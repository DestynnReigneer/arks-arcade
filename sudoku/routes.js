'use strict';

// Sudoku: the daily puzzles and the fastest-time boards (/api/sudoku).
//
// The server decides every time. Opening a puzzle starts a "run" here, with
// the moment it started written down on the server. The browser gets a long
// random run id and the puzzle, never the answer. When the board is full the
// browser sends the grid; the server checks it against the answer it kept and
// works out the time itself (minus any pauses, plus any help penalties). No
// time from the browser is ever read.
//
// A profile's progress (the numbers and pencil marks filled in so far) is
// kept with its run too, so it follows them to another device. It's only
// ever handed back to the page; the finish still checks the whole grid the
// browser sends against the answer, so saved progress can't change a time.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const gen = require('./generator');

// Help costs time, decided here and explained in How to play.
const PENALTY = { hint: 30000, check: 15000, mistake: 10000 };
// Nobody honestly fills a square faster than this, so a finish quicker than
// this much per square the player had to fill is turned away.
// (The test suite shortens it, so it doesn't have to wait half a minute.)
const MIN_MS_PER_SQUARE = process.env.NODE_ENV === 'test' && process.env.SUDOKU_MIN_MS_PER_SQUARE
  ? Number(process.env.SUDOKU_MIN_MS_PER_SQUARE) : 400;
// Unfinished runs are forgotten after this long.
const KEEP_RUNS_MS = 3 * 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS sudoku_runs (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    level TEXT NOT NULL,
    profile_id TEXT,
    started_at INTEGER NOT NULL,
    paused_at INTEGER,
    paused_ms INTEGER NOT NULL DEFAULT 0,
    penalty_ms INTEGER NOT NULL DEFAULT 0,
    hints INTEGER NOT NULL DEFAULT 0,
    checks INTEGER NOT NULL DEFAULT 0,
    mistakes INTEGER NOT NULL DEFAULT 0,
    finished_at INTEGER,
    time_ms INTEGER,
    saved INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sudoku_runs_profile ON sudoku_runs (day, level, profile_id);
  CREATE TABLE IF NOT EXISTS sudoku_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    level TEXT NOT NULL,
    who TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    time_ms INTEGER NOT NULL,
    hints INTEGER NOT NULL DEFAULT 0,
    checks INTEGER NOT NULL DEFAULT 0,
    mistakes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (day, level, who)
  );
  CREATE INDEX IF NOT EXISTS sudoku_scores_day ON sudoku_scores (level, day, time_ms);
  CREATE INDEX IF NOT EXISTS sudoku_scores_all ON sudoku_scores (level, time_ms);
