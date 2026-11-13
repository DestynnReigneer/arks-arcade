'use strict';

// Tumbler Rumble: runs and the high-score boards (/api/tumbler).
//
// The server decides every score. Starting a run here writes down when it
// started (on the server's clock) and hands the page a random seed, which
// decides where every pin goes. A run goes on until the first miss, and its
// score is how many pins were popped. When the run is over the page sends
// only the list of its tap times; the server replays the same simulation the
// page ran (public/tumbler-engine.js) with those taps and works the score out
// itself.
// Taps closer together than anyone can tap, or going on longer than the run
// has really lasted, are refused. No score from the page is ever read.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const engine = require('../public/tumbler-engine');

// The page's clock starts a moment after the server's, so its tap times are
// always a little behind the server's. This much slack covers a phone's clock
// running a touch fast over a long run. (The test suite stretches it, so it
// doesn't have to wait out real runs in real time.)
const SLACK_MS = process.env.NODE_ENV === 'test' && process.env.TUMBLER_SLACK_MS ? Number(process.env.TUMBLER_SLACK_MS) : 1500;
// Runs that were never finished are forgotten after a day.
const KEEP_RUNS_MS = 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS tumbler_runs (
    id TEXT PRIMARY KEY,
    seed INTEGER NOT NULL,
    day TEXT NOT NULL,
    profile_id TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    taps TEXT,
    score INTEGER,
    level INTEGER,
    pins INTEGER,
    bullseyes INTEGER,
    best_streak INTEGER,
    saved INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tumbler_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    day TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    score INTEGER NOT NULL,
    level INTEGER NOT NULL,
    pins INTEGER NOT NULL,
    best_streak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS tumbler_scores_day ON tumbler_scores (day, score DESC);
  CREATE INDEX IF NOT EXISTS tumbler_scores_all ON tumbler_scores (score DESC);
`);

// Which rules a saved score was played under. The first version scored points
// over locks that opened; since 2026-11 a run is endless and the score is the
// number of pins popped, so the two can't share a board. Older scores are
// kept (rules 1) but only rules-2 scores are shown and ranked. `level` holds
// the wave a run ended in, and `pins` the pins popped.
const RULES_VERSION = 2;
for (const table of ['tumbler_scores', 'tumbler_runs']) {
  if (!db.db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'rules')) {
    db.db.exec(`ALTER TABLE ${table} ADD COLUMN rules INTEGER NOT NULL DEFAULT 1`);
  }
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const profiles = () => require('../arcade/profiles');

const getRun = id => db.db.prepare('SELECT * FROM tumbler_runs WHERE id = ?').get(String(id || ''));
function needRun(id) {
  const run = getRun(id);
  if (!run) throw fail('That run has expired. Tap to start a new one.', 404);
  return run;
}

function result(run) {
  return {
    runId: run.id, finished: !!run.finished_at, saved: !!run.saved,
    score: run.score, pops: run.pins, wave: run.level,
    bullseyes: run.bullseyes, bestStreak: run.best_streak
  };
}

function start({ profileToken } = {}, now = Date.now()) {
  db.db.prepare('DELETE FROM tumbler_runs WHERE started_at < ? AND saved = 0').run(now - KEEP_RUNS_MS);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const id = crypto.randomBytes(16).toString('hex');
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  db.db.prepare('INSERT INTO tumbler_runs (id, seed, day, profile_id, started_at, rules) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, seed, today(new Date(now)), profile ? profile.id : null, now, RULES_VERSION);
  return {
    runId: id, seed, rules: engine.RULES,
    // Only the test suites get this: it turns on the page's helper that says
    // when the next pin is due, so a browser test can play a real run.
    ...(process.env.NODE_ENV === 'test' ? { testHook: true } : {})
  };
}

// The page sends its taps; the server replays them and keeps what it worked out.
function finish(id, taps, now = Date.now()) {
  const run = needRun(id);
  if (run.rules !== RULES_VERSION) throw fail('That run was started under the old rules. Tap to start a new one.', 409);
  if (run.finished_at) return result(run);
  const out = engine.replay(run.seed, taps, { maxMs: now - run.started_at + SLACK_MS });
  db.db.prepare(`UPDATE tumbler_runs SET finished_at = ?, taps = ?, score = ?, level = ?, pins = ?, bullseyes = ?, best_streak = ?
    WHERE id = ? AND finished_at IS NULL`)
    .run(now, JSON.stringify(taps), out.score, out.wave, out.pops, out.bullseyes, out.bestStreak, run.id);
  return { ...result(getRun(run.id)), endedBy: out.endedBy };
}

// ---- the boards --------------------------------------------------------------------
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');
const rankIn = (sql, ...args) => db.db.prepare(sql).get(...args).c + 1;

function save(id, { initials, profileToken } = {}) {
  const run = needRun(id);
  if (!run.finished_at) throw fail('Finish the run first.', 409);
  if (run.saved) throw fail('This score is already on the board.', 409);
  if (run.rules !== RULES_VERSION) throw fail('That run was played under the old rules, so it can\'t go on the new board.', 409);
  if (!run.score) throw fail('Pop at least one pin to get a score on the board.');
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const info = db.db.prepare(`INSERT INTO tumbler_scores (run_id, day, initials, profile_id, profile_name, profile_avatar, score, level, pins, best_streak, rules)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, run.day, ini, profile ? profile.id : null,
    profile ? profile.name : null, profile ? profile.avatar : null, run.score, run.level, run.pins, run.best_streak, RULES_VERSION);
  db.db.prepare('UPDATE tumbler_runs SET saved = 1 WHERE id = ?').run(run.id);
  const scoreId = Number(info.lastInsertRowid);
  // Ties go to whoever got there first.
  const dayRank = rankIn('SELECT COUNT(*) AS c FROM tumbler_scores WHERE rules = ? AND day = ? AND (score > ? OR (score = ? AND id < ?))',
    RULES_VERSION, run.day, run.score, run.score, scoreId);
  const allRank = rankIn('SELECT COUNT(*) AS c FROM tumbler_scores WHERE rules = ? AND (score > ? OR (score = ? AND id < ?))',
    RULES_VERSION, run.score, run.score, scoreId);
  if (allRank === 1) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    comm.safePost({
      trophy: { game: 'Tumbler Rumble', profileId: profile ? profile.id : null, name: shout, score: `${run.score.toLocaleString('en-US')} locks`, url: '/tumbler.html' },
      kind: 'highscore', emoji: '🔓', game: 'tumbler',
      title: `${shout} set the best Tumbler Rumble score ever`,
      body: `${shout} popped ${run.score.toLocaleString('en-US')} locks in a row on Tumbler Rumble without a miss, the best anyone has done. Think you can pop more?`
    });
  }
  return { id: scoreId, dayRank, allRank, score: run.score };
}

