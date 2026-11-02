'use strict';

// Criss Cross: the rules on their own (no server needed), then the API
// against the real server: games on one phone, online games between
// profiles, racks kept private, turns, the bag, the end and the adult rules.

const path = require('node:path');

async function run({ base, root }) {
  const E = require(path.join(root, 'crisscross/engine.js'));
  const bot = require(path.join(root, 'crisscross/bot.js'));
  const API = base + '/api/crisscross';
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  async function api(p, method = 'GET', body, headers = {}) {
    const res = await fetch((p.startsWith('/api/') ? base : API) + p, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  }
  const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const at = (r, c) => r * E.SIZE + c;
  const row = (r, c, word) => word.split('').map((letter, k) => ({ index: at(r, c + k), letter }));
  const col = (r, c, word) => word.split('').map((letter, k) => ({ index: at(r + k, c), letter }));
  // A game with chosen racks and an empty bag order we don't care about.
  const game = (racks, dictionary = 'kids') => {
    const s = E.newGame({ players: racks.map((_, k) => ({ name: `P${k}` })), dictionary });
    racks.forEach((r, k) => { s.bag.push(...s.racks[k]); s.racks[k] = r.split(''); });
    return s;
  };

  console.log('\n-- criss cross: the tiles and the board --');
  ok('the bag holds 66 tiles, two of them blanks', E.BAG_SIZE === 66 && E.TILES['?'][0] === 2);
  ok('the board is 11 by 11 and its bonus pattern is the same from every side',
    E.BONUS.length === 121 && E.BONUS.every((b, i) => b === E.BONUS[at(E.colOf(i), E.rowOf(i))] && b === E.BONUS[120 - i]));
  ok('the middle square is a double word', E.BONUS[E.CENTER] === 'dw');
  ok('two-letter words count, from the same big list', E.isWord('QI', 'kids') === E.twoLetterWords().kids.has('QI') && E.isWord('AT', 'kids') && !E.isWord('ZZ', 'kids'));
  ok('British spellings don\'t count', !E.isWord('COLOUR', 'kids') && !E.isWord('COLOUR', 'adult') && E.isWord('COLOR', 'kids'));
  ok('the kids list leaves out blocked words; the unfiltered list keeps them', !E.isWord('SHIT', 'kids') && E.isWord('SHIT', 'adult'));
  const fresh = E.newGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  ok('everyone starts with seven tiles, drawn from the bag', fresh.racks.every(r => r.length === 7) && fresh.bag.length === 66 - 21);

  console.log('\n-- criss cross: checking a move --');
  let s = game(['CATSXYZ', 'DOGEARS']);
  ok('the first word has to cover the star', throws(() => E.evaluate(s, row(0, 0, 'CAT')), /star/));
  ok('…and be two letters at least', throws(() => E.evaluate(s, [{ index: E.CENTER, letter: 'C' }]), /two letters/));
  ok('tiles have to be in one line', throws(() => E.evaluate(s, [{ index: at(5, 5), letter: 'C' }, { index: at(6, 6), letter: 'A' }]), /one line/));
  ok('…with no gaps', throws(() => E.evaluate(s, [{ index: at(5, 4), letter: 'C' }, { index: at(5, 6), letter: 'T' }]), /gaps/));
  ok('every word made has to be a real word', throws(() => E.evaluate(s, row(5, 4, 'TCA')), /TCA isn't a word/));
  ok('you can only use tiles on your rack', throws(() => E.evaluate(s, row(5, 4, 'DOG'), { rack: s.racks[0] }), /don't have a D/));
  ok('two tiles can\'t share a square', throws(() => E.evaluate(s, [{ index: E.CENTER, letter: 'C' }, { index: E.CENTER, letter: 'A' }])));
  const first = E.evaluate(s, row(5, 4, 'CAT'), { rack: s.racks[0] });
  // C 3 + A 1 + T 1, doubled by the star.
  ok('the first word scores, doubled by the star', first.score === 10 && first.words[0].word === 'CAT', JSON.stringify(first));
  E.play(s, 0, row(5, 4, 'CAT'));
  ok('then it\'s the next player\'s turn, and the rack is filled back up', s.turn === 1 && s.racks[0].length === 7 && s.scores[0] === 10);
  ok('playing out of turn is refused', throws(() => E.play(s, 0, row(6, 4, 'SO')), /isn't your turn/));
  ok('a word has to join onto the board', throws(() => E.evaluate(s, row(0, 0, 'DOG')), /join onto/));
  ok('tiles can\'t go on a square that\'s taken', throws(() => E.evaluate(s, [{ index: at(5, 5), letter: 'O' }]), /already/));
  const plural = E.evaluate(s, [{ index: at(5, 7), letter: 'S' }], { rack: s.racks[1] });
  ok('adding one tile scores the whole word it makes (old tiles count, without their bonuses)', plural.score === 6 && plural.words[0].word === 'CATS', JSON.stringify(plural));
  const across = E.evaluate(s, row(6, 5, 'GO'), { rack: s.racks[1] });
  ok('every new word is found and scored, crosses included', across.words.map(w => w.word).sort().join() === ['AG', 'GO', 'TO'].sort().join() &&
    across.score === across.words.reduce((n, w) => n + w.score, 0), JSON.stringify(across));

  console.log('\n-- criss cross: bonus squares --');
  s = game(['QUIZERS', 'ABCDEFG']);
  E.play(s, 0, row(5, 3, 'QUIZ'));
  // Q 10 + U 2 + I 1 + Z 10 = 23, the I is on the star: doubled.
  ok('letters add up and the star doubles the word', s.scores[0] === 46, String(s.scores[0]));
  s = game(['ABCDEFG', 'ZAXQUIT']);
  s.board[at(1, 0)] = 'A'; s.board[at(1, 1)] = 'X';     // pretend tiles already there
  const tl = E.evaluate(s, [{ index: at(0, 0), letter: 'Z' }, { index: at(2, 0), letter: 'X' }], { rack: s.racks[1] });
  ok('a word on the corner square is tripled', tl.words.some(w => w.word === 'ZAX' && w.score === (10 + 1 + 8) * 3), JSON.stringify(tl));
  s = game(['ABCDEFG', 'ZAXQUIT']);
  s.board[at(5, 1)] = 'A';
  const letter3 = E.evaluate(s, [{ index: at(4, 1), letter: 'Z' }, { index: at(6, 1), letter: 'X' }], { rack: s.racks[1] });
  ok('a triple letter square triples only that letter', letter3.score === 10 + 1 + 8, JSON.stringify(letter3));
  s = game(['RETAINS', 'ABCDEFG']);
  const seven = E.evaluate(s, row(5, 2, 'RETAINS'), { rack: s.racks[0] });
  ok('using all seven tiles adds 40', seven.allTiles && seven.score === seven.words[0].score + E.ALL_TILES_BONUS, JSON.stringify(seven));
  s = game(['CA?SXYZ', 'DOGEARS']);
  const blank = E.evaluate(s, [{ index: at(5, 4), letter: 'C' }, { index: at(5, 5), letter: 'A' }, { index: at(5, 6), letter: 'T', blank: true }], { rack: s.racks[0] });
  ok('a blank can be any letter and scores nothing', blank.score === (3 + 1) * 2 && blank.words[0].word === 'CAT', JSON.stringify(blank));
  ok('…but only if you have one', throws(() => E.evaluate(game(['CATSXYZ', 'A']), [{ index: at(5, 4), letter: 'C' }, { index: at(5, 5), letter: 'A', blank: true }], { rack: ['C', 'A'] }), /blank/));

  console.log('\n-- criss cross: the bag, swapping and the end --');
  s = game(['ABCDEFG', 'HIJKLMN']);
  const before = s.bag.length;
  E.swap(s, 0, ['A', 'B']);
  ok('swapping trades tiles with the bag and uses the turn', s.racks[0].length === 7 && s.bag.length === before && s.turn === 1 && s.scoreless === 1);
  ok('you can only swap your own tiles', throws(() => E.swap(s, 1, ['Z']), /own rack/));
  s.bag = s.bag.slice(0, E.SWAP_MIN - 1);
  ok(`swapping needs ${E.SWAP_MIN} tiles left in the bag`, throws(() => E.swap(s, 1, ['H']), /at least/));
  s = game(['ABCDEFG', 'HIJKLMN']);
  for (let k = 0; k < E.SCORELESS_END; k++) E.pass(s, s.turn);
  const leftA = E.rackValue('ABCDEFG'.split('')), leftB = E.rackValue('HIJKLMN'.split(''));
  ok('six scoreless turns in a row end the game', !!s.over && s.over.why === 'stalled');
  ok('…and everyone loses what\'s left on their rack', s.scores[0] === -leftA && s.scores[1] === -leftB && s.over.winners[0] === 0, JSON.stringify(s.scores));
  s = game(['AT', 'QZXJ']);
  s.bag = [];
  E.play(s, 0, row(5, 5, 'AT'));
  ok('using your last tile with the bag empty ends the game', s.over && s.over.why === 'out' && s.over.outSeat === 0);
  ok('…the others lose their leftovers, and the one who went out gets them', s.scores[1] === -36 && s.scores[0] === 4 + 36, JSON.stringify(s.scores));
  s = game(['ABCDEFG', 'HIJKLMN', 'OPQRSTU']);
  E.resign(s, 1);
  ok('leaving a game with three players lets the other two carry on', !s.over && s.resigned[1]);
  E.resign(s, 0);
  ok('when only one is left, they win', s.over && s.over.winners.join() === '2');

  console.log('\n-- criss cross: the computer --');
  s = game(['RETAINS', 'ABCDEFG']);
  const best = bot.bestPlay(s, 0);
  ok('the computer finds a scoring first move through the star', best && best.score > 0 && best.placements.some(p => p.index === E.CENTER), JSON.stringify(best));
  const sim = E.newGame({ players: [{ name: 'A', bot: true }, { name: 'B', bot: true }] });
  let turns = 0;
  while (!sim.over && turns++ < 200) bot.move(sim, sim.turn);
  ok('two computers can play a whole game to the end by the rules', !!sim.over, `${turns} turns`);
  ok('…with every tile accounted for', sim.board.filter(Boolean).length + sim.bag.length + sim.racks.flat().length === E.BAG_SIZE);

  // ---- the server ----------------------------------------------------------------------------------
  console.log('\n-- criss cross: on one phone --');
  const cfg = await api('/config');
  ok('the board, the tiles and the rules are published', cfg.status === 200 && cfg.data.size === 11 && cfg.data.layout.length === 11 && cfg.data.values.Q === 10);
  const local = await api('/games', 'POST', { kind: 'local', players: [{ name: 'Ana' }, { name: 'Ben' }] });
  ok('anyone can start a game on one phone, no profile needed', local.status === 201 && /^[0-9a-f]{32}$/.test(local.data.key));
  const L = { 'X-Game-Key': local.data.key };
  ok('only the device with the key can open it', (await api(`/games/${local.data.id}`)).status === 403 &&
    (await api(`/games/${local.data.id}`, 'GET', null, { 'X-Game-Key': 'f'.repeat(32) })).status === 403);
  let g = local.data.game;
  ok('the rack shown is the one whose turn it is, and only that one', g.rack.length === 7 && g.rackSeat === 0 && g.players.every(p => p.rack === undefined));
  ok('the bag is a count, never the tiles', typeof g.bag === 'number' && !local.text.includes('"racks"'));
  ok('a first move off the star is refused', (await api(`/games/${g.id}/play`, 'POST', { placements: [{ index: 0, letter: g.rack[0] }] }, L)).status === 400);
  const sendBest = async (view, h) => {
    const mock = { board: view.board, dictionary: view.dictionary, racks: { [view.rackSeat ?? view.you]: view.rack } };
    const b = bot.bestPlay(mock, view.rackSeat ?? view.you);
    return { b, expect: b ? E.evaluate(mock, b.placements, { rack: view.rack }).score : null,
      res: b ? await api(`/games/${view.id}/play`, 'POST', { placements: b.placements, score: 999 }, h) : await api(`/games/${view.id}/swap`, 'POST', { tiles: view.rack }, h) };
  };
  let move = await sendBest(g, L);
  if (move.b) {
    ok('a real word is played and the server scores it the same way the rules do, whatever score the page sends', move.res.status === 200 && move.res.data.game.players[0].score === move.expect, JSON.stringify(move.res.data));
    ok('…and the phone moves on to the next player\'s rack', move.res.data.game.rackSeat === 1 && move.res.data.game.last.length === move.b.placements.length);
  } else ok('no word in that rack: the tiles were swapped instead', move.res.status === 200);
  const pv = await api(`/games/${g.id}/preview`, 'POST', { placements: [{ index: 0, letter: 'A' }, { index: 1, letter: 'A' }] }, L);
  ok('the score preview checks the move without making it', pv.status === 400 && (await api(`/games/${g.id}`, 'GET', null, L)).data.moves.length === 1);
  const vsBot = await api('/games', 'POST', { kind: 'local', players: [{ name: 'Ana' }, { bot: true }] });
  const vb = vsBot.data;
  move = await sendBest(vb.game, { 'X-Game-Key': vb.key });
  ok('playing the computer: it takes its turn straight after yours', move.res.status === 200 && move.res.data.game.moves.length === 2 && move.res.data.game.yourTurn,
    JSON.stringify(move.res.data.game && move.res.data.game.moves));
  ok('…and its rack is never shown', move.res.data.game.rackSeat === 0 && !move.res.text.includes('"racks"'));
  ok('only computers isn\'t a game', (await api('/games', 'POST', { kind: 'local', players: [{ bot: true }, { bot: true }] })).status === 400);

  console.log('\n-- criss cross: online games between profiles --');
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  const people = {};
  for (const name of ['Ana', 'Ben', 'Cy']) {
    const asked = await api('/api/profiles', 'POST', { name: `CC ${name}`, avatar: 'shiba:1' });
    await api(`/api/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    const used = await api(`/api/profiles/${asked.data.id}/use`, 'POST', {});
    people[name] = { id: asked.data.id, h: { 'X-Profile-Token': used.data.token } };
  }
  const { Ana, Ben, Cy } = people;
  ok('online games need a profile', (await api('/games', 'POST', { kind: 'online', invite: [Ben.id] })).status === 401);
  ok('the invite list has everyone but you', (await api('/people', 'GET', null, Ana.h)).data.some(p => p.id === Ben.id) &&
    !(await api('/people', 'GET', null, Ana.h)).data.some(p => p.id === Ana.id));
  const on = await api('/games', 'POST', { kind: 'online', invite: [Ben.id] }, Ana.h);
  ok('inviting someone starts the game straight away, with the host first', on.status === 201 && on.data.game.status === 'playing' && on.data.game.you === 0 && on.data.game.yourTurn);
  const gid = on.data.id;
  const asBen = await api(`/games/${gid}`, 'GET', null, Ben.h);
  ok('the invited player sees the game', asBen.status === 200 && asBen.data.you === 1 && !asBen.data.yourTurn);
  ok('each player sees only their own rack', asBen.data.rack.length === 7 && asBen.data.players.every(p => p.rack === undefined) && !asBen.text.includes('"racks"') &&
    !asBen.text.includes('"bag":['));
  ok('someone not in the game can\'t look', (await api(`/games/${gid}`, 'GET', null, Cy.h)).status === 403 && (await api(`/games/${gid}`)).status === 401);
  ok('Ben\'s list says it\'s waiting on Ana', (await api('/mine', 'GET', null, Ben.h)).data.yourTurn === 0);
  ok('Ana\'s says it\'s her turn', (await api('/mine', 'GET', null, Ana.h)).data.yourTurn === 1 && (await api('/turns', 'GET', null, Ana.h)).data.yourTurn === 1);
  const benMove = await sendBest(asBen.data, Ben.h);
  ok('playing out of turn is refused', benMove.res.status === 409);
  move = await sendBest(on.data.game, Ana.h);
  ok('the host plays, and the server scores it', move.res.status === 200 && (!move.b || move.res.data.game.players[0].score === move.expect));
  ok('…now it\'s Ben\'s turn, on his list and the home page count', (await api('/turns', 'GET', null, Ben.h)).data.yourTurn === 1 && (await api('/turns', 'GET', null, Ana.h)).data.yourTurn === 0);
  const benView = (await api(`/games/${gid}`, 'GET', null, Ben.h)).data;
  ok('swapping a tile you don\'t have is refused', (await api(`/games/${gid}/swap`, 'POST', { tiles: ['?', '?', '?'] }, Ben.h)).status === 400 || benView.rack.filter(t => t === '?').length >= 3);
  const sw = await api(`/games/${gid}/swap`, 'POST', { tiles: benView.rack.slice(0, 2) }, Ben.h);
  ok('Ben swaps two tiles: same number of tiles, the bag the same size', sw.status === 200 && sw.data.game.rack.length === 7 && sw.data.game.bag === benView.bag && sw.data.game.turn === 0);
  ok('leaving: the last one standing wins', (await api(`/games/${gid}/resign`, 'POST', {}, Ben.h)).data.game.over.winners.join() === '0');
  const over = (await api(`/games/${gid}`, 'GET', null, Ana.h)).data;
  ok('once it\'s over, everyone\'s leftover tiles are shown', over.status === 'over' && over.players.every(p => Array.isArray(p.rack)));
  ok('…and moves are refused', (await api(`/games/${gid}/pass`, 'POST', {}, Ana.h)).status === 409);
  ok('a finished game can be cleared from your list', (await api(`/games/${gid}/hide`, 'POST', {}, Ana.h)).status === 200 &&
    !(await api('/mine', 'GET', null, Ana.h)).data.games.some(x => x.id === gid));

  console.log('\n-- criss cross: the share link --');
  const shared = await api('/games', 'POST', { kind: 'online', invite: [], openSeats: 1 }, Ana.h);
  ok('a seat left open makes a game that waits, with a link for the host', shared.status === 201 && shared.data.game.status === 'waiting' && !!shared.data.game.joinCode);
  const code = shared.data.game.joinCode;
  ok('the link shows who\'s playing', (await api(`/invite/${code}`)).data.players.join() === 'CC Ana');
  ok('joining needs a profile', (await api(`/invite/${code}/join`, 'POST', {})).status === 401);
  const joined = await api(`/invite/${code}/join`, 'POST', {}, Cy.h);
  ok('the last seat filled starts the game', joined.status === 200 && joined.data.game.status === 'playing' && joined.data.game.you === 1);
  ok('…and the link stops working', (await api(`/invite/${code}`)).status === 404);
  ok('a game can\'t have more than 4 players', (await api('/games', 'POST', { kind: 'online', invite: [Ben.id, Cy.id], openSeats: 2 }, Ana.h)).status === 400);

  console.log('\n-- criss cross: the unfiltered list --');
  await api('/api/comm/admin/adult-pin', 'POST', { pin: '246810' }, ADMIN);
  const PIN = { 'X-Adult-Pin': '246810' };
  ok('an unfiltered game needs the adult PIN to start', (await api('/games', 'POST', { kind: 'online', invite: [Ben.id], dictionary: 'adult' }, Ana.h)).status === 403);
  ok('…on one phone too', (await api('/games', 'POST', { kind: 'local', players: [{ name: 'A' }, { name: 'B' }], dictionary: 'adult' })).status === 403);
  const adult = await api('/games', 'POST', { kind: 'online', invite: [Ben.id], dictionary: 'adult' }, { ...Ana.h, ...PIN });
  ok('with the PIN it starts', adult.status === 201 && adult.data.game.dictionary === 'adult');
  const noPin = await api(`/games/${adult.data.id}`, 'GET', null, Ben.h);
  ok('every player needs the PIN to open it, not just the host', noPin.status === 403 && noPin.data.adult === true);
  ok('…a wrong PIN doesn\'t work', (await api(`/games/${adult.data.id}`, 'GET', null, { ...Ben.h, 'X-Adult-Pin': '111111' })).status === 403);
  ok('…the right one does', (await api(`/games/${adult.data.id}`, 'GET', null, { ...Ben.h, ...PIN })).status === 200);
  await api('/api/comm/admin/adult-pin', 'POST', { pin: '' }, ADMIN);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
