'use strict';

// Clueless Crosswords: the daily crosswords and their fastest-time boards
// (/api/clueless), free play, plus the admin side of clue packs.
//
// Free play is a crossword picked at random instead of from the date. It
// works like the daily one (the server keeps the letters and the clock), but
// it never goes on a board, because everyone gets a different one. "New
// board" on the page just starts another free run.
//
// The server decides every time. Opening a puzzle starts a "run" here, with
// the moment it started written down on the server. The page gets a long
// random run id, the shape and the clues, never the letters. Check and
// Reveal ask the server, which writes down what was asked and adds the time
// it costs. When the grid is full the page sends it; the server checks it
// against the answer it kept and works out the time itself.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const maker = require('./maker');
const puzzles = require('./puzzles');
const clueRules = require('./clues');

// Help costs time, decided here and explained in How to play.
const PENALTY = { checkSquare: 5000, checkWord: 10000, checkPuzzle: 20000, reveal: 15000 };
// Nobody honestly types a square faster than this, so a finish quicker than
// this much per square they had to fill (not counting revealed ones) is
// turned away. The test suite shortens it.
const MIN_MS_PER_SQUARE = process.env.NODE_ENV === 'test' && process.env.CLUELESS_MIN_MS_PER_SQUARE
  ? Number(process.env.CLUELESS_MIN_MS_PER_SQUARE) : 300;
const KEEP_RUNS_MS = 3 * 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS clueless_runs (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    level TEXT NOT NULL,
    profile_id TEXT,
    started_at INTEGER NOT NULL,
    paused_at INTEGER,
    paused_ms INTEGER NOT NULL DEFAULT 0,
    penalty_ms INTEGER NOT NULL DEFAULT 0,
    checks INTEGER NOT NULL DEFAULT 0,
    revealed TEXT NOT NULL DEFAULT '[]',
    finished_at INTEGER,
    time_ms INTEGER,
    saved INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS clueless_runs_profile ON clueless_runs (day, level, profile_id);
  CREATE TABLE IF NOT EXISTS clueless_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    level TEXT NOT NULL,
    who TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    time_ms INTEGER NOT NULL,
    checks INTEGER NOT NULL DEFAULT 0,
    reveals INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (day, level, who)
  );
  CREATE INDEX IF NOT EXISTS clueless_scores_day ON clueless_scores (level, day, time_ms);
  CREATE INDEX IF NOT EXISTS clueless_scores_all ON clueless_scores (level, time_ms);
