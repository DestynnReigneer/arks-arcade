'use strict';

// Moonshot: runs, swings and the high-score boards (/api/moonshot).
//
// The server decides every score. Starting a run picks a random seed here and
// writes down the moment it started. The seed decides every pitch
// (public/moonshot-engine.js, the same file the page draws with). For each
// swing the page sends only *when* it happened, in milliseconds since the run
// started. The server replays the whole run from the seed and those times to
// work out every hit, and turns away a swing that couldn't have happened:
// between pitches, two on one pitch, later than the server's own clock says
// the run has been going, or so old that it can't be a swing that just
// happened. A score sent by the page is never read.
//
// Pausing (How to play, leaving the page) stops the run's clock here too, so
// the page and the server keep counting the same time.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const E = require('../public/moonshot-engine');

// A swing is sent the moment it happens, so it reaches the server a moment
// later. GRACE covers the two clocks starting a hair apart; LAG is the
// oldest a swing may be when it arrives (a slow phone network, not a swing
// picked with hindsight). The test suite can widen GRACE so it can send a
// whole run without playing it in real time; nothing else can.
const GRACE_MS = process.env.NODE_ENV === 'test' && Number(process.env.MOONSHOT_SLACK_MS) > 0
  ? Number(process.env.MOONSHOT_SLACK_MS) : 300;