`);
// Where a profile got to: { grid, notes, marks } as JSON, and when it was saved.
for (const col of ['progress TEXT', 'progress_at INTEGER']) {
  try { db.db.exec(`ALTER TABLE sudoku_runs ADD COLUMN ${col}`); } catch { /* already there */ }
}

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const profiles = () => require('../arcade/profiles');

// ---- puzzles, made once a day and kept in memory -----------------------------------
const cache = new Map();
function puzzleFor(day, level) {
  const key = `${day}|${level}`;
  if (!cache.has(key)) {
    // Keep the last few days only; anything older is remade the same way if needed.
    if (cache.size > 16) for (const k of [...cache.keys()].slice(0, cache.size - 12)) cache.delete(k);
    cache.set(key, gen.generate(day, level));
  }
  return cache.get(key);
}
const levelOf = level => {
  if (!gen.LEVELS[level]) throw fail('Pick a level: Family, Easy, Medium or Hard.');
  return level;
};

// ---- runs ------------------------------------------------------------------------------
const getRun = id => db.db.prepare('SELECT * FROM sudoku_runs WHERE id = ?').get(String(id || ''));
function needRun(id) {
  const run = getRun(id);
  if (!run) throw fail('That puzzle has expired. Start it again from the level buttons.', 404);
  return run;
}

// Time spent actually playing: from the start until now (or until it was
// paused, or finished), leaving out every pause.
function playMs(run, now = Date.now()) {
  const end = run.finished_at || run.paused_at || now;
  return Math.max(0, end - run.started_at - run.paused_ms);
}

// withProgress: also hand back the saved progress (opening, reopening or
// carrying on after a pause, the moments another device may have moved on).
function view(run, now = Date.now(), { withProgress = false } = {}) {
  const p = puzzleFor(run.day, run.level);
  return {
    ...(withProgress ? { progress: readProgress(run) } : {}),
    // Whether this run's progress is kept on the server (profiles only).
    syncs: !!run.profile_id,
    runId: run.id, day: run.day, level: run.level, label: gen.LEVELS[run.level].label,
    puzzle: p.puzzle, clues: p.clues,
    playMs: playMs(run, now), penaltyMs: run.penalty_ms,
    paused: !!run.paused_at, hints: run.hints, checks: run.checks, mistakes: run.mistakes,
    finished: !!run.finished_at, timeMs: run.time_ms, saved: !!run.saved,
    resetsAt: nextMidnight().toISOString()
  };
}

function nextMidnight(now = new Date()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

function start({ level, profileToken }, now = Date.now()) {
  levelOf(level);
  db.db.prepare('DELETE FROM sudoku_runs WHERE started_at < ? AND saved = 0').run(now - KEEP_RUNS_MS);
  const day = today(new Date(now));
  const profile = profileToken ? profiles().verify(profileToken) : null;
  // A profile has one clock per puzzle: opening it again (on any device)
  // carries on with the run it already has, so starting over doesn't reset the time.
  if (profile) {
    const had = db.db.prepare('SELECT * FROM sudoku_runs WHERE day = ? AND level = ? AND profile_id = ? ORDER BY started_at LIMIT 1')
      .get(day, level, profile.id);
    if (had) return view(had, now, { withProgress: true });
  }
  puzzleFor(day, level);
  const id = crypto.randomBytes(16).toString('hex');
  db.db.prepare('INSERT INTO sudoku_runs (id, day, level, profile_id, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, day, level, profile ? profile.id : null, now);
  return view(getRun(id), now, { withProgress: true });
}

function playing(run) {
  if (run.finished_at) throw fail('This puzzle is already solved.', 409);
  if (run.paused_at) throw fail('The puzzle is paused. Tap Keep going first.', 409);
}

function pause(id, on, now = Date.now()) {
  const run = needRun(id);
  if (run.finished_at) return view(run, now);
  if (on && !run.paused_at) db.db.prepare('UPDATE sudoku_runs SET paused_at = ? WHERE id = ?').run(now, run.id);
  if (!on && run.paused_at) {
    db.db.prepare('UPDATE sudoku_runs SET paused_ms = paused_ms + ?, paused_at = NULL WHERE id = ?').run(now - run.paused_at, run.id);
  }
  return view(getRun(run.id), now, { withProgress: !on });
}

// ---- progress that follows a profile -----------------------------------------------
function readProgress(run) {
  if (!run.progress) return null;
  try { return { ...JSON.parse(run.progress), savedAt: run.progress_at }; } catch { return null; }
}
const MARKS = new Set(['wrong', 'hinted']);
// Saved for the profile playing this run only; guests keep theirs on their device.
function saveProgress(id, { grid, notes, marks, profileToken }, now = Date.now()) {
  const run = needRun(id);
  if (!run.profile_id) throw fail('Only profiles have their progress kept on the arcade. Yours is kept on this device.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  if (!profile || profile.id !== run.profile_id) throw fail('This puzzle belongs to a different profile.', 403);
  if (run.finished_at) return { saved: false };
  const g = readGrid(grid).join('');
  const n = Array.isArray(notes) ? notes : [];
  if (n.length && (n.length !== 81 || n.some(v => !Number.isInteger(v) || v < 0 || v > 1022))) throw fail('Those pencil marks do not look right.');
  const m = {};
  for (const [k, v] of Object.entries(marks && typeof marks === 'object' ? marks : {})) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i <= 80 && MARKS.has(v)) m[i] = v;
  }
  const notesOut = n.length ? n : new Array(81).fill(0);
  db.db.prepare('UPDATE sudoku_runs SET progress = ?, progress_at = ? WHERE id = ?')
    .run(JSON.stringify({ grid: g, notes: notesOut, marks: m }), now, run.id);
  return { saved: true, savedAt: now };
}

// The grid the browser sends: 81 characters, 1-9 for a number and 0 (or a
// dot) for an empty square.
function readGrid(text, { full = false } = {}) {
  const s = String(text || '').replace(/\./g, '0');
  if (!/^[0-9]{81}$/.test(s)) throw fail('That board does not look right.');
  const g = s.split('').map(Number);
  if (full && g.includes(0)) throw fail('Fill every square first.');
  return g;
}
function givensKept(puzzle, grid) {
  for (let i = 0; i < 81; i++) if (puzzle[i] !== '0' && grid[i] !== Number(puzzle[i])) return false;
  return true;
}

// "Check my board": which of the numbers you've placed are wrong.
function check(id, grid, now = Date.now()) {
  const run = needRun(id);
  playing(run);
  const p = puzzleFor(run.day, run.level);
  const g = readGrid(grid);
  const wrong = [];
  for (let i = 0; i < 81; i++) if (p.puzzle[i] === '0' && g[i] && g[i] !== Number(p.solution[i])) wrong.push(i);
  db.db.prepare('UPDATE sudoku_runs SET checks = checks + 1, penalty_ms = penalty_ms + ? WHERE id = ?').run(PENALTY.check, run.id);
  return { wrong, ...view(getRun(run.id), now) };
}

// "Show mistakes as I go": is this one number right? Only a wrong one costs time.
function cell(id, index, value, now = Date.now()) {
  const run = needRun(id);
  playing(run);
  const i = Number(index), v = Number(value);
  if (!Number.isInteger(i) || i < 0 || i > 80 || !Number.isInteger(v) || v < 1 || v > 9) throw fail('That square does not look right.');
  const p = puzzleFor(run.day, run.level);
  if (p.puzzle[i] !== '0') return { right: true, ...view(run, now) };
  const right = Number(p.solution[i]) === v;
  if (!right) db.db.prepare('UPDATE sudoku_runs SET mistakes = mistakes + 1, penalty_ms = penalty_ms + ? WHERE id = ?').run(PENALTY.mistake, run.id);
  return { right, ...view(getRun(run.id), now) };
}

// A hint: the right number for one square. A wrong number on the board is
// put right first; otherwise it's the empty square with the fewest options,
// the one a person would most likely work out next.
function hint(id, grid, now = Date.now()) {
  const run = needRun(id);
  playing(run);
  const p = puzzleFor(run.day, run.level);
  const g = readGrid(grid);
  for (let i = 0; i < 81; i++) if (p.puzzle[i] !== '0') g[i] = Number(p.puzzle[i]);
  let index = g.findIndex((v, i) => v && v !== Number(p.solution[i]));
  const fixing = index >= 0;
  if (!fixing) index = gen.easiestEmpty(g);
  if (index < 0) throw fail('Every square is filled in already.');
  db.db.prepare('UPDATE sudoku_runs SET hints = hints + 1, penalty_ms = penalty_ms + ? WHERE id = ?').run(PENALTY.hint, run.id);
  return { index, value: Number(p.solution[index]), fixing, ...view(getRun(run.id), now) };
}

function finish(id, grid, now = Date.now()) {
  const run = needRun(id);
  if (run.finished_at) return view(run, now);
  if (run.paused_at) throw fail('The puzzle is paused. Tap Keep going first.', 409);
  const p = puzzleFor(run.day, run.level);
  const g = readGrid(grid, { full: true });
  if (!givensKept(p.puzzle, g)) throw fail('The numbers the puzzle started with were changed.');
  if (g.join('') !== p.solution) throw fail('Not quite: something on the board isn\'t right yet. Keep looking!', 400, { solved: false });
  const played = playMs(run, now);
  const toFill = 81 - p.clues - run.hints;
  if (played < toFill * MIN_MS_PER_SQUARE) throw fail('That was faster than anyone can fill in a puzzle, so it can\'t go on the board.', 400);
  const timeMs = played + run.penalty_ms;
  db.db.prepare('UPDATE sudoku_runs SET finished_at = ?, time_ms = ? WHERE id = ?').run(now, timeMs, run.id);
  return view(getRun(run.id), now);
}

// ---- the boards --------------------------------------------------------------------
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');

function save(id, { initials, profileToken }) {
  const run = needRun(id);
  if (!run.finished_at) throw fail('Finish the puzzle first.', 409);
  if (run.saved) throw fail('This time is already on the board.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const who = profile ? `p:${profile.id}` : `g:${ini}`;
  const label = gen.LEVELS[run.level].label;
  // The puzzle is the same all day, so only the first finish counts: a second
  // go, already knowing the answer, would always be faster.
  if (db.db.prepare('SELECT 1 FROM sudoku_scores WHERE day = ? AND level = ? AND who = ?').get(run.day, run.level, who)) {
    throw fail(`You already have a time on the ${label} board for this day. Only your first finish of the day counts, because the puzzle stays the same all day.`, 409);
  }
  const info = db.db.prepare(`INSERT INTO sudoku_scores (day, level, who, initials, profile_id, profile_name, profile_avatar, time_ms, hints, checks, mistakes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.day, run.level, who, ini, profile ? profile.id : null,
    profile ? profile.name : null, profile ? profile.avatar : null, run.time_ms, run.hints, run.checks, run.mistakes);
  db.db.prepare('UPDATE sudoku_runs SET saved = 1 WHERE id = ?').run(run.id);
  const scoreId = Number(info.lastInsertRowid);
  const dayRank = db.db.prepare('SELECT COUNT(*) AS c FROM sudoku_scores WHERE level = ? AND day = ? AND (time_ms < ? OR (time_ms = ? AND id < ?))')
    .get(run.level, run.day, run.time_ms, run.time_ms, scoreId).c + 1;
  const allRank = db.db.prepare('SELECT COUNT(*) AS c FROM sudoku_scores WHERE level = ? AND (time_ms < ? OR (time_ms = ? AND id < ?))')
    .get(run.level, run.time_ms, run.time_ms, scoreId).c + 1;
  if (allRank === 1) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    comm.safePost({
      kind: 'highscore', emoji: '🧩', game: 'sudoku',
      title: `${shout} set the fastest Sudoku ${label} time ever`,
      body: `${shout} solved a ${label} Sudoku in ${clock(run.time_ms)}, the quickest anyone has done it. Today's puzzle is waiting if you want a go.`
    });
  }
  return { id: scoreId, dayRank, allRank, timeMs: run.time_ms };
}