`);
// Added with free play (2026-11-02): which puzzle a free run is on. Empty for
// the daily crosswords, which are found by their day.
{
  const cols = db.db.prepare('PRAGMA table_info(clueless_runs)').all().map(c => c.name);
  if (!cols.includes('puzzle_key')) db.db.exec('ALTER TABLE clueless_runs ADD COLUMN puzzle_key TEXT');
  // Where a profile got to on a daily crossword ({ letters, pencil } as JSON) and
  // when it was saved, so it follows them to another device (2026-11-13).
  if (!cols.includes('progress')) db.db.exec('ALTER TABLE clueless_runs ADD COLUMN progress TEXT');
  if (!cols.includes('progress_at')) db.db.exec('ALTER TABLE clueless_runs ADD COLUMN progress_at INTEGER');
}

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const profiles = () => require('../arcade/profiles');
const levelOf = level => {
  if (!maker.LEVELS[level]) throw fail('Pick a puzzle: the family mini or the adults\' one.');
  return level;
};

// ---- runs ------------------------------------------------------------------------------
const getRun = id => db.db.prepare('SELECT * FROM clueless_runs WHERE id = ?').get(String(id || ''));
function needRun(id) {
  const run = getRun(id);
  if (!run) throw fail('That puzzle has expired. Start it again from the buttons at the top.', 404);
  return run;
}
const revealedOf = run => JSON.parse(run.revealed || '[]');

function playMs(run, now = Date.now()) {
  const end = run.finished_at || run.paused_at || now;
  return Math.max(0, end - run.started_at - run.paused_ms);
}

function nextMidnight(now = new Date()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

const puzzleOf = run => puzzles.puzzleFor(run.puzzle_key || run.day, run.level);

// Whether a run's letters are kept on the arcade: a profile's daily crossword
// (guests and free boards keep theirs on the device).
const syncs = run => !!run.profile_id && !run.puzzle_key;
function readProgress(run) {
  if (!run.progress) return null;
  try { return { ...JSON.parse(run.progress), savedAt: run.progress_at }; } catch { return null; }
}

function view(run, now = Date.now()) {
  const p = puzzleOf(run);
  const revealed = revealedOf(run);
  return {
    syncs: syncs(run),
    progress: syncs(run) ? readProgress(run) : null,
    runId: run.id, day: run.day, level: run.level, label: maker.LEVELS[run.level].label, free: !!run.puzzle_key,
    puzzle: maker.publicView(p),
    // Squares that were revealed come back with their letters, so a reload
    // shows them again. Only these, never the rest.
    revealed: Object.fromEntries(revealed.map(i => [i, p.letters[i]])),
    playMs: playMs(run, now), penaltyMs: run.penalty_ms, paused: !!run.paused_at,
    checks: run.checks, reveals: revealed.length,
    finished: !!run.finished_at, timeMs: run.time_ms, saved: !!run.saved,
    resetsAt: nextMidnight().toISOString()
  };
}

function start({ level, profileToken, free }, now = Date.now()) {
  levelOf(level);
  db.db.prepare('DELETE FROM clueless_runs WHERE started_at < ? AND saved = 0').run(now - KEEP_RUNS_MS);
  const day = today(new Date(now));
  if (free) {
    // A random seed instead of the date. The puzzle is saved like a daily
    // one, so a reload (or a server restart) finds the same grid.
    const key = `free-${crypto.randomBytes(8).toString('hex')}`;
    puzzles.puzzleFor(key, level);
    const id = crypto.randomBytes(16).toString('hex');
    db.db.prepare('INSERT INTO clueless_runs (id, day, level, profile_id, started_at, puzzle_key) VALUES (?, ?, ?, NULL, ?, ?)')
      .run(id, day, level, now, key);
    puzzles.sweep(day);
    return view(getRun(id), now);
  }
  const profile = profileToken ? profiles().verify(profileToken) : null;
  // A profile has one clock per puzzle: opening it again (on any device)
  // carries on with the run it already has.
  if (profile) {
    const had = db.db.prepare('SELECT * FROM clueless_runs WHERE day = ? AND level = ? AND profile_id = ? AND puzzle_key IS NULL ORDER BY started_at LIMIT 1')
      .get(day, level, profile.id);
    if (had) return view(had, now);
  }
  puzzles.puzzleFor(day, level);
  puzzles.sweep(day);
  const id = crypto.randomBytes(16).toString('hex');
  db.db.prepare('INSERT INTO clueless_runs (id, day, level, profile_id, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, day, level, profile ? profile.id : null, now);
  return view(getRun(id), now);
}

function playing(run) {
  if (run.finished_at) throw fail('This puzzle is already solved.', 409);
  if (run.paused_at) throw fail('The puzzle is paused. Tap Keep going first.', 409);
}

function pause(id, on, now = Date.now()) {
  const run = needRun(id);
  if (run.finished_at) return view(run, now);
  if (on && !run.paused_at) db.db.prepare('UPDATE clueless_runs SET paused_at = ? WHERE id = ?').run(now, run.id);
  if (!on && run.paused_at) {
    db.db.prepare('UPDATE clueless_runs SET paused_ms = paused_ms + ?, paused_at = NULL WHERE id = ?').run(now - run.paused_at, run.id);
  }
  return view(getRun(run.id), now);
}

// The letters a profile has typed so far (and which are in pencil), saved for that
// profile only. Never used for the finish or the clock: the finish checks the grid
// it's sent.
function saveProgress(id, { letters, pencil, profileToken }, now = Date.now()) {
  const run = needRun(id);
  if (!syncs(run)) throw fail('Only profiles have their daily crossword kept on the arcade. Yours is kept on this device.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  if (!profile || profile.id !== run.profile_id) throw fail('This crossword belongs to a different profile.', 403);
  if (run.finished_at) return { saved: false };
  const p = puzzleOf(run);
  const n = p.size * p.size;
  if (!Array.isArray(letters) || letters.length !== n) throw fail('Those letters don\'t fit this crossword.');
  const out = letters.map((l, i) => (/^[A-Z]$/.test(p.letters[i] || '') && /^[A-Z]$/.test(String(l || '')) ? String(l) : ''));
  const pen = Array.from({ length: n }, (_, i) => !!(Array.isArray(pencil) && pencil[i]) && !!out[i]);
  db.db.prepare('UPDATE clueless_runs SET progress = ?, progress_at = ? WHERE id = ?')
    .run(JSON.stringify({ letters: out, pencil: pen }), now, run.id);
  return { saved: true, savedAt: now };
}

// The grid the page sends: one character per square, row by row. A letter
// is a letter; anything else is an empty (or black) square.
function readGrid(p, text) {
  const s = String(text || '').toUpperCase();
  if (s.length !== p.size * p.size) throw fail('That grid does not look right.');
  return s.split('').map((ch, i) => (p.letters[i] === '#' || !/[A-Z]/.test(ch) ? '' : ch));
}

// Which squares a check or reveal is about: one square, one across or down
// word, or (checks only) the whole puzzle.
function target(p, { scope, index, dir }) {
  const i = Number(index);
  const white = n => Number.isInteger(n) && n >= 0 && n < p.letters.length && p.letters[n] !== '#';
  if (scope === 'puzzle') return [...p.letters].map((ch, n) => n).filter(white);
  if (!white(i)) throw fail('Pick a white square first.');
  if (scope === 'square') return [i];
  if (scope === 'word') {
    const e = p.entries.find(en => en.dir === (dir === 'down' ? 'down' : 'across') && en.cells.includes(i));
    if (!e) throw fail('That square isn\'t part of a word going that way.');
    return e.cells;
  }
  throw fail('Check a square, a word or the whole puzzle.');
}

function check(id, body, now = Date.now()) {
  const run = needRun(id);
  playing(run);
  const p = puzzleOf(run);
  const scope = body.scope;
  const cells = target(p, body);
  const g = readGrid(p, body.grid);
  const wrong = cells.filter(i => g[i] && g[i] !== p.letters[i]);
  const cost = scope === 'puzzle' ? PENALTY.checkPuzzle : scope === 'word' ? PENALTY.checkWord : PENALTY.checkSquare;
  db.db.prepare('UPDATE clueless_runs SET checks = checks + 1, penalty_ms = penalty_ms + ? WHERE id = ?').run(cost, run.id);
  return { wrong, checked: cells, cost, ...view(getRun(run.id), now) };
}

// Reveal hands over letters, so every square revealed is written down on the
// run and costs time. Revealing the same square twice only costs once.
function reveal(id, body, now = Date.now()) {
  const run = needRun(id);
  playing(run);
  if (body.scope === 'puzzle') throw fail('You can reveal a square or a word, but not the whole puzzle.');
  const p = puzzleOf(run);
  const cells = target(p, body);
  const had = new Set(revealedOf(run));
  const fresh = cells.filter(i => !had.has(i));
  for (const i of fresh) had.add(i);
  db.db.prepare('UPDATE clueless_runs SET revealed = ?, penalty_ms = penalty_ms + ? WHERE id = ?')
    .run(JSON.stringify([...had]), fresh.length * PENALTY.reveal, run.id);
  return { letters: Object.fromEntries(cells.map(i => [i, p.letters[i]])), cost: fresh.length * PENALTY.reveal, ...view(getRun(run.id), now) };
}

// Which clues to cross off in the lists. The rule depends on the level, and
// How to play explains both:
//  - the family mini crosses a clue off as soon as its word is right;
//  - the adults' crossword waits until the whole line is right: an across
//    clue once every square in its row is right, a down clue once every
//    square in its column is. So a crossed-off clue there gives away less.
// Only filled squares can be right, and nothing is said about which letters
// are wrong.
const LINE_RULE = { mini: 'word', big: 'line' };
function solvedClues(run, g) {
  const p = puzzleOf(run);
  const right = i => !!g[i] && g[i] === p.letters[i];
  const rule = LINE_RULE[run.level] || 'word';
  const line = e => {
    const out = [];
    for (let k = 0; k < p.size; k++) {
      const i = e.dir === 'across' ? e.row * p.size + k : k * p.size + e.col;
      if (p.letters[i] !== '#') out.push(i);
    }
    return out;
  };
  const done = { across: [], down: [] };
  for (const e of p.entries) {
    if ((rule === 'line' ? line(e) : e.cells).every(right)) done[e.dir].push(e.num);
  }
  return { rule, ...done };
}
function solved(id, grid) {
  const run = needRun(id);
  const p = puzzleOf(run);
  if (run.finished_at) return solvedClues(run, [...p.letters]);
  if (run.paused_at) throw fail('The puzzle is paused. Tap Keep going first.', 409);
  const g = readGrid(p, grid);
  for (const i of revealedOf(run)) g[i] = p.letters[i];
  return solvedClues(run, g);
}

function finish(id, grid, now = Date.now()) {
  const run = needRun(id);
  if (run.finished_at) return view(run, now);
  if (run.paused_at) throw fail('The puzzle is paused. Tap Keep going first.', 409);
  const p = puzzleOf(run);
  const g = readGrid(p, grid);
  const whites = [...p.letters].map((ch, i) => i).filter(i => p.letters[i] !== '#');
  if (whites.some(i => !g[i])) throw fail('Fill every square first.');
  if (whites.some(i => g[i] !== p.letters[i])) throw fail('Not quite: something in the grid isn\'t right yet. Keep looking!', 400, { solved: false });
  const played = playMs(run, now);
  const toFill = whites.length - revealedOf(run).length;
  if (played < toFill * MIN_MS_PER_SQUARE) throw fail('That was faster than anyone can fill in a crossword, so it can\'t go on the board.', 400);
  const timeMs = played + run.penalty_ms;
  db.db.prepare('UPDATE clueless_runs SET finished_at = ?, time_ms = ? WHERE id = ?').run(now, timeMs, run.id);
  return { answers: p.letters, ...view(getRun(run.id), now) };
}

// ---- the boards --------------------------------------------------------------------
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');
function clock(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function save(id, { initials, profileToken }) {
  const run = needRun(id);
  if (!run.finished_at) throw fail('Finish the puzzle first.', 409);
  if (run.puzzle_key) throw fail('Free play crosswords don\'t go on the board, because everyone gets a different one. Today\'s puzzle is the one to race on.', 409);
  if (run.saved) throw fail('This time is already on the board.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const who = profile ? `p:${profile.id}` : `g:${ini}`;
  const label = maker.LEVELS[run.level].label;
  // The puzzle is the same all day, so only the first finish counts.
  if (db.db.prepare('SELECT 1 FROM clueless_scores WHERE day = ? AND level = ? AND who = ?').get(run.day, run.level, who)) {
    throw fail(`You already have a time on the ${label} board for this day. Only your first finish of the day counts, because the puzzle stays the same all day.`, 409);
  }
  const reveals = revealedOf(run).length;
  const info = db.db.prepare(`INSERT INTO clueless_scores (day, level, who, initials, profile_id, profile_name, profile_avatar, time_ms, checks, reveals)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.day, run.level, who, ini, profile ? profile.id : null,
    profile ? profile.name : null, profile ? profile.avatar : null, run.time_ms, run.checks, reveals);
  db.db.prepare('UPDATE clueless_runs SET saved = 1 WHERE id = ?').run(run.id);
  const scoreId = Number(info.lastInsertRowid);
  const dayRank = db.db.prepare('SELECT COUNT(*) AS c FROM clueless_scores WHERE level = ? AND day = ? AND (time_ms < ? OR (time_ms = ? AND id < ?))')
    .get(run.level, run.day, run.time_ms, run.time_ms, scoreId).c + 1;
  const allRank = db.db.prepare('SELECT COUNT(*) AS c FROM clueless_scores WHERE level = ? AND (time_ms < ? OR (time_ms = ? AND id < ?))')
    .get(run.level, run.time_ms, run.time_ms, scoreId).c + 1;
  if (allRank === 1) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    comm.safePost({
      trophy: { game: 'Clueless Crosswords', profileId: profile ? profile.id : null, name: shout, score: clock(run.time_ms), board: label, url: '/clueless.html' },
      kind: 'highscore', emoji: '📰', game: 'clueless',
      title: `${shout} set the fastest Clueless Crosswords ${label} time ever`,
      body: `${shout} solved the ${label} crossword in ${clock(run.time_ms)}, the quickest anyone has done it. Today's puzzle is waiting if you want a go.`
    });
  }
  return { id: scoreId, dayRank, allRank, timeMs: run.time_ms };
}

