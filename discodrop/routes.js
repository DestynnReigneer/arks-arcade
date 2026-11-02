'use strict';

// Disco Drop: runs, drops and the high-score boards (/api/discodrop).
//
// The server decides every score. Starting a run picks a random seed here and
// writes down the moment it started. The seed decides how the cups and the
// arm move (public/discodrop-engine.js, the same file the page draws with).
// For each ball the page sends only *when* it was dropped, in milliseconds
// since the run started. The server replays the whole run from the seed and
// those times to work out where every ball landed, and turns away a time that
// couldn't have happened: before the last ball had landed and a new one was
// back on the arm, later than the server's own clock says the run has been
// going, or so old that it can't be a drop that just happened. A score sent by
// the page is never read.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const E = require('../public/discodrop-engine');

// A drop is sent the moment it happens, so it reaches the server a moment
// later. GRACE covers the two clocks starting a hair apart; LAG is the
// oldest a drop may be when it arrives (a slow phone network, not a replay
// picked with hindsight).
const GRACE_MS = 300;
const LAG_MS = 10000;
// A run that isn't finished in this long is over.
const MAX_RUN_MS = 30 * 60 * 1000;
const KEEP_RUNS_MS = 2 * 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS discodrop_runs (
    id TEXT PRIMARY KEY,
    seed INTEGER NOT NULL,
    profile_id TEXT,
    started_at INTEGER NOT NULL,
    drops TEXT NOT NULL DEFAULT '[]',
    score INTEGER NOT NULL DEFAULT 0,
    jackpots INTEGER NOT NULL DEFAULT 0,
    finished_at INTEGER,
    saved INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS discodrop_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    run_id TEXT NOT NULL UNIQUE,
    who TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    score INTEGER NOT NULL,
    jackpots INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS discodrop_scores_day ON discodrop_scores (day, score DESC);
  CREATE INDEX IF NOT EXISTS discodrop_scores_all ON discodrop_scores (score DESC);
`);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const profiles = () => require('../arcade/profiles');

const getRun = id => db.db.prepare('SELECT * FROM discodrop_runs WHERE id = ?').get(String(id || ''));
function needRun(id) {
  const run = getRun(id);
  if (!run) throw fail('That run has ended. Tap Play again for a new one.', 404);
  return run;
}
const timesOf = run => JSON.parse(run.drops);

function view(run, now = Date.now()) {
  const times = timesOf(run);
  const r = E.replay(run.seed, times);
  return {
    runId: run.id, seed: run.seed, drops: E.DROPS, times, results: r.results, total: r.total,
    finished: !!run.finished_at, saved: !!run.saved, elapsedMs: now - run.started_at
  };
}

function start({ profileToken } = {}, now = Date.now()) {
  db.db.prepare('DELETE FROM discodrop_runs WHERE started_at < ? AND saved = 0').run(now - KEEP_RUNS_MS);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const id = crypto.randomBytes(16).toString('hex');
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  db.db.prepare('INSERT INTO discodrop_runs (id, seed, profile_id, started_at) VALUES (?, ?, ?, ?)')
    .run(id, seed, profile ? profile.id : null, now);
  return view(getRun(id), now);
}

// One ball, dropped `t` ms after the run started (by the page's clock, which
// started when the run arrived, so it's never ahead of the server's).
function drop(id, t, now = Date.now()) {
  const run = needRun(id);
  if (run.finished_at) throw fail('This run has used all its balls.', 409);
  const elapsed = now - run.started_at;
  if (elapsed > MAX_RUN_MS) throw fail('This run went on too long and has ended. Tap Play again for a new one.', 409);
  const time = Number(t);
  if (!Number.isInteger(time) || time < 0) throw fail('That drop time does not look right.');
  if (time > elapsed + GRACE_MS) throw fail('That drop is later than this run has been going, so it can\'t count.');
  if (time < elapsed - LAG_MS) throw fail('That drop took too long to arrive, so it can\'t count.');
  const times = timesOf(run);
  let r;
  try {
    r = E.replay(run.seed, [...times, time]);
  } catch (e) {
    if (e.code === 'done') throw fail(e.message, 409);
    if (e.code) throw fail(e.message);
    throw e;
  }
  times.push(time);
  const jackpots = r.results.filter(x => x.jackpot).length;
  db.db.prepare('UPDATE discodrop_runs SET drops = ?, score = ?, jackpots = ?, finished_at = ? WHERE id = ?')
    .run(JSON.stringify(times), r.total, jackpots, r.finished ? now : null, run.id);
  return { result: r.results[r.results.length - 1], total: r.total, jackpots, left: E.DROPS - times.length, finished: r.finished };
}

// ---- the boards --------------------------------------------------------------------
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');
const rankOf = (where, args, score, id) => db.db.prepare(
  `SELECT COUNT(*) AS c FROM discodrop_scores WHERE ${where} (score > ? OR (score = ? AND id < ?))`
).get(...args, score, score, id).c + 1;

function save(id, { initials, profileToken } = {}) {
  const run = needRun(id);
  if (!run.finished_at) throw fail('Drop all ten balls first.', 409);
  if (run.saved) throw fail('This score is already on the board.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const who = profile ? `p:${profile.id}` : `g:${ini}`;
  // The score comes from the server's own replay of the drop times, never the request.
  const { total } = E.replay(run.seed, timesOf(run));
  const day = today(new Date(run.started_at));
  const info = db.db.prepare(`INSERT INTO discodrop_scores (day, run_id, who, initials, profile_id, profile_name, profile_avatar, score, jackpots)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(day, run.id, who, ini, profile ? profile.id : null,
    profile ? profile.name : null, profile ? profile.avatar : null, total, run.jackpots);
  db.db.prepare('UPDATE discodrop_runs SET saved = 1 WHERE id = ?').run(run.id);
  const scoreId = Number(info.lastInsertRowid);
  const dayRank = rankOf('day = ? AND', [day], total, scoreId);
  const allRank = rankOf('', [], total, scoreId);
  // The next score up on today's board, so "N points to beat #2" is real.
  const above = dayRank > 1 ? db.db.prepare('SELECT score FROM discodrop_scores WHERE day = ? AND (score > ? OR (score = ? AND id < ?)) ORDER BY score ASC, id DESC LIMIT 1')
    .get(day, total, total, scoreId) : null;
  if (allRank === 1 && total > 0) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    comm.safePost({
      kind: 'highscore', emoji: '🪩', game: 'discodrop',
      title: `${shout} set a new Disco Drop record`,
      body: `${shout} scored ${total.toLocaleString('en-US')} points in Disco Drop${run.jackpots ? `, with ${run.jackpots} jackpot${run.jackpots === 1 ? '' : 's'}` : ''}. That's the best run anyone has had. Think you can drop it better?`
    });
  }
  return { id: scoreId, score: total, dayRank, allRank, nextUp: above ? above.score - total : null };
}

