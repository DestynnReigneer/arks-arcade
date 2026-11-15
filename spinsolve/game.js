'use strict';

// Spin & Solve's game, run on the server so the server decides every score.
// The page only draws it: it never sees an answer until the round is over,
// the wheel lands where the server says, and the total on the board is the
// one worked out here.
//
// A game lives in memory, and it's also written down after every move
// (through the store routes.js hands over) and read back when the arcade
// starts, so a restart or a power cut ends nobody's game. A page that reloads
// (a locked screen, a browser clearing a tab) finds its game again the same
// way. A guest's game, or one nobody has made a move in, is kept for a quiet
// day. A profile's game that has been played is kept for 30 quiet days, and
// shows in the home page's Continue row until it's finished.

const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');

const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const VOWEL_COST = 250;
const SOLVE_MIN = 1000;      // solving always banks at least this much
const MAX_STRIKES = 3;       // solo: three misses and the round is lost
const MAX_PLAYERS = 4;
const ROUNDS = [1, 3, 5];
// 24 wedges, clockwise from the top. The page draws the same list.
const WEDGES = [500, 900, 300, 650, 'BANKRUPT', 400, 700, 350, 550, 800, 'LOSE A TURN', 450,
  600, 1000, 300, 500, 750, 400, 850, 350, 500, 600, 450, 700];
const KEEP_MS = 24 * 60 * 60 * 1000;   // a guest's game, or one with no move in it, is gone after a quiet day
const KEEP_PLAYED_MS = 30 * 24 * 60 * 60 * 1000;   // a profile's game that has been played waits 30 quiet days
const OVER_KEEP_MS = 10 * 60 * 1000;   // a finished game stays 10 minutes, to save the score
const MAX_GAMES = 3000;
const MAX_PER_OWNER = 10;              // games one address or one profile can have going at once

const games = new Map();

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const letters = s => s.replace(/[^A-Z]/g, '');
const pickFrom = list => list[crypto.randomInt(list.length)];

// ---- kept between restarts ---------------------------------------------------------
// The store is { save(id, state, touched), remove(id), all() }, where all()
// gives every row as { id, state }. routes.js hands over one that writes to
// the database. Without one (the tests that load this file by itself) games
// live in memory only, as they did before.
let store = null;
function useStore(s) { store = s || null; }

// A game as text: everything but its list of puzzles, which is shared with
// every other game on the same list and put together again from poolKey.
const packed = g => JSON.stringify({ ...g, pool: undefined, revealed: [...g.revealed], used: [...g.used], usedPuzzles: [...g.usedPuzzles] });
function keep(g) {
  if (!store || !games.has(g.id)) return;
  try { store.save(g.id, packed(g), g.touched); } catch (e) { console.error('Spin & Solve could not save a game:', e.message); }
}
function drop(id) {
  games.delete(id);
  if (store) { try { store.remove(id); } catch { /* it's gone from memory either way */ } }
}

// What a kept game has to look like before it's let back in: every field the
// rest of this file reads, in the shape it reads it.
const PHASES = ['turn', 'letter', 'roundover', 'over'];
const isCount = n => Number.isInteger(n) && n >= 0;
const isTexts = list => Array.isArray(list) && list.every(s => typeof s === 'string');
function sound(g, id) {
  if (!g || typeof g !== 'object' || g.id !== id || !/^[0-9a-f]{32}$/.test(id)) return false;
  if (!Array.isArray(g.players) || !g.players.length || g.players.length > MAX_PLAYERS) return false;
  if (!g.players.every(p => p && typeof p.name === 'string' && isCount(p.round) && isCount(p.total))) return false;
  if (!PHASES.includes(g.phase) || !ROUNDS.includes(g.rounds) || !isCount(g.round) || g.round < 1 || g.round > g.rounds + 1) return false;
  if (!isCount(g.cur) || g.cur >= g.players.length || !isCount(g.strikes) || !Number.isFinite(g.touched)) return false;
  if (!isTexts(g.revealed) || !isTexts(g.used) || !isTexts(g.usedPuzzles) || !isTexts([g.level, g.poolKey, g.packLabel])) return false;
  if (typeof g.adult !== 'boolean' || (g.phase === 'letter' && !Number.isFinite(g.wedge))) return false;
  if (g.phase === 'over') return true;
  return !!g.puzzle && typeof g.puzzle.answer === 'string' && !!letters(g.puzzle.answer) && typeof g.puzzle.category === 'string';
}

