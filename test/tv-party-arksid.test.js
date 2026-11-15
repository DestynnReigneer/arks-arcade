'use strict';

// The party and word games on a TV with ARKS ID, against the pretend ARKS ID
// (fake-arksid.js). Anyone can play an adult game but a kid's or a teen's
// device: the TV hosts one with nothing to unlock, a guest joins with nothing
// to type, and a phone signed in as a kid is turned away in Uh-Oh: Part Deux,
// Dare Devil, Shuffle Scuffle and Rambler. A host turning a family lobby
// adult moves out only the kid.

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

  console.log('\n-- a TV hosts adult games, with nothing to unlock --');
  const passKey = (await tv.post('/api/arksid/adult-pass')).data.pass;
  ok('the TV gets its adult pass straight away', typeof passKey === 'string' && passKey.length > 0);
  const pin = { 'X-Adult-Pin': passKey };
  const rooms = {
    partdeux: (await tv.post('/api/partdeux/rooms', { name: 'TV', screen: true, level: 'spicy' }, pin)).data,
    daredevil: (await tv.post('/api/daredevil/rooms', { name: 'TV', screen: true, level: 'spicy' }, pin)).data,
    scuffle: (await tv.post('/api/scuffle/rooms', { name: 'TV', screen: true, settings: { dictionary: 'adult' } }, pin)).data,
    rambler: (await tv.post('/api/rambler/rooms', { name: 'TV', screen: true, profile: 'adult' }, pin)).data
  };
  ok('the TV hosts an adult room in every one of them', Object.values(rooms).every(r => r && /^[A-Z2-9]{4}$/.test(r.code)), JSON.stringify(rooms));
  ok('a kid\'s phone gets no adult pass', (await kid.post('/api/arksid/adult-pass')).status === 403);
  for (const [game, r] of Object.entries(rooms)) {
    const kidJoin = await kid.post(`/api/${game}/rooms/${r.code}/join`, { name: 'Milo' });
    ok(`${game}: a kid's phone is turned away`, kidJoin.status === 403 && kidJoin.data.error === 'Adult games aren\'t available on a kid\'s account.', JSON.stringify(kidJoin.data));
    const guest = await browser().post(`/api/${game}/rooms/${r.code}/join`, { name: 'Guest' });
    ok(`${game}: a guest gets in with nothing to type`, [200, 201].includes(guest.status), JSON.stringify(guest.data));
  }
  for (const [game, r] of Object.entries(rooms)) await tv.post(`/api/${game}/rooms/${r.code}/leave`, { playerId: r.playerId, token: r.token });

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
    const turned = await kimPhone.post(`/api/${game}/rooms/${fam.code}/settings`, { ...seatOf(fam), level: 'spicy' }, kimPass);
    ok(`${game}: the host turns it adult`, turned.status === 200, JSON.stringify(turned.data));
    ok(`${game}: the kid is moved out, and the adult and the guest stay`, (await inLobby()) === 'Gus,Kim,Sam', await inLobby());
    ok(`${game}: the kid can't come back`, (await kid.post(`/api/${game}/rooms/${fam.code}/join`, { name: 'Milo' }, await profileOf(kid))).status === 403);
    await kimPhone.post(`/api/${game}/rooms/${fam.code}/leave`, seatOf(fam));
  }

  {
    // An adult who signs out before the switch is a guest now, and guests can play adult games.
    const lobbyOf = async fam => (await kimPhone.call(`/api/partdeux/rooms/${fam.code}?playerId=${fam.playerId}&token=${fam.token}`)).data.players.map(p => p.name).sort().join();
    const turnAdult = async fam => kimPhone.post(`/api/partdeux/rooms/${fam.code}/settings`, { ...seatOf(fam), level: 'spicy' },
      { 'X-Adult-Pin': (await kimPhone.post('/api/arksid/adult-pass')).data.pass });
    const one = (await kimPhone.post('/api/partdeux/rooms', { name: 'Kim', level: 'kids' }, await profileOf(kimPhone))).data;
    await samPhone.post(`/api/partdeux/rooms/${one.code}/join`, { name: 'Sam' }, await profileOf(samPhone));
    await samPhone.post('/auth/signout');
    ok('the host turns the lobby adult after an adult in it signed out', (await turnAdult(one)).status === 200);
    ok('…and that seat stays, as a guest\'s would', (await lobbyOf(one)) === 'Kim,Sam', await lobbyOf(one));
    await kimPhone.post(`/api/partdeux/rooms/${one.code}/leave`, seatOf(one));

    // Rambler keeps coins, a streak and badges for each profile. With sign-in on, who a
    // request is for comes from its profile token, never from an id it names.
    console.log('\n-- Rambler: a profile belongs to whoever is signed in as it --');
    const rb = async (path, method = 'GET', body, headers = {}) => {
      const res = await fetch(`${base}/api/rambler${path}`, {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    const kimIs = await profileOf(kimPhone), samIs = await profileOf(samPhone);
    const kimId = kimIs['X-Profile-Token'].split('.')[0];
    const listed = async h => (await rb('/players', 'GET', null, h)).data;
    ok('a visitor is shown nobody\'s Rambler profile', (await listed()).players.length === 0 && (await listed()).signIn === true);
    ok('someone signed in is shown their own, and only their own',
      (await listed(kimIs)).players.map(q => q.id).join() === kimId && !(await listed(samIs)).players.some(q => q.id === kimId));
    const kimBefore = (await rb(`/players/${kimId}`, 'GET', null, kimIs)).data;
    ok('they can open their own profile, and nobody else can', !!kimBefore && kimBefore.id === kimId &&
      (await rb(`/players/${kimId}`)).status === 404 && (await rb(`/players/${kimId}`, 'GET', null, samIs)).status === 404);
    const tries = [
      await rb(`/players/${kimId}`, 'PATCH', { name: 'Not Kim' }),
      await rb(`/players/${kimId}`, 'PATCH', { name: 'Not Kim' }, samIs),
      await rb(`/players/${kimId}`, 'DELETE'),
      await rb(`/players/${kimId}`, 'DELETE', null, samIs),
      await rb('/players', 'POST', { name: 'Extra' }),
      await rb(`/players/${kimId}`, 'PATCH', { name: 'Kimmy' }, kimIs)
    ];
    const kimAfter = (await rb(`/players/${kimId}`, 'GET', null, kimIs)).data;
    ok('nobody can rename, delete or add a Rambler profile here: profiles come from ARKS ID',
      tries.every(r => r.status === 403) && !!kimAfter && kimAfter.name === kimBefore.name, tries.map(r => r.status).join());
    // A round scored with someone else's profile id is a guest's round.
    const round = async (headers, profileId) => {
      const board = (await rb('/board', 'POST', { size: 4, profile: 'kids' }, headers)).data;
      return (await rb('/score', 'POST', { boardId: board.boardId, players: [{ id: 'p0', name: 'K', words: [] }], profileId }, headers)).data;
    };
    const asVisitor = await round({}, kimId), asSam = await round(samIs, kimId);
    const untouched = (await rb(`/players/${kimId}`, 'GET', null, kimIs)).data;
    ok('a round scored in someone else\'s name counts for nobody', !asVisitor.progress && !asSam.progress && untouched.games === kimBefore.games,
      JSON.stringify([!!asVisitor.progress, !!asSam.progress, untouched.games, kimBefore.games]));
    const asKim = await round(kimIs, kimId);
    ok('…and one scored by the person themselves counts for them', !!asKim.progress && (await rb(`/players/${kimId}`, 'GET', null, kimIs)).data.games === kimBefore.games + 1);
    const hintBoard = (await rb('/board', 'POST', { size: 4, profile: 'kids' })).data;
    const coinsBefore = (await rb(`/players/${kimId}`, 'GET', null, kimIs)).data.coins;
    const spent = await rb('/hint', 'POST', { boardId: hintBoard.boardId, playerId: kimId, found: [] }, samIs);
    ok('nobody can spend someone else\'s coins on a hint', spent.status === 400 && (await rb(`/players/${kimId}`, 'GET', null, kimIs)).data.coins === coinsBefore, JSON.stringify(spent));
  }

  console.log('\n-- a host turns a family word game unfiltered --');
  {
    const samNow = await signIn('sam');
    fake.next = was;
    const kimPass = async () => ({ 'X-Adult-Pin': (await kimPhone.post('/api/arksid/adult-pass')).data.pass });
    const namesOf = snap => (snap.players || []).map(q => q.name).sort().join();

    // Shuffle Scuffle
    const sc = (await kimPhone.post('/api/scuffle/rooms', { name: 'Kim', settings: { dictionary: 'kids' } })).data;
    const scState = async () => (await kimPhone.call(`/api/scuffle/rooms/${sc.code}?playerId=${sc.playerId}&token=${sc.token}`)).data;
    await samNow.post(`/api/scuffle/rooms/${sc.code}/join`, { name: 'Sam' });
    await kid.post(`/api/scuffle/rooms/${sc.code}/join`, { name: 'Milo' });
    const scGuest = browser();
    await scGuest.post(`/api/scuffle/rooms/${sc.code}/join`, { name: 'Gus' });
    ok('Shuffle Scuffle: an adult, a kid and a guest joined the host\'s family lobby', namesOf(await scState()) === 'Gus,Kim,Milo,Sam', namesOf(await scState()));
    const scTurned = await kimPhone.post(`/api/scuffle/rooms/${sc.code}/settings`, { ...seatOf(sc), settings: { dictionary: 'adult' } }, await kimPass());
    ok('Shuffle Scuffle: the host switches to the unfiltered words', scTurned.status === 200, JSON.stringify(scTurned.data));
    const scAfter = await scState();
    ok('Shuffle Scuffle: the kid is moved out, and the adult and the guest stay', namesOf(scAfter) === 'Gus,Kim,Sam', namesOf(scAfter));
    ok('Shuffle Scuffle: everyone still in reads who was removed',
      !!scAfter.notice && scAfter.notice.text === 'Milo was removed, the host switched game mode to adult.', JSON.stringify(scAfter.notice));
    ok('Shuffle Scuffle: the kid can\'t come back', (await kid.post(`/api/scuffle/rooms/${sc.code}/join`, { name: 'Milo' })).status === 403);

    // Rambler (it has no route that only reads a room, so the host asks by saving its settings as they are)
    const rb = (await kimPhone.post('/api/rambler/rooms', { name: 'Kim', size: 4, durationSec: 60 })).data;
    const rbState = async () => (await kimPhone.post(`/api/rambler/rooms/${rb.code}/settings`, seatOf(rb))).data;
    await samNow.post(`/api/rambler/rooms/${rb.code}/join`, { name: 'Sam' });
    await kid.post(`/api/rambler/rooms/${rb.code}/join`, { name: 'Milo' });
    const rbGuest = browser();
    await rbGuest.post(`/api/rambler/rooms/${rb.code}/join`, { name: 'Gus' });
    ok('Rambler: an adult, a kid and a guest joined the host\'s family lobby', namesOf(await rbState()) === 'Gus,Kim,Milo,Sam', namesOf(await rbState()));
    const rbTurned = await kimPhone.post(`/api/rambler/rooms/${rb.code}/settings`, { ...seatOf(rb), profile: 'adult' }, await kimPass());
    ok('Rambler: the host switches to the unfiltered words', rbTurned.status === 200, JSON.stringify(rbTurned.data));
    ok('Rambler: the kid is moved out, and the adult and the guest stay', namesOf(rbTurned.data) === 'Gus,Kim,Sam', namesOf(rbTurned.data));
    ok('Rambler: everyone still in reads who was removed',
      !!rbTurned.data.notice && rbTurned.data.notice.text === 'Milo was removed, the host switched game mode to adult.', JSON.stringify(rbTurned.data.notice));
    ok('Rambler: the kid can\'t come back', (await kid.post(`/api/rambler/rooms/${rb.code}/join`, { name: 'Milo' })).status === 403);
    for (const [game, r] of [['scuffle', sc], ['rambler', rb]]) await kimPhone.post(`/api/${game}/rooms/${r.code}/leave`, seatOf(r));
  }

  return { pass, fail };
}

module.exports = { run };