// scope 'day' is one day's board (today unless a day is given); 'all' is the
// best scores ever.
function board({ scope = 'day', day, limit = 20 } = {}) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM tumbler_scores WHERE rules = ? ORDER BY score DESC, id ASC LIMIT ?').all(RULES_VERSION, cap)
    : db.db.prepare('SELECT * FROM tumbler_scores WHERE rules = ? AND day = ? ORDER BY score DESC, id ASC LIMIT ?')
      .all(RULES_VERSION, DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    // A profile's current choice (name or initials) wins over what was saved.
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, initials: r.initials, score: r.score, wave: r.level, bestStreak: r.best_streak,
      profileName: now ? now.label : r.profile_name || null, profileAvatar: now ? now.avatar : r.profile_avatar || null
    };
  });
}

// ---- routes ------------------------------------------------------------------------
const router = express.Router();
const limiter = (limit, windowMin = 10) => rateLimit({
  windowMs: windowMin * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'That\'s a lot of runs in a short time. Take a breather and try again in a few minutes.' }
});
const startLimit = limiter(300), finishLimit = limiter(300), saveLimit = limiter(60);
const body = req => req.body || {};
const wrap = fn => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

router.post('/start', startLimit, wrap(req => start(body(req))));
router.get('/run/:id', wrap(req => result(needRun(req.params.id))));
router.post('/run/:id/finish', finishLimit, wrap(req => finish(req.params.id, body(req).taps)));
router.post('/run/:id/save', saveLimit, (req, res, next) => {
  try { res.status(201).json(save(req.params.id, body(req))); } catch (e) { next(e); }
});
router.get('/board', wrap(req => board({ scope: req.query.scope, day: req.query.day, limit: req.query.limit })));

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});

module.exports = { router, start, finish, save, board, SLACK_MS, RULES_VERSION };
