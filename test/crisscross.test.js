'use strict';

// Words with Family (once Criss Cross): the rules on their own (no server needed), then the API
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
  {
    // The browser tests' fixed deal: on with NODE_ENV=test, ignored otherwise.
    const was = { env: process.env.NODE_ENV, seed: process.env.CRISSCROSS_DEAL_SEED };
    const deal = () => E.newGame({ players: [{ name: 'A' }, { name: 'B' }] }).bag.join('');
    process.env.CRISSCROSS_DEAL_SEED = '1';
    process.env.NODE_ENV = 'test';
    const fixed = deal() === deal();
    process.env.NODE_ENV = 'production';
    const random = deal() !== deal();
    for (const [k, v] of [['NODE_ENV', was.env], ['CRISSCROSS_DEAL_SEED', was.seed]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    ok('a test server can deal every game the same way, and a real one never does', fixed && random);
  }

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

  console.log('\n-- criss cross: words that touch other words --');
  // TO goes down through the star, then each check plays against it.
  s = game(['TOXXXXX', 'QIJOATE']);
  E.play(s, 0, col(5, 5, 'TO'));
  const xi = E.evaluate(s, col(4, 6, 'QI'));
  ok('QI down, with its I next to a T, makes TI too, and both count', xi.words.map(w => w.word).sort().join() === 'QI,TI', JSON.stringify(xi));
  ok('the bonus under a new tile counts, and the star under the old T doesn\'t count again', xi.score === 10 * 2 + 1 + (1 + 1), JSON.stringify(xi));
  ok('a word off on its own is refused', throws(() => E.evaluate(s, row(0, 0, 'QI')), /join onto/));
  ok('a move is refused when a word it makes across is not a real word, and the error names it', throws(() => E.evaluate(s, col(5, 6, 'JO')), /TJ/));
  ok('new tiles with an empty square between them are refused', throws(() => E.evaluate(s, [{ index: at(5, 3), letter: 'A' }, { index: at(5, 7), letter: 'E' }]), /gaps/));
  ok('…but a gap filled by a tile already on the board is fine', E.evaluate(s, [{ index: at(5, 4), letter: 'A' }, { index: at(5, 6), letter: 'E' }]).words[0].word === 'ATE');

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
  ok('online games need a profile', (await api('/games', 'POST', { kind: 'online', seats: 2 })).status === 401);
  ok('there is no list of people to pick from', (await api('/people', 'GET', null, Ana.h)).status === 404);
  const made = await api('/games', 'POST', { kind: 'online', seats: 2 }, Ana.h);
  ok('creating a lobby makes a game that waits for players, with only its host in it',
    made.status === 201 && made.data.game.status === 'waiting' && made.data.game.players.length === 1 && !!made.data.game.joinCode);
  const lobbyCode = made.data.game.joinCode;
  const hosted = async h => (await api('/lobbies', 'GET', null, h || {})).data.lobbies;
  ok('the lobby is in List Hosted Games for everyone: another profile, and a guest',
    (await hosted(Ben.h)).some(l => l.code === lobbyCode && l.host === 'CC Ana' && l.count === 1 && l.max === 2 && l.status === 'open' && !l.mine) &&
    (await hosted()).some(l => l.code === lobbyCode));
  ok('…marked as yours when you are in it', (await hosted(Ana.h)).find(l => l.code === lobbyCode).mine === true);
  ok('…and on the home page\'s list of lobbies', (await api('/api/lobby')).data.rooms.some(r => r.game === 'crisscross' && r.code === lobbyCode && r.status === 'open'));
  ok('nobody was put in it or told about it', (await api('/mine', 'GET', null, Ben.h)).data.games.length === 0);
  // A page that still names people gets an ordinary lobby, and the people named aren't in it.
  const named = await api('/games', 'POST', { kind: 'online', invite: [Ben.id, Cy.id] }, Ana.h);
  ok('naming people does nothing: the lobby has only its host', named.status === 201 && named.data.game.status === 'waiting' && named.data.game.players.length === 1 &&
    (await api('/mine', 'GET', null, Ben.h)).data.games.length === 0);
  await api(`/games/${named.data.id}/resign`, 'POST', {}, Ana.h);
  ok('the host leaving closes the lobby', !(await hosted()).some(l => l.code === named.data.game.joinCode));
  // Everyone sees a waiting lobby, so one person can only have five of them waiting.
  const cysBefore = (await hosted()).filter(l => l.host === 'CC Cy').length;
  const cys = [];
  for (let k = 0; k < 7; k++) cys.push(await api('/games', 'POST', { kind: 'online', seats: 2 }, Cy.h));
  ok('one person can have five lobbies waiting, and a sixth is refused with the reason',
    cysBefore === 0 && cys.slice(0, 5).every(r => r.status === 201) && cys[5].status === 429 && cys[6].status === 429 &&
    cys[5].data.error === 'You already have 5 lobbies waiting for players. Call one off first.', JSON.stringify(cys.map(r => r.status)));
  ok('…so the lists never hold more than five of one person\'s',
    (await hosted()).filter(l => l.host === 'CC Cy').length === 5 && (await api('/api/lobby')).data.rooms.filter(r => r.game === 'crisscross' && r.host === 'CC Cy').length === 5);
  await api(`/games/${cys[0].data.id}/resign`, 'POST', {}, Cy.h);
  const sixth = await api('/games', 'POST', { kind: 'online', seats: 2 }, Cy.h);
  ok('calling one off makes room for another', sixth.status === 201);
  for (const r of [...cys.slice(1, 5), sixth]) await api(`/games/${r.data.id}/resign`, 'POST', {}, Cy.h);
  ok('…and with all of them called off, none is left in the list', (await hosted()).filter(l => l.host === 'CC Cy').length === 0);
  const benIn = await api(`/lobby/${lobbyCode}/join`, 'POST', {}, Ben.h);
  ok('Ben finds it and joins, which fills the seats and starts the game', benIn.status === 200 && benIn.data.game.status === 'playing' && benIn.data.game.you === 1);
  ok('a game that has started is off the lists', !(await hosted()).some(l => l.code === lobbyCode) && !(await api('/api/lobby')).data.rooms.some(r => r.code === lobbyCode));
  const on = { data: { id: made.data.id, game: (await api(`/games/${made.data.id}`, 'GET', null, Ana.h)).data } };
  ok('the game starts with the host first', on.data.game.status === 'playing' && on.data.game.you === 0 && on.data.game.yourTurn);
  const gid = on.data.id;
  const asBen = await api(`/games/${gid}`, 'GET', null, Ben.h);
  ok('the player who joined sees the game', asBen.status === 200 && asBen.data.you === 1 && !asBen.data.yourTurn);
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

  console.log('\n-- criss cross: a lobby\'s link and QR code --');
  const shared = await api('/games', 'POST', { kind: 'online', seats: 2 }, Ana.h);
  ok('a lobby has a link for the host, to show as a QR code', shared.status === 201 && shared.data.game.status === 'waiting' && !!shared.data.game.joinCode);
  const code = shared.data.game.joinCode;
  ok('the link shows who\'s playing', (await api(`/lobby/${code}`)).data.players.join() === 'CC Ana');
  ok('joining needs a profile', (await api(`/lobby/${code}/join`, 'POST', {})).status === 401);
  const joined = await api(`/lobby/${code}/join`, 'POST', {}, Cy.h);
  ok('the last seat filled starts the game', joined.status === 200 && joined.data.game.status === 'playing' && joined.data.game.you === 1);
  ok('…and the link stops working, saying why', (await api(`/lobby/${code}`)).status === 404 &&
    (await api(`/lobby/${code}`)).data.error === 'That lobby is either full, or the game has already started.');
  const big = await api('/games', 'POST', { kind: 'online', seats: 9 }, Ana.h);
  ok('a lobby never has more than 4 seats', big.status === 201 && big.data.game.seats === 4);
  const three = await api('/games', 'POST', { kind: 'online', seats: 3 }, Ben.h);
  await api(`/lobby/${three.data.game.joinCode}/join`, 'POST', {}, Cy.h);
  ok('with a seat still open the game waits', (await api(`/games/${three.data.id}`, 'GET', null, Ben.h)).data.status === 'waiting');
  ok('someone who isn\'t the host can\'t start it', (await api(`/games/${three.data.id}/start`, 'POST', {}, Cy.h)).status === 403);
  ok('the host can start with who\'s here', (await api(`/games/${three.data.id}/start`, 'POST', {}, Ben.h)).data.game.status === 'playing');
  await api(`/games/${big.data.id}/resign`, 'POST', {}, Ana.h);

  console.log('\n-- criss cross: the unfiltered list --');
  const PIN = { 'X-Adult-Pin': '246810' };
  ok('an unfiltered game needs the adult PIN to start', (await api('/games', 'POST', { kind: 'online', seats: 2, dictionary: 'adult' }, Ana.h)).status === 403);
  ok('…on one phone too', (await api('/games', 'POST', { kind: 'local', players: [{ name: 'A' }, { name: 'B' }], dictionary: 'adult' })).status === 403);
  const adult = await api('/games', 'POST', { kind: 'online', seats: 2, dictionary: 'adult' }, { ...Ana.h, ...PIN });
  ok('with the PIN the lobby opens', adult.status === 201 && adult.data.game.dictionary === 'adult');
  ok('…and it\'s listed as an unfiltered game', (await api('/lobbies')).data.lobbies.find(l => l.code === adult.data.game.joinCode).adult === true);
  ok('joining it needs the PIN too', (await api(`/lobby/${adult.data.game.joinCode}/join`, 'POST', {}, Ben.h)).status === 403);
  ok('…and with it Ben is in', (await api(`/lobby/${adult.data.game.joinCode}/join`, 'POST', {}, { ...Ben.h, ...PIN })).status === 200);
  const noPin = await api(`/games/${adult.data.id}`, 'GET', null, Ben.h);
  ok('every player needs the PIN to open it, not just the host', noPin.status === 403 && noPin.data.adult === true);
  ok('…a wrong PIN doesn\'t work', (await api(`/games/${adult.data.id}`, 'GET', null, { ...Ben.h, 'X-Adult-Pin': '111111' })).status === 403);
  ok('…the right one does', (await api(`/games/${adult.data.id}`, 'GET', null, { ...Ben.h, ...PIN })).status === 200);

  // Last in this file, because it clears lobbies as if weeks had gone by.
  // A lobby nobody joined is cleared after a quiet day. One that someone joined waits two weeks for the rest.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const unjoined = await api('/games', 'POST', { kind: 'online', seats: 2 }, Cy.h);
  const halfFull = await api('/games', 'POST', { kind: 'online', seats: 3 }, Cy.h);
  await api(`/lobby/${halfFull.data.game.joinCode}/join`, 'POST', {}, Ben.h);
  const codesNow = async () => (await hosted()).map(l => l.code);
  await api('/test/sweep', 'POST', { now: Date.now() + DAY_MS - 60 * 1000 });
  ok('a lobby nobody joined is still there just short of a day', (await codesNow()).includes(unjoined.data.game.joinCode));
  await api('/test/sweep', 'POST', { now: Date.now() + DAY_MS + 60 * 1000 });
  ok('…and gone after a quiet day, while one that someone joined stays',
    !(await codesNow()).includes(unjoined.data.game.joinCode) && (await codesNow()).includes(halfFull.data.game.joinCode), (await codesNow()).join());
  ok('…and it has left its host\'s games too', (await api(`/games/${unjoined.data.id}`, 'GET', null, Cy.h)).status === 404);
  await api('/test/sweep', 'POST', { now: Date.now() + 13 * DAY_MS });
  ok('a lobby someone joined waits two weeks for the rest', (await codesNow()).includes(halfFull.data.game.joinCode));
  await api('/test/sweep', 'POST', { now: Date.now() + 15 * DAY_MS });
  ok('…and then it is cleared as well', !(await codesNow()).includes(halfFull.data.game.joinCode));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
