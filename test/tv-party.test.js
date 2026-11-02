'use strict';

// The party and word games on a TV, without ARKS ID: the TV hosting a room
// as its screen (it shows the game and doesn't play) in Uh-Oh: Part Deux,
// Dare Devil (arcade/party-tables.js), Shuffle Scuffle (scuffle/rooms.js)
// and Rambler (rambler/rooms.js), and one phone holding several players
// and being passed around. The server still decides every move and score.
// Kids' phones and adult rooms are in tv-party-arksid.test.js.

async function run({ base }) {
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
  const post = (p, body = {}) => call(p, 'POST', body);
  const look = (game, code, who) => call(`/${game}/rooms/${code}?playerId=${who.playerId}&token=${who.token}`);

  console.log('\n-- Uh-Oh: Part Deux hosted by the TV --');
  const tv = (await post('/partdeux/rooms', { name: 'Living room TV', screen: true, level: 'kids' })).data;
  let snap = (await look('partdeux', tv.code, tv)).data;
  ok('the TV hosts as its screen, and isn\'t a player', snap.isScreen === true && snap.screen === true && snap.youAreHost && snap.players.length === 0 && snap.hostName === 'Living room TV', JSON.stringify(snap));
  ok('it can\'t start with nobody there', (await post(`/partdeux/rooms/${tv.code}/start`, tv)).data.error === 'Nobody has joined yet.');
  ok('the TV can\'t add players of its own: they join from their phones', (await post(`/partdeux/rooms/${tv.code}/seats`, { ...tv, name: 'Sneaky' })).status === 400);
  const pat = (await post(`/partdeux/rooms/${tv.code}/join`, { name: 'Pat' })).data;
  ok('one player isn\'t enough for Uh-Oh', (await post(`/partdeux/rooms/${tv.code}/start`, tv)).status === 409);
  // One phone, passed around between Kim, Sam and Lee.
  const kim = (await post(`/partdeux/rooms/${tv.code}/join`, { name: 'Kim' })).data;
  const sam = await post(`/partdeux/rooms/${tv.code}/seats`, { ...kim, name: 'Sam' });
  const lee = await post(`/partdeux/rooms/${tv.code}/seats`, { ...kim, name: 'Lee' });
  ok('a phone can hold more players', sam.status === 201 && lee.status === 201 && sam.data.name === 'Sam');
  snap = (await look('partdeux', tv.code, kim)).data;
  ok('the phone knows which players are its own', snap.mine.length === 3 && snap.mine.includes(kim.playerId) && snap.mine.includes(sam.data.seatId), JSON.stringify(snap.mine));
  ok('the players show which phone they\'re on', snap.players.find(p => p.id === sam.data.seatId).on === 'Kim' && snap.players.find(p => p.id === pat.playerId).on === null);
  ok('a seat has no way to sign in by itself', (await look('partdeux', tv.code, { playerId: sam.data.seatId, token: '' })).status === 403);
  ok('someone else can\'t take Kim\'s players off', (await post(`/partdeux/rooms/${tv.code}/seats/remove`, { ...pat, seat: lee.data.seatId })).status === 403);
  ok('Kim can', (await post(`/partdeux/rooms/${tv.code}/seats/remove`, { ...kim, seat: lee.data.seatId })).status === 200);
  ok('only the host starts the game', (await post(`/partdeux/rooms/${tv.code}/start`, pat)).status === 403);
  ok('the TV starts it', (await post(`/partdeux/rooms/${tv.code}/start`, tv)).status === 200);

  snap = (await look('partdeux', tv.code, tv)).data;
  ok('the TV sees the table and nobody\'s hand', snap.game && snap.game.hand.length === 0 && snap.as === null && snap.game.players.length === 3 && snap.game.players.every(p => p.cards === 7), JSON.stringify(snap.game && snap.game.players));
  const turn = snap.game.turn;
  const kimPhone = (await look('partdeux', tv.code, kim)).data;
  const patPhone = (await look('partdeux', tv.code, pat)).data;
  if (kimPhone.mine.includes(turn)) {
    ok('the shared phone shows the hand of whoever\'s turn it is', kimPhone.as === turn && kimPhone.game.hand.length === 7);
  } else {
    ok('the shared phone shows no hand while it\'s someone else\'s turn', kimPhone.as === null && kimPhone.game.hand.length === 0);
  }
  ok('a phone of one always shows its own hand', patPhone.as === pat.playerId && patPhone.game.hand.length === 7);
  ok('the TV can\'t play a card', (await post(`/partdeux/rooms/${tv.code}/act`, { ...tv, action: 'draw' })).status === 403);
  const other = turn === pat.playerId ? kim : pat;
  ok('a phone can\'t play for a player who isn\'t on it', (await post(`/partdeux/rooms/${tv.code}/act`, { ...other, action: 'draw', as: turn })).status === 403);
  const holder = turn === pat.playerId ? pat : kim;
  const drew = await post(`/partdeux/rooms/${tv.code}/act`, { ...holder, action: 'draw', as: turn });
  ok('whoever\'s turn it is plays from the phone that holds them', drew.status === 200 && drew.data.game.players.find(p => p.id === turn).cards === 8, JSON.stringify(drew.data.error || ''));
  ok('Kim\'s phone leaving takes Sam with it', (await post(`/partdeux/rooms/${tv.code}/leave`, kim)).status === 200 &&
    (await look('partdeux', tv.code, tv)).data.players.length === 1);
  ok('the TV leaving ends the game for everyone', (await post(`/partdeux/rooms/${tv.code}/leave`, tv)).status === 200 &&
    (await look('partdeux', tv.code, pat)).status === 404);
  const phoneRoom = (await post('/partdeux/rooms', { name: 'Sam', level: 'kids' })).data;
  snap = (await look('partdeux', phoneRoom.code, phoneRoom)).data;
  ok('a room hosted by a phone is the same as ever: the host plays', snap.screen === false && snap.isScreen === false && snap.players.length === 1 && snap.mine[0] === phoneRoom.playerId);

  console.log('\n-- Dare Devil hosted by the TV --');
  const dtv = (await post('/daredevil/rooms', { name: 'Living room TV', screen: true, level: 'kids', options: { length: 'quick' } })).data;
  const a = (await post(`/daredevil/rooms/${dtv.code}/join`, { name: 'Ana' })).data;
  const b = (await post(`/daredevil/rooms/${dtv.code}/seats`, { ...a, name: 'Ben' })).data;
  ok('one phone can hold everyone', !!b.seatId);
  ok('the TV starts a game for the players on the phone', (await post(`/daredevil/rooms/${dtv.code}/start`, dtv)).status === 200);
  let g = (await look('daredevil', dtv.code, dtv)).data.game;
  ok('the TV sees the deck and the scores', g.phase === 'draw' && g.players.length === 2 && g.left === 15);
  let moves = 0;
  for (let i = 0; i < 6; i++) {
    const as = g.turn;
    const d = await post(`/daredevil/rooms/${dtv.code}/act`, { ...a, action: 'draw', as });
    const done = await post(`/daredevil/rooms/${dtv.code}/act`, { ...a, action: 'done', as });
    if (d.status === 200 && done.status === 200) moves++;
    g = done.data.game;
  }
  ok('the phone plays each turn for whoever\'s up, and the server keeps the score', moves === 6 && g.players.reduce((n, p) => n + p.score, 0) > 0 && g.left === 9, JSON.stringify(g && g.players));
  ok('the TV still can\'t draw', (await post(`/daredevil/rooms/${dtv.code}/act`, { ...dtv, action: 'draw' })).status === 403);
  await post(`/daredevil/rooms/${dtv.code}/leave`, dtv);

  console.log('\n-- Shuffle Scuffle hosted by the TV --');
  const stv = (await post('/scuffle/rooms', { name: 'Living room TV', screen: true, settings: { rounds: 1, seconds: 2, dictionary: 'kids' } })).data;
  let ss = (await look('scuffle', stv.code, stv)).data;
  ok('the TV hosts as its screen', ss.isScreen && ss.screen && ss.host && ss.players.length === 0 && ss.hostName === 'Living room TV');
  ok('it can\'t start with nobody there', (await post(`/scuffle/rooms/${stv.code}/start`, stv)).status === 409);
  const sp = (await post(`/scuffle/rooms/${stv.code}/join`, { name: 'Pat' })).data;
  ok('the TV starts the race', (await post(`/scuffle/rooms/${stv.code}/start`, stv)).status === 200);
  ss = (await look('scuffle', stv.code, stv)).data;
  ok('the TV sees the letters and the clock, and has no words of its own', ss.phase === 'playing' && ss.round.letters.length >= 6 && ss.mine === null && !!ss.endsAt);
  ok('the TV can\'t send a word', (await post(`/scuffle/rooms/${stv.code}/word`, { ...stv, word: 'abc' })).status === 403);
  const word = await post(`/scuffle/rooms/${stv.code}/word`, { ...sp, word: 'zzzq' });
  ok('a phone\'s words are checked by the server', word.status === 200 && word.data.ok === false);
  await post(`/scuffle/rooms/${stv.code}/next`, stv);
  ss = (await look('scuffle', stv.code, stv)).data;
  ok('the TV can end a round early, and shows how it went', ['reveal', 'over'].includes(ss.phase) && !!ss.reveal && ss.reveal.players.length === 1, ss.phase);
  ok('the TV leaving ends the game', (await post(`/scuffle/rooms/${stv.code}/leave`, stv)).status === 200 && (await look('scuffle', stv.code, sp)).status === 404);

  console.log('\n-- Rambler hosted by the TV --');
  const rtv = (await post('/rambler/rooms', { name: 'Living room TV', screen: true, size: 4, profile: 'kids' })).data;
  let rs = rtv.state;
  ok('the TV hosts as its screen', rs.isScreen && rs.screen && rs.youAreHost && rs.players.length === 0 && rs.you === null);
  ok('it can\'t start with nobody there', (await post(`/rambler/rooms/${rtv.code}/start`, rtv)).status === 409);
  const rp = (await post(`/rambler/rooms/${rtv.code}/join`, { name: 'Pat' })).data;
  rs = (await post(`/rambler/rooms/${rtv.code}/start`, rtv)).data;
  ok('the TV starts the round and sees the board', rs.state === 'playing' && Array.isArray(rs.board) && rs.board.length === 16);
  ok('the TV can\'t send words', (await post(`/rambler/rooms/${rtv.code}/words`, { ...rtv, words: ['CAT'] })).status === 403);
  ok('the TV saying it\'s done doesn\'t end anyone\'s round', (await post(`/rambler/rooms/${rtv.code}/ready`, rtv)).data.state === 'playing');
  await post(`/rambler/rooms/${rtv.code}/words`, { ...rp, words: ['QZXV'] });
  rs = (await post(`/rambler/rooms/${rtv.code}/ready`, rp)).data;
  ok('when every phone is done, the round ends and the server scores it', rs.state === 'results' && rs.results.results.length === 1 && rs.results.results[0].score === 0);
  ok('the TV leaving ends the game', (await post(`/rambler/rooms/${rtv.code}/leave`, rtv)).status === 200 &&
    (await post(`/rambler/rooms/${rtv.code}/ready`, rp)).status === 404);

  return { pass, fail };
}

module.exports = { run };
