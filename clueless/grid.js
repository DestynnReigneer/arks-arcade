'use strict';

// Clueless: the grid shapes and the filler. No database and no outside
// library, so the tests (and anyone curious) can load it on its own.
//
// A shape is a few rows of text: `#` is a black square and `.` a white one.
// Every white square sits in an across word and a down word of 3 letters or
// more, and the shapes look the same turned upside down, like a newspaper's.
// The filler tries words in a shuffled order that comes from the seed alone,
// always filling the spot with the fewest words that still fit next, and
// backs up when a spot has nothing left. Same words in, same seed, same grid.

// The same small seeded random numbers as the Rambler daily (mulberry32 and
// FNV-1a), copied so this file needs nothing else.
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Hand-made shapes, a few per size. They're tried in an order picked from the
// date, so the look changes from day to day.
const SHAPES = {
  5: [
    ['##...', '#....', '.....', '....#', '...##'],
    ['...##', '....#', '.....', '#....', '##...'],
    ['##...', '##...', '.....', '...##', '...##'],
    ['...##', '...##', '.....', '##...', '##...'],
    ['...##', '.....', '.....', '.....', '##...'],
    ['....#', '....#', '.....', '#....', '#....']
  ],
  7: [
    ['...#...', '...#...', '.......', '##...##', '.......', '...#...', '...#...'],
    ['###...#', '###....', '.......', '...#...', '.......', '....###', '#...###'],
    ['##....#', '##.....', '##.....', '...#...', '.....##', '.....##', '#....##'],
    ['###...#', '###...#', '.......', '...#...', '.......', '#...###', '#...###'],
    ['#...###', '#...###', '.......', '...#...', '.......', '###...#', '###...#'],
    ['....###', '....###', '.....##', '...#...', '##.....', '###....', '###....']
  ]
};

// Reads a shape: its size, which squares are black, every across and down
// spot with its number, the way a printed crossword numbers them.
function parseShape(rows) {
  const size = rows.length;
  const black = [];
  for (const r of rows) for (const ch of r) black.push(ch === '#');
  const white = (r, c) => r >= 0 && c >= 0 && r < size && c < size && !black[r * size + c];
  const slots = [];
  const numbers = new Array(size * size).fill(0);
  let n = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!white(r, c)) continue;
      const startsAcross = !white(r, c - 1) && white(r, c + 1);
      const startsDown = !white(r - 1, c) && white(r + 1, c);
      if (!startsAcross && !startsDown) continue;
      numbers[r * size + c] = ++n;
      if (startsAcross) {
        const cells = [];
        for (let k = c; white(r, k); k++) cells.push(r * size + k);
        slots.push({ dir: 'across', num: n, row: r, col: c, cells });
      }
      if (startsDown) {
        const cells = [];
        for (let k = r; white(k, c); k++) cells.push(k * size + c);
        slots.push({ dir: 'down', num: n, row: r, col: c, cells });
      }
    }
  }
  return { size, rows, black, numbers, slots };
}

