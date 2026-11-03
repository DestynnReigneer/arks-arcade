'use strict';

// The computer player for Words with Family. It isn't clever: it finds every word
// it can make along each row and column with its rack, scores each one with
// the same rules as everyone else (engine.evaluate), and plays the best. It
// doesn't use blanks, and its main word is always three letters or more
// (cross words can be two). With nothing to play, it swaps or passes.

const dictionary = require('../rambler/dictionary');
const E = require('./engine');

const { SIZE, CENTER } = E;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Which letters can go in an empty square without spoiling the word running
// the other way through it. null means anything goes (no neighbors that way).
function crossChecks(board, across, dict) {
  const perp = across ? SIZE : 1;
  const checks = new Array(SIZE * SIZE).fill(null);
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (board[i]) continue;
    const before = perp === 1 ? E.colOf(i) > 0 && board[i - 1] : i - SIZE >= 0 && board[i - SIZE];
    const after = perp === 1 ? E.colOf(i) < SIZE - 1 && board[i + 1] : i + SIZE < SIZE * SIZE && board[i + SIZE];
    if (!before && !after) continue;
    const ok = new Set();
    const test = board.slice();
    for (const ch of LETTERS) {
      test[i] = ch;
      if (E.isWord(E.wordThrough(test, i, perp).word, dict)) ok.add(ch);
    }
    checks[i] = ok;
  }
  return checks;
}

// Every play the rack can make along rows (across) or columns.
function linePlays(board, rack, across, dict, out) {
  const { root } = dictionary.load();
  const bit = dictionary.profileBit(E.dictOf(dict));
  const checks = crossChecks(board, across, dict);
  const empty = !board.some(Boolean);
  const anchor = i => (empty ? i === CENTER : !board[i] && E.neighbors(i).some(n => board[n]));
  const at = (line, k) => (across ? line * SIZE + k : k * SIZE + line);
  for (let line = 0; line < SIZE; line++) {
    for (let start = 0; start < SIZE; start++) {
      // A word starts at the edge or after an empty square.
      if (start > 0 && board[at(line, start - 1)]) continue;
      const counts = {};
      for (const t of rack) if (t !== '?') counts[t] = (counts[t] || 0) + 1;
      const placed = [];
      const walk = (node, k, word, touched) => {
        if (k < SIZE && board[at(line, k)]) {
          const ch = board[at(line, k)].toUpperCase();
          const nx = node[ch];
          if (nx && (nx[dictionary.PRE] & bit)) walk(nx, k + 1, word + ch, touched);
          return;
        }
        // The word can end here (edge or empty square next).
        if (placed.length && touched && word.length >= 3 && ((node[dictionary.TERM] || 0) & bit)) out.push(placed.slice());
        if (k >= SIZE) return;
        const i = at(line, k);
        for (const ch of Object.keys(counts)) {
          if (!counts[ch] || (checks[i] && !checks[i].has(ch))) continue;
          const nx = node[ch];
          if (!nx || !(nx[dictionary.PRE] & bit)) continue;
          counts[ch]--;
          placed.push({ index: i, letter: ch });
          walk(nx, k + 1, word + ch, touched || anchor(i));
          placed.pop();
          counts[ch]++;
        }
      };
      walk(root, start, '', false);
    }
  }
}

function bestPlay(state, seat) {
  const rack = state.racks[seat];
  const found = [];
  linePlays(state.board, rack, true, state.dictionary, found);
  linePlays(state.board, rack, false, state.dictionary, found);
  let best = null;
  for (const placements of found) {
    try {
      const r = E.evaluate(state, placements, { rack });
      if (!best || r.score > best.score) best = { placements, score: r.score };
    } catch { /* the full check turned it down */ }
  }
  return best;
}

// Takes the computer's turn on the game object. Returns what it did.
function move(state, seat, now = Date.now()) {
  const best = bestPlay(state, seat);
  if (best) { E.play(state, seat, best.placements, now); return 'play'; }
  if (state.bag.length >= E.SWAP_MIN) {
    // Swap the awkward tiles: blanks stay, everything else goes back.
    const out = state.racks[seat].filter(t => t !== '?');
    E.swap(state, seat, out.length ? out : state.racks[seat], now);
    return 'swap';
  }
  E.pass(state, seat, now);
  return 'pass';
}

module.exports = { bestPlay, move, crossChecks };
