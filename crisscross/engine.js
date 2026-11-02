'use strict';

// Criss Cross: the board, the tiles and the rules. No database here, so the
// tests (and the computer player) can use it on its own.
//
// The game keeps everything in one plain object (see newGame). The server
// stores it whole and only ever shows each player their own rack.
//
// The board is 11 by 11, small enough to read on a phone. Squares are
// numbered 0 to 120, row by row, so square i is row Math.floor(i / 11),
// column i % 11.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dictionary = require('../rambler/dictionary');

const SIZE = 11;
const CENTER = 5 * SIZE + 5;
const RACK = 7;              // tiles on a rack
const ALL_TILES_BONUS = 40;  // for using all seven in one turn
const SWAP_MIN = 7;          // tiles that must be left in the bag to swap
const SCORELESS_END = 6;     // turns in a row without points that end the game
const MAX_PLAYERS = 4;

// The bonus squares, our own pattern. T triples the word, D doubles it,
// t triples the letter, d doubles the letter, and * is the middle square
// (the first word has to cover it, and it doubles that word).
const LAYOUT = [
  'T..d...d..T',
  '.D...t...D.',
  '..d.....d..',
  'd..D...D..d',
  '....d.d....',
  '.t...*...t.',
  '....d.d....',
  'd..D...D..d',
  '..d.....d..',
  '.D...t...D.',
  'T..d...d..T'
];
const BONUS = LAYOUT.join('').split('').map(ch => ({ T: 'tw', D: 'dw', '*': 'dw', t: 'tl', d: 'dl' }[ch] || ''));

// How many of each letter are in the bag, and what each is worth. Balanced
// for the arcade's word lists: lots of vowels so kids don't get stuck, and
// one each of the hard letters. ? is a blank: it can stand for any letter and
// scores nothing.
const TILES = {
  A: [5, 1], B: [1, 3], C: [2, 3], D: [2, 2], E: [7, 1], F: [1, 4], G: [2, 2], H: [2, 4], I: [5, 1],
  J: [1, 8], K: [1, 5], L: [3, 1], M: [2, 3], N: [4, 1], O: [4, 1], P: [2, 3], Q: [1, 10], R: [4, 1],
  S: [4, 1], T: [4, 1], U: [2, 2], V: [1, 5], W: [1, 4], X: [1, 8], Y: [1, 4], Z: [1, 10], '?': [2, 0]
};
const VALUES = Object.fromEntries(Object.entries(TILES).map(([k, [, v]]) => [k, v]));
const BAG_SIZE = Object.values(TILES).reduce((n, [c]) => n + c, 0);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const rowOf = i => Math.floor(i / SIZE);
const colOf = i => i % SIZE;

// ---- words ------------------------------------------------------------------------------

// The arcade's dictionary tree only holds words of three letters or more, so
// two-letter words come from the same big list here, with the same rules:
// British spellings out, and the kids list without anything blocked.
let twos = null;
function twoLetterWords() {
  if (twos) return twos;
  const dir = path.join(__dirname, '..', 'words');
  const read = f => {
    try { return fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map(s => s.trim().toUpperCase()).filter(s => s && !s.startsWith('#')); } catch { return []; }
  };
  const british = new Set(read('british.txt'));
  const blocked = new Set(read('blocklist-kids.txt'));
  const all = read('enable1.txt').filter(w => /^[A-Z]{2}$/.test(w) && !british.has(w));
  const extra = read('supplement-adult.txt').filter(w => /^[A-Z]{2}$/.test(w));
  twos = { kids: new Set(all.filter(w => !blocked.has(w))), adult: new Set([...all, ...extra]) };
  return twos;
}
const dictOf = raw => (raw === 'adult' ? 'adult' : 'kids');
function isWord(word, dict) {
  const w = String(word || '').toUpperCase();
  if (w.length < 2 || !/^[A-Z]+$/.test(w)) return false;
  if (w.length === 2) return twoLetterWords()[dictOf(dict)].has(w);
  return dictionary.isWord(w, dictOf(dict));
}

// ---- a new game -------------------------------------------------------------------------