// What makes a shape fair: every white square in an across and a down word,
// each 3 letters or more, the same upside down, and all in one piece.
function checkShape(rows) {
  const s = parseShape(rows);
  const problems = [];
  if (rows.some(r => r.length !== s.size || /[^#.]/.test(r))) problems.push('not square');
  const across = new Array(s.size * s.size).fill(0), down = new Array(s.size * s.size).fill(0);
  for (const slot of s.slots) {
    if (slot.cells.length < 3) problems.push(`${slot.num} ${slot.dir} is too short`);
    for (const i of slot.cells) (slot.dir === 'across' ? across : down)[i]++;
  }
  for (let i = 0; i < s.black.length; i++) {
    if (s.black[i]) continue;
    if (across[i] !== 1 || down[i] !== 1) problems.push(`square ${i} is not in both an across and a down word`);
    if (s.black[s.black.length - 1 - i]) problems.push('not the same upside down');
  }
  const first = s.black.indexOf(false), seen = new Set([first]), todo = [first];
  while (todo.length) {
    const i = todo.pop(), r = Math.floor(i / s.size), c = i % s.size;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc, j = rr * s.size + cc;
      if (rr >= 0 && cc >= 0 && rr < s.size && cc < s.size && !s.black[j] && !seen.has(j)) { seen.add(j); todo.push(j); }
    }
  }
  if (seen.size !== s.black.filter(b => !b).length) problems.push('not in one piece');
  return problems;
}

// Fills one shape from `words` (a list of uppercase words). Returns the
// letters (one string, `#` for black) or null when these words can't do it
// within `budget` tries.
function fillShape(shape, words, rng, { budget = 30000 } = {}) {
  // Words by length, and for each length which words have which letter at
  // which place, so the words that fit a half-filled spot are quick to find.
  const byLength = new Map();
  for (const w of shuffle([...new Set(words)].sort(), rng)) {
    if (!byLength.has(w.length)) byLength.set(w.length, { list: [], at: [] });
    const group = byLength.get(w.length);
    const n = group.list.push(w) - 1;
    for (let k = 0; k < w.length; k++) {
      if (!group.at[k]) group.at[k] = {};
      (group.at[k][w[k]] = group.at[k][w[k]] || []).push(n);
    }
  }
  const known = new Set(words);
  const letters = shape.black.map(b => (b ? '#' : ''));
  const slots = shape.slots;
  const filled = new Array(slots.length).fill(null);
  const used = new Set();
  let tries = 0;

  function options(slot) {
    const group = byLength.get(slot.cells.length);
    if (!group) return [];
    // Start from the letter already in place that the fewest words share.
    let pool = null;
    const fixed = [];
    for (let k = 0; k < slot.cells.length; k++) {
      const ch = letters[slot.cells[k]];
      if (!ch) continue;
      fixed.push(k);
      const list = (group.at[k] && group.at[k][ch]) || [];
      if (!pool || list.length < pool.length) pool = list;
    }
    const out = [];
    for (const n of pool || group.list.keys()) {
      const w = group.list[n];
      if (used.has(w)) continue;
      let ok = true;
      for (const k of fixed) if (letters[slot.cells[k]] !== w[k]) { ok = false; break; }
      if (ok) out.push(w);
    }
    return out;
  }

  function step() {
    if (++tries > budget) return false;
    // The open spot with the fewest words that still fit.
    let best = -1, bestList = null;
    for (let s = 0; s < slots.length; s++) {
      if (filled[s]) continue;
      const list = options(slots[s]);
      if (!list.length) return false;
      if (!bestList || list.length < bestList.length) { best = s; bestList = list; if (list.length === 1) break; }
    }
    if (best < 0) return true;
    const slot = slots[best];
    for (const word of bestList) {
      const before = slot.cells.map(i => letters[i]);
      slot.cells.forEach((i, k) => { letters[i] = word[k]; });
      filled[best] = word;
      used.add(word);
      // A spot that got completed by its crossings has to be a real word too
      // (and not one used already).
      const done = [];
      let ok = true;
      for (let s = 0; s < slots.length && ok; s++) {
        if (filled[s]) continue;
        const cells = slots[s].cells;
        if (cells.every(i => letters[i])) {
          const w = cells.map(i => letters[i]).join('');
          if (used.has(w) || !known.has(w)) ok = false;
          else { filled[s] = w; used.add(w); done.push(s); }
        }
      }
      if (ok && step()) return true;
      for (const s of done) { used.delete(filled[s]); filled[s] = null; }
      used.delete(word);
      filled[best] = null;
      slot.cells.forEach((i, k) => { letters[i] = before[k]; });
      if (tries > budget) return false;
    }
    return false;
  }
  return step() ? letters.join('') : null;
}

// Every across and down word in a filled grid.
function entries(shape, letters) {
  return shape.slots.map(slot => ({ ...slot, answer: slot.cells.map(i => letters[i]).join('') }));
}

// The day's grid for one size: the shapes in an order picked from the seed,
// the first one the words can fill. Null if none of them can.
function build({ seed, size, words, budget }) {
  const rng = seededRng(seedFrom(seed));
  const order = shuffle(SHAPES[size].map((_, i) => i), rng);
  for (const index of order) {
    const shape = parseShape(SHAPES[size][index]);
    const letters = fillShape(shape, words, seededRng(seedFrom(`${seed}|${index}`)), { budget });
    if (letters) return { shape: index, size, letters, entries: entries(shape, letters), numbers: shape.numbers };
  }
  return null;
}

module.exports = { SHAPES, parseShape, checkShape, fillShape, entries, build, seededRng, seedFrom, shuffle };