const END_GRACE_MS = 300;
const LAG_MS = 10000;
// A run that isn't finished in this long (pauses included) is over.
const MAX_RUN_MS = 30 * 60 * 1000;
const KEEP_RUNS_MS = 2 * 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS moonshot_runs (
    id TEXT PRIMARY KEY,
    seed INTEGER NOT NULL,
    profile_id TEXT,
    started_at INTEGER NOT NULL,
    paused_ms INTEGER NOT NULL DEFAULT 0,
    paused_at INTEGER,
    swings TEXT NOT NULL DEFAULT '[]',
    saved INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS moonshot_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    run_id TEXT NOT NULL UNIQUE,
    who TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    score INTEGER NOT NULL,
    homers INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS moonshot_scores_day ON moonshot_scores (day, score DESC);
  CREATE INDEX IF NOT EXISTS moonshot_scores_all ON moonshot_scores (score DESC);
`);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const profiles = () => require('../arcade/profiles');

const getRun = id => db.db.prepare('SELECT * FROM moonshot_runs WHERE id = ?').get(String(id || ''));
function needRun(id) {
  const run = getRun(id);
  if (!run) throw fail('That run has ended. Tap Play again for a new one.', 404);
  return run;
}
const timesOf = run => JSON.parse(run.swings);
// The run's own clock: time since it started, not counting pauses.
const clockOf = (run, now) => now - run.started_at - run.paused_ms - (run.paused_at ? now - run.paused_at : 0);

// Over when the last pitch has been swung at, or its chance to swing has
// passed by the run's clock.
const isOver = (run, now) => E.replay(run.seed, timesOf(run), clockOf(run, now) + END_GRACE_MS).finished;

function view(run, now = Date.now()) {
  const times = timesOf(run);
  const clock = clockOf(run, now);
  const r = E.replay(run.seed, times, clock);
  return {
    runId: run.id, seed: run.seed, pitches: E.PITCHES, times, results: r.results, total: r.total, homers: r.homers,
    bestStreak: r.bestStreak, finished: isOver(run, now), saved: !!run.saved, paused: !!run.paused_at, clockMs: clock
  };
}

function start({ profileToken } = {}, now = Date.now()) {
  db.db.prepare('DELETE FROM moonshot_runs WHERE started_at < ? AND saved = 0').run(now - KEEP_RUNS_MS);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const id = crypto.randomBytes(16).toString('hex');
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  db.db.prepare('INSERT INTO moonshot_runs (id, seed, profile_id, started_at) VALUES (?, ?, ?, ?)')
    .run(id, seed, profile ? profile.id : null, now);
  return {
    ...view(getRun(id), now),
    ...(process.env.NODE_ENV === 'test' ? { testHook: true } : {})
  };
}

function live(run, now) {
  if (run.saved) throw fail('This run is already on the board.', 409);
  if (now - run.started_at > MAX_RUN_MS) throw fail('This run went on too long and has ended. Tap Play again for a new one.', 409);
}

// One swing, `t` ms into the run (by the page's clock, which started when the
// run arrived and stops when it's paused, so it's never ahead of the server's).
function swing(id, t, now = Date.now()) {
  const run = needRun(id);
  live(run, now);
  if (run.paused_at) throw fail('This run is paused, so a swing can\'t count.', 409);
  const clock = clockOf(run, now);
  const time = Number(t);
  if (!Number.isInteger(time) || time < 0) throw fail('That swing time does not look right.');
  if (time > clock + GRACE_MS) throw fail('That swing is later than this run has been going, so it can\'t count.');
  if (time < clock - LAG_MS) throw fail('That swing took too long to arrive, so it can\'t count.');
  const times = timesOf(run);
  // How many pitches the earlier swings had settled (counting up to the last one).
  const before = E.replay(run.seed, times, -1).results.length;
  let r;
  try {
    // Up to and including the pitch this swing was at.
    r = E.replay(run.seed, [...times, time], time);
  } catch (e) {
    if (e.code === 'done') throw fail(e.message, 409);
    if (e.code) throw fail(e.message);
    throw e;
  }
  times.push(time);
  db.db.prepare('UPDATE moonshot_runs SET swings = ? WHERE id = ?').run(JSON.stringify(times), run.id);
  return {
    result: r.results[r.results.length - 1],
    // Pitches let go by without a swing since the last one (each a strike).
    taken: r.results.slice(before, -1),
    total: r.total, homers: r.homers, left: E.PITCHES - r.results.length, finished: r.finished
  };
}

function pause(id, now = Date.now()) {
  const run = needRun(id);
  live(run, now);
  if (!run.paused_at) db.db.prepare('UPDATE moonshot_runs SET paused_at = ? WHERE id = ?').run(now, run.id);
  return { paused: true, clockMs: clockOf(getRun(id), now) };
}

function resume(id, now = Date.now()) {
  const run = needRun(id);
  if (run.paused_at) {
    db.db.prepare('UPDATE moonshot_runs SET paused_ms = paused_ms + ?, paused_at = NULL WHERE id = ?')
      .run(Math.max(0, now - run.paused_at), run.id);
  }
  return { paused: false, clockMs: clockOf(getRun(id), now) };
}

// ---- the boards --------------------------------------------------------------------
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');
const rankOf = (where, args, score, id) => db.db.prepare(
  `SELECT COUNT(*) AS c FROM moonshot_scores WHERE ${where} (score > ? OR (score = ? AND id < ?))`
).get(...args, score, score, id).c + 1;

function save(id, { initials, profileToken } = {}, now = Date.now()) {
  const run = needRun(id);
  if (run.saved) throw fail('This score is already on the board.', 409);
  // The score comes from the server's own replay of the swing times, never the request.
  const r = E.replay(run.seed, timesOf(run));
  if (!isOver(run, now)) throw fail('Finish all twelve pitches first.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const who = profile ? `p:${profile.id}` : `g:${ini}`;
  const day = today(new Date(run.started_at));
  const info = db.db.prepare(`INSERT INTO moonshot_scores (day, run_id, who, initials, profile_id, profile_name, profile_avatar, score, homers, best_streak)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(day, run.id, who, ini, profile ? profile.id : null,
    profile ? profile.name : null, profile ? profile.avatar : null, r.total, r.homers, r.bestStreak);
  db.db.prepare('UPDATE moonshot_runs SET saved = 1 WHERE id = ?').run(run.id);
  const scoreId = Number(info.lastInsertRowid);
  const dayRank = rankOf('day = ? AND', [day], r.total, scoreId);
  const allRank = rankOf('', [], r.total, scoreId);
  // The next score up on today's board, so "N points behind #2" is real.
  const above = dayRank > 1 ? db.db.prepare('SELECT score FROM moonshot_scores WHERE day = ? AND (score > ? OR (score = ? AND id < ?)) ORDER BY score ASC, id DESC LIMIT 1')
    .get(day, r.total, r.total, scoreId) : null;
  if (allRank === 1 && r.total > 0) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    comm.safePost({
      kind: 'highscore', emoji: '⚾', game: 'moonshot',
      title: `${shout} set a new Moonshot record`,
      body: `${shout} scored ${r.total.toLocaleString('en-US')} points in Moonshot${r.homers ? `, with ${r.homers} home run${r.homers === 1 ? '' : 's'}` : ''}. That's the best run anyone has had. Think you can knock it out further?`
    });
  }
  return { id: scoreId, score: r.total, homers: r.homers, dayRank, allRank, nextUp: above ? above.score - r.total : null };
}