// Reads the kept games back when the arcade starts. listOf(key) finds a game's
// list of puzzles again -> { level, adult, pool }, or null when it's gone. A
// game whose list is gone (its pack was deleted), or isn't the level the game
// was started on anymore, carries on with the puzzle it's on. A row that isn't
// a game (someone edited it, or a later mistake wrote it) is left out, said in
// the log and removed, so one bad row can never keep the arcade from starting.
// -> how many came back.
function restore(listOf, now = Date.now()) {
  if (!store) return 0;
  let back = 0;
  for (const row of store.all()) {
    const id = String(row && row.id);
    try {
      const g = JSON.parse(row.state);
      if (!sound(g, id)) throw new Error('it is not a game anymore');
      let list = null;
      try { list = listOf(g.poolKey); } catch { /* the list is gone */ }
      const fits = !!list && list.level === g.level && list.adult === g.adult && Array.isArray(list.pool) && list.pool.length > 0;
      g.pool = fits ? list.pool : (g.puzzle ? [g.puzzle] : []);
      g.revealed = new Set(g.revealed);
      g.used = new Set(g.used);
      g.usedPuzzles = new Set(g.usedPuzzles);
      g.wedge = g.phase === 'letter' ? g.wedge : null;
      g.overAt = Number(g.overAt) || 0;
      g.moved = !!g.moved;
      g.saved = !!g.saved;
      games.set(id, g);
      back++;
    } catch (e) {
      console.error(`Spin & Solve left out a saved game it could not read: ${e.message}`);
      try { store.remove(id); } catch { /* it stays out of memory either way */ }
    }
  }
  sweep(now);
  return back;
}

const keepFor = g => (g.profileId && g.moved ? KEEP_PLAYED_MS : KEEP_MS);
function sweep(now = Date.now()) {
  for (const [id, g] of games) {
    if (now - g.touched > keepFor(g) || (g.phase === 'over' && now - g.overAt > OVER_KEEP_MS)) drop(id);
  }
}

// So one visitor can't fill the arcade with games: starting one more than a
// share drops one of that visitor's own. A signed-in player's games are counted
// by profile, wherever they're played, and everyone else's by address. A guest's
// games are never counted with a profile's, so a guest on the same network, or
// on the same device, can't push out a game that's kept for a person. An address
// is counted the way the rate limiter counts it (a whole IPv6 network is one
// visitor), so changing addresses inside one network doesn't get around the
// share. Only a fingerprint of it is kept, never the address itself.
const ownerOf = ip => (ip ? crypto.createHash('sha256').update(`spin:${ipKeyGenerator(String(ip))}`).digest('hex').slice(0, 24) : null);
// Which game makes room first: one nobody has made a move in, then a guest's,
// and a profile's played game last. Among equals, the quietest goes.
const keptFor = g => (!g.moved ? 0 : g.profileId ? 2 : 1);
const firstToGo = (a, b) => (keptFor(a) - keptFor(b)) || (a.touched - b.touched);
function makeRoom(owner, profileId) {
  if (!profileId && !owner) return;
  const mine = [...games.values()].filter(g => (profileId ? g.profileId === profileId : !g.profileId && g.ip === owner)).sort(firstToGo);
  while (mine.length >= MAX_PER_OWNER) drop(mine.shift().id);
}