function shuffle(list, rand = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
// Real randomness for the bag: nobody can work out what's coming next.
const cryptoRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

function newBag(rand = cryptoRand) {
  const bag = [];
  for (const [letter, [count]] of Object.entries(TILES)) for (let k = 0; k < count; k++) bag.push(letter);
  return shuffle(bag, rand);
}

function draw(state, seat) {
  const rack = state.racks[seat];
  while (rack.length < RACK && state.bag.length) rack.push(state.bag.pop());
}

// players: [{ name, profileId?, avatar?, bot? }], in turn order.
function newGame({ players, dictionary: dict = 'kids', rand = cryptoRand }) {
  if (!Array.isArray(players) || players.length < 2 || players.length > MAX_PLAYERS) throw fail('A game needs 2 to 4 players.');
  const state = {
    board: new Array(SIZE * SIZE).fill(''),   // '' empty, A-Z a tile, a-z a blank standing for that letter
    played: new Array(SIZE * SIZE).fill(0),   // which move put the tile there (1-based), for the last-move glow
    bag: newBag(rand),
    racks: players.map(() => []),
    scores: players.map(() => 0),
    players: players.map(p => ({ ...p })),
    resigned: players.map(() => false),
    dictionary: dictOf(dict),
    turn: 0,
    scoreless: 0,
    moves: [],
    over: null
  };
  players.forEach((_, seat) => draw(state, seat));
  return state;
}

// ---- checking and scoring a play -----------------------------------------------------------

// Reads what the page sent: [{ index, letter, blank }]. The letter is what
// the tile shows; for a blank it's the letter it stands for.
function cleanPlacements(raw) {
  if (!Array.isArray(raw) || !raw.length) throw fail('Put at least one tile on the board first.');
  if (raw.length > RACK) throw fail('That\'s more tiles than a rack holds.');
  return raw.map(p => {
    const index = Number(p && p.index);
    const letter = String((p && p.letter) || '').toUpperCase();
    if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE) throw fail('A tile landed off the board.');
    if (!/^[A-Z]$/.test(letter)) throw fail('Every tile needs a letter.');
    return { index, letter, blank: !!(p && p.blank) };
  });
}

// Takes the tiles a play uses out of a copy of the rack, or says what's missing.
function takeFromRack(rack, placements) {
  const left = rack.slice();
  for (const p of placements) {
    const k = left.indexOf(p.blank ? '?' : p.letter);
    if (k < 0) throw fail(p.blank ? 'You don\'t have a blank tile to use.' : `You don't have a ${p.letter} on your rack.`);
    left.splice(k, 1);
  }
  return left;
}