// scope 'day' is one day's board (today unless a day is given); 'all' is the
// best runs ever.
function board({ scope = 'day', day, limit = 20 } = {}) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM moonshot_scores ORDER BY score DESC, id ASC LIMIT ?').all(cap)
    : db.db.prepare('SELECT * FROM moonshot_scores WHERE day = ? ORDER BY score DESC, id ASC LIMIT ?')
      .all(DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    // A profile's current choice (name or initials) wins over what was saved.
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, initials: r.initials, score: r.score, homers: r.homers, bestStreak: r.best_streak,
      profileName: now ? now.label : r.profile_name || null, profileAvatar: now ? now.avatar : r.profile_avatar || null
    };
  });
}

// ---- routes ------------------------------------------------------------------------
const router = express.Router();
const limiter = (limit, windowMin = 10) => rateLimit({
  windowMs: windowMin * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'That\'s a lot of swings in a short time. Take a breather and try again in a few minutes.' }
});
const startLimit = limiter(200), swingLimit = limiter(2000), saveLimit = limiter(60);
const body = req => req.body || {};
const wrap = fn => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

router.get('/rules', wrap(() => ({
  day: today(), pitches: E.PITCHES, perLevel: E.PER_LEVEL, lateMs: E.LATE_MS, bands: E.BANDS,
  kinds: E.KINDS, types: E.TYPES, streakBonus: E.STREAK_BONUS, streakCap: E.STREAK_CAP, maxScore: E.MAX_SCORE
})));
router.post('/start', startLimit, wrap(req => start(body(req))));
router.get('/run/:id', wrap(req => view(needRun(req.params.id))));
router.post('/run/:id/swing', swingLimit, wrap(req => swing(req.params.id, body(req).t)));
router.post('/run/:id/pause', swingLimit, wrap(req => pause(req.params.id)));
router.post('/run/:id/resume', swingLimit, wrap(req => resume(req.params.id)));
router.post('/run/:id/save', saveLimit, (req, res, next) => {
  try { res.status(201).json(save(req.params.id, body(req))); } catch (e) { next(e); }
});
router.get('/board', wrap(req => board({ scope: req.query.scope, day: req.query.day, limit: req.query.limit })));

// Only for the test suites (NODE_ENV=test): the perfect moment to swing at the
// next pitch that leaves the machine after `after`. It doesn't exist on a real
// server (a 404 there).
if (process.env.NODE_ENV === 'test') {
  router.get('/test/homer/:id', wrap(req => {
    const run = needRun(req.params.id);
    const after = Math.max(0, Number(req.query.after) || 0);
    const ph = E.plan(run.seed).pitches.find(x => x.release >= after);
    return ph ? { n: ph.n, release: ph.release, perfect: ph.plate } : { n: null };
  }));
}

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});

module.exports = { router, start, swing, pause, resume, save, board, GRACE_MS, LAG_MS };