// pool: [{ category, answer, pack? }], already checked and allowed for this player.
// poolKey: the name of that list ('level:kids', 'pack:12'), so it can be found again after a restart.
function start({ pool, poolKey, names, rounds, level, adult, packLabel, profileId, ip }) {
  if (!pool.length) throw fail('No puzzles here yet.', 404);
  const owner = ownerOf(ip);
  sweep();
  makeRoom(owner, profileId || null);
  // Full: one game makes room (see firstToGo), so a pile of abandoned games can
  // never keep someone from starting one.
  while (games.size >= MAX_GAMES) {
    let out = null;
    for (const g of games.values()) if (!out || firstToGo(g, out) < 0) out = g;
    drop(out.id);
  }
  const list = (Array.isArray(names) ? names : []).slice(0, MAX_PLAYERS);
  if (!list.length) list.push('');
  const g = {
    id: crypto.randomBytes(16).toString('hex'),
    pool, poolKey: poolKey || '', level, adult: !!adult, packLabel: packLabel || '', profileId: profileId || null, ip: owner, overAt: 0, moved: false,
    rounds: ROUNDS.includes(Number(rounds)) ? Number(rounds) : 3,
    players: list.map((n, i) => ({ name: String(n || '').trim().slice(0, 16) || `Player ${i + 1}`, round: 0, total: 0 })),
    round: 0, cur: 0, puzzle: null, revealed: new Set(), used: new Set(), strikes: 0,
    wedge: null, phase: 'turn', usedPuzzles: new Set(), saved: false, touched: Date.now()
  };
  games.set(g.id, g);
  nextRound(g);
  keep(g);
  return g;
}

function get(id) {
  const g = games.get(String(id || ''));
  if (!g) throw fail('That game has ended. Start a new one.', 404);
  g.touched = Date.now();
  return g;
}

const solo = g => g.players.length === 1;
const remaining = (g, set) => [...new Set(letters(g.puzzle.answer))].filter(ch => set.includes(ch) && !g.revealed.has(ch));

function nextRound(g) {
  if (g.phase !== 'turn' && g.phase !== 'roundover') throw fail('Finish this round first.', 409);
  if (g.round && g.phase !== 'roundover') throw fail('Finish this round first.', 409);
  g.round++;
  if (g.round > g.rounds) { g.phase = 'over'; g.overAt = Date.now(); g.puzzle = null; return; }
  let pool = g.pool.filter(p => !g.usedPuzzles.has(p.answer));
  if (!pool.length) { g.usedPuzzles.clear(); pool = g.pool; }
  g.puzzle = pickFrom(pool);
  g.usedPuzzles.add(g.puzzle.answer);
  g.revealed = new Set();
  g.used = new Set();
  g.strikes = 0;
  g.wedge = null;
  g.players.forEach(p => { p.round = 0; });
  g.cur = (g.round - 1) % g.players.length;
  g.phase = 'turn';
}

// A miss of any kind: a strike when playing alone, the next player otherwise.
function endTurn(g) {
  g.wedge = null;
  if (solo(g)) {
    g.strikes++;
    if (g.strikes >= MAX_STRIKES) {
      g.players.forEach(p => { p.round = 0; });
      g.phase = 'roundover';
      return { lost: true };
    }
  } else g.cur = (g.cur + 1) % g.players.length;
  g.phase = 'turn';
  return {};
}

function bank(g) {
  const p = g.players[g.cur];
  const won = Math.max(p.round, SOLVE_MIN);
  p.total += won;
  g.players.forEach(x => { x.round = 0; });
  g.phase = 'roundover';
  return won;
}

function needTurn(g) {
  if (g.phase !== 'turn') throw fail(g.phase === 'letter' ? 'Pick a consonant first.' : 'This round is over.', 409);
}

function spin(g) {
  needTurn(g);
  if (!remaining(g, CONSONANTS).length) throw fail('No consonants left. Buy a vowel or solve.', 409);
  const wedge = crypto.randomInt(WEDGES.length);
  const w = WEDGES[wedge];
  const p = g.players[g.cur];
  if (w === 'BANKRUPT') { p.round = 0; return { wedge, value: w, ...endTurn(g) }; }
  if (w === 'LOSE A TURN') return { wedge, value: w, ...endTurn(g) };
  g.wedge = w;
  g.phase = 'letter';
  return { wedge, value: w };
}