// scope 'day' is one day's board (today unless a day is given); 'all' is the
// best runs ever.
function board({ scope = 'day', day, limit = 20 } = {}) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM discodrop_scores ORDER BY score DESC, id ASC LIMIT ?').all(cap)
    : db.db.prepare('SELECT * FROM discodrop_scores WHERE day = ? ORDER BY score DESC, id ASC LIMIT ?')
      .all(DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    // A profile's current choice (name or initials) wins over what was saved.
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, initials: r.initials, score: r.score, jackpots: r.jackpots,
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
const startLimit = limiter(200), dropLimit = limiter(2000), saveLimit = limiter(60);
const body = req => req.body || {};
const wrap = fn => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

router.get('/rules', wrap(() => ({
  day: today(), drops: E.DROPS, fallMs: E.FALL_MS, reloadMs: E.RELOAD_MS, bonusFrom: E.BONUS_FROM,
  cups: E.KINDS, maxScore: E.MAX_SCORE
})));
router.post('/start', startLimit, wrap(req => start(body(req))));
router.get('/run/:id', wrap(req => view(needRun(req.params.id))));
router.post('/run/:id/drop', dropLimit, wrap(req => drop(req.params.id, body(req).t)));
router.post('/run/:id/save', saveLimit, (req, res, next) => {
  try { res.status(201).json(save(req.params.id, body(req))); } catch (e) { next(e); }
});
router.get('/board', wrap(req => board({ scope: req.query.scope, day: req.query.day, limit: req.query.limit })));

// Only for the browser tests (NODE_ENV=test): when to drop the next ball so
// it lands in the jackpot. It doesn't exist on a real server.
if (process.env.NODE_ENV === 'test') {
  router.get('/test/jackpot/:id', wrap(req => {
    const run = needRun(req.params.id);
    const after = Math.max(0, Number(req.query.after) || 0);
    return { windows: E.jackpotWindows(run.seed, timesOf(run), after, 30000) };
  }));
}

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});

module.exports = { router, start, drop, save, board, GRACE_MS, LAG_MS };
