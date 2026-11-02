'use strict';

// Sudoku puzzles, made here with no outside library.
//
// 1. Fill a whole 9x9 grid from a seeded random number generator, so the same
//    date and level always give the same grid.
// 2. Take numbers away one pair at a time (a cell and its mirror across the
//    center, so the puzzle looks balanced), putting a number back whenever
//    taking it away would leave more than one answer.
// 3. Grade it honestly by trying to solve it the way a person would:
//      family  lots of numbers given, and every step is "this square can only
//              be one number" (a naked single).
//      easy    fewer numbers, solvable with singles alone (a square that can
//              only be one number, or a number that can only go in one square
//              of a row, column or box).
//      medium  singles get stuck; it needs the next tricks too (pairs, and a
//              number pinned to one line of a box), and those finish it.
//      hard    even those tricks get stuck, so it takes deeper thinking.
//    A puzzle that doesn't fit its level is thrown away and the next one is
//    tried, still from the same seed, so everyone gets the same puzzle.

// ---- seeded randomness (the same mulberry32 the Rambler daily uses) ----------
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
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---- the board's shape --------------------------------------------------------
const ROW = i => Math.floor(i / 9);
const COL = i => i % 9;
const BOX = i => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3);
const UNITS = [];                                   // 27 lists of 9 cells: rows, columns, boxes
for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = Math.floor(b / 3) * 3, c0 = (b % 3) * 3;
  UNITS.push([...Array(9)].map((_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)));
}
const PEERS = [...Array(81)].map((_, i) => {
  const set = new Set();
  for (let j = 0; j < 81; j++) if (j !== i && (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i))) set.add(j);
  return [...set];
});
const ALL = 0x1FF;                                  // bits 0..8 stand for the numbers 1..9
const bitCount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowBit = m => m & -m;
const digitOf = bit => 31 - Math.clz32(bit) + 1;   // a single bit back to its number

// ---- brute force: counting answers -------------------------------------------
// Fills the emptiest-looking square first (the one with the fewest options),
// which keeps this fast. Stops as soon as it has found `limit` answers, so
// "is there exactly one?" only ever needs to look for two.
function search(grid, limit, rng, out) {
  const g = grid.slice();
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = 1 << (g[i] - 1);
    if ((rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)]) & b) return 0;   // the givens already clash
    rows[ROW(i)] |= b; cols[COL(i)] |= b; boxes[BOX(i)] |= b;
  }
  let found = 0;
  (function step() {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)]);
      const n = bitCount(m);
      if (n < bestCount) { best = i; bestMask = m; bestCount = n; if (n <= 1) break; }
    }
    if (best < 0) { found++; if (out && !out.length) out.push(g.slice()); return; }
    if (!bestMask) return;
    const bits = [];
    for (let m = bestMask; m; m &= m - 1) bits.push(lowBit(m));
    if (rng) shuffle(bits, rng);
    const r = ROW(best), c = COL(best), x = BOX(best);
    for (const b of bits) {
      g[best] = digitOf(b);
      rows[r] |= b; cols[c] |= b; boxes[x] |= b;
      step();
      rows[r] &= ~b; cols[c] &= ~b; boxes[x] &= ~b;
      g[best] = 0;
      if (found >= limit) return;
    }
  })();
  return found;
}

const countSolutions = (grid, limit = 2) => search(grid, limit, null, null);
function solve(grid) {
  const out = [];
  search(grid, 1, null, out);
  return out[0] || null;
}
function fullGrid(rng) {
  const out = [];
  search(new Array(81).fill(0), 1, rng, out);
  return out[0];
}