function board({ level, scope = 'day', day, limit = 20 }) {
  levelOf(level);
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM clueless_scores WHERE level = ? ORDER BY time_ms ASC, id ASC LIMIT ?').all(level, cap)
    : db.db.prepare('SELECT * FROM clueless_scores WHERE level = ? AND day = ? ORDER BY time_ms ASC, id ASC LIMIT ?')
      .all(level, DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, level: r.level, initials: r.initials, timeMs: r.time_ms, checks: r.checks, reveals: r.reveals,
      profileName: now ? now.label : r.profile_name || null, profileAvatar: now ? now.avatar : r.profile_avatar || null
    };
  });
}

// ---- routes ------------------------------------------------------------------------
module.exports = function cluelessRoutes({ requireAdmin }) {
  const router = express.Router();
  const limiter = (limit, windowMin = 10) => rateLimit({
    windowMs: windowMin * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
    message: { error: 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.' }
  });
  const startLimit = limiter(120), playLimit = limiter(1500), saveLimit = limiter(30);
  // Each free board is made on the spot (up to about half a second), so
  // pressing New board over and over has its own, smaller allowance.
  const freeLimit = limiter(80);
  const body = req => req.body || {};
  const wrap = fn => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

  router.get('/levels', wrap(() => ({
    day: today(), resetsAt: nextMidnight().toISOString(), penalties: PENALTY,
    levels: maker.LEVEL_IDS.map(id => ({ id, label: maker.LEVELS[id].label, size: maker.LEVELS[id].size }))
  })));
  router.post('/start', startLimit, (req, res, next) => (body(req).free ? freeLimit(req, res, next) : next()), wrap(req => start(body(req))));
  router.post('/run/:id/solved', playLimit, wrap(req => solved(req.params.id, body(req).grid)));
  router.get('/run/:id', wrap(req => view(needRun(req.params.id))));
  router.post('/run/:id/progress', playLimit, wrap(req => saveProgress(req.params.id, body(req))));
  router.post('/run/:id/pause', playLimit, wrap(req => pause(req.params.id, true)));
  router.post('/run/:id/resume', playLimit, wrap(req => pause(req.params.id, false)));
  router.post('/run/:id/check', playLimit, wrap(req => check(req.params.id, body(req))));
  router.post('/run/:id/reveal', playLimit, wrap(req => reveal(req.params.id, body(req))));
  router.post('/run/:id/finish', playLimit, wrap(req => finish(req.params.id, body(req).grid)));
  router.post('/run/:id/save', saveLimit, (req, res, next) => {
    try { res.status(201).json(save(req.params.id, body(req))); } catch (e) { next(e); }
  });
  router.get('/board', wrap(req => board({ level: req.query.level, scope: req.query.scope, day: req.query.day, limit: req.query.limit })));

  // The browser tests need the letters to solve a puzzle through the page.
  // This only exists when the server runs under the test suite.
  if (process.env.NODE_ENV === 'test') {
    router.get('/test/answer/:id', wrap(req => {
      const run = needRun(req.params.id);
      return { letters: puzzleOf(run).letters };
    }));
  }

  // ---- admin: clue packs ----------------------------------------------------------
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.get('/summary', wrap(() => ({ ...puzzles.summary(), maxClue: clueRules.MAX_CLUE, minWord: clueRules.MIN_WORD, maxWord: clueRules.MAX_WORD })));
  admin.get('/batch', wrap(req => {
    const kind = clueRules.KINDS[req.query.kind] ? req.query.kind : 'kids';
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 40, 10), 80);
    return { kind, words: puzzles.batch(kind, count) };
  }));
  admin.get('/packs', wrap(() => puzzles.listPacks()));
  admin.get('/packs/:id', wrap(req => puzzles.packClues(req.params.id)));
  admin.post('/packs', (req, res, next) => {
    try { res.status(201).json(puzzles.addPack(body(req))); } catch (e) { next(e); }
  });
  admin.delete('/packs/:id', wrap(req => { puzzles.deletePack(req.params.id); return { deleted: true }; }));
  router.use('/admin', admin);

  router.use((err, req, res, next) => {
    if (!err.status) return next(err);
    res.status(err.status).json({ error: err.message, ...(err.solved === false ? { solved: false } : {}), ...(err.skipped ? { skipped: err.skipped } : {}) });
  });
  return router;
};

// Today's daily crosswords a profile has started and not solved, for the home
// page's Continue row (arcade/continue.js). Free boards belong to no profile.
function inProgress(profileId, now = Date.now()) {
  return db.db.prepare('SELECT * FROM clueless_runs WHERE profile_id = ? AND day = ? AND puzzle_key IS NULL AND finished_at IS NULL ORDER BY started_at')
    .all(String(profileId), today(new Date(now)))
    .map(run => ({ level: run.level, label: maker.LEVELS[run.level].label, playMs: playMs(run, now), updatedAt: run.progress_at || run.paused_at || run.started_at }));
}

Object.assign(module.exports, { start, pause, check, reveal, finish, solved, save, saveProgress, board, inProgress, PENALTY, MIN_MS_PER_SQUARE, LINE_RULE });