// A consonant after a spin, or a vowel bought on your turn.
function call(g, raw, vowel) {
  const ch = String(raw || '').toUpperCase();
  if (!/^[A-Z]$/.test(ch)) throw fail('Pick a letter.');
  if (vowel !== VOWELS.includes(ch)) throw fail(vowel ? 'Pick a vowel: A, E, I, O or U.' : 'Pick a consonant (not A, E, I, O or U).');
  if (g.used.has(ch)) throw fail(`${ch} was already called.`);
  const p = g.players[g.cur];
  if (vowel) {
    needTurn(g);
    if (p.round < VOWEL_COST) throw fail(`A vowel costs $${VOWEL_COST} of this round's money.`, 409);
    if (!remaining(g, VOWELS).length) throw fail('No vowels left.', 409);
    p.round -= VOWEL_COST;
  } else if (g.phase !== 'letter') throw fail('Spin first.', 409);
  g.used.add(ch);
  const answer = g.puzzle.answer;
  const positions = [];
  for (let i = 0; i < answer.length; i++) if (answer[i] === ch) positions.push(i);
  if (!positions.length) return { ch, count: 0, positions, ...endTurn(g) };
  if (!vowel) p.round += g.wedge * positions.length;
  g.revealed.add(ch);
  g.wedge = null;
  g.phase = 'turn';
  // Every letter showing solves it.
  if (!remaining(g, CONSONANTS + VOWELS).length) return { ch, count: positions.length, positions, solved: true, won: bank(g) };
  return { ch, count: positions.length, positions };
}

function solve(g, guess) {
  needTurn(g);
  const tried = letters(String(guess || '').toUpperCase()).slice(0, 80);
  if (!tried) throw fail('Type your answer first.');
  if (tried === letters(g.puzzle.answer)) return { correct: true, won: bank(g) };
  return { correct: false, ...endTurn(g) };
}

// The clock ran out (after a spin, buying a vowel or solving). The clock is the
// page's: it only decides how long someone may think, never what they score.
function timeUp(g) {
  if (g.phase !== 'turn' && g.phase !== 'letter') throw fail('This round is over.', 409);
  return endTurn(g);
}

// What the page may see: the board with every hidden letter as _, and the
// answer only once the round is over.
function view(g) {
  const over = g.phase === 'roundover' || g.phase === 'over';
  const out = {
    id: g.id, phase: g.phase, round: g.round, rounds: g.rounds, cur: g.cur, strikes: g.strikes, solo: solo(g),
    players: g.players.map(p => ({ name: p.name, round: p.round, total: p.total })),
    used: [...g.used].sort(), wedge: g.wedge, adult: g.adult, canSave: solo(g) && g.phase === 'over' && !g.saved && g.players[0].total > 0
  };
  if (g.puzzle) {
    const answer = g.puzzle.answer;
    out.category = g.puzzle.category;
    out.pack = g.puzzle.pack || '';
    out.board = over ? answer : answer.replace(/[A-Z]/g, c => (g.revealed.has(c) ? c : '_'));
    out.consonantsLeft = remaining(g, CONSONANTS).length > 0;
    out.vowelsLeft = remaining(g, VOWELS).length > 0;
    if (over) out.answer = answer;
  }
  return out;
}

// A profile's games that have been played and aren't finished, for the home page's Continue row.
function mine(profileId) {
  if (!profileId) return [];
  return [...games.values()].filter(g => g.profileId === profileId && g.moved && g.phase !== 'over').map(g => ({
    id: g.id, round: g.round, rounds: g.rounds, names: g.players.map(p => p.name), solo: solo(g),
    total: g.players[0].total + g.players[0].round, adult: g.adult, updatedAt: g.touched
  }));
}

// Every move is written down as it happens, so the game is the same after a restart.
const moving = fn => (g, ...rest) => {
  const out = fn(g, ...rest);
  g.moved = true;
  g.touched = Date.now();
  keep(g);
  return out;
};

module.exports = {
  start, get, view, spin: moving(spin), call: moving(call), solve: moving(solve), timeUp: moving(timeUp), nextRound: moving(nextRound),
  sweep, drop, mine, useStore, restore, games,
  WEDGES, VOWEL_COST, SOLVE_MIN, MAX_STRIKES, MAX_PLAYERS, MAX_PER_OWNER, MAX_GAMES, KEEP_MS, KEEP_PLAYED_MS
};
