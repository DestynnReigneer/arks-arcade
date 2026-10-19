'use strict';

// Pure logic: dice, board shapes, the solver, scoring, and the progress rules.
// No server and no network — these are the things that must never quietly
// change, because every other test trusts them.

const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const dice = require(path.join(ROOT, 'rambler/dice.js'));
const solver = require(path.join(ROOT, 'rambler/solver.js'));
const scoring = require(path.join(ROOT, 'rambler/scoring.js'));
const dictionary = require(path.join(ROOT, 'rambler/dictionary.js'));
const progress = require(path.join(ROOT, 'rambler/progress.js'));
const marathon = require(path.join(ROOT, 'rambler/marathon.js'));

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };

  console.log('\n-- dice and board shape --');
  ok('4x4 rolls 16 tiles', dice.rollBoard(4).length === 16);
  ok('5x5 rolls 25 tiles', dice.rollBoard(5).length === 25);
  ok('rectangles roll the right count', dice.rollBoard({ cols: 4, rows: 6 }).length === 24);
  ok('a corner has 3 neighbors', dice.neighbors(4)[0].length === 3);
  ok('an interior cell has 8', dice.neighbors(4)[5].length === 8);
  ok('rectangular adjacency is right', dice.neighbors({ cols: 4, rows: 2 })[0].length === 3);
  ok('bad dimensions are rejected', (() => {
    try { dice.dims({ cols: 1, rows: 1 }); return false; } catch { return true; }
  })());

  console.log('\n-- the Qu tile --');
  const qb = ['QU', 'I', 'T', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'];
  ok('QUIT walks the Qu tile as two letters', !!dice.findPath(qb, 4, 'QUIT'));
  ok('QIT does not', dice.findPath(qb, 4, 'QIT') === null);

  console.log('\n-- growing a board --');
  const base = ['C', 'A', 'T', 'S'];
  const dim = { cols: 2, rows: 2 };
  for (const side of dice.SIDES) {
    const g = dice.growBoard(base, dim, side, () => 0.5);
    ok(`grow ${side} keeps the cell count consistent`, g.board.length === g.cols * g.rows,
      `${g.board.length} vs ${g.cols}x${g.rows}`);
  }
  const topGrown = dice.growBoard(base, dim, 'top', () => 0.5);
  ok('growing upward leaves the original rows intact', topGrown.board.slice(2).join('') === 'CATS');

  console.log('\n-- dictionary profiles --');
  const checks = [
    ['CAT', 'kids', true], ['CAT', 'adult', true],
    ['FUCK', 'kids', false], ['FUCK', 'adult', true],
    ['SHITTING', 'kids', false], ['SHITTING', 'adult', true],
    ['WANKER', 'kids', false], ['WANKER', 'adult', true],
    ['RIZZ', 'kids', false], ['RIZZ', 'adult', true],
    // innocent words the blocklist's inflections used to catch by accident
    ['HEROINES', 'kids', true], ['BONKERS', 'kids', true],
    ['SPUNKY', 'kids', true], ['COCKY', 'kids', true],
    // mild words deliberately left playable for children
    ['NUT', 'kids', true], ['CRACK', 'kids', true], ['WEED', 'kids', true], ['FART', 'kids', true]
  ];
  let bad = 0;
  for (const [w, p, want] of checks) {
    if (dictionary.isWord(w, p) !== want) { bad++; console.log(`        ${w} (${p}) expected ${want}`); }
  }
  ok(`all ${checks.length} dictionary rules hold`, bad === 0, bad ? `${bad} wrong` : '');
  ok('the kids list is not empty', dictionary.stats.kids > 150000);
  ok('the adult list is larger than the kids list', dictionary.stats.adult > dictionary.stats.kids);

  console.log('\n-- scoring --');
  ok('3 and 4 letters score 1', scoring.wordPoints('CAT', 4) === 1 && scoring.wordPoints('CATS', 4) === 1);
  ok('5 scores 2', scoring.wordPoints('CATER', 4) === 2);
  ok('6 scores 3', scoring.wordPoints('CATERS', 4) === 3);
  ok('7 scores 5', scoring.wordPoints('CATERER', 4) === 5);
  ok('8+ scores 11', scoring.wordPoints('CATERERS', 4) === 11);
  ok('a 3-letter word scores nothing on 5x5', scoring.wordPoints('CAT', 5) === 0);

  console.log('\n-- duplicate cancellation --');
  const valid = w => ({ valid: ['AAA', 'BBB', 'CCC'].includes(w), reason: null });
  const r = scoring.scoreRound({
    size: 4, min: 3, validator: valid,
    players: [
      { id: 'a', name: 'Ada', words: ['AAA', 'BBB'] },
      { id: 'b', name: 'Bo', words: ['CCC', 'BBB'] },
      { id: 'c', name: 'Cy', words: [] }
    ]
  });
  ok('a word two players found is canceled', r.canceled.includes('BBB'), JSON.stringify(r.canceled));
  ok('both are left on 1 point', r.results[0].score === 1 && r.results[1].score === 1);
  ok('a tie shares rank 1', r.results.filter(p => p.rank === 1).length === 2);
  ok('the player with nothing ranks last', r.results[2].rank === 3);

  console.log('\n-- solver --');
  const known = ['C', 'A', 'T', 'S', 'O', 'R', 'E', 'D', 'N', 'I', 'L', 'P', 'E', 'S', 'T', 'A'];
  const found = solver.solveWords(known, 4, 'kids');
  ok('finds a decent haul on a known board', found.length > 100, String(found.length));
  ok('includes an obvious word', found.includes('CAT'));
  ok('excludes a word not on the board', !found.includes('ZEBRA'));

  console.log('\n-- streaks --');
  const mk = (last, streak) => ({ lastPlayed: last, streak, longestStreak: streak });
  ok('a first game starts at 1', progress.nextStreak(mk(null, 0), '2026-09-12') === 1);
  ok('a second game the same day does not double-count', progress.nextStreak(mk('2026-09-12', 4), '2026-09-12') === 4);
  ok('the next day extends it', progress.nextStreak(mk('2026-09-11', 4), '2026-09-12') === 5);
  ok('a missed day resets it', progress.nextStreak(mk('2026-09-09', 9), '2026-09-12') === 1);
  ok('it survives a month boundary', progress.nextStreak(mk('2026-08-31', 3), '2026-09-01') === 4);

  console.log('\n-- the daily board is reproducible --');
  const d1 = progress.dailyBoard('2026-09-12', 'kids');
  const d2 = progress.dailyBoard('2026-09-12', 'kids');
  const d3 = progress.dailyBoard('2026-09-13', 'kids');
  ok('the same date gives the same board', d1.board.join('') === d2.board.join(''));
  ok('a different date gives a different board', d1.board.join('') !== d3.board.join(''));
  ok('the daily board is worth playing', d1.totalWords >= 35, String(d1.totalWords));

  // The date is the whole seed. Put the dictionary in it and the house is no
  // longer playing the same board, which is the only thing the daily is for.
  const dAdult = progress.dailyBoard('2026-09-12', 'adult');
  ok('the dictionary does not change the letters', d1.board.join('') === dAdult.board.join(''));
  ok('but it does change what is findable', dAdult.totalWords >= d1.totalWords,
    `${dAdult.totalWords} vs ${d1.totalWords}`);

  console.log('\n-- marathon --');
  const session = marathon.create({ profile: 'kids', difficulty: 'normal' });
  const startEnds = session.endsAt;
  let cur = marathon.view(marathon.get(session.id));
  let grew = null;
  for (let i = 0; i < 12; i++) {
    const live = marathon.get(session.id);
    const words = solver.solveWords(live.board, { cols: live.cols, rows: live.rows }, 'kids', { min: live.minLength });
    const have = new Set(live.found.map(f => f.word));
    const next = words.find(w => !have.has(w));
    if (!next) break;
    const res = marathon.submit(session.id, next);
    cur = res;
    if (res.grew) grew = res.grew;
  }
  ok('finding words buys time', cur.endsAt > startEnds, `${cur.endsAt - startEnds}ms`);
  ok('the board grows', !!grew, JSON.stringify(grew));
  ok('growth raises the level', cur.level > 1, String(cur.level));
  ok('tiles still match the shape after growing', cur.board.length === cur.cols * cur.rows);
  const done = marathon.finish(session.id);
  ok('finishing yields a final score', typeof done.finalScore === 'number');
  ok('nothing is accepted after the end', (() => {
    try { marathon.submit(session.id, 'CAT'); return false; } catch (e) { return e.status === 409; }
  })());

  console.log('\n-- short fuse --');
  const sf = require(path.join(ROOT, 'shortfuse/engine.js'));
  const sfCards = require(path.join(ROOT, 'shortfuse/cards.js'));
  const throws = fn => { try { fn(); return null; } catch (e) { return e; } };
  const people = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const count = (g, type) => Object.values(g.cards).filter(c => c.type === type).length;

  const g4 = sf.createGame({ players: people(4), level: 'kids' });
  ok('everyone starts with a Defuse', g4.seats.every(s => s.hand.some(id => g4.cards[id].type === 'defuse')));
  ok('nobody starts with a bomb', g4.seats.every(s => s.hand.every(id => g4.cards[id].type !== 'bomb')));
  ok('one fewer bomb than players', count(g4, 'bomb') === 3);
  ok('every card has a face at every level', Object.keys(sfCards.LEVELS).every(lv =>
    Object.values(g4.cards).every(c => { const v = sfCards.view(c, lv); return v.name && v.emoji && v.rule; })));

  const turnOf = g => g.seats[g.turn].id;
  const notMe = g => g.seats.find(s => !s.out && s.id !== turnOf(g)).id;
  const give1 = (g, type) => { const id = 'x' + Math.random(); g.cards[id] = { id, type, variant: 0 }; g.seats[g.turn].hand.push(id); return id; };

  const ga = sf.createGame({ players: people(3), level: 'kids' });
  const attacker = turnOf(ga);
  sf.play(ga, attacker, { cards: [give1(ga, 'attack')] });
  ok('an action waits for Nopes before it happens', ga.phase === 'reaction' && turnOf(ga) === attacker);
  sf.resolve(ga);
  ok('an attack hands the next player two turns', turnOf(ga) !== attacker && ga.turnsOwed === 2);

  const gn = sf.createGame({ players: people(3), level: 'kids' });
  const skipper = turnOf(gn);
  sf.play(gn, skipper, { cards: [give1(gn, 'skip')] });
  const noper = gn.seats.find(s => s.id !== skipper);
  const nid = 'n1'; gn.cards[nid] = { id: nid, type: 'nope', variant: 0 }; noper.hand.push(nid);
  sf.nope(gn, noper.id);
  sf.resolve(gn);
  ok('a Nope cancels the action', turnOf(gn) === skipper && gn.phase === 'play');

  const gb = sf.createGame({ players: people(2), level: 'kids' });
  const drawer = turnOf(gb);
  const bombId = Object.values(gb.cards).find(c => c.type === 'bomb').id;
  gb.deck.splice(gb.deck.indexOf(bombId), 1);
  gb.deck.unshift(bombId);
  sf.draw(gb, drawer);
  ok('a Defuse saves you and you hide the bomb', gb.phase === 'defuse');
  sf.placeBomb(gb, drawer, 0);
  ok('the hidden bomb is where you put it', gb.deck[0] === bombId && turnOf(gb) !== drawer);
  const victimSeat = gb.seats[gb.turn];
  victimSeat.hand = victimSeat.hand.filter(id => gb.cards[id].type !== 'defuse');
  sf.draw(gb, victimSeat.id);
  ok('no Defuse means you blow up and the last one wins', victimSeat.out && gb.phase === 'over' && gb.winner === drawer);

  const gp = sf.createGame({ players: people(3), level: 'kids' });
  ok('junk alone does nothing', !!throws(() => sf.play(gp, turnOf(gp), { cards: [give1(gp, 'junk1')] })));
  ok('you cannot play out of turn', throws(() => sf.draw(gp, notMe(gp))).status === 409);
  const thief = turnOf(gp);
  const mark = notMe(gp);
  const before = gp.seats.find(s => s.id === thief).hand.length;
  sf.play(gp, thief, { cards: [give1(gp, 'junk2'), give1(gp, 'junk2')], target: mark });
  sf.resolve(gp);
  ok('a matching pair steals a card', gp.seats.find(s => s.id === thief).hand.length === before + 1);

  const snap = sf.snapshot(gp, mark);
  ok('a player sees only their own hand', snap.hand.length === gp.seats.find(s => s.id === mark).hand.length && !snap.hands);

  // Play a few hundred random games to the end: no stuck states, no crashes.
  let finished = 0;
  let problem = '';
  for (let n = 0; n < 300 && !problem; n++) {
    const g = sf.createGame({ players: people(2 + (n % 7)), level: 'filthy' });
    for (let step = 0; step < 2000 && g.phase !== 'over'; step++) {
      const me = g.seats[g.turn];
      try {
        if (g.phase === 'reaction') sf.resolve(g);
        else if (g.phase === 'favor') sf.give(g, g.pending.target, g.seats.find(s => s.id === g.pending.target).hand[0]);
        else if (g.phase === 'defuse') sf.placeBomb(g, g.defusing.playerId, Math.floor(Math.random() * (g.deck.length + 1)));
        else {
          const action = me.hand.find(id => sf.ACTIONS.includes(g.cards[id].type));
          if (action && Math.random() < 0.5) {
            const target = g.seats.find(s => !s.out && s.id !== me.id && s.hand.length);
            if (g.cards[action].type === 'favor' && !target) sf.draw(g, me.id);
            else sf.play(g, me.id, { cards: [action], target: target && target.id });
          } else sf.draw(g, me.id);
        }
      } catch (e) { problem = `game ${n}: ${e.message}`; break; }
    }
    if (g.phase === 'over') finished++;
    else if (!problem) problem = `game ${n} never finished`;
  }
  ok('300 random games all reach a winner', finished === 300, problem);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
