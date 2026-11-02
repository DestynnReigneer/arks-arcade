'use strict';

// Clueless: the clue packs and the day's puzzles, kept in the database.
//
// A day's puzzle is made the first time anyone opens it and then saved, so it
// stays the same all day for everyone, even if a clue pack is added or
// deleted, or the server restarts, before midnight.

const db = require('../db');
const clues = require('./clues');
const maker = require('./maker');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS clueless_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS clueless_clues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    kind TEXT NOT NULL,
    clue TEXT NOT NULL,
    pack_id INTEGER,
    UNIQUE (word, kind, clue)
  );
  CREATE INDEX IF NOT EXISTS clueless_clues_pack ON clueless_clues (pack_id);
  CREATE TABLE IF NOT EXISTS clueless_puzzles (
    day TEXT NOT NULL,
    level TEXT NOT NULL,
    data TEXT NOT NULL,
    made_from TEXT NOT NULL DEFAULT 'all',
    PRIMARY KEY (day, level)
  );
`);

// Every clue there is: word -> { kids: [...], grownup: [...] }. The built-in
// ones are family clues.
function clueMap({ starterOnly = false } = {}) {
  const map = new Map();
  const add = (word, kind, clue) => {
    if (!map.has(word)) map.set(word, { kids: [], grownup: [] });
    map.get(word)[kind].push(clue);
  };
  for (const [word, clue] of clues.starterClues()) add(word, 'kids', clue);
  if (!starterOnly) {
    for (const r of db.db.prepare('SELECT word, kind, clue FROM clueless_clues').all()) {
      if (clues.KINDS[r.kind]) add(r.word, r.kind, r.clue);
    }
  }
  return map;
}

// ---- the day's puzzles -------------------------------------------------------------------
const cache = new Map();
function puzzleFor(day, level) {
  const key = `${day}|${level}`;
  if (cache.has(key)) return cache.get(key);
  let p = null;
  const row = db.db.prepare('SELECT data FROM clueless_puzzles WHERE day = ? AND level = ?').get(day, level);
  if (row) p = JSON.parse(row.data);
  else {
    // Every clued word first; if they somehow can't fill a shape, the
    // built-in clues always can (the tests check a few years of dates).
    let from = 'all';
    p = maker.makePuzzle(day, level, clueMap());
    if (!p) { from = 'starter'; p = maker.makePuzzle(day, level, clueMap({ starterOnly: true }), { budget: 200000 }); }
    if (!p) throw Object.assign(new Error('Today\'s crossword couldn\'t be made. Please let the admin know.'), { status: 500 });
    db.db.prepare('INSERT OR IGNORE INTO clueless_puzzles (day, level, data, made_from) VALUES (?, ?, ?, ?)').run(day, level, JSON.stringify(p), from);
    p = JSON.parse(db.db.prepare('SELECT data FROM clueless_puzzles WHERE day = ? AND level = ?').get(day, level).data);
  }
  if (cache.size > 16) for (const k of [...cache.keys()].slice(0, cache.size - 12)) cache.delete(k);
  cache.set(key, p);
  return p;
}
// Old puzzles are only needed for old runs; a month is plenty.
function sweep(today) {
  const cutoff = new Date(`${today}T12:00:00`);
  cutoff.setDate(cutoff.getDate() - 31);
  db.db.prepare('DELETE FROM clueless_puzzles WHERE day < ?').run(cutoff.toISOString().slice(0, 10));
}

// ---- clue packs ------------------------------------------------------------------------------
function summary() {
  const count = kind => db.db.prepare('SELECT COUNT(DISTINCT word) AS c FROM clueless_clues WHERE kind = ?').get(kind).c;
  return { starter: clues.starterClues().size, kids: count('kids'), grownup: count('grownup') };
}

function listPacks() {
  return db.db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM clueless_clues c WHERE c.pack_id = p.id) AS count
    FROM clueless_packs p ORDER BY p.created_at DESC, p.id DESC`).all()
    .map(r => ({ id: r.id, label: r.label, kind: r.kind, count: r.count, createdAt: r.created_at }));
}

function packClues(id) {
  return db.db.prepare('SELECT word, clue FROM clueless_clues WHERE pack_id = ? ORDER BY word').all(Number(id));
}

// Words from the common list for the prompt, the ones without a clue of
// this kind yet first, so every pack adds new words to the grids.
function batch(kind, count = 40) {
  const have = new Set(db.db.prepare('SELECT DISTINCT word FROM clueless_clues WHERE kind = ?').all(kind).map(r => r.word));
  if (kind === 'kids') for (const w of clues.starterClues().keys()) have.add(w);
  const fresh = clues.commonWords().filter(w => !have.has(w));
  const pool = fresh.length >= count ? fresh : clues.commonWords();
  const picked = new Set();
  // Mostly short words, since the family mini only takes up to 5 letters.
  const short = pool.filter(w => w.length <= 5), long = pool.filter(w => w.length > 5);
  const want = Math.min(count, pool.length);
  while (picked.size < want) {
    const from = (kind === 'kids' ? Math.random() < 0.75 : Math.random() < 0.55) && short.length ? short : long.length ? long : short;
    picked.add(from[Math.floor(Math.random() * from.length)]);
  }
  return [...picked].sort();
}

function addPack({ label, kind, text }) {
  const name = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw Object.assign(new Error('Give the pack a name, so you can find it later.'), { status: 400 });
  if (!clues.KINDS[kind]) throw Object.assign(new Error('Pick Family or Grown-up clues.'), { status: 400 });
  const { keep, skipped, error } = clues.checkPaste(text);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const fresh = keep.filter(k => {
    const dup = db.db.prepare('SELECT 1 FROM clueless_clues WHERE word = ? AND kind = ? AND clue = ?').get(k.word, kind, k.clue);
    if (dup) skipped.push({ word: k.word, reason: 'that exact clue is already saved' });
    return !dup;
  });
  if (fresh.length < 5) {
    const why = skipped.length ? ` Skipped: ${skipped.slice(0, 4).map(s => `${s.word} (${s.reason})`).join('; ')}${skipped.length > 4 ? '…' : ''}` : '';
    throw Object.assign(new Error(`A pack needs at least 5 clues that pass the checks, and this one has ${fresh.length}.${why}`), { status: 400, skipped });
  }
  const id = Number(db.db.prepare('INSERT INTO clueless_packs (label, kind) VALUES (?, ?)').run(name, kind).lastInsertRowid);
  const insert = db.db.prepare('INSERT OR IGNORE INTO clueless_clues (word, kind, clue, pack_id) VALUES (?, ?, ?, ?)');
  for (const k of fresh) insert.run(k.word, kind, k.clue, id);
  return { pack: listPacks().find(p => p.id === id), added: fresh.length, skipped };
}

function deletePack(id) {
  db.db.prepare('DELETE FROM clueless_clues WHERE pack_id = ?').run(Number(id));
  db.db.prepare('DELETE FROM clueless_packs WHERE id = ?').run(Number(id));
}

module.exports = { clueMap, puzzleFor, sweep, summary, listPacks, packClues, batch, addPack, deletePack };
