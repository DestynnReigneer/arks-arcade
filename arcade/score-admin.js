'use strict';

// Taking a single score off a board, from the admin page's Boards tab, and
// putting it back.
//
// A removed score is moved out of its game's table into `removed_scores`,
// whole, with when it was removed and by whom. Nothing is erased: putting it
// back copies the row into its table again with the same id. Moving it out
// (rather than marking it and teaching every game's board to skip it) means
// every board, rank, "fastest ever" and "your best" in every game leaves it
// out without any game having to know about this file.
//
// Which games have boards: the ones listed in KNOWN below, plus any other
// table named `<game>_scores` with an `id`, `initials` and a `score` or
// `time_ms` column, so a new game's board shows up here on its own.

const express = require('express');
const db = require('../db');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS removed_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    tbl TEXT NOT NULL,
    score_id INTEGER NOT NULL,
    row TEXT NOT NULL,
    removed_at TEXT NOT NULL DEFAULT (datetime('now')),
    removed_by TEXT NOT NULL DEFAULT '',
    UNIQUE (tbl, score_id)
  );
  CREATE INDEX IF NOT EXISTS removed_scores_game ON removed_scores (game);
`);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const TABLE_RE = /^[a-z][a-z0-9_]*_scores$/;
// Rambler's boards have their own Remove buttons on the Rambler tab (and its
// seasons turn scores into badges), so they're left to that tab. Disco Drop, Roll Royale and Moonshot
// were taken out of the arcade on 2026-11-07; their old scores stay in the database but get no board.
const SKIP = new Set(['rambler_scores', 'discodrop_scores', 'royale_scores', 'moonshot_scores']);

const columnsOf = table => db.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const tableExists = table => !!db.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

// The games we know by name. Each one says where its scores live, how its
// boards are split (boardCol), and which way is best (order).
function known() {
  const list = [];
  const one = [{ id: 'all', label: 'The board' }];
  const levels = obj => Object.entries(obj).map(([id, v]) => ({ id, label: v.label }));
  const add = def => { if (tableExists(def.table)) list.push(def); };

  add({ id: 'sudoku', label: 'Sudoku', table: 'sudoku_scores', boardCol: 'level', unit: 'time', daily: true,
    boards: levels(require('../sudoku/generator').LEVELS) });
  add({ id: 'clueless', label: 'Clueless Crosswords', table: 'clueless_scores', boardCol: 'level', unit: 'time', daily: true,
    boards: levels(require('../clueless/maker').LEVELS) });
  add({ id: 'tumbler', label: 'Tumbler Rumble', table: 'tumbler_scores', unit: 'points', daily: true, boards: one });
  add({ id: 'scuffle', label: 'Shuffle Scuffle', table: 'scuffle_scores', boardCol: 'dictionary', unit: 'points', daily: true,
    boards: [{ id: 'kids', label: 'Family daily' }, { id: 'adult', label: 'Unfiltered daily' }] });
  add({ id: 'wordless', label: 'Wordless', table: 'scores', boardCol: 'difficulty', unit: 'points', daily: false,
    boards: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['ludicrous', 'Ludicrous']].map(([id, label]) => ({ id, label })) });
  // The older games share one table, split by game and then by board.
  for (const [id, g] of Object.entries(require('./scores').GAMES)) {
    add({ id, label: g.label, table: 'arcade_scores', gameCol: 'game', boardCol: 'board', unit: 'points', daily: false,
      boards: Object.entries(g.boards).map(([b, label]) => ({ id: b, label })) });
  }
  return list;
}

// Any other `<game>_scores` table: a game added after this file was written.
function discovered(taken) {
  const names = require('./switches').NAMES || {};
  const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_scores' ESCAPE '\\'").all().map(r => r.name);
  const out = [];
  for (const table of tables) {
    if (taken.has(table) || SKIP.has(table) || !TABLE_RE.test(table)) continue;
    const cols = columnsOf(table);
    if (!cols.includes('id') || !cols.includes('initials')) continue;
    const unit = cols.includes('time_ms') ? 'time' : cols.includes('score') ? 'points' : null;
    if (!unit) continue;
    const id = table.replace(/_scores$/, '');
    const boardCol = cols.includes('level') ? 'level' : null;
    const boards = boardCol
      ? db.db.prepare(`SELECT DISTINCT level FROM ${table} ORDER BY level`).all().map(r => ({ id: String(r.level), label: String(r.level) }))
      : [{ id: 'all', label: 'The board' }];
    out.push({ id, label: names[id] || id[0].toUpperCase() + id.slice(1), table, boardCol, unit, daily: cols.includes('day'),
      boards: boards.length ? boards : [{ id: 'all', label: 'The board' }] });
  }
  return out;
}

function games() {
  const list = known();
  return [...list, ...discovered(new Set(list.map(g => g.table)))];
}
function gameOf(id) {
  const g = games().find(x => x.id === String(id || ''));
  if (!g) throw fail('There is no board for that game.', 404);
  return g;
}
const orderOf = g => (g.unit === 'time' ? 'time_ms ASC, id ASC' : 'score DESC, id ASC');

// Does this row belong to this game (and, given a board, to that board)?
function belongs(g, row, board) {
  if (g.gameCol && row[g.gameCol] !== g.id) return false;
  if (board && g.boardCol && String(row[g.boardCol]) !== String(board)) return false;
  return true;
}

function shape(g, r) {
  return {
    id: r.id,
    initials: r.initials,
    name: r.profile_name || null,
    value: g.unit === 'time' ? r.time_ms : r.score,
    day: r.day || null,
    createdAt: r.created_at || null,
    detail: r.detail || r.theme_label || null
  };
}

// The rows on one board, best first, and the scores removed from it.
function board(gameId, { board: boardId, scope = 'all', day } = {}) {
  const g = gameOf(gameId);
  const b = g.boards.find(x => x.id === String(boardId || '')) || g.boards[0];
  const where = [], args = [];
  if (g.gameCol) { where.push(`${g.gameCol} = ?`); args.push(g.id); }
  if (g.boardCol) { where.push(`${g.boardCol} = ?`); args.push(b.id); }
  const daily = g.daily && scope === 'day';
  const theDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : require('../rambler/progress').today();
  if (daily) { where.push('day = ?'); args.push(theDay); }
  const rows = db.db.prepare(`SELECT * FROM ${g.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderOf(g)} LIMIT 100`).all(...args);
  const removed = db.db.prepare('SELECT * FROM removed_scores WHERE game = ? AND tbl = ? ORDER BY removed_at DESC, id DESC').all(g.id, g.table)
    .map(r => ({ ...r, data: JSON.parse(r.row) }))
    .filter(r => belongs(g, r.data, b.id) && (!daily || r.data.day === theDay))
    .map(r => ({ ...shape(g, r.data), removedAt: r.removed_at, removedBy: r.removed_by }));
  return {
    game: g.id, board: b.id, scope: daily ? 'day' : 'all', day: daily ? theDay : null, unit: g.unit,
    rows: rows.map((r, i) => ({ rank: i + 1, ...shape(g, r) })),
    removed
  };
}

function remove(gameId, scoreId, by) {
  const g = gameOf(gameId);
  const id = Number(scoreId);
  const row = Number.isInteger(id) && db.db.prepare(`SELECT * FROM ${g.table} WHERE id = ?`).get(id);
  if (!row || !belongs(g, row)) throw fail('That score isn\'t on the board (it may have been removed already).', 404);
  db.db.exec('BEGIN');
  try {
    db.db.prepare('INSERT INTO removed_scores (game, tbl, score_id, row, removed_by) VALUES (?, ?, ?, ?, ?)')
      .run(g.id, g.table, id, JSON.stringify(row), String(by || '').slice(0, 80));
    db.db.prepare(`DELETE FROM ${g.table} WHERE id = ?`).run(id);
    db.db.exec('COMMIT');
  } catch (e) { db.db.exec('ROLLBACK'); throw e; }
  return { removed: true, id };
}

function restore(gameId, scoreId) {
  const g = gameOf(gameId);
  const kept = db.db.prepare('SELECT * FROM removed_scores WHERE game = ? AND tbl = ? AND score_id = ?').get(g.id, g.table, Number(scoreId));
  if (!kept) throw fail('That score isn\'t in the removed list.', 404);
  const data = JSON.parse(kept.row);
  const cols = columnsOf(g.table).filter(c => Object.hasOwn(data, c));
  db.db.exec('BEGIN');
  try {
    db.db.prepare(`INSERT INTO ${g.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => data[c]));
    db.db.prepare('DELETE FROM removed_scores WHERE id = ?').run(kept.id);
    db.db.exec('COMMIT');
  } catch (e) {
    db.db.exec('ROLLBACK');
    if (/UNIQUE/i.test(e.message)) throw fail('It can\'t go back yet, because the same player already has another score in its place on that board (only one counts per day). Remove that one first if this one should win.', 409);
    throw e;
  }
  return { restored: true, id: Number(scoreId) };
}

// whoOf(req) -> a name for "removed by" (the server knows best who is asking).
function routes({ whoOf = () => 'the admin page' } = {}) {
  const router = express.Router();
  const wrap = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };
  router.get('/', wrap(() => ({
    games: games().map(g => ({ id: g.id, label: g.label, unit: g.unit, daily: g.daily, boards: g.boards }))
  })));
  router.get('/:game', wrap(req => board(req.params.game, req.query)));
  router.post('/:game/:id/remove', wrap(async req => remove(req.params.game, req.params.id, await whoOf(req))));
  router.post('/:game/:id/restore', wrap(req => restore(req.params.game, req.params.id)));
  router.use((err, req, res, next) => {
    if (!err.status) return next(err);
    res.status(err.status).json({ error: err.message });
  });
  return router;
}

module.exports = { routes, games, board, remove, restore };