// Works out everything about a play without changing the game: whether it's
// allowed, every new word it makes, and the points. Throws a plain sentence
// for anything wrong.
function evaluate(state, rawPlacements, { rack = null } = {}) {
  const placements = cleanPlacements(rawPlacements);
  if (rack) takeFromRack(rack, placements);
  const board = state.board.slice();
  const fresh = new Set();
  for (const p of placements) {
    if (fresh.has(p.index)) throw fail('Two tiles can\'t share a square.');
    if (board[p.index]) throw fail('That square already has a tile on it.');
    fresh.add(p.index);
    board[p.index] = p.blank ? p.letter.toLowerCase() : p.letter;
  }
  const firstMove = !state.board.some(Boolean);
  const rows = new Set(placements.map(p => rowOf(p.index)));
  const cols = new Set(placements.map(p => colOf(p.index)));
  if (rows.size > 1 && cols.size > 1) throw fail('All your tiles have to go in one line, across or down.');
  // With one tile, the line is whichever way makes the longer word.
  let across = rows.size === 1 && (cols.size > 1 || placements.length === 1);
  if (placements.length === 1) {
    const i = placements[0].index;
    const left = colOf(i) > 0 && board[i - 1], right = colOf(i) < SIZE - 1 && board[i + 1];
    across = !!(left || right);
  }
  const step = across ? 1 : SIZE;
  // No gaps: every square between the first and last new tile must be filled.
  const sorted = placements.map(p => p.index).sort((a, b) => a - b);
  for (let i = sorted[0]; i <= sorted[sorted.length - 1]; i += step) {
    if (!board[i]) throw fail('Your tiles have to make one word with no gaps in it.');
  }
  if (firstMove) {
    if (!fresh.has(CENTER)) throw fail('The first word has to cover the star in the middle.');
    if (placements.length < 2) throw fail('The first word needs at least two letters.');
  } else {
    const touches = placements.some(p => neighbors(p.index).some(n => board[n] && !fresh.has(n)));
    if (!touches) throw fail('Your word has to join onto tiles already on the board.');
  }

  // Every new word: the one along the line, and one across it for each new
  // tile that has neighbors that way.
  const words = [];
  const main = wordThrough(board, sorted[0], step);
  if (main.cells.length >= 2) words.push(main);
  for (const p of placements) {
    const cross = wordThrough(board, p.index, across ? SIZE : 1);
    if (cross.cells.length >= 2) words.push(cross);
  }
  if (!words.length) throw fail('That doesn\'t make a word of two letters or more.');
  const bad = words.filter(w => !isWord(w.word, state.dictionary));
  if (bad.length) {
    const list = [...new Set(bad.map(w => w.word))];
    throw fail(`${list.join(', ')} ${list.length === 1 ? 'isn\'t a word' : 'aren\'t words'} in this game's word list.`);
  }
  let score = 0;
  const scored = words.map(w => {
    let sum = 0, times = 1;
    for (const i of w.cells) {
      const ch = board[i];
      let v = ch === ch.toLowerCase() ? 0 : VALUES[ch];
      if (fresh.has(i)) {
        if (BONUS[i] === 'dl') v *= 2;
        if (BONUS[i] === 'tl') v *= 3;
        if (BONUS[i] === 'dw') times *= 2;
        if (BONUS[i] === 'tw') times *= 3;
      }
      sum += v;
    }
    score += sum * times;
    return { word: w.word, score: sum * times };
  });
  const allTiles = placements.length === RACK;
  if (allTiles) score += ALL_TILES_BONUS;
  return { placements, words: scored, score, allTiles };
}

function neighbors(i) {
  const out = [];
  if (rowOf(i) > 0) out.push(i - SIZE);
  if (rowOf(i) < SIZE - 1) out.push(i + SIZE);
  if (colOf(i) > 0) out.push(i - 1);
  if (colOf(i) < SIZE - 1) out.push(i + 1);
  return out;
}

// The whole run of tiles through square i, going across (step 1) or down (step SIZE).
function wordThrough(board, i, step) {
  const sameLine = (a, b) => (step === 1 ? rowOf(a) === rowOf(b) : true);
  let start = i;
  while (start - step >= 0 && sameLine(start - step, i) && board[start - step]) start -= step;
  const cells = [];
  for (let k = start; k < SIZE * SIZE && sameLine(k, i) && board[k]; k += step) cells.push(k);
  return { cells, word: cells.map(k => board[k].toUpperCase()).join('') };
}

// ---- taking a turn ---------------------------------------------------------------------------

const rackValue = rack => rack.reduce((n, t) => n + VALUES[t], 0);
const active = state => state.players.map((_, s) => s).filter(s => !state.resigned[s]);

function assertTurn(state, seat) {
  if (state.over) throw fail('This game is over.', 409);
  if (state.resigned[seat]) throw fail('You left this game.', 409);
  if (state.turn !== seat) throw fail('It isn\'t your turn yet.', 409);
}

function nextTurn(state) {
  const n = state.players.length;
  let t = state.turn;
  for (let k = 0; k < n; k++) {
    t = (t + 1) % n;
    if (!state.resigned[t]) break;
  }
  state.turn = t;
}

function record(state, seat, move, now) {
  state.moves.push({ seat, at: now, ...move });
}

