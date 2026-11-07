'use strict';

// The eight cars on ARKS Train Station's train: each has a name (on its side and on the light board) and how hard it
// is to land in (easy cars are long and worth 5, medium 15, hard ones short and worth 40). The admin page's Arcade tab
// names them. Until then the train uses the made-up names below, so the repo never carries anyone's real names.

const db = require('../db');

const KEY = 'train_cars';
const KINDS = ['easy', 'med', 'hard'];
const DEFAULTS = [
  { name: 'Comet', kind: 'easy' }, { name: 'Blaze', kind: 'hard' }, { name: 'Pixel', kind: 'easy' }, { name: 'Rocket', kind: 'med' },
  { name: 'Nova', kind: 'easy' }, { name: 'Turbo', kind: 'hard' }, { name: 'Jinx', kind: 'easy' }, { name: 'Zap', kind: 'med' }
];
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,11}$/u;

function get() {
  const saved = db.getSetting(KEY, null);
  if (!Array.isArray(saved) || saved.length !== 8) return DEFAULTS.map(c => ({ ...c }));
  return saved.map((c, i) => ({
    name: typeof c.name === 'string' && NAME_RE.test(c.name) ? c.name : DEFAULTS[i].name,
    kind: KINDS.includes(c.kind) ? c.kind : DEFAULTS[i].kind
  }));
}

function set(cars) {
  if (!Array.isArray(cars) || cars.length !== 8) throw Object.assign(new Error('The train has exactly 8 cars.'), { status: 400 });
  const clean = cars.map((c, i) => {
    const name = String((c && c.name) || '').trim();
    if (!NAME_RE.test(name)) throw Object.assign(new Error(`Car ${i + 1}'s name should be 1 to 12 letters, numbers or spaces.`), { status: 400 });
    if (!KINDS.includes(c.kind)) throw Object.assign(new Error(`Car ${i + 1} should be easy, medium or hard.`), { status: 400 });
    return { name, kind: c.kind };
  });
  db.setSetting(KEY, clean);
  return get();
}

module.exports = { get, set, DEFAULTS, KINDS };
