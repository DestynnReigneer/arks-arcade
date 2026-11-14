'use strict';

// The arcade on a TV with ARKS ID (contract v14), against the pretend ARKS ID
// (fake-arksid.js): setting the TV up with a pairing code, family mode by
// default, adults' night unlocked from an adult's phone, Back to family,
// games reported while they're played, and adult games still turning a
// kid's phone away.

async function run({ base, fake }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // A browser that keeps this arcade's cookies (and doesn't follow redirects).
  function browser() {
    const jar = new Map();
    async function call(p, { method = 'GET', body, headers = {} } = {}) {
      const h = { ...headers };
      if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const k = pair.slice(0, i), v = pair.slice(i + 1);
        if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
      }
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, location: res.headers.get('location') };
    }
    return { call, jar, post: (p, body = {}) => call(p, { method: 'POST', body }) };
  }

  console.log('\n-- setting up a TV --');
  const tv = browser();
  let st = (await tv.call('/api/tv/state')).data;
  ok('a new TV is not signed in yet', st.on === true && st.signedIn === false && st.tv === null);
  const started = await tv.post('/api/tv/pair');
  ok('it gets a 6-letter code and a QR code of the address to scan', started.status === 200 && /^[A-Z]{6}$/.test(started.data.userCode) &&
    started.data.pairUrl === `${fake.base}/tv/${started.data.userCode}` && started.data.qr.startsWith('data:image/svg+xml;base64,'));
  ok('the poll token stays on the arcade\'s server', !JSON.stringify(started.data).includes('pollToken') && !!tv.jar.get('arcade_tvpair'));
  let poll = (await tv.call('/api/tv/pair')).data;
  ok('nobody has answered yet', poll.status === 'pending');
  const polls = fake.tvCalls.filter(c => c === 'poll').length;
  for (let i = 0; i < 3; i++) await tv.call('/api/tv/pair');
  ok('the page asking often doesn\'t make the arcade ask ARKS ID sooner than it may', fake.tvCalls.filter(c => c === 'poll').length === polls);
  ok('another device can\'t pick up this TV\'s pairing', (await browser().call('/api/tv/pair')).data.status === 'expired');
  ok('an adult approves it on their phone', fake.approvePair(started.data.userCode));
  for (let i = 0; i < 12 && poll.status === 'pending'; i++) { await sleep(500); poll = (await tv.call('/api/tv/pair')).data; }
  ok('the TV is signed in as its own account', poll.status === 'approved' && poll.tv.name === 'Living room TV', JSON.stringify(poll));
  st = (await tv.call('/api/tv/state')).data;
  ok('…in family mode', st.signedIn && st.tv.name === 'Living room TV' && st.adultMode === null);
  let me = (await tv.call('/api/arksid/me')).data;
  ok('the arcade sees a TV with the kid role, not an adult', me.signedIn && me.tv === true && me.role === 'kid' && me.adult === false);
  ok('the pairing can\'t be picked up twice', (await tv.call('/api/tv/pair')).data.status === 'expired');
  ok('a code nobody answers runs out and starts again', (await (async () => {
    const b = browser();
    await b.post('/api/tv/pair');
    const pending = [...fake.pairs.values()].pop();
    pending.status = 'done';
    await sleep(2100);
    return (await b.call('/api/tv/pair')).data.status;
  })()) === 'expired');

  console.log('\n-- family mode, and adults\' night --');
  ok('in family mode the TV gets no adult pass', (await tv.post('/api/arksid/adult-pass')).status === 403);
  ok('…so adult questions stay locked', (await tv.call('/api/trivia/questions?level=spicy&count=5')).status === 403);
  ok('activity outside adults\' night is fine too', (await tv.post('/api/tv/activity')).status === 200);
  const unlock = await tv.post('/api/tv/unlock');
  ok('Adults\' night shows a code and QR code for an adult\'s phone', unlock.status === 200 && /^[A-Z]{6}$/.test(unlock.data.userCode) &&
    unlock.data.unlockUrl === `${fake.base}/tv/${unlock.data.userCode}` && unlock.data.qr.startsWith('data:image/svg') && unlock.data.adultMode === null);
  ok('a kid\'s phone can\'t unlock it', !fake.approveUnlock(unlock.data.userCode, 'milo'));
  st = (await tv.call('/api/tv/state?waiting=1')).data;
  ok('…and the TV stays family', st.adultMode === null);
  ok('an adult\'s phone can', fake.approveUnlock(unlock.data.userCode, 'kim'));
  await sleep(1600);
  st = (await tv.call('/api/tv/state?waiting=1')).data;
  ok('the TV sees adults\' night within a couple of seconds, and who unlocked it', !!st.adultMode && st.adultMode.by.name === 'Kim' && st.adultMode.until > Date.now(), JSON.stringify(st));
  me = (await tv.call('/api/arksid/me')).data;
  ok('the TV now counts as an adult for adult levels', me.adult === true && !!me.adultMode);
  const adultPass = (await tv.post('/api/arksid/adult-pass')).data.pass;
  ok('it gets an adult pass', typeof adultPass === 'string' && adultPass.startsWith('ap.'));
  ok('…which opens the adult questions', (await tv.call('/api/trivia/questions?level=spicy&count=5', { headers: { 'X-Adult-Pin': adultPass } })).status === 200);
  const adultRoom = await tv.post('/api/trivia/rooms', { name: 'Living room TV', screen: true, password: 'tacos42', settings: { level: 'spicy', count: 5, style: 'together' }, adultPin: adultPass });
  ok('the TV can host an adult game, with a lobby password', adultRoom.status === 201, JSON.stringify(adultRoom.data));

  console.log('\n-- joining an adult game on the TV --');
  const kidPhone = browser();
  fake.next = 'milo';
  // The trip to the pretend ARKS ID and back, by hand.
  const toId = await kidPhone.call('/auth/signin?return=%2F');
  const fromId = await fetch(toId.location, { redirect: 'manual' });
  const back = new URL(fromId.headers.get('location'));
  await kidPhone.call(back.pathname + back.search);
  const kidSignedIn = (await kidPhone.call('/api/arksid/me')).data.signedIn;
  ok('a kid signs in on their own phone', kidSignedIn);
  const kidJoin = await kidPhone.post(`/api/trivia/rooms/${adultRoom.data.code}/join`, { name: 'Milo', password: 'tacos42' });
  ok('a kid\'s phone is turned away from the adult game, even with the password', kidJoin.status === 403, JSON.stringify(kidJoin.data));
  const guest = await browser().post(`/api/trivia/rooms/${adultRoom.data.code}/join`, { name: 'Guest', password: 'tacos42' });
  ok('a guest with the password gets in, as before', guest.status === 200);
  ok('the TV itself can\'t join an adult game as a player', (await tv.post(`/api/trivia/rooms/${adultRoom.data.code}/join`, { name: 'TV', password: 'tacos42' })).status === 403);

  console.log('\n-- games keep adults\' night going --');
  const before = fake.tvCalls.filter(c => c === '/api/app/tv/activity').length;
  const a1 = (await tv.post('/api/tv/activity')).data;
  const a2 = (await tv.post('/api/tv/activity')).data;
  const sent = fake.tvCalls.filter(c => c === '/api/app/tv/activity').length - before;
  ok('a game being played is reported to ARKS ID, at most once a minute', a1.adultMode && sent <= 1 && a2.sent === false, JSON.stringify({ a1, a2, sent }));

  console.log('\n-- Back to family --');
  const lock = await tv.post('/api/tv/lock');
  ok('Back to family ends it at once', lock.status === 200 && lock.data.adultMode === null && fake.tvCalls.includes('/api/app/tv/lock'));
  ok('the adult pass stops working straight away', (await tv.call('/api/trivia/questions?level=spicy&count=5', { headers: { 'X-Adult-Pin': adultPass } })).status === 403);
  ok('…and no new one is handed out', (await tv.post('/api/arksid/adult-pass')).status === 403);
  st = (await tv.call('/api/tv/state?waiting=1')).data;
  ok('ARKS ID agrees: family mode', st.adultMode === null);

  console.log('\n-- ARKS ID ends it from the adult\'s phone --');
  const again = (await tv.post('/api/tv/unlock')).data;
  fake.approveUnlock(again.userCode, 'sam');
  await sleep(1600);
  ok('unlocked again', !!(await tv.call('/api/tv/state?waiting=1')).data.adultMode);
  for (const id of fake.adult.keys()) fake.adult.delete(id);
  await sleep(1600);
  ok('ended from a phone: the TV goes back to family on its next check', (await tv.call('/api/tv/state?waiting=1')).data.adultMode === null);

  console.log('\n-- a TV that is paired again --');
  {
    // Adults' night, and a pass from it.
    const night = (await tv.post('/api/tv/unlock')).data;
    fake.approveUnlock(night.userCode, 'kim');
    await sleep(1600);
    await tv.call('/api/tv/state?waiting=1');
    const earlier = (await tv.post('/api/arksid/adult-pass')).data.pass;
    const opens = key => tv.call('/api/trivia/questions?level=spicy&count=5', { headers: { 'X-Adult-Pin': key } }).then(r => r.status === 200);
    ok('a pass from adults\' night works', typeof earlier === 'string' && await opens(earlier));
    // The TV is paired again without signing out first, then adults' night comes back on.
    const pairing = (await tv.post('/api/tv/pair')).data;
    fake.approvePair(pairing.userCode);
    let state = { status: 'pending' };
    for (let i = 0; i < 12 && state.status === 'pending'; i++) { await sleep(500); state = (await tv.call('/api/tv/pair')).data; }
    ok('the TV is paired again', state.status === 'approved', JSON.stringify(state));
    const nightAgain = (await tv.post('/api/tv/unlock')).data;
    fake.approveUnlock(nightAgain.userCode, 'kim');
    await sleep(1600);
    ok('adults\' night is back on', !!(await tv.call('/api/tv/state?waiting=1')).data.adultMode);
    ok('the pass from before the new pairing stays refused', !(await opens(earlier)));
    const newer = (await tv.post('/api/arksid/adult-pass')).data.pass;
    ok('…and a new one works', typeof newer === 'string' && await opens(newer));
    await tv.post('/api/tv/lock');
  }

  console.log('\n-- only TVs --');
  ok('a person\'s phone can\'t ask for adults\' night', (await kidPhone.post('/api/tv/unlock')).status === 403);
  ok('Back to family from a person\'s phone does nothing', (await kidPhone.post('/api/tv/lock')).data.adultMode === null);
  ok('a person\'s sign-in has no adults\' night in it', (await kidPhone.call('/api/arksid/me')).data.tv === undefined);
  fake.next = 'milo';

  return { pass, fail };
}

module.exports = { run };
