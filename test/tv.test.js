'use strict';

// The arcade on a TV, without ARKS ID: knowing it's a TV, moving the
// highlight with the remote's arrows (public/tv-core.js), and Know-It-All
// hosted by the TV in its three ways (trivia/rooms.js): everyone on their
// own phone, one phone passed around, and the remote playing for everyone.
// The TV's sign-in and adults' night are in tv-arksid.test.js.

const path = require('node:path');

async function run({ base, root }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  async function call(p, method = 'GET', body) {
    const res = await fetch(base + '/api' + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const Core = require(path.join(root, 'public', 'tv-core.js'));

  console.log('\n-- knowing it\'s a TV --');
  const shield = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36 ARKS-TV/1.0.3';
  ok('the ARKS TV app\'s user agent is a TV', Core.isTvAgent(shield));
  ok('a phone\'s is not', !Core.isTvAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'));
  ok('"ARKS-TV" somewhere else in the name doesn\'t count', !Core.isTvAgent('Mozilla/5.0 NOTARKS-TV/1.0') && !Core.isTvAgent('ARKS-TV/'));
  ok('the app is a TV whatever the address says', Core.wantsTv(shield, '?tv=0', '0').on);
  ok('?tv=1 tries the TV layout, and is remembered for the visit', JSON.stringify(Core.wantsTv('Chrome', '?tv=1', null)) === '{"on":true,"remember":"1"}');
  ok('…so the next page is a TV too', Core.wantsTv('Chrome', '', '1').on && !Core.wantsTv('Chrome', '', null).on);
  ok('?tv=0 turns it off again', JSON.stringify(Core.wantsTv('Chrome', '?tv=0', '1')) === '{"on":false,"remember":"0"}');
  ok('a pairing code reads in two halves', Core.splitCode('BCDFGH') === 'BCD FGH');

  console.log('\n-- moving the highlight with the arrows --');
  // A 3 by 2 grid of tiles, a wide button under it, and a small one far off to the right.
  const box = (id, left, top, w = 100, h = 60) => ({ id, left, top, right: left + w, bottom: top + h });
  const tiles = [box('a', 0, 0), box('b', 120, 0), box('c', 240, 0), box('d', 0, 80), box('e', 120, 80), box('f', 240, 80)];
  const wide = box('go', 0, 170, 340, 50), far = box('far', 900, 300, 40, 40);
  const all = [...tiles, wide, far];
  const go = (from, dir) => (Core.pick(all.find(b => b.id === from), all, dir) || {}).id || null;
  ok('right goes to the next tile in the row', go('a', 'right') === 'b' && go('b', 'right') === 'c');
  ok('down goes to the tile straight below', go('b', 'down') === 'e' && go('c', 'down') === 'f');
  ok('up comes back', go('e', 'up') === 'b');
  ok('left from the first tile has nowhere to go', go('a', 'left') === null && go('d', 'left') === null);
  ok('down from the bottom row lands on the wide button', go('e', 'down') === 'go');
  ok('up from the wide button goes to a tile above it', ['d', 'e', 'f'].includes(go('go', 'up')));
  ok('a button off to the side is still reachable', go('go', 'right') === 'far' || go('f', 'down') === 'go');
  ok('an unknown direction moves nothing', Core.pick(tiles[0], tiles, 'sideways') === null);
  // The two-by-two answers of a question.
  const answers = [box('A', 0, 0, 300, 80), box('B', 320, 0, 300, 80), box('C', 0, 100, 300, 80), box('D', 320, 100, 300, 80)];
  const ans = (from, dir) => (Core.pick(answers.find(b => b.id === from), answers, dir) || {}).id || null;
  ok('the answers move like a two-by-two grid', ans('A', 'right') === 'B' && ans('A', 'down') === 'C' && ans('D', 'up') === 'B' && ans('D', 'left') === 'C');

  console.log('\n-- without ARKS ID, a TV has nothing to set up --');
  const st = await call('/tv/state');
  ok('the TV\'s state says ARKS ID is off', st.status === 200 && st.data.on === false && st.data.signedIn === false);
  ok('pairing isn\'t offered', (await call('/tv/pair', 'POST', {})).status === 404);
  ok('…nor adults\' night', (await call('/tv/unlock', 'POST', {})).status === 404);

  console.log('\n-- the TV hosts: everyone on their own phone --');
  const tv = (await call('/trivia/rooms', 'POST', { name: 'Living room TV', screen: true, settings: { level: 'kids', count: 5, seconds: 30 } })).data;
  const room = code => ({
    view: async who => (await call(`/trivia/rooms/${code}?playerId=${who.playerId}&token=${who.token}`)).data,
    post: (who, p, body = {}) => call(`/trivia/rooms/${code}/${p}`, 'POST', { playerId: who.playerId, token: who.token, ...body })
  });
  const R = room(tv.code);
  let snap = await R.view(tv);
  ok('the TV gets a room code as its screen', /^[A-Z2-9]{4}$/.test(tv.code) && snap.isScreen && snap.host && snap.screen);
  ok('…and isn\'t a player itself', snap.players.length === 0 && snap.settings.style === 'together');
  ok('it can\'t start with nobody there', (await R.post(tv, 'start')).status === 409);
  const lobby = (await call('/lobby')).data;
  const listed = (lobby.rooms || lobby).find ? (lobby.rooms || lobby).find(x => x.code === tv.code) : null;
  ok('the Join a game board shows it, hosted by the TV', !!listed && listed.host === 'Living room TV', JSON.stringify(listed));
  const sam = (await call(`/trivia/rooms/${tv.code}/join`, 'POST', { name: 'Sam' })).data;
  const jo = (await call(`/trivia/rooms/${tv.code}/join`, 'POST', { name: 'Jo' })).data;
  ok('phones join with the code', !!sam.playerId && !!jo.playerId);
  ok('only the host (the TV) starts the game', (await R.post(sam, 'start')).status === 403);
  ok('extra players on one phone are for taking turns only', (await R.post(sam, 'seats', { name: 'Kid' })).status === 400);
  await R.post(tv, 'start');
  snap = await R.view(tv);
  ok('the TV shows the question, with no answer key', snap.phase === 'question' && !!snap.question && !('correctIndex' in snap.question));
  ok('…and doesn\'t answer for anyone', snap.answeringFor === null);
  ok('the TV can\'t answer', (await R.post(tv, 'answer', { choice: 0 })).status === 403);
  ok('a phone can\'t answer for another phone', (await R.post(sam, 'answer', { choice: 0, seat: jo.playerId })).status === 403);
  for (let i = 0; i < 5; i++) {
    await R.post(sam, 'answer', { choice: 0 });
    await R.post(jo, 'answer', { choice: 1 });
    snap = await R.view(tv);
    if (i === 0) ok('the answers are scored by the server', snap.phase === 'reveal' && snap.reveal.results.length === 2 && snap.reveal.results.every(r => r.correct ? r.points >= 100 : r.points === 0));
    await R.post(tv, 'next');
  }
  snap = await R.view(sam);
  ok('the game ends with the phones in the standings, not the TV', snap.phase === 'over' && snap.finale.standings.length === 2 && !snap.finale.standings.some(s => s.name === 'Living room TV'));

  console.log('\n-- the TV hosts: one phone passed around --');
  const tv2 = (await call('/trivia/rooms', 'POST', { name: 'TV', screen: true, settings: { level: 'kids', count: 5, seconds: 30, style: 'turns' } })).data;
  const P = room(tv2.code);
  const phone = (await call(`/trivia/rooms/${tv2.code}/join`, 'POST', { name: 'Robin' })).data;
  const kid = (await P.post(phone, 'seats', { name: 'Milo' })).data;
  const third = (await P.post(phone, 'seats', { name: 'Robin' })).data;
  ok('the phone adds everyone who shares it', !!kid.seatId && kid.name === 'Milo' && third.name === 'Robin 2');
  snap = await P.view(phone);
  ok('…and holds all three of them', snap.mine.length === 3 && snap.players.filter(p => p.on === 'Robin').length === 2);
  await P.post(phone, 'seats/remove', { seat: third.seatId });
  ok('one can be taken off again before the start', (await P.view(phone)).players.length === 2);
  ok('a seat can\'t be used to sign in as itself', (await call(`/trivia/rooms/${tv2.code}?playerId=${kid.seatId}&token=null`)).status === 403);
  await P.post(tv2, 'start');
  snap = await P.view(tv2);
  ok('everyone gets the questions picked: 5 each', snap.phase === 'ready' && snap.upNext.total === 10 && snap.turn.name === 'Robin' && !snap.question);
  ok('the question stays hidden until they\'re ready', snap.question === null);
  ok('the TV knows it\'s not holding that player', snap.turn.yours === false);
  await P.post(phone, 'ready');
  snap = await P.view(phone);
  ok('ready starts the clock, and the phone answers for Robin', snap.phase === 'question' && snap.answeringFor === phone.playerId && !!snap.question);
  ok('…not for Milo yet: it isn\'t his turn', (await P.post(phone, 'answer', { choice: 0, seat: kid.seatId })).status === 409);
  await P.post(phone, 'answer', { choice: 0 });
  snap = await P.view(tv2);
  ok('one answer is enough on a turn, and only that player is scored', snap.phase === 'reveal' && snap.reveal.results.length === 1 && snap.reveal.results[0].name === 'Robin');
  await P.post(tv2, 'next');
  snap = await P.view(phone);
  ok('then it\'s Milo\'s turn, on the same phone', snap.phase === 'ready' && snap.turn.name === 'Milo' && snap.turn.yours);
  await P.post(phone, 'ready');
  const before = (await P.view(phone)).players.find(p => p.name === 'Milo').score;
  await P.post(phone, 'answer', { choice: 2, seat: kid.seatId });
  snap = await P.view(phone);
  const res = snap.reveal.results[0];
  ok('the phone answers for Milo, and the server scores it', res.name === 'Milo' && (res.correct ? res.points >= 100 : res.points === 0) &&
    snap.players.find(p => p.name === 'Milo').score === before + res.points);

  console.log('\n-- the TV hosts: the remote plays for everyone --');
  const tv3 = (await call('/trivia/rooms', 'POST', { name: 'TV', screen: true, settings: { level: 'kids', count: 5, seconds: 30, style: 'turns' } })).data;
  const T = room(tv3.code);
  const solo = (await T.post(tv3, 'seats', { name: 'Player 1' })).data;
  ok('the TV holds its own player, for the remote', !!solo.seatId);
  await T.post(tv3, 'start');
  let total = 0;
  for (let i = 0; i < 5; i++) {
    snap = await T.view(tv3);
    if (i === 0) ok('it\'s that player\'s turn, and it\'s the TV\'s to answer', snap.phase === 'ready' && snap.turn.yours && snap.upNext.total === 5);
    await T.post(tv3, 'ready');
    snap = await T.view(tv3);
    if (i === 0) ok('the TV answers for its player', snap.answeringFor === solo.seatId);
    await T.post(tv3, 'answer', { choice: i % 4 === 3 ? 0 : i % 4, seat: solo.seatId });
    snap = await T.view(tv3);
    total += snap.reveal.results[0].points;
    await T.post(tv3, 'next');
  }
  snap = await T.view(tv3);
  ok('five questions later the game is over, with the server\'s score', snap.phase === 'over' && snap.finale.standings.length === 1 && snap.finale.standings[0].score === total);
  ok('the TV can start another round', (await T.post(tv3, 'start')).status === 200);
  await T.post(tv3, 'leave');
  ok('when the TV leaves, the game is gone', (await call(`/trivia/rooms/${tv3.code}?playerId=${tv3.playerId}&token=${tv3.token}`)).status === 404);

  console.log('\n-- the TV pages --');
  for (const page of ['/', '/trivia.html']) {
    const html = await (await fetch(base + page)).text();
    ok(`${page} loads the TV layout and lets the arrows move around it`, html.includes('src="tv.js"') && html.includes('data-tv-nav'));
  }
  const css = await fetch(base + '/tv.css');
  ok('the TV styles are served', css.ok && (await css.text()).includes('html.tv'));

  return { pass, fail };
}

module.exports = { run };
