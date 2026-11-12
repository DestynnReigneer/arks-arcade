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
  ok('…as the old profile with the same name, scores and all', me.signedIn && me.profile.id === 'abcdefabcdef0001');
  ok('…wearing the character picked in ARKS ID', me.profile.avatar === 'toon:2', me.profile.avatar);
  ok('…its old PIN is off, and the boards show the initials chosen in ARKS ID', !me.profile.hasPin && me.profile.boardShow === 'initials' && me.profile.initials === 'MIL');
  ok('…and the token works like any profile token', /^abcdefabcdef0001\./.test(me.token));
  ok('a role is reported, and a kid is not an adult', me.role === 'kid' && me.adult === false);
  ok('nobody asks for an arcade profile anymore', (await milo.call('/api/profiles', { method: 'POST', body: { name: 'Sneaky' } })).status === 403);
  ok('or picks one with a PIN', (await milo.call('/api/profiles/abcdefabcdef0001/use', { method: 'POST', body: { pin: '123456' } })).status === 403);
  ok('the boards choice is made in ARKS ID', (await milo.call('/api/profiles/abcdefabcdef0001', { method: 'PATCH', body: { token: me.token, boardShow: 'name' } })).status === 403);
  ok('the avatar is picked in ARKS ID too', (await milo.call('/api/profiles/abcdefabcdef0001', { method: 'PATCH', body: { token: me.token, avatar: 'emoji:🐙' } })).status === 403);
  // Silent sign-in (v8): nobody signed in to ARKS ID, so straight back, still signed out.
  const quiet = browser();
  fake.next = null;
  const miss = await quiet.call('/auth/signin?silent=1&return=%2Fsnake.html');
  ok('a silent try with nobody signed in comes straight back to the page', miss.url === base + '/snake.html', miss.url);
  ok('…still signed out', !(await quiet.me()).signedIn);
  const fresh = browser();
  fake.next = 'alex';
  await fresh.call('/auth/signin?silent=1&return=%2F');
  const alex = await fresh.me();
  ok('someone with no matching profile gets a new one', alex.signedIn && alex.profile.name === 'Alex' && alex.profile.id !== 'abcdefabcdef0001');
  ok('…showing their ARKS ID icon in its color', alex.profile.avatar === 'arks:cat:teal', alex.profile.avatar);

  console.log('\n-- a guest makes an account --');
  const guestPhone = browser();
  const su = await guestPhone.call('/auth/signup', { method: 'POST', body: { name: 'Zed', avatar: 'shiba:4', return: '/chess.html' } });
  const to = new URL(su.data.url);
  const handed = fake.prefills.get(to.searchParams.get('prefill')) || {};
  ok('it goes to the sign-in service with a prefill token, not the name', to.pathname === '/signin' && /^[A-Za-z0-9_-]{20,}$/.test(to.searchParams.get('prefill') || '') && !su.data.url.includes('Zed'));
  ok('…and the name and avatar were handed over', handed.name === 'Zed' && handed.art === 'shiba:4');
  const odd = await guestPhone.call('/auth/signup', { method: 'POST', body: { name: '', avatar: 'arks:cat:teal' } });
  ok('nothing to hand over: the plain sign-up page', !new URL(odd.data.url).searchParams.get('prefill'));

  console.log('\n-- adult levels follow the role --');
  ok('a kid gets no adult pass', (await milo.call('/api/arksid/adult-pass', { method: 'POST' })).status === 403);
  ok('neither does someone signed out', (await visitor.call('/api/arksid/adult-pass', { method: 'POST' })).status === 401);
  const p = await fresh.call('/api/arksid/adult-pass', { method: 'POST' });
  ok('an adult does', p.status === 200 && /^ap\./.test(p.data.pass));
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
  fake.inbox.milo = ['meme-cat'];
  const meme = (await milo.call('/api/custom/inbox', { method: 'POST', body: {} })).data.clip;
  ok('a meme sent from another app shows the picture from the images folder', meme && meme.meme === true && meme.url === '/custom/media/images/cat.gif', JSON.stringify(meme));
  fake.inbox.milo = ['meme-nope'];
  ok('…and one this arcade has no file for is skipped', !(await milo.call('/api/custom/inbox', { method: 'POST', body: {} })).data.clip);
  const moved = await asAdmin('/api/profiles/admin/abcdefabcdef0001/link', 'POST', { arksid_user: 'u_alex000001' });
  ok('the admin can move a wrong link', moved.status === 200 && (await asAdmin('/api/profiles/admin/accounts')).data.accounts.find(a => a.name === 'Alex').profile_id === 'abcdefabcdef0001');

  console.log('\n-- ARKS ID photos and team pictures --');
  // A fetch that sends a browser's cookies and keeps the raw bytes.
  const host = new URL(base).host;
  const getPicture = async (b, url, headers = {}) => {
    const cookie = b ? [...b.jar].filter(([k]) => k.startsWith(host + ' ')).map(([k, v]) => `${k.split(' ')[1]}=${v}`).join('; ') : '';
    const res = await fetch(base + url, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    return { status: res.status, type: res.headers.get('content-type') || '', body: Buffer.from(await res.arrayBuffer()) };
  };
  const kim = browser();
  fake.next = 'kim';
  await kim.call('/auth/signin?return=%2F');
  let kimMe = await kim.me();
  const kimAvatar = kimMe.profile && kimMe.profile.avatar;
  ok('a photo picked in ARKS ID becomes the avatar, with the icon kept to fall back on', /^photo:[A-Za-z0-9]+:[0-9a-f]{8}:arks:star:pink$/.test(kimAvatar), kimAvatar);
  const photoUrl = av => `/api/arksid/photo/${kimMe.profile.id}?v=${av.split(':')[2]}`;
  const before = fake.photoFetches;
  let pic = await getPicture(kim, photoUrl(kimAvatar));
  ok('the arcade serves the photo from its own address', pic.status === 200 && pic.type.startsWith('image/webp') && pic.body.subarray(0, 4).toString() === 'RIFF', `${pic.status} ${pic.type}`);
  await getPicture(kim, photoUrl(kimAvatar));
  ok('…fetching it from ARKS ID once and keeping it for a while', fake.photoFetches === before + 1, String(fake.photoFetches - before));
  ok('the admin page can show it too', (await getPicture(null, photoUrl(kimAvatar), { 'X-Admin-Token': ADMIN })).status === 200);
  ok('someone not signed in gets no photo, so their page draws the icon', (await getPicture(visitor, photoUrl(kimAvatar))).status === 404);
  ok('an address that isn\'t a profile gets nothing', (await getPicture(kim, '/api/arksid/photo/..%2F..%2Fetc')).status === 404);
  const csp = (await fetch(base + '/')).headers.get('content-security-policy') || '';
  ok('pages still only load pictures from the arcade itself', /img-src 'self' data:(;|$)/.test(csp), csp);
  fake.users.kim.avatar.image = `${fake.base}/avatars/teams/faithful.png`;
  await kim.call('/auth/signin?return=%2F');
  kimMe = await kim.me();
  pic = await getPicture(kim, photoUrl(kimMe.profile.avatar));
  ok('a team picture works the same way, under a new address', kimMe.profile.avatar !== kimAvatar && pic.status === 200 && pic.type.startsWith('image/png'), `${kimMe.profile.avatar} ${pic.status} ${pic.type}`);
  fake.users.kim.avatar.image = `${fake.base}/avatars/u_fake000001.webp?v=1`;
  await kim.call('/auth/signin?return=%2F');
  kimMe = await kim.me();
  ok('a file that only claims to be a picture is never served', (await getPicture(kim, photoUrl(kimMe.profile.avatar))).status === 404);
  fake.users.kim.avatar.image = 'https://elsewhere.example.com/avatars/u_kim0000001.webp';
  await kim.call('/auth/signin?return=%2F');
  kimMe = await kim.me();
  ok('a picture on some other site is ignored, and the icon shows', kimMe.profile.avatar === 'arks:star:pink', kimMe.profile.avatar);
  fake.users.kim.avatar.image = null;

  console.log('\n-- feedback pictures when the folder is full --');
  // This server was started with a tiny cap, so any picture is one too many.
  // The pretend ARKS ID acts like one without the feedback inbox, so the
  // arcade keeps these notes itself, as it does without ARKS ID.
  fake.inboxMissing = true;
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const smallPng = 'data:image/png;base64,' + Buffer.concat([pngHead, Buffer.alloc(200)]).toString('base64');
  const miloToken = (await milo.me()).token;
  const full1 = await milo.call('/api/comm/feedback', { method: 'POST', body: { message: 'Look at this', picture: smallPng, profileToken: miloToken } });
  ok('the note still arrives, without its picture, and says so kindly', full1.status === 201 && full1.data.pictureDropped === true && /no room left/.test(full1.data.note), JSON.stringify(full1.data));
  await milo.call('/api/comm/feedback', { method: 'POST', body: { message: 'And this', picture: smallPng, profileToken: miloToken } });
  const inbox = (await asAdmin('/api/comm/admin/feedback')).data.items;
  const flags = inbox.filter(i => i.from === 'The arcade');
  ok('the admin is told once in the Comm Center, not for every note', flags.length === 1 && /500 MB/.test(flags[0].message), String(flags.length));
  ok('…and the notes themselves have no picture', inbox.filter(i => /^(Look at this|And this)$/.test(i.message)).every(i => !i.hasPicture));
  fake.inboxMissing = false;

  console.log('\n-- feedback goes to ARKS ID\'s one inbox --');
  // Milo signs in again (an earlier part of the suite signed this device out).
  fake.next = 'milo';
  await milo.call('/auth/signin?return=%2F');
  const localBefore = (await asAdmin('/api/comm/admin/feedback')).data.items.length;
  const fwd = await milo.call('/api/comm/feedback', { method: 'POST', body: { kind: 'issue', message: 'Snake is too fast.', game: 'snake', from: 'Not Milo', profileToken: miloToken, picture: smallPng, details: { page: '/snake.html?room=secret' } } });
  ok('a note is passed on to ARKS ID, and the sender is told it arrived', fwd.status === 201 && fwd.data.forwarded === true, JSON.stringify(fwd.data));
  const n1 = fake.notes[fake.notes.length - 1];
  ok('…as ARKS ID\'s kind, from the signed-in account, never a typed name', n1 && n1.kind === 'broken' && n1.person.user === 'u_milo000001' && !n1.person.guestName, JSON.stringify(n1 && n1.person));
  ok('…with its picture (not stored here, so the full folder doesn\'t matter)', n1.picture === true);
  ok('…with the game and device as the arcade\'s own facts, and the page without its ? part', n1.details.extra.game === 'snake' && /,/.test(n1.details.extra.device) && n1.details.page === '/snake.html', JSON.stringify(n1.details.extra));
  ok('…and nothing new in the Comm Center\'s own inbox', (await asAdmin('/api/comm/admin/feedback')).data.items.length === localBefore);
  const guestFb = await visitor.call('/api/comm/feedback', { method: 'POST', body: { kind: 'feature', message: 'Add mini golf!', from: 'Zed' } });
  ok('a guest\'s note goes with the name they typed', guestFb.status === 201 && fake.notes[fake.notes.length - 1].person.guestName === 'Zed' && fake.notes[fake.notes.length - 1].kind === 'idea');

  const mine = (b, p, body = {}) => b.call('/api/comm/mine' + p, { method: 'POST', body });
  let myList = (await mine(milo, '', { view: 'open' })).data.items;
  ok('My feedback comes from ARKS ID, in the arcade\'s words', myList.length === 1 && myList[0].id === n1.id && myList[0].message === 'Snake is too fast.' && myList[0].status === 'new' && myList[0].kind === 'issue', JSON.stringify(myList));
  fake.adminReply(n1.id, 'Which level?');
  fake.setStage(n1.id, 'seen');
  let thread = (await mine(milo, `/${n1.id}`)).data.thread;
  ok('the admin\'s reply from ARKS ID\'s console shows up here, and Seen reads as Seen', thread.status === 'pending' && thread.replies[0].fromAdmin && thread.replies[0].body === 'Which level?');
  ok('the sender answers', (await mine(milo, `/${n1.id}/reply`, { body: 'Level 3.' })).status === 201 && fake.notes.find(n => n.id === n1.id).replies[1].body === 'Level 3.');
  ok('…and fixes what they wrote', (await mine(milo, `/${n1.id}/edit`, { message: 'Snake is too fast on level 3.' })).status === 200 && fake.notes.find(n => n.id === n1.id).body === 'Snake is too fast on level 3.');
  fake.setStage(n1.id, 'wontfix');
  myList = (await mine(milo, '', { view: 'archive' })).data.items;
  ok('Won\'t fix in ARKS ID is the arcade\'s "canceled", in the Archive', myList.length === 1 && myList[0].status === 'canceled');
  ok('…and can\'t be edited anymore', (await mine(milo, `/${n1.id}/edit`, { message: 'again' })).status === 409);
  ok('Delete my copy goes through to ARKS ID', (await mine(milo, `/${n1.id}/delete`)).status === 200 && (await mine(milo, '', { view: 'archive' })).data.items.length === 0);
  ok('someone not signed in has no My feedback here', (await mine(visitor, '', { view: 'open' })).status === 401);

  // The admin page: a pointer to ARKS ID, and the older notes read-only.
  const page = (await asAdmin('/api/comm/admin/feedback')).data;
  ok('the admin page says where feedback lives now', page.inbox && page.inbox.url === `${fake.base}/admin` && page.inbox.waiting === 0, JSON.stringify(page.inbox));
  const old = page.items.find(i => i.message === 'Look at this');
  ok('older notes can\'t change status, get replies or be deleted', (await asAdmin(`/api/comm/admin/feedback/${old.id}`, 'PATCH', { status: 'completed' })).status === 409 &&
    (await asAdmin(`/api/comm/admin/feedback/${old.id}/replies`, 'POST', { body: 'Thanks' })).status === 409 &&
    (await asAdmin(`/api/comm/admin/feedback/${old.id}`, 'DELETE')).status === 409);
  const noted = await asAdmin(`/api/comm/admin/feedback/${old.id}`, 'PATCH', { status: old.status, note: 'Asked Milo about it' });
  ok('…but the admin\'s private note to self still saves', noted.status === 200 && noted.data.note === 'Asked Milo about it');

  fake.feedbackDown = true;
  const notesBefore = fake.notes.length;
  const queued = await milo.call('/api/comm/feedback', { method: 'POST', body: { message: 'Is anyone there?', profileToken: miloToken } });
  ok('with ARKS ID away, the sender is still told it arrived, and it waits to go later', queued.status === 201 && queued.data.forwarded === true && fake.notes.length === notesBefore &&
    (await asAdmin('/api/comm/admin/feedback')).data.inbox.waiting === 1);
  fake.feedbackDown = false;

  console.log('\n-- status reports --');
  // The first report goes a few seconds after the server starts.
  for (let i = 0; i < 40 && !fake.reports.length; i++) await new Promise(r => setTimeout(r, 250));
  const report = fake.reports[0] || {};
  ok('the arcade tells the sign-in service how it is doing, a few seconds after starting', fake.reports.length >= 1, JSON.stringify(fake.reports));
  ok('…with its build, Node version and how long it has been up', typeof report.version === 'string' && typeof report.commit === 'string' &&
    report.node === process.versions.node && Number.isInteger(report.uptimeSec), JSON.stringify(report));
  ok('…its database size and the free disk space where its data lives', report.dbBytes > 0 && report.diskTotalBytes > 0 &&
    report.diskFreeBytes >= 0 && report.diskFreeBytes <= report.diskTotalBytes, JSON.stringify(report));

  console.log('\n-- criss cross: adults only on the unfiltered list --');
  const kimCB = browser();
  fake.next = 'kim';
  await kimCB.call('/auth/signin?return=%2F');
  const samCB = browser();
  fake.next = 'sam';
  await samCB.call('/auth/signin?return=%2F');
  const [kimCC, samCC, miloCC] = [await kimCB.me(), await samCB.me(), await milo.me()];
  const kimPass = (await kimCB.call('/api/arksid/adult-pass', { method: 'POST' })).data.pass;
  const samPass = (await samCB.call('/api/arksid/adult-pass', { method: 'POST' })).data.pass;
  const cc = (p, who, { method = 'GET', body, pass } = {}) => fetch(`${base}/api/crisscross${p}`, {
    method, headers: { 'X-Profile-Token': who.token, ...(pass ? { 'X-Adult-Pin': pass } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
  const invitable = (await cc('/people', kimCC)).data;
  ok('the invite list says who could join an unfiltered game', invitable.find(p => p.id === miloCC.profile.id).adultOk === false &&
    invitable.find(p => p.id === samCC.profile.id).adultOk === true);
  const withKid = await cc('/games', kimCC, { method: 'POST', body: { kind: 'online', invite: [miloCC.profile.id], dictionary: 'adult' }, pass: kimPass });
  ok('a kid can\'t be invited to an unfiltered game', withKid.status === 403 && /Milo/.test(withKid.data.error), JSON.stringify(withKid.data));
  const grown = await cc('/games', kimCC, { method: 'POST', body: { kind: 'online', invite: [samCC.profile.id], dictionary: 'adult' }, pass: kimPass });
  ok('two adults can play one', grown.status === 201);
  ok('…each opening it with their own adult pass', (await cc(`/games/${grown.data.id}`, samCC)).status === 403 &&
    (await cc(`/games/${grown.data.id}`, samCC, { pass: samPass })).status === 200);
  ok('a kid holding an adult\'s pass still can\'t start one', (await cc('/games', miloCC, { method: 'POST', body: { kind: 'local', players: [{ name: 'A' }, { name: 'B' }], dictionary: 'adult' }, pass: kimPass })).status === 403);
  ok('a kid can start a family-words game with an adult', (await cc('/games', miloCC, { method: 'POST', body: { kind: 'online', invite: [kimCC.profile.id] } })).status === 201);

  console.log('\n-- notifications: your turn in Words with Family --');
  // Notifications go out in the background, so wait for them to land (or for nothing to).
  const settle = async (want = 1) => { for (let i = 0; i < 40 && fake.pushes.length < want; i++) await new Promise(r => setTimeout(r, 50)); await new Promise(r => setTimeout(r, 150)); };
  const sub = n => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'x', auth: 'y' } });
  ok('the page gets the key to turn notifications on with', (await browser().call('/api/push/key')).data.publicKey === 'B' + 'A'.repeat(86));
  ok("someone signed out can't turn them on", (await browser().call('/api/push/subscribe', { method: 'POST', body: { subscription: sub('nobody') } })).status === 401);
  ok('a signed-in phone turns them on', (await samCB.call('/api/push/subscribe', { method: 'POST', body: { subscription: sub('sam') } })).status === 200 &&
    fake.pushSubs[fake.users.sam.id].length === 1);
  ok("…and something that isn't a push address is turned away", (await samCB.call('/api/push/subscribe', { method: 'POST', body: { subscription: sub('x').endpoint } })).status === 400);
  await kimCB.call('/api/push/subscribe', { method: 'POST', body: { subscription: sub('kim') } });
  fake.pushes.length = 0;
  const ng = await cc('/games', kimCC, { method: 'POST', body: { kind: 'online', invite: [samCC.profile.id] } });
  await settle();
  const toSam = fake.pushes.filter(p => p.to === fake.users.sam.id), toKim = () => fake.pushes.filter(p => p.to === fake.users.kim.id);
  ok('starting a game tells the person invited, with a link straight to it', toSam.length === 1 && /^Kim started a game with you[.,]/.test(toSam[0].body) &&
    toSam[0].url === `/crisscross.html?game=${ng.data.id}` && toSam[0].tag === `ww-${ng.data.id}`, JSON.stringify(fake.pushes));
  ok('…and not the one who started it', toKim().length === 0);
  // Whoever goes first passes; the other one hears about it.
  let g = (await cc(`/games/${ng.data.id}`, kimCC)).data;
  const [first, second, secondKey] = g.you === g.turn ? [kimCC, samCC, 'sam'] : [samCC, kimCC, 'kim'];
  const firstName = first === kimCC ? 'Kim' : 'Sam';
  fake.pushes.length = 0;
  ok('a move goes through', (await cc(`/games/${ng.data.id}/pass`, first, { method: 'POST', body: {} })).status === 200);
  await settle();
  const told = fake.pushes.filter(p => p.to === fake.users[secondKey].id);
  ok("…and the next player hears it's their turn, and what was played", fake.pushes.length === 1 && told.length === 1 &&
    told[0].body === `${firstName} passed. Your move!` && told[0].title === 'Words with Family', JSON.stringify(fake.pushes));
  fake.pushDown = true;
  ok("a move still goes through when the notification can't be sent", (await cc(`/games/${ng.data.id}/pass`, second, { method: 'POST', body: {} })).status === 200);
  await settle();
  fake.pushDown = false;
  ok('a game against the computer never sends any', await (async () => {
    fake.pushes.length = 0;
    await cc('/games', kimCC, { method: 'POST', body: { kind: 'local', players: [{ name: 'Kim' }, { name: 'Computer', bot: true }] } });
    await settle();
    return fake.pushes.length === 0;
  })());
  console.log('\n-- notifications: Chess invites --');
  {
    const chessCall = (p, who, body) => fetch(`${base}/api/chess${p}`, {
      method: 'POST', headers: { 'X-Profile-Token': who.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
    const hostRoom = (await chessCall('/rooms', kimCC, { color: 'w' })).data;
    const seat = { playerId: hostRoom.playerId, token: hostRoom.token };
    fake.pushes.length = 0;
    await chessCall(`/rooms/${hostRoom.code}/invite`, kimCC, { ...seat, to: [samCC.profile.id] });
    await settle();
    const first = fake.pushes.filter(p => p.to === fake.users.sam.id);
    ok('a Chess invite tells the person invited, with a link to the lobby', first.length === 1 && first[0].body === 'Kim invited you to Chess. Get in here!' &&
      first[0].url === `chess.html?room=${hostRoom.code}`, JSON.stringify(fake.pushes));
    fake.pushes.length = 0;
    for (let i = 0; i < 3; i++) await chessCall(`/rooms/${hostRoom.code}/invite`, kimCC, { ...seat, to: [samCC.profile.id] });
    await settle(1);
    ok('…and inviting them again straight away doesn\'t buzz their phone again', fake.pushes.length === 0, JSON.stringify(fake.pushes));
    ok('…and a list that isn\'t a list is a clear error, not a crash', (await chessCall(`/rooms/${hostRoom.code}/invite`, kimCC, { ...seat, to: samCC.profile.id })).status === 400);
    await chessCall(`/rooms/${hostRoom.code}/leave`, kimCC, seat);
  }

  ok('a phone can turn them off again', (await samCB.call('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub('sam').endpoint } })).status === 200 &&
    fake.pushSubs[fake.users.sam.id].length === 0);
  await samCB.call('/api/push/subscribe', { method: 'POST', body: { subscription: sub('sam2') } });
  await samCB.call('/auth/signout', { method: 'POST' });
  ok('signing out on a phone stops its notifications', fake.pushSubs[fake.users.sam.id].length === 0, JSON.stringify(fake.pushSubs[fake.users.sam.id]));

  console.log('\n-- game switches and the banner from the sign-in service --');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const guest = browser();
  const closedFor = async b => (await b.call('/api/arcade-info')).data.games.closed;
  // A no-op save on the admin page's game list: it also sends the list again
  // and forgets the answers it kept, so the next question is a fresh one.
  const resave = async (closed) => {
    const h = (await asAdmin('/api/comm/admin/home-games')).data;
    return asAdmin('/api/comm/admin/home-games', 'POST', { order: h.order, hidden: h.hidden, closed: closed || h.closed, sort: h.sort });
  };
  const home = (await asAdmin('/api/comm/admin/home-games')).data;
  ok('the admin page says the sign-in service can switch games too', home.arksId === true);
  for (let i = 0; i < 40 && !fake.features; i++) await wait(250);
  const chessF = (fake.features || []).find(x => x.key === 'game.chess');
  ok('the arcade tells it every game, named, each on for everyone by default',
    !!fake.features && fake.features.every(x => x.key.startsWith('game.') && x.group === 'Games') && fake.features.length >= 14 &&
    !!chessF && chessF.name === 'Chess' && chessF.on === true && chessF.roles.guest === true && chessF.roles.kid === true, JSON.stringify(chessF));
  ok('nothing is closed until someone closes something', (await closedFor(guest)).length === 0 && (await closedFor(milo)).length === 0);

  await resave(['snake']);
  for (let i = 0; i < 40 && (fake.features.find(x => x.key === 'game.snake') || {}).on !== false; i++) await wait(250);
  ok('turning a game off on the admin page still works, and becomes its default there', (await closedFor(guest)).includes('snake') &&
    fake.features.find(x => x.key === 'game.snake').on === false);

  fake.set['game.chess'] = { all: false };
  await resave();
  ok('Chess turned off for everyone in the sign-in service closes it for guests and the signed in', (await closedFor(guest)).includes('chess') &&
    (await closedFor(milo)).includes('chess'));
  fake.set['game.chess'].people = { [fake.users.milo.id]: 'on' };
  await resave();
  ok('…except for someone it turned on for', !(await closedFor(milo)).includes('chess') && (await closedFor(guest)).includes('chess'));
  fake.set['game.snake'] = { all: true };
  await resave();
  ok('a game the sign-in service turned on opens, even when the admin page has it off', !(await closedFor(guest)).includes('snake'));
  fake.set = {};
  await resave([]);
  ok('…and with nothing set there, everything is back the way it was', (await closedFor(guest)).length === 0);

  fake.banner = { id: 3, text: 'The arcade is getting an update tonight at 9.', tone: 'warning', until: null, at: Date.now() };
  const bn = (await guest.call('/api/banner')).data;
  ok('the banner from the sign-in service is handed to the pages', !!bn.banner && bn.banner.text === fake.banner.text && bn.banner.tone === 'warning', JSON.stringify(bn));
  const chessPage = await fetch(base + '/chess.html').then(r => r.text());
  ok('…and every page loads the banner script', chessPage.includes('<script src="banner.js" defer></script>'));

  console.log('\n-- the admin page: an ARKS ID admin is straight in --');
  {
    const sam = browser();
    fake.next = 'sam';
    await sam.call('/auth/signin?return=%2Fadmin.html');
    const s = (await sam.call('/api/admin/session')).data;
    ok('an ARKS ID admin is straight into the admin page, with no PIN or password', s.admin === true && s.signedIn === true && s.arksId === true, JSON.stringify(s));
    ok('…and the admin routes answer them', (await sam.call('/api/admin/version')).status === 200 && (await sam.call('/api/admin/scores')).status === 200);
    const kid = browser();
    fake.next = 'milo';
    await kid.call('/auth/signin?return=%2Fadmin.html');
    const k = (await kid.call('/api/admin/session')).data;
    ok('a kid signed in with ARKS ID is not the admin', k.admin === false && k.arksId === true, JSON.stringify(k));
    ok('…and the admin routes turn them away', (await kid.call('/api/admin/version')).status === 401);
    const lost = browser();
    const ways = (await lost.call('/api/admin/session')).data;
    ok('recovery: the page learns there\'s a PIN and a password to try', ways.admin === false && ways.hasPin === true && ways.hasPassword === true);
    ok('…a wrong PIN is refused', (await lost.call('/api/admin/login', { method: 'POST', body: { pin: '000000' } })).status === 401);
    ok('…the admin PIN from setup opens it', (await lost.call('/api/admin/login', { method: 'POST', body: { pin: '135790' } })).status === 200);
    const r = (await lost.call('/api/admin/session')).data;
    ok('…as recovery, not as an ARKS ID admin', r.admin === true && r.signedIn === false && (await lost.call('/api/admin/version')).status === 200);

    // Signing out takes the admin page with it.
    const adultThemes = async who => ((await who.call('/api/themes')).data || []).filter(t => t.adult).length;
    const all = (await browser().call('/api/themes', { headers: { 'X-Admin-Token': ADMIN } })).data.filter(t => t.adult).length;
    ok('an ARKS ID admin on the admin page sees the adult themes too', all > 0 && await adultThemes(sam) === all, `${await adultThemes(sam)} of ${all}`);
    await sam.call('/auth/signout', { method: 'POST', follow: false });
    ok('…and after signing out of the arcade, that browser doesn\'t', await adultThemes(sam) === 0);
    ok('…and the admin page turns it away', (await sam.call('/api/admin/version')).status === 401 && (await sam.call('/api/admin/session')).data.admin === false);
    fake.next = 'milo';
  }

  console.log('\n-- signing out --');
  const out = await milo.call('/auth/signout', { method: 'POST', follow: false });
  ok('signing out ends the arcade sign-in and goes on to ARKS ID\'s sign-out', out.data.next === `${fake.base}/signout?app=arcade&return=%2F`);
  ok('…and the device is signed out', (await milo.me()).signedIn === false);

  console.log('\n-- the admin page: wrong recovery tries pause --');
  {
    // Last in this suite: it pauses this address on purpose.
    const guesser = browser();
    for (let i = 0; i < 9; i++) await guesser.call('/api/admin/login', { method: 'POST', body: { pin: '000000' } });
    const tenth = await guesser.call('/api/admin/login', { method: 'POST', body: { password: 'not it either' } });
    ok('wrong PINs and passwords count together', tenth.status === 401);
    const after = await guesser.call('/api/admin/login', { method: 'POST', body: { pin: '135790' } });
    ok('…and after ten, even the right PIN waits', after.status === 429);
    ok('…and so does the password header', (await browser().call('/api/admin/version', { headers: { 'X-Admin-Token': ADMIN } })).status === 429);
    ok('a write from another site is refused', (await guesser.call('/api/admin/logout', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } })).status === 403);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
