'use strict';

// Clueless: turns a set of clued words into one day's puzzle. No database
// here either; puzzles.js hands in the clues and keeps what comes out.

const grid = require('./grid');

// The two puzzles of the day. The family mini only uses family clues; the
// grown-ups' puzzle is bigger and also uses the trickier grown-up clues.
const LEVELS = {
  mini: { id: 'mini', label: 'Family mini', size: 5, kinds: ['kids'] },
  big: { id: 'big', label: 'Grown-ups', size: 7, kinds: ['kids', 'grownup'] }
};
const LEVEL_IDS = Object.keys(LEVELS);

// `clues` is a Map of word -> { kids: [clue...], grownup: [clue...] }.
// Returns null when the words can't fill any of the shapes.
function makePuzzle(day, level, clues, { budget } = {}) {
  const L = LEVELS[level];
  const usable = w => w.length <= L.size && L.kinds.some(k => (clues.get(w)[k] || []).length);
  const words = [...clues.keys()].filter(usable).sort();
  const seed = `clueless|${day}|${level}`;
  const built = grid.build({ seed, size: L.size, words, budget });
  if (!built) return null;
  const entries = built.entries.map(e => {
    const have = clues.get(e.answer);
    // A grown-up clue when there is one (they're the trickier kind), picked
    // from the date like everything else.
    const kind = L.kinds.slice().reverse().find(k => (have[k] || []).length);
    const options = [...new Set(have[kind])].sort();
    const pick = options[Math.floor(grid.seededRng(grid.seedFrom(`${seed}|${e.answer}`))() * options.length)];
    return { dir: e.dir, num: e.num, row: e.row, col: e.col, cells: e.cells, answer: e.answer, clue: pick };
  });
  return { day, level, size: L.size, shape: built.shape, letters: built.letters, numbers: built.numbers, entries };
}

// What the page gets: the shape, the numbers and the clues. Never a letter.
function publicView(p) {
  const clue = e => ({ num: e.num, row: e.row, col: e.col, cells: e.cells, clue: e.clue });
  return {
    size: p.size,
    blocks: p.letters.replace(/[A-Z]/g, '.'),
    numbers: p.numbers,
    across: p.entries.filter(e => e.dir === 'across').map(clue),
    down: p.entries.filter(e => e.dir === 'down').map(clue)
  };
}

module.exports = { LEVELS, LEVEL_IDS, makePuzzle, publicView };
