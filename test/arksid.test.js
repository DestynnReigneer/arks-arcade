'use strict';

// The arcade signing in through ARKS ID (arcade/arksid.js), against a second
// server started with ARKS_ID_URL set and a pretend ARKS ID (fake-arksid.js).

const path = require('node:path');

async function run({ base, root, fake, admin: ADMIN }) {
  let pass = 0;
  let fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };

  // A browser: keeps cookies, follows redirects itself (across both servers).
  function browser() {
    const jar = new Map();
    async function call(url, { method = 'GET', body, headers = {}, follow = true } = {}) {
      let target = url.startsWith('http') ? url : base + url;
      for (let hop = 0; hop < 8; hop++) {
        const h = { ...headers };
        const host = new URL(target).host;
        const mine = [...jar].filter(([k]) => k.startsWith(host + ' ')).map(([k, v]) => `${k.split(' ')[1]}=${v}`);
        if (mine.length) h.Cookie = mine.join('; ');
        if (body !== undefined) h['Content-Type'] = 'application/json';
        const res = await fetch(target, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
        for (const c of res.headers.getSetCookie()) {
          const [pair] = c.split(';');
          const i = pair.indexOf('=');
          const k = `${host} ${pair.slice(0, i)}`, v = pair.slice(i + 1);
          if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
        }
        if (follow && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          target = new URL(res.headers.get('location'), target).href;
          method = 'GET'; body = undefined;
          continue;
        }
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { data = text; }
        return { status: res.status, data, url: target, location: res.headers.get('location') };
      }
      throw new Error('too many redirects');
    }
    return { call, jar, me: () => call('/api/arksid/me').then(r => r.data) };
  }
  const asAdmin = (p, method = 'GET', body) => fetch(base + p, {
    method, headers: { 'X-Admin-Token': ADMIN, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));

  console.log('\n-- whose device is this (guest play) --');
  const visitor = browser();
  let me = await visitor.me();
  ok('ARKS ID mode is on; nobody signed in; the device is not checked yet', me.on && !me.signedIn && !me.deviceChecked);
  fake.deviceOwner = null;
  const peek = await visitor.call('/auth/device?return=%2Frambler.html');
  ok('the device check goes to ARKS ID and comes straight back', peek.url === base + '/rambler.html', peek.url);
  me = await visitor.me();
  ok('a visitor\'s phone may play as a guest', me.deviceChecked && me.guestAllowed);
  const kidsTablet = browser();
  fake.deviceOwner = 'milo';
  await kidsTablet.call('/auth/device?return=%2F');
  ok('a family member\'s device may not', (await kidsTablet.me()).guestAllowed === false);
  const adminPhone = browser();
  fake.deviceOwner = 'sam';
  await adminPhone.call('/auth/device?return=%2F');
  ok('an admin\'s phone may, to hand it to a visitor', (await adminPhone.me()).guestAllowed === true);
  const forged = browser();
  forged.jar.set(`${new URL(base).host} arcade_dev`, '0.-.99999999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  ok('a made-up device cookie counts for nothing', (await forged.me()).deviceChecked === false);

  console.log('\n-- signing in --');
  // An arcade profile from before, with the same name: it gets linked.
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(root, 'data', 'test-arksid.db');
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO arcade_profiles (id, name, avatar, status, pin_hash, pin_salt) VALUES ('abcdefabcdef0001', 'Milo', 'emoji:🦖', 'approved', 'x', 'y')").run();
  db.close();
  const milo = browser();
  fake.next = 'milo';
  const signed = await milo.call('/auth/signin?return=%2Fchess.html');
  ok('signing in goes to ARKS ID and back to the page it started on', signed.url === base + '/chess.html', signed.url);
  me = await milo.me();
  ok('…as the old profile with the same name, scores and all', me.signedIn && me.profile.id === 'abcdefabcdef0001' && me.profile.avatar === 'emoji:🦖');
  ok('…its old PIN is off, and the boards show the initials chosen in ARKS ID', !me.profile.hasPin && me.profile.boardShow === 'initials' && me.profile.initials === 'MIL');
  ok('…and the token works like any profile token', /^abcdefabcdef0001\./.test(me.token));
  ok('a role is reported, and a kid is not a grown-up', me.role === 'kid' && me.adult === false);
  ok('nobody asks for an arcade profile anymore', (await milo.call('/api/profiles', { method: 'POST', body: { name: 'Sneaky' } })).status === 403);
  ok('or picks one with a PIN', (await milo.call('/api/profiles/abcdefabcdef0001/use', { method: 'POST', body: { pin: '123456' } })).status === 403);
  ok('the boards choice is made in ARKS ID', (await milo.call('/api/profiles/abcdefabcdef0001', { method: 'PATCH', body: { token: me.token, boardShow: 'name' } })).status === 403);
  ok('the avatar is still the arcade\'s own', (await milo.call('/api/profiles/abcdefabcdef0001', { method: 'PATCH', body: { token: me.token, avatar: 'emoji:🐙' } })).status === 200);
  const fresh = browser();
  fake.next = 'alex';
  await fresh.call('/auth/signin?return=%2F');
  const alex = await fresh.me();
  ok('someone with no matching profile gets a new one', alex.signedIn && alex.profile.name === 'Alex' && alex.profile.id !== 'abcdefabcdef0001');

  console.log('\n-- adult levels follow the role --');
  ok('a kid gets no adult pass', (await milo.call('/api/arksid/adult-pass', { method: 'POST' })).status === 403);
  ok('neither does someone signed out', (await visitor.call('/api/arksid/adult-pass', { method: 'POST' })).status === 401);
  const p = await fresh.call('/api/arksid/adult-pass', { method: 'POST' });
  ok('a grown-up does', p.status === 200 && /^ap\./.test(p.data.pass));
  ok('…and it works wherever the adult PIN did', (await visitor.call('/api/adult-check', { method: 'POST', body: { pin: p.data.pass } })).data.ok === true &&
    (await visitor.call('/api/trivia/unlock', { method: 'POST', body: { pin: p.data.pass } })).data.ok === true);
  ok('a PIN does nothing', (await visitor.call('/api/adult-check', { method: 'POST', body: { pin: '123456' } })).data.ok === false);
  ok('a tampered pass does nothing', (await visitor.call('/api/adult-check', { method: 'POST', body: { pin: p.data.pass.slice(0, -2) + 'xx' } })).data.ok === false);
  ok('the games say an unlock is needed', (await visitor.call('/api/arcade-info')).data.adultRequiresPin === true);
  fake.users.alex.role = 'teen';
  await fresh.call('/auth/signin?return=%2F');
  ok('a role change takes the pass away', (await visitor.call('/api/adult-check', { method: 'POST', body: { pin: p.data.pass } })).data.ok === false);
  ok('there is no adult PIN to set', (await asAdmin('/api/comm/admin/adult-pin', 'POST', { pin: '654321' })).status === 400);

  console.log('\n-- admin links and clips --');
  const accounts = await asAdmin('/api/profiles/admin/accounts');
  ok('the admin sees every account the arcade has met', accounts.data.on && accounts.data.accounts.length === 2);
  const list = (await asAdmin('/api/profiles/admin')).data;
  ok('…and which profile each one plays as', list.find(x => x.id === 'abcdefabcdef0001').account.name === 'Milo');
  const sent = await asAdmin('/api/custom/admin/send', 'POST', { clip: 'rickroll', to: 'abcdefabcdef0001' });
  ok('a clip is sent through ARKS ID to the person', sent.status === 200 && fake.inbox.milo[0] === 'rickroll', JSON.stringify(sent.data));
  const got = await milo.call('/api/custom/inbox', { method: 'POST', body: {} });
  ok('…and plays for them once', got.data.clip && got.data.clip.name === 'rickroll' && !(await milo.call('/api/custom/inbox', { method: 'POST', body: {} })).data.clip);
  const moved = await asAdmin('/api/profiles/admin/abcdefabcdef0001/link', 'POST', { arksid_user: 'u_alex000001' });
  ok('the admin can move a wrong link', moved.status === 200 && (await asAdmin('/api/profiles/admin/accounts')).data.accounts.find(a => a.name === 'Alex').profile_id === 'abcdefabcdef0001');

  console.log('\n-- signing out --');
  const out = await milo.call('/auth/signout', { method: 'POST', follow: false });
  ok('signing out ends the arcade sign-in and goes on to ARKS ID\'s sign-out', out.data.next === `${fake.base}/signout?app=arcade&return=%2F`);
  ok('…and the device is signed out', (await milo.me()).signedIn === false);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