// ---- solving like a person ----------------------------------------------------
// tier 1: naked singles only (a square with one possible number)
// tier 2: plus hidden singles (a number with one possible square in a row,
//         column or box)
// tier 3: plus pointing and claiming (a number stuck to one line inside a
//         box, or to one box along a line) and naked and hidden pairs
// Returns how far it got: { solved, grid }.
function logicSolve(puzzle, tier) {
  const g = puzzle.slice();
  const cand = new Array(81).fill(ALL);
  const place = (i, d) => {
    g[i] = d; cand[i] = 0;
    const b = 1 << (d - 1);
    for (const p of PEERS[i]) cand[p] &= ~b;
  };
  for (let i = 0; i < 81; i++) if (g[i]) { const d = g[i]; g[i] = 0; place(i, d); }

  let progress = true;
  while (progress) {
    progress = false;
    // Naked singles, as many as there are.
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      if (!cand[i]) return { solved: false, grid: g };          // stuck: a square with no options
      if (bitCount(cand[i]) === 1) { place(i, digitOf(cand[i])); progress = true; }
    }
    if (progress) continue;
    if (tier >= 2 && hiddenSingle()) { progress = true; continue; }
    if (tier >= 3 && (pointing() || nakedPairs() || hiddenPairs())) { progress = true; continue; }
  }
  return { solved: g.every(Boolean), grid: g };

  function hiddenSingle() {
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const b = 1 << (d - 1);
        let spot = -1, n = 0;
        for (const i of unit) {
          if (g[i] === d) { n = 2; break; }
          if (!g[i] && cand[i] & b) { spot = i; n++; }
        }
        if (n === 1) { place(spot, d); return true; }
      }
    }
    return false;
  }
  // A number that, inside one unit, can only go where that unit overlaps
  // another unit, can't go anywhere else in that other unit.
  function pointing() {
    let changed = false;
    for (let a = 0; a < 27; a++) {
      for (let d = 1; d <= 9; d++) {
        const b = 1 << (d - 1);
        const spots = UNITS[a].filter(i => !g[i] && cand[i] & b);
        if (spots.length < 2) continue;
        for (let o = 0; o < 27; o++) {
          if (o === a || !spots.every(i => UNITS[o].includes(i))) continue;
          for (const i of UNITS[o]) {
            if (!g[i] && !spots.includes(i) && cand[i] & b) { cand[i] &= ~b; changed = true; }
          }
        }
      }
    }
    return changed;
  }
  function nakedPairs() {
    let changed = false;
    for (const unit of UNITS) {
      const twos = unit.filter(i => !g[i] && bitCount(cand[i]) === 2);
      for (let x = 0; x < twos.length; x++) {
        for (let y = x + 1; y < twos.length; y++) {
          if (cand[twos[x]] !== cand[twos[y]]) continue;
          const m = cand[twos[x]];
          for (const i of unit) {
            if (i !== twos[x] && i !== twos[y] && !g[i] && cand[i] & m) { cand[i] &= ~m; changed = true; }
          }
        }
      }
    }
    return changed;
  }
  function hiddenPairs() {
    let changed = false;
    for (const unit of UNITS) {
      const where = [];
      for (let d = 1; d <= 9; d++) {
        const b = 1 << (d - 1);
        where[d] = unit.filter(i => !g[i] && cand[i] & b);
      }
      for (let d1 = 1; d1 <= 9; d1++) {
        if (where[d1].length !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          if (where[d2].length !== 2 || where[d2][0] !== where[d1][0] || where[d2][1] !== where[d1][1]) continue;
          const keep = (1 << (d1 - 1)) | (1 << (d2 - 1));
          for (const i of where[d1]) if (cand[i] & ~keep) { cand[i] &= keep; changed = true; }
        }
      }
    }
    return changed;
  }
}

// The hardest tier a puzzle needs (1, 2 or 3), or 4 when tier 3 gets stuck.
function grade(puzzle) {
  for (const tier of [1, 2, 3]) if (logicSolve(puzzle, tier).solved) return tier;
  return 4;
}

// ---- the levels ---------------------------------------------------------------
const LEVELS = {
  family: { label: 'Family', minClues: 46, tier: 1 },
  easy: { label: 'Easy', minClues: 36, tier: 2 },
  medium: { label: 'Medium', minClues: 27, tier: 3 },
  hard: { label: 'Hard', minClues: 0, tier: 4 }
};
const LEVEL_IDS = Object.keys(LEVELS);
const MAX_TRIES = 60;

// Takes numbers away in mirrored pairs while `keeps(puzzle)` still says yes.
function carve(solution, rng, minClues, keeps) {
  const puzzle = solution.slice();
  const order = shuffle([...Array(41)].map((_, i) => i), rng);   // 0..40: the cell, its mirror is 80 - i
  let clues = 81;
  for (const i of order) {
    const j = 80 - i;
    const take = i === j ? 1 : 2;
    if (clues - take < minClues) continue;
    const a = puzzle[i], b = puzzle[j];
    puzzle[i] = 0; puzzle[j] = 0;
    if (keeps(puzzle)) clues -= take;
    else { puzzle[i] = a; puzzle[j] = b; }
  }
  return puzzle;
}

function attempt(level, rng) {
  const L = LEVELS[level];
  const solution = fullGrid(rng);
  let puzzle;
  if (L.tier <= 3) {
    // Solving it by those tricks alone also proves there's only one answer.
    puzzle = carve(solution, rng, L.minClues, p => logicSolve(p, L.tier).solved);
  } else {
    puzzle = carve(solution, rng, L.minClues, p => countSolutions(p, 2) === 1);
  }
  return { puzzle, solution, tier: grade(puzzle) };
}

// One level's puzzle for one day. Always the same for the same date and level.
function generate(day, level) {
  if (!LEVELS[level]) throw new Error(`Unknown level: ${level}`);
  const want = LEVELS[level].tier;
  let fallback = null;
  for (let n = 0; n < MAX_TRIES; n++) {
    const rng = seededRng(seedFrom(`sudoku|${day}|${level}|${n}`));
    const made = attempt(level, rng);
    if (made.tier === want) return finish(day, level, made, n);
    // The closest miss so far, in case no try lands exactly (in practice one does).
    if (!fallback || Math.abs(made.tier - want) < Math.abs(fallback.tier - want)) fallback = { ...made, n };
  }
  return finish(day, level, fallback, fallback.n);
}

function finish(day, level, { puzzle, solution, tier }, tries) {
  return {
    day, level, label: LEVELS[level].label,
    puzzle: puzzle.join(''), solution: solution.join(''),
    clues: puzzle.filter(Boolean).length, tier, tries
  };
}

// For a hint: the empty square a person could fill next, the one with the
// fewest options given what's on the board now (ties go to the first).
function easiestEmpty(grid) {
  let best = -1, bestCount = 10;
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    let m = ALL;
    for (const p of PEERS[i]) if (grid[p]) m &= ~(1 << (grid[p] - 1));
    const n = bitCount(m);
    if (n < bestCount) { best = i; bestCount = n; }
  }
  return best;
}

module.exports = {
  LEVELS, LEVEL_IDS, generate, solve, countSolutions, logicSolve, grade, easiestEmpty,
  seededRng, seedFrom, PEERS, UNITS
};
