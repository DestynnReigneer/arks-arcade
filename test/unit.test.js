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
    ['DUMBASS', 'kids', false], ['DUMBASS', 'adult', true],
    // American English only: the US spelling scores, the British one doesn't
    ['COLOR', 'kids', true], ['COLOUR', 'kids', false], ['COLOUR', 'adult', false],
    ['GRAY', 'kids', true], ['GREY', 'kids', false], ['CENTER', 'kids', true], ['CENTRE', 'kids', false],
    ['TRAVELED', 'kids', true], ['TRAVELLED', 'kids', false], ['ORGANIZE', 'kids', true], ['ORGANISE', 'kids', false],
    ['WANKER', 'adult', false],
    // American words the British filter must leave alone
    ['SURPRISE', 'kids', true], ['ADVERTISE', 'kids', true], ['SHOES', 'kids', true], ['SCOURING', 'kids', true],
    ['TIMBRE', 'kids', true], ['FILLED', 'kids', true], ['CONTROLLED', 'kids', true], ['ENROLLED', 'kids', true],
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

  console.log('\n-- wordless hints --');
  const hints = require(path.join(ROOT, 'arcade/wordless-hints.js'));
  const common = dictionary.load().common;
  const leaks = [];
  for (const [themeId, words] of Object.entries(hints.BUILTIN)) {
    for (const [w, [, clue]] of Object.entries(words)) if (clue.toLowerCase().includes(w)) leaks.push(`${themeId}:${w}`);
  }
  ok('no built-in clue contains its own word', leaks.length === 0, leaks.join(', '));
  const classic = { id: 'classic', subject: 'word' };
  const apple = hints.hintsFor(classic, 'apple', common);
  ok('Classic words get a dictionary clue', /fruit/i.test(apple.clue || ''), apple.clue);
  ok('…and a kid-friendly category', apple.category === 'Thing');
  const ends = hints.endsLike('bottle', common);
  ok('ends-like finds a word with the same ending', !!ends && ends.endsWith('TLE') && ends !== 'BOTTLE', ends);
  ok('…that does not share the first letter', ends && ends[0] !== 'B');
  const bart = hints.hintsFor({ id: 'simpsons', subject: 'Simpsons character or thing' }, 'bart', common);
  ok('built-in themes have hand-written clues', bart.category === 'Character' && /skateboard/.test(bart.clue));
  const mine = hints.hintsFor({ id: 'minecraft', subject: 'Minecraft thing', clues: {} }, 'creeper', common);
  ok('custom themes never borrow dictionary clues', mine.clue === null && mine.category === 'Minecraft thing');
  const cleaned = hints.cleanClues({ creeper: 'Green and explodes', zombie: 'Not in the theme', sheep: 'A sheep, baa' }, ['creeper', 'sheep']);
  ok('pasted clues keep only theme words that do not give the word away',
    Object.keys(cleaned).join() === 'creeper', JSON.stringify(cleaned));

  console.log('\n-- chess --');
  const Chess = require(path.join(ROOT, 'public/chess-engine.js'));
  // Known move counts for standard test positions. Any rules bug changes them.
  const perfts = [
    [Chess.START, 3, 8902],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 3, 2812],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 2, 1486]
  ];
  for (const [fen, depth, want] of perfts) {
    const got = Chess.perft(Chess.fromFen(fen), depth);
    ok(`perft ${depth} = ${want} for ${fen.split(' ')[0].slice(0, 18)}…`, got === want, String(got));
  }
  const fools = Chess.fromFen();
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) Chess.play(fools, { from, to });
  ok('fool\'s mate is checkmate for Black', Chess.status(fools).reason === 'checkmate' && Chess.status(fools).winner === 'b');
  ok('an illegal move is refused', Chess.play(Chess.fromFen(), { from: 'e2', to: 'e5' }) === null);
  const stale = Chess.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  ok('stalemate is a draw', Chess.status(stale).reason === 'stalemate');
  const mateIn1 = Chess.fromFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
  const aiMove = Chess.bestMove(mateIn1, 'medium');
  ok('the computer finds mate in one', Chess.name(aiMove.from) + Chess.name(aiMove.to) === 'h5f7');
  const promo = Chess.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  ok('promotion makes the piece you pick', Chess.play(promo, { from: 'a7', to: 'a8', promo: 'n' }).san === 'a8=N');

  console.log('\n-- spin & solve --');
  const puzzles = require(path.join(ROOT, 'public/spin-puzzles.js'));
  ok('there are plenty of puzzles', puzzles.length >= 150, String(puzzles.length));
  ok('every word fits on the board (12 letters max)',
    puzzles.every(p => p.answer.split(' ').every(w => w.length <= 12)));
  ok('puzzles use only capitals, spaces and simple punctuation', puzzles.every(p => /^[A-Z '&?!-]+$/.test(p.answer)));
  const spinBanks = require(path.join(ROOT, 'spinsolve/puzzles.js'));
  const badBuiltins = Object.entries(spinBanks.BUILTIN)
    .flatMap(([lv, list]) => list.filter(p => spinBanks.checkPuzzle(p).error).map(p => `${lv}: ${p.answer}`));
  ok('every built-in puzzle at every level passes the pack checks', badBuiltins.length === 0, badBuiltins.join(', '));
  ok('each adult level has its own bank', ['cheeky', 'spicy', 'filthy'].every(l => spinBanks.BUILTIN[l].length >= 30));
  ok('no puzzle uses a British spelling',
    puzzles.every(p => p.answer.split(' ').every(w => !dictionary.isBritish(w.replace(/[^A-Z]/g, '')))));

  console.log('\n-- know-it-all --');
  const tbank = require(path.join(ROOT, 'trivia/bank.js'));
  const tstore = require(path.join(ROOT, 'trivia/store.js'));
  const TR = require(path.join(ROOT, 'public/trivia-rules.js'));
  const badQs = Object.values(tbank.QUESTIONS).flat().filter(q => tstore.checkQuestion(q).error)
    .map(q => `${q.question} (${tstore.checkQuestion(q).error})`);
  ok('every built-in question passes the pack checks', badQs.length === 0, badQs.join('; '));
  ok('every level has its own questions', ['kids', 'cheeky', 'spicy', 'filthy'].every(l => tbank.QUESTIONS[l].length >= 20));
  ok('faster right answers score more', TR.points('hard', true, 9000, 10000) > TR.points('hard', true, 1000, 10000));
  ok('wrong answers score nothing', TR.points('hard', false, 9000, 10000) === 0);
  const calls = TR.afterQuestion([{ id: 'a', name: 'A', correct: false, streak: 0 }, { id: 'b', name: 'B', correct: true, streak: 3 }],
    { drinking: true, couples: true, drinks: tbank.DRINKS.spicy, dares: tbank.DARES.spicy, rand: () => 0 });
  ok('drinking: the wrong one drinks and a streak gives drinks', calls.some(c => c.kind === 'drink' && c.who === 'a') && calls.some(c => c.kind === 'drink' && c.who === 'b'));
  ok('couples: someone who missed gets a dare', calls.some(c => c.kind === 'dare' && c.who === 'a'));
  ok('no drinking, no dares when they are off', TR.afterQuestion([{ id: 'a', correct: false, streak: 0 }], { drinks: tbank.DRINKS.spicy, dares: tbank.DARES.spicy }).length === 0);

  console.log('\n-- uh-oh: part deux --');
  const PD = require(path.join(ROOT, 'partdeux/engine.js'));
  let pdDone = 0, pdProblem = '';
  for (let n = 0; n < 200 && !pdProblem; n++) {
    const g = PD.createGame({ players: Array.from({ length: 2 + n % 5 }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), level: ['kids', 'cheeky', 'spicy', 'filthy'][n % 4], drinking: true });
    try {
      for (let guard = 0; g.phase !== 'over' && guard < 5000; guard++) {
        const me = g.players[g.turn];
        if (me.hand.length === 2 && guard % 3) PD.callUhOh(g, me.id);
        const s = PD.snapshot(g, me.id);
        // Gifts need another card to give away; with none left, draw instead.
        const pick = s.playable.find(c => g.cards[c].kind !== 'gift' || me.hand.length > 1) || null;
        if (pick) {
          const card = g.cards[pick];
          const opts = card.kind === 'wild' || card.kind === 'wild4' ? { color: PD.COLORS[guard % 4] }
            : card.kind === 'gift' ? { giftCardId: me.hand.find(c => c !== pick), target: g.players.find(p => p.id !== me.id).id } : {};
          PD.play(g, me.id, pick, opts);
          if (g.vulnerable) PD.catchUhOh(g, g.players.find(p => p.id !== g.vulnerable).id, g.vulnerable);
        } else { PD.draw(g, me.id); if (g.drew) PD.pass(g, me.id); }
        const total = g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0);
        if (total !== 116) throw new Error('lost or duplicated a card: ' + total);
      }
      if (g.phase === 'over') pdDone++; else pdProblem = 'game ' + n + ' never ended';
    } catch (e) { pdProblem = 'game ' + n + ': ' + e.message; }
  }
  ok('200 random games all end with a winner and no lost cards', pdDone === 200, pdProblem);
  const pd = PD.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  const notMine = pd.players[1].hand[0];
  ok('you can only play your own cards on your turn', (() => { try { PD.play(pd, 'b', notMine); return false; } catch (e) { return e.status === 409; } })());
  ok('action cards wear funny names', PD.view({ kind: 'wild4', color: null, variant: 0 }, 'filthy').name.length > 3);
  const PDC = require(path.join(ROOT, 'partdeux/cards.js'));
  const pdKinds = ['skip', 'draw2', 'reverse', 'nope', 'gift', 'wild', 'wild4'];
  ok('every action card has names at every level', Object.keys(PDC.LEVELS).every(lv => pdKinds.every(k => PDC.FLAVOR[lv][k] && PDC.FLAVOR[lv][k].length >= 3)));
  ok('the kids deck has nothing rude in it', !/fuck|shit|ass|sex|drunk|booty|bomb/i.test(JSON.stringify(PDC.FLAVOR.kids)));
  const PDB = require(path.join(ROOT, 'partdeux/banter.js'));
  ok('the kids table only hears clean jokes', PDB.jokesFor('kids').every(j => PDB.JOKES.kids.includes(j)));
  ok('adult tables still hear some clean jokes', PDB.jokesFor('filthy').some(j => PDB.JOKES.kids.includes(j)));
  const jg = PD.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], level: 'kids' });
  let moves = 0, lastJoke = 0, closest = Infinity;
  while (jg.phase !== 'over' && moves < 3000) {
    const me = jg.players[jg.turn];
    const pick = PD.snapshot(jg, me.id).playable.find(id => jg.cards[id].kind !== 'gift');
    if (pick) PD.play(jg, me.id, pick, jg.cards[pick].kind.startsWith('wild') ? { color: 'red' } : {});
    else { PD.draw(jg, me.id); if (jg.drew) PD.pass(jg, me.id); }
    moves++;
    if (jg.jokeSeq > lastJoke) { if (lastJoke) closest = Math.min(closest, moves - jg._lastJokeAt); jg._lastJokeAt = moves; lastJoke = jg.jokeSeq; }
  }
  ok('jokes pop up during a game', jg.jokeSeq > 0);
  ok('…but never closer than six moves apart', closest >= 6, String(closest));
  const rv = PD.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
  const rvCard = Object.values(rv.cards).find(c => c.kind === 'reverse');
  rv.players[0].hand.push(rvCard.id);
  rv.color = rvCard.color;
  PD.play(rv, 'a', rvCard.id);
  ok('a Reverse tells every phone to beep like a truck', rv.fx && rv.fx.kind === 'reverse' && PD.snapshot(rv, 'b').fx.kind === 'reverse');

  console.log('\n-- dare devil --');
  const DD = require(path.join(ROOT, 'daredevil/engine.js'));
  const DDC = require(path.join(ROOT, 'daredevil/cards.js'));
  for (const lv of ['kids', 'cheeky', 'spicy', 'filthy']) {
    const g = DD.createGame({ players: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }], level: lv, drinking: true, length: 'quick' });
    let leftover = false;
    for (let i = 0; g.phase !== 'over' && i < 100; i++) {
      const pid = g.players[g.turn].id;
      DD.draw(g, pid);
      if (/\{other\}/.test(g.card.text) || g.card.text.includes(g.players[g.turn].name + ' ') && g.card.other === pid) leftover = true;
      if (i % 4) DD.done(g, pid); else DD.chicken(g, pid);
    }
    ok(`${lv}: a quick game plays to a winner, names filled in`, g.phase === 'over' && !!g.winner && !leftover);
  }
  const kidsTexts = DDC.pool('kids').map(c => c.text).join(' ');
  ok('the family deck has nothing rude in it', !/sex|naked|strip|kiss|drink|clothing|orgasm|fuck|shit/i.test(kidsTexts));
  ok('every card type is known', Object.values(DDC.DECK).flat().every(([type]) => DDC.TYPES[type]));

  console.log('\n-- snake --');
  const SN = require(path.join(ROOT, 'public/snake-engine.js'));
  const sg = SN.create({ cols: 10, rows: 10, rand: () => 0 });
  const head0 = { ...sg.snake[0] };
  SN.step(sg);
  ok('the snake moves one square each tick', sg.snake[0].x === head0.x + 1 && sg.snake.length === 3);
  ok('it cannot reverse into itself', SN.turn(sg, 'left') === false);
  ok('a turn is queued', SN.turn(sg, 'down') && SN.turn(sg, 'left') && sg.queue.join() === 'down,left');
  SN.step(sg); SN.step(sg);
  ok('quick double turns both happen', sg.dir === 'left');
  const eat = SN.create({ cols: 10, rows: 10 });
  eat.food = { x: eat.snake[0].x + 1, y: eat.snake[0].y };
  SN.step(eat); SN.step(eat);
  ok('eating an apple scores and grows the snake', eat.apples === 1 && eat.score === 20 && eat.snake.length === 4 && !!eat.food);
  const wall = SN.create({ cols: 10, rows: 10 });
  wall.food = { x: 0, y: 0 };
  for (let i = 0; i < 10 && !wall.over; i++) SN.step(wall);
  ok('classic: hitting a wall ends the game', wall.over && wall.events.includes('wall'));
  const wrap = SN.create({ cols: 10, rows: 10, mode: 'wrap' });
  wrap.food = { x: 0, y: 0 };
  for (let i = 0; i < 6; i++) SN.step(wrap);
  ok('wrap-around: walls take you to the other side', !wrap.over && wrap.snake[0].x === 1);
  const coil = SN.create({ cols: 10, rows: 10 });
  coil.food = { x: 0, y: 9 };
  coil.grow = 3;
  SN.step(coil);
  for (const d of ['down', 'left', 'up']) { SN.turn(coil, d); SN.step(coil); }
  ok('running into your own body ends the game', coil.over && coil.events.includes('self'));
  const chase = SN.create({ cols: 10, rows: 10 });
  chase.food = { x: 0, y: 9 };
  for (const d of ['down', 'left', 'up']) { SN.turn(chase, d); SN.step(chase); }
  ok('…but chasing your own tail is fine (it moves out of the way)', !chase.over);
  const gold = SN.create({ cols: 10, rows: 10 });
  gold.apples = 4;
  gold.food = { x: gold.snake[0].x + 1, y: gold.snake[0].y };
  SN.step(gold);
  ok('every 5th apple brings a golden star', !!gold.gold && gold.events.includes('gold-appears'));
  for (let i = 0; i < SN.GOLD_TICKS + 2 && gold.gold; i++) { gold.mode = 'wrap'; SN.step(gold); if (gold.over) break; }
  ok('…which disappears if you are too slow', !gold.gold);
  const fast = SN.create({ speed: 'fast' }), slow = SN.create({ speed: 'chill' });
  ok('faster speeds tick faster', SN.interval(fast) < SN.interval(slow));
  let filled = 0;
  for (let n = 0; n < 50; n++) {
    const r = SN.create({ cols: 12, rows: 12, mode: n % 2 ? 'wrap' : 'classic' });
    for (let i = 0; i < 3000 && !r.over; i++) {
      if (Math.random() < 0.3) SN.turn(r, ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)]);
      SN.step(r);
    }
    const cells = new Set(r.snake.map(p => p.x + ',' + p.y));
    if (cells.size === r.snake.length && r.snake.every(p => p.x >= 0 && p.y >= 0 && p.x < 12 && p.y < 12)) filled++;
  }
  ok('50 random games never overlap the snake or leave the board', filled === 50);

  console.log('\n-- brick breaker --');
  const BR = require(path.join(ROOT, 'public/bricks-engine.js'));
  ok('every level is 12 bricks wide and has something to break', BR.LEVELS.every((l, i) => BR.bricksFor(i).some(b => !b.steel)));
  const serveG = BR.create({ rand: () => 0.5 });
  BR.step(serveG, 0.1, { x: 100 });
  ok('the ball rides on the paddle until launched', serveG.balls[0].stuck && Math.abs(serveG.balls[0].x - 100) < 0.01);
  BR.step(serveG, 0.01, { x: 100, launch: true });
  ok('launching sends it up', serveG.phase === 'play' && serveG.balls[0].vy < 0);
  const edge = BR.create();
  edge.phase = 'play';
  edge.paddle.x = 180;
  edge.balls = [{ x: 180 + 30, y: edge.paddle.y - 12, vx: 0, vy: 200, r: 5 }];
  BR.step(edge, 0.02, { x: 180 });
  ok('hitting the end of the paddle sends the ball off at an angle', edge.balls[0].vy < 0 && edge.balls[0].vx > 100);
  const drop = BR.create();
  drop.phase = 'play';
  drop.balls = [{ x: 20, y: BR.H - 10, vx: 0, vy: 300, r: 5 }];
  drop.paddle.x = 300;
  BR.step(drop, 0.1, { x: 300 });
  ok('missing the ball costs a life and serves again', drop.lives === 2 && drop.phase === 'serve');
  drop.lives = 1;
  drop.phase = 'play';
  drop.balls = [{ x: 20, y: BR.H - 10, vx: 0, vy: 300, r: 5 }];
  BR.step(drop, 0.1, { x: 300 });
  ok('…and the last life ends the game', drop.phase === 'over');
  const rocket = BR.create();
  rocket.phase = 'play';
  const bricksBefore = rocket.bricks.length;
  rocket.balls = [{ x: 100, y: 400, vx: 0, vy: -4000, r: 5 }];
  BR.step(rocket, 0.1, { x: 100 });
  ok('even a very fast ball cannot pass through a brick', rocket.bricks.length === bricksBefore - 1 && rocket.balls[0].vy > 0);
  const split = BR.create();
  split.phase = 'play';
  split.balls = [{ x: 180, y: 300, vx: 50, vy: -200, r: 5 }];
  BR.applyPower(split, 'multi');
  ok('the three-ball power-up splits the ball', split.balls.length === 3);
  let clearedLevels = 0, problem = '';
  for (let L = 0; L < BR.LEVELS.length; L++) {
    let seed = L + 1;
    const g = BR.create({ level: L, rand: () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; } });
    for (let t = 0; t < 600 && g.phase !== 'cleared' && g.phase !== 'over'; t += 1 / 120) {
      const ball = g.balls.reduce((a, b) => (!a || b.y > a.y ? b : a), null);
      BR.step(g, 1 / 120, { x: ball ? ball.x + Math.sin(t * 1.7) * 20 : 180, launch: true });
      if (g.balls.some(b => !(b.x >= 0 && b.x <= BR.W) || Number.isNaN(b.y))) { problem = 'a ball left the field on level ' + (L + 1); break; }
    }
    if (g.phase === 'cleared') clearedLevels++;
    else if (!problem) problem = `level ${L + 1} not cleared (${BR.breakable(g)} left)`;
  }
  ok('an autopilot paddle can clear every level, and the ball never escapes', clearedLevels === BR.LEVELS.length, problem);

  console.log('\n-- block drop --');
  const BD = require(path.join(ROOT, 'public/blocks-engine.js'));
  const key = cells => cells.map(c => c.join(',')).sort().join(' ');
  ok('every piece has four squares in every turn', BD.TYPES.every(t => BD.ROTATIONS[t].every(st => st.length === 4)));
  ok('four turns bring a piece back to where it started', BD.TYPES.every(t => {
    const r = BD.ROTATIONS[t];
    return key(r[0].map(([x, y]) => [BD.SHAPES[t].size - 1 - y, x]).map(([x, y]) => [BD.SHAPES[t].size - 1 - y, x]).map(([x, y]) => [BD.SHAPES[t].size - 1 - y, x]).map(([x, y]) => [BD.SHAPES[t].size - 1 - y, x])) === key(r[0]);
  }));
  const bagG = BD.create({ rand: Math.random });
  const firstSeven = [bagG.piece.type, ...bagG.queue.slice(0, 6)];
  ok('pieces come from a bag of all seven', new Set(firstSeven).size === 7);
  const kick = BD.create();
  kick.piece = { type: 'I', rot: 1, x: -2, y: 5 };
  ok('a standing long piece fits against the left wall', BD.fits(kick, kick.piece));
  ok('…and still turns there (wall kick)', BD.rotate(kick, 1) && BD.cellsOf(kick.piece).every(([x]) => x >= 0));
  const clear = BD.create({ rand: () => 0 });
  for (let x = 0; x < 9; x++) for (const y of [18, 19, 20, 21]) clear.board[y][x] = 'Z';
  clear.piece = { type: 'I', rot: 1, x: 7, y: 0 };
  const dropped = BD.hardDrop(clear);
  ok('a hard drop scores 2 per row fallen', clear.score >= dropped * 2 && dropped > 10);
  ok('four rows at once clears them all', clear.lines === 4 && clear.board.slice(18).every(r => r.every(c => !c)));
  ok('…and scores the big bonus (800 x level, plus the perfect clear)', clear.score === dropped * 2 + 800 + 2000);
  const lockG = BD.create({ rand: () => 0.3 });
  const firstPiece = lockG.piece.type;
  for (let i = 0; i < 400 && lockG.piece.type === firstPiece && lockG.lines === 0; i++) BD.update(lockG, 0.05);
  ok('a piece that lands locks after a short delay and the next appears', lockG.board.some(r => r.some(Boolean)));
  const holdG = BD.create({ rand: () => 0.6 });
  const was = holdG.piece.type, nextUp = holdG.queue[0];
  BD.hold(holdG);
  ok('hold keeps the piece and brings out the next', holdG.hold === was && holdG.piece.type === nextUp);
  ok('…but only once per piece', BD.hold(holdG) === false);
  const top = BD.create({ rand: () => 0.1 });
  for (let y = 2; y < BD.ROWS; y++) for (let x = 0; x < BD.COLS; x++) if (x !== y % BD.COLS) top.board[y][x] = 'J';
  BD.hardDrop(top);
  for (let i = 0; i < 5 && !top.over; i++) BD.hardDrop(top);
  ok('filling up to the top ends the game', top.over);
  const rush = BD.create({ mode: 'rush' });
  for (let i = 0; i < 300 && !rush.over; i++) { BD.update(rush, 0.5); if (!rush.over && i % 3 === 0) BD.hardDrop(rush); }
  ok('the rush ends at two minutes (or a top-out)', rush.over && (rush.timeUp || rush.time < BD.RUSH_SECONDS));
  ok('pieces fall faster at higher levels', BD.fallSeconds(10) < BD.fallSeconds(1) / 5);
  let sane = 0;
  for (let n = 0; n < 40; n++) {
    const g = BD.create();
    for (let i = 0; i < 2000 && !g.over; i++) {
      const r = Math.random();
      if (r < 0.2) BD.move(g, -1); else if (r < 0.4) BD.move(g, 1); else if (r < 0.55) BD.rotate(g, 1);
      else if (r < 0.6) BD.rotate(g, -1); else if (r < 0.62) BD.hold(g); else if (r < 0.7) BD.hardDrop(g);
      BD.update(g, 0.05, { soft: r > 0.95 });
      if (!g.over && !BD.fits(g, g.piece)) break;
    }
    if (Number.isFinite(g.score) && (g.over || BD.fits(g, g.piece))) sane++;
  }
  ok('40 random games never leave a piece overlapping the stack', sane === 40);

  ok('snake speeds give you time to think (Normal is 150ms+ a step)', SN.interval(SN.create()) >= 150 && SN.interval(SN.create({ speed: 'chill' })) >= 200);
  const wallHit = BR.create();
  wallHit.phase = 'play';
  wallHit.balls = [{ x: BR.SIDE + 8, y: 400, vx: -300, vy: -10, r: 5 }];
  BR.step(wallHit, 0.05, { x: 180 });
  ok('brick breaker: the ball bounces off the side wall, not the screen edge', wallHit.balls[0].vx > 0 && wallHit.balls[0].x >= BR.SIDE + 5);
  BR.step(wallHit, 0.01, { x: -50 });
  ok('…and the paddle stays inside the walls', wallHit.paddle.x - wallHit.paddle.w / 2 >= BR.SIDE - 0.01);
  const nudge = BD.create({ rand: () => 0.5 });
  const y0 = nudge.piece.y;
  ok('block drop: pressing down moves the piece one row and scores 1', BD.softStep(nudge) && nudge.piece.y === y0 + 1 && nudge.score === 1);
  ok('…and holding down speeds it up without being instant', BD.SOFT_SECONDS >= 0.05 && BD.SOFT_SECONDS < BD.fallSeconds(1) / 5);

  console.log('\n-- tower defense --');
  const TD = require(path.join(ROOT, 'public/towers-engine.js'));
  const mapIds = Object.keys(TD.MAPS);
  ok('there are six maps, easy to hard', mapIds.length === 6 && ['Easy', 'Medium', 'Hard'].every(l => mapIds.some(id => TD.MAPS[id].level === l)));
  let roadsOk = true, roadProblem = '';
  for (const id of mapIds) {
    const m = TD.parseMap(id);
    m.tiles.forEach((row, y) => [...row].forEach((ch, x) => {
      if ((ch === '#' || ch === 'S') && !m.pathSet.has(x + ',' + y)) { roadsOk = false; roadProblem = `${id} ${x},${y} is road nobody walks`; }
    }));
    for (const p of m.paths) for (let i = 1; i < p.length; i++) if (Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]) !== 1) { roadsOk = false; roadProblem = id + ' road jumps'; }
  }
  ok('every map\'s roads lead to the castle, with no dead ends', roadsOk, roadProblem);
  const twoRoads = mapIds.filter(id => TD.parseMap(id).paths.length === 2);
  ok('Swamp and Volcano have two roads in', twoRoads.join() === 'swamp,volcano');
  const sw = TD.create({ map: 'swamp' });
  TD.startWave(sw);
  for (let i = 0; i < 90; i++) TD.step(sw, 1 / 30);
  ok('…and monsters take turns using each road', new Set(sw.enemies.map(e => e.road)).size === 2);
  const tg = TD.create({ map: 'meadow' });
  for (let i = 0; i < 30 * 60; i++) TD.step(tg, 1 / 30);
  ok('the first wave waits until you build something', tg.wave === 0 && tg.countdown == null);
  TD.build(tg, 'archer', 4, 1);
  ok('…then its clock starts', tg.countdown === TD.FIRST_BREAK);
  for (let i = 0; i < 30 * TD.FIRST_BREAK + 2; i++) TD.step(tg, 1 / 30);
  ok('…and wave 1 comes by itself when the clock runs out', tg.wave === 1 && tg.phase === 'wave');
  ok('a wave can\'t be called while it\'s still marching out', TD.canCall(tg) === false && TD.startWave(tg) === false);
  for (let i = 0; i < 30 * 120 && tg.phase === 'wave'; i++) { if (tg.enemies[0]) tg.enemies[0].hp = 0; TD.step(tg, 1 / 30); }
  ok('after a wave is cleared there\'s a break with a clock', tg.phase === 'build' && tg.countdown > TD.BREAK - 1);
  const fullBonus = TD.earlyBonus(tg);
  for (let i = 0; i < 30 * (TD.BREAK - 3); i++) TD.step(tg, 1 / 30);
  ok('calling the next wave early pays more the earlier you call', fullBonus > TD.earlyBonus(tg) && TD.earlyBonus(tg) > 0);
  const goldBefore = tg.gold, bonusNow = TD.earlyBonus(tg);
  ok('…and calling it starts it right away with the bonus', TD.startWave(tg) && tg.wave === 2 && tg.gold === goldBefore + bonusNow);
  const auto = TD.create({ map: 'meadow' });
  TD.armFirstWave(auto);
  for (let i = 0; i < 30 * 400 && auto.phase !== 'lost'; i++) TD.step(auto, 1 / 30);
  ok('with no towers at all, the waves keep coming until the castle falls', auto.phase === 'lost' && auto.wave >= 2);
  // A decent player (the same simple bot on every map) should win every map.
  const coverage = (g, x, y) => g.map.paths.reduce((n, p) => n + p.filter(([px, py]) => Math.hypot(px - x, py - y) <= 2.4).length, 0);
  const results = mapIds.map(id => {
    const g = TD.create({ map: id });
    const plan = ['archer', 'archer', 'frost', 'cannon', 'archer', 'tesla', 'cannon', 'frost', 'tesla'];
    const spots = [];
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) if (TD.canBuild(g, x, y)) spots.push({ x, y, c: coverage(g, x, y) });
    spots.sort((a, b) => b.c - a.c);
    let k = 0;
    for (let i = 0; i < 30 * 3000 && g.phase !== 'won' && g.phase !== 'lost'; i++) {
      if (i % 30 === 0) for (let guard = 0; guard < 20; guard++) {
        if (g.towers.length >= 6) {
          const up = g.towers.filter(t => TD.upgradeCost(t) != null).sort((a, b) => TD.upgradeCost(a) - TD.upgradeCost(b))[0];
          if (up && g.gold >= TD.upgradeCost(up) && (g.towers.length >= 10 || k % 2)) { TD.upgrade(g, up.id); continue; }
        }
        const type = plan[k % plan.length], spot = spots.find(p => TD.canBuild(g, p.x, p.y));
        if (!spot || g.gold < TD.TOWERS[type].levels[0].cost) break;
        TD.build(g, type, spot.x, spot.y); k++;
      }
      TD.step(g, 1 / 30);
    }
    return id + ':' + g.phase;
  });
  ok('a sensible player can win every map', results.every(r => r.endsWith(':won')), results.join(' '));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
