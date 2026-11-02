'use strict';

// Roll Royale: runs and the high-score boards (/api/royale).
//
// The server decides every score. Starting a run here writes down when it
// started (on the server's clock) and hands the page a random seed, which
// decides how each ball's aiming arrow sways and where the bonus cup slides.
// When the 9 balls are done the page sends only when each ball was pressed
// and let go; the server replays the same simulation the page ran
// (public/royale-engine.js) with those times and works out where every ball
// landed and the score itself. Times that couldn't have happened are
// refused. No score from the page is ever read.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const engine = require('../public/royale-engine');

// The page's clock starts a moment after the server's, so its times are
// always a little behind the server's. This much slack covers a phone's
// clock running a touch fast. (The test suite stretches it, so it doesn't
// have to play whole runs in real time.)
const SLACK_MS = process.env.NODE_ENV === 'test' && process.env.ROYALE_SLACK_MS ? Number(process.env.ROYALE_SLACK_MS) : 1500;
// Runs that were never finished are forgotten after a day.
const KEEP_RUNS_MS = 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS royale_runs (
    id TEXT PRIMARY KEY,
    seed INTEGER NOT NULL,
    day TEXT NOT NULL,
    profile_id TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    balls TEXT,
    rings TEXT,
    score INTEGER,
    jackpots INTEGER,
    bulls INTEGER,
    saved INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS royale_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    day TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    score INTEGER NOT NULL,
    rings TEXT NOT NULL,
    jackpots INTEGER NOT NULL DEFAULT 0,
    bulls INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS royale_scores_day ON royale_scores (day, score DESC);
  CREATE INDEX IF NOT EXISTS royale_scores_all ON royale_scores (score DESC);
`);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const profiles = () => require('../arcade/profiles');
const ringsOf = text => { try { return JSON.parse(text || '[]'); } catch { return []; } };

const getRun = id => db.db.prepare('SELECT * FROM royale_runs WHERE id = ?').get(String(id || ''));
function needRun(id) {
  const run = getRun(id);
  if (!run) throw fail('That run has expired. Start a new one.', 404);
  return run;
}

function result(run) {
  return {
    runId: run.id, finished: !!run.finished_at, saved: !!run.saved,
    score: run.score, rings: run.finished_at ? ringsOf(run.rings) : null, jackpots: run.jackpots, bulls: run.bulls
  };
}

function start({ profileToken } = {}, now = Date.now()) {
  db.db.prepare('DELETE FROM royale_runs WHERE started_at < ? AND saved = 0').run(now - KEEP_RUNS_MS);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const id = crypto.randomBytes(16).toString('hex');
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  db.db.prepare('INSERT INTO royale_runs (id, seed, day, profile_id, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, seed, today(new Date(now)), profile ? profile.id : null, now);
  return {
    runId: id, seed, rules: engine.RULES,
    // Only the test suites get this: it turns on the page's helper that says
    // when to press and how long to hold, so a browser test can roll a real ball.
    ...(process.env.NODE_ENV === 'test' ? { testHook: true } : {})
  };
}

// The page sends its press and release times; the server replays them and
// keeps what it worked out.
function finish(id, balls, now = Date.now()) {
  const run = needRun(id);
  if (run.finished_at) return result(run);
  const out = engine.replay(run.seed, balls, { maxMs: now - run.started_at + SLACK_MS });
  db.db.prepare(`UPDATE royale_runs SET finished_at = ?, balls = ?, rings = ?, score = ?, jackpots = ?, bulls = ?
    WHERE id = ? AND finished_at IS NULL`)
    .run(now, JSON.stringify(balls), JSON.stringify(out.rings), out.score, out.jackpots, out.bulls, run.id);
  return result(getRun(run.id));
}

// ---- the boards --------------------------------------------------------------------
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');
const rankIn = (sql, ...args) => db.db.prepare(sql).get(...args).c + 1;

function save(id, { initials, profileToken } = {}) {
  const run = needRun(id);
  if (!run.finished_at) throw fail('Roll all 9 balls first.', 409);
  if (run.saved) throw fail('This score is already on the board.', 409);
  if (!run.score) throw fail('Land at least one ball in a ring to get a score on the board.');
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const info = db.db.prepare(`INSERT INTO royale_scores (run_id, day, initials, profile_id, profile_name, profile_avatar, score, rings, jackpots, bulls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, run.day, ini, profile ? profile.id : null,
    profile ? profile.name : null, profile ? profile.avatar : null, run.score, run.rings, run.jackpots, run.bulls);
  db.db.prepare('UPDATE royale_runs SET saved = 1 WHERE id = ?').run(run.id);
  const scoreId = Number(info.lastInsertRowid);
  // Ties go to whoever got there first.
  const dayRank = rankIn('SELECT COUNT(*) AS c FROM royale_scores WHERE day = ? AND (score > ? OR (score = ? AND id < ?))',
    run.day, run.score, run.score, scoreId);
  const allRank = rankIn('SELECT COUNT(*) AS c FROM royale_scores WHERE score > ? OR (score = ? AND id < ?)',
    run.score, run.score, scoreId);
  if (allRank === 1) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    const cups = run.jackpots ? ` with ${run.jackpots} jackpot${run.jackpots === 1 ? '' : 's'}` : '';
    comm.safePost({
      kind: 'highscore', emoji: '🎳', game: 'royale',
      title: `${shout} set the best Roll Royale score ever`,
      body: `${shout} rolled ${run.score.toLocaleString('en-US')} points on Roll Royale${cups}, the best anyone has done. Think you can roll better?`
    });
  }
  return { id: scoreId, dayRank, allRank, score: run.score };
}

// scope 'day' is one day's board (today unless a day is given); 'all' is the
// best scores ever.
function board({ scope = 'day', day, limit = 20 } = {}) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM royale_scores ORDER BY score DESC, id ASC LIMIT ?').all(cap)
    : db.db.prepare('SELECT * FROM royale_scores WHERE day = ? ORDER BY score DESC, id ASC LIMIT ?')
      .all(DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    // A profile's current choice (name or initials) wins over what was saved.
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, initials: r.initials, score: r.score, rings: ringsOf(r.rings), jackpots: r.jackpots, bulls: r.bulls,
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
router.post('/run/:id/finish', finishLimit, wrap(req => finish(req.params.id, body(req).balls)));
router.post('/run/:id/save', saveLimit, (req, res, next) => {
  try { res.status(201).json(save(req.params.id, body(req))); } catch (e) { next(e); }
});
router.get('/board', wrap(req => board({ scope: req.query.scope, day: req.query.day, limit: req.query.limit })));

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});

module.exports = { router, start, finish, save, board, SLACK_MS };