function clock(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// scope 'day' is one day's board (today unless a day is given); 'all' is the
// fastest times ever on that level.
function board({ level, scope = 'day', day, limit = 20 }) {
  levelOf(level);
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM sudoku_scores WHERE level = ? ORDER BY time_ms ASC, id ASC LIMIT ?').all(level, cap)
    : db.db.prepare('SELECT * FROM sudoku_scores WHERE level = ? AND day = ? ORDER BY time_ms ASC, id ASC LIMIT ?')
      .all(level, DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    // A profile's current choice (name or initials) wins over what was saved.
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, level: r.level, initials: r.initials, timeMs: r.time_ms,
      hints: r.hints, checks: r.checks, mistakes: r.mistakes,
      profileName: now ? now.label : r.profile_name || null, profileAvatar: now ? now.avatar : r.profile_avatar || null
    };
  });
}

// ---- routes ------------------------------------------------------------------------
const router = express.Router();
const limiter = (limit, windowMin = 10) => rateLimit({
  windowMs: windowMin * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.' }
});
const startLimit = limiter(120), playLimit = limiter(1500), saveLimit = limiter(30);
const body = req => req.body || {};
const wrap = fn => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

router.get('/levels', wrap(() => ({
  day: today(), resetsAt: nextMidnight().toISOString(), penalties: PENALTY,
  levels: gen.LEVEL_IDS.map(id => ({ id, label: gen.LEVELS[id].label }))
})));
router.post('/start', startLimit, wrap(req => start(body(req))));
router.get('/run/:id', wrap(req => view(needRun(req.params.id), Date.now(), { withProgress: true })));
router.post('/run/:id/progress', playLimit, wrap(req => saveProgress(req.params.id, body(req))));
router.post('/run/:id/pause', playLimit, wrap(req => pause(req.params.id, true)));
router.post('/run/:id/resume', playLimit, wrap(req => pause(req.params.id, false)));
router.post('/run/:id/check', playLimit, wrap(req => check(req.params.id, body(req).grid)));
router.post('/run/:id/cell', playLimit, wrap(req => cell(req.params.id, body(req).index, body(req).value)));
router.post('/run/:id/hint', playLimit, wrap(req => hint(req.params.id, body(req).grid)));
router.post('/run/:id/finish', playLimit, wrap(req => finish(req.params.id, body(req).grid)));
router.post('/run/:id/save', saveLimit, (req, res, next) => {
  try { res.status(201).json(save(req.params.id, body(req))); } catch (e) { next(e); }
});
router.get('/board', wrap(req => board({ level: req.query.level, scope: req.query.scope, day: req.query.day, limit: req.query.limit })));

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message, ...(err.solved === false ? { solved: false } : {}) });
});

// Today's puzzles a profile has started and not solved, for the home page's
// Continue row (arcade/continue.js).
function inProgress(profileId, now = Date.now()) {
  return db.db.prepare('SELECT * FROM sudoku_runs WHERE profile_id = ? AND day = ? AND finished_at IS NULL ORDER BY started_at')
    .all(String(profileId), today(new Date(now)))
    .map(run => ({ level: run.level, label: gen.LEVELS[run.level].label, playMs: playMs(run, now), updatedAt: run.progress_at || run.paused_at || run.started_at }));
}

module.exports = { router, start, pause, saveProgress, check, cell, hint, finish, save, board, puzzleFor, inProgress, PENALTY, MIN_MS_PER_SQUARE };
