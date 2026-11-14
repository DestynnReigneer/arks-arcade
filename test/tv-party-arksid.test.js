'use strict';

// The party and word games on a TV with ARKS ID, against the pretend ARKS ID
// (fake-arksid.js): the TV hosts a adults room only during an adults'
// night (with its adult pass, never a PIN), and a phone signed in as a kid
// is turned away from a adults room in Uh-Oh: Part Deux, Dare Devil,
// Shuffle Scuffle and Rambler, whatever it types. Guests with the lobby
// password still get in, as before. And a host turning a family lobby adult
// keeps the adults who are signed in, and moves out the kid and the guest.

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
    return { call, jar, post: (p, body = {}, headers = {}) => call(p, { method: 'POST', body, headers }) };
  }

  console.log('\n-- a TV, and a kid\'s phone --');
  const tv = browser();
  const started = (await tv.post('/api/tv/pair')).data;
  fake.approvePair(started.userCode);
  let poll = { status: 'pending' };
  for (let i = 0; i < 12 && poll.status === 'pending'; i++) { await sleep(500); poll = (await tv.call('/api/tv/pair')).data; }
  ok('the TV is set up', poll.status === 'approved');
  const kid = browser();
  fake.next = 'milo';
  const toId = await kid.call('/auth/signin?return=%2F');
  const fromId = await fetch(toId.location, { redirect: 'manual' });
  const back = new URL(fromId.headers.get('location'));
  await kid.call(back.pathname + back.search);
  ok('a kid is signed in on their own phone', (await kid.call('/api/arksid/me')).data.signedIn === true);

  console.log('\n-- family mode: no adults rooms on the TV --');
  ok('Part Deux turns an adult deck away', (await tv.post('/api/partdeux/rooms', { name: 'TV', screen: true, level: 'spicy', password: 'tacos42' })).status === 403);
  ok('so does Shuffle Scuffle\'s unfiltered list', (await tv.post('/api/scuffle/rooms', { name: 'TV', screen: true, password: 'tacos42', settings: { dictionary: 'adult' } })).status === 403);
  const family = (await tv.post('/api/partdeux/rooms', { name: 'TV', screen: true, level: 'kids' })).data;
  ok('a family room is fine', !!family.code);
  ok('and a kid\'s phone joins it as always', (await kid.post(`/api/partdeux/rooms/${family.code}/join`, { name: 'Milo' })).status === 201);
  await tv.post(`/api/partdeux/rooms/${family.code}/leave`, family);

  console.log('\n-- adults\' night: the TV hosts adults rooms --');
  const unlock = (await tv.post('/api/tv/unlock')).data;
  fake.approveUnlock(unlock.userCode, 'kim');
  await sleep(1600);
  ok('adults\' night is on', !!(await tv.call('/api/tv/state?waiting=1')).data.adultMode);
  const passKey = (await tv.post('/api/arksid/adult-pass')).data.pass;
  ok('the TV has its adult pass', typeof passKey === 'string' && passKey.length > 0);
  const pin = { 'X-Adult-Pin': passKey };
  const rooms = {
    partdeux: (await tv.post('/api/partdeux/rooms', { name: 'TV', screen: true, level: 'spicy', password: 'tacos42' }, pin)).data,
    daredevil: (await tv.post('/api/daredevil/rooms', { name: 'TV', screen: true, level: 'spicy', password: 'tacos42' }, pin)).data,
    scuffle: (await tv.post('/api/scuffle/rooms', { name: 'TV', screen: true, password: 'tacos42', settings: { dictionary: 'adult' } }, pin)).data,
    rambler: (await tv.post('/api/rambler/rooms', { name: 'TV', screen: true, profile: 'adult', password: 'tacos42' }, pin)).data
  };
  ok('with the pass, the TV hosts a adults room in every one of them', Object.values(rooms).every(r => r && /^[A-Z2-9]{4}$/.test(r.code)), JSON.stringify(rooms));
  for (const [game, r] of Object.entries(rooms)) {
    const kidJoin = await kid.post(`/api/${game}/rooms/${r.code}/join`, { name: 'Milo', password: 'tacos42' });
    ok(`${game}: a kid's phone is turned away, even with the password`, kidJoin.status === 403 && /adult accounts/.test(kidJoin.data.error), JSON.stringify(kidJoin.data));
    const guest = await browser().post(`/api/${game}/rooms/${r.code}/join`, { name: 'Guest', password: 'tacos42' });
    ok(`${game}: a guest with the lobby password gets in`, [200, 201].includes(guest.status), JSON.stringify(guest.data));
    const tvJoin = await browser().post(`/api/${game}/rooms/${r.code}/join`, { name: 'Guest 2' });
    ok(`${game}: without the password, nobody does`, tvJoin.status >= 400);
  }
  ok('the TV itself can\'t join a adults room as a player', (await tv.post(`/api/partdeux/rooms/${rooms.partdeux.code}/join`, { name: 'TV', password: 'tacos42' })).status === 403);
  for (const [game, r] of Object.entries(rooms)) await tv.post(`/api/${game}/rooms/${r.code}/leave`, { playerId: r.playerId, token: r.token });

  console.log('\n-- Back to family --');
  await tv.post('/api/tv/lock');
  ok('the pass stops working, so no new adults room', (await tv.post('/api/partdeux/rooms', { name: 'TV', screen: true, level: 'spicy', password: 'tacos42' }, pin)).status === 403);

  console.log('\n-- a host turns a family lobby adult --');
  const was = fake.next;
  const signIn = async key => {
    const b = browser();
    fake.next = key;
    const to = await b.call('/auth/signin?return=%2F');
    const from = await fetch(to.location, { redirect: 'manual' });
    const home = new URL(from.headers.get('location'));
    await b.call(home.pathname + home.search);
    return b;
  };
  const kimPhone = await signIn('kim');
  const samPhone = await signIn('sam');
  fake.next = was;
  const profileOf = async b => ({ 'X-Profile-Token': (await b.call('/api/arksid/me')).data.token });
  const seatOf = s => ({ playerId: s.playerId, token: s.token });
  for (const game of ['partdeux', 'daredevil']) {
    const fam = (await kimPhone.post(`/api/${game}/rooms`, { name: 'Kim', level: 'kids' }, await profileOf(kimPhone))).data;
    await samPhone.post(`/api/${game}/rooms/${fam.code}/join`, { name: 'Sam' }, await profileOf(samPhone));
    await kid.post(`/api/${game}/rooms/${fam.code}/join`, { name: 'Milo' }, await profileOf(kid));
    const guestPhone = browser();
    await guestPhone.post(`/api/${game}/rooms/${fam.code}/join`, { name: 'Gus' });
    const inLobby = async () => (await kimPhone.call(`/api/${game}/rooms/${fam.code}?playerId=${fam.playerId}&token=${fam.token}`)).data.players.map(p => p.name).sort().join();
    ok(`${game}: an adult, a kid and a guest joined the host's family lobby`, (await inLobby()) === 'Gus,Kim,Milo,Sam', await inLobby());
    const kimPass = { 'X-Adult-Pin': (await kimPhone.post('/api/arksid/adult-pass')).data.pass };
    const turned = await kimPhone.post(`/api/${game}/rooms/${fam.code}/settings`, { ...seatOf(fam), level: 'spicy', password: 'tacos42' }, kimPass);
    ok(`${game}: the host turns it adult`, turned.status === 200, JSON.stringify(turned.data));
    ok(`${game}: the adult signed in with ARKS ID stays, and the kid and the guest are moved out`, (await inLobby()) === 'Kim,Sam', await inLobby());
    ok(`${game}: the kid can't come back, even with the password`, (await kid.post(`/api/${game}/rooms/${fam.code}/join`, { name: 'Milo', password: 'tacos42' }, await profileOf(kid))).status === 403);
    ok(`${game}: the guest can, with the password`, (await guestPhone.post(`/api/${game}/rooms/${fam.code}/join`, { name: 'Gus', password: 'tacos42' })).status === 201);
    await kimPhone.post(`/api/${game}/rooms/${fam.code}/leave`, seatOf(fam));
  }

  return { pass, fail };
}

module.exports = { run };