function play(state, seat, rawPlacements, now = Date.now()) {
  assertTurn(state, seat);
  const result = evaluate(state, rawPlacements, { rack: state.racks[seat] });
  state.racks[seat] = takeFromRack(state.racks[seat], result.placements);
  const moveNo = state.moves.length + 1;
  for (const p of result.placements) {
    state.board[p.index] = p.blank ? p.letter.toLowerCase() : p.letter;
    state.played[p.index] = moveNo;
  }
  state.scores[seat] += result.score;
  record(state, seat, { kind: 'play', words: result.words, score: result.score, allTiles: result.allTiles,
    tiles: result.placements.map(p => p.index) }, now);
  draw(state, seat);
  state.scoreless = result.score > 0 ? 0 : state.scoreless + 1;
  // Out of tiles with the bag empty: the game is over.
  if (!state.racks[seat].length && !state.bag.length) finish(state, 'out', seat);
  else if (state.scoreless >= SCORELESS_END) finish(state, 'stalled');
  else nextTurn(state);
  return result;
}

// Swaps some tiles for new ones from the bag. The old ones go back in after
// the new ones are drawn, so you never get the same tile straight back.
function swap(state, seat, rawTiles, now = Date.now(), rand = cryptoRand) {
  assertTurn(state, seat);
  if (state.bag.length < SWAP_MIN) throw fail(`Swapping needs at least ${SWAP_MIN} tiles left in the bag.`);
  const tiles = (Array.isArray(rawTiles) ? rawTiles : []).map(t => String(t).toUpperCase());
  if (!tiles.length) throw fail('Pick the tiles you want to swap.');
  if (tiles.length > RACK) throw fail('That\'s more tiles than a rack holds.');
  const left = state.racks[seat].slice();
  for (const t of tiles) {
    const k = left.indexOf(t);
    if (k < 0) throw fail('You can only swap tiles on your own rack.');
    left.splice(k, 1);
  }
  state.racks[seat] = left;
  draw(state, seat);
  state.bag.push(...tiles);
  shuffle(state.bag, rand);
  record(state, seat, { kind: 'swap', count: tiles.length, score: 0 }, now);
  return endScoreless(state);
}

function pass(state, seat, now = Date.now()) {
  assertTurn(state, seat);
  record(state, seat, { kind: 'pass', score: 0 }, now);
  return endScoreless(state);
}

function endScoreless(state) {
  state.scoreless++;
  if (state.scoreless >= SCORELESS_END) finish(state, 'stalled');
  else nextTurn(state);
  return { score: 0 };
}

// Leaving a game. It can be done on anyone's turn. With one player left, the
// game is over and they win.
function resign(state, seat, now = Date.now()) {
  if (state.over) throw fail('This game is over.', 409);
  if (state.resigned[seat]) throw fail('You already left this game.', 409);
  state.resigned[seat] = true;
  record(state, seat, { kind: 'resign', score: 0 }, now);
  if (active(state).length < 2) return finish(state, 'resigned');
  if (state.turn === seat) nextTurn(state);
  return null;
}

// The end. Everyone loses the points still on their rack; when someone used
// their last tile, they get everyone else's leftovers too.
function finish(state, why, outSeat = null) {
  const adjust = state.players.map(() => 0);
  if (why !== 'resigned') {
    let leftovers = 0;
    state.players.forEach((_, s) => {
      if (state.resigned[s] || s === outSeat) return;
      const v = rackValue(state.racks[s]);
      adjust[s] -= v;
      leftovers += v;
    });
    if (outSeat !== null) adjust[outSeat] += leftovers;
  }
  adjust.forEach((v, s) => { state.scores[s] += v; });
  const still = active(state);
  const best = Math.max(...still.map(s => state.scores[s]));
  state.over = { why, outSeat, adjust, winners: still.filter(s => state.scores[s] === best) };
  return state.over;
}

module.exports = {
  SIZE, CENTER, RACK, ALL_TILES_BONUS, SWAP_MIN, SCORELESS_END, MAX_PLAYERS, LAYOUT, BONUS, TILES, VALUES, BAG_SIZE,
  isWord, twoLetterWords, dictOf, newGame, newBag, evaluate, play, swap, pass, resign, finish, wordThrough, neighbors,
  rackValue, rowOf, colOf, shuffle, fail
};
