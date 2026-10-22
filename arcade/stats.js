'use strict';

// Arcade stats and the error log.
//
// Visits: every game page opens a visit when it loads, sends a heartbeat with
// how long it was actually on screen (a phone left on the counter doesn't
// count), and closes it when the page goes away. Games can also count a
// "play" (a round, a run, a match) so the admin sees how often, not just how
// long.
//
// Errors: crashes in the browser and on the server are grouped by a short
// code like E-3F9A2C, made from where it happened and what it said. The same
// bug always gets the same code, so "Spin & Solve said E-3F9A2C" is enough to
// find it, and the admin page can copy the full details to paste into a chat.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const profiles = require('./profiles');
const homeGames = require('./home-games');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS arcade_visits (
    id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    player TEXT NOT NULL DEFAULT '',
    profile_id TEXT,
    device TEXT NOT NULL DEFAULT 'desktop',
    started_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    active_ms INTEGER NOT NULL DEFAULT 0,
    plays INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS arcade_visits_started ON arcade_visits (started_at);
  CREATE TABLE IF NOT EXISTS arcade_errors (
    code TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    stack TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '',
    player TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0
  );
`);

const DAY = 24 * 60 * 60 * 1000;
const KEEP_VISITS = 400 * DAY;
const MAX_ERRORS = 500;
const BEAT_MAX_MS = 90 * 1000;      // a heartbeat can't claim more than this
const DEVICES = ['phone', 'tablet', 'desktop'];

const knownGame = g => g === 'hub' || homeGames.GAMES.includes(g);
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const cleanName = raw => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16);

function deviceOf(ua) {
  ua = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'phone';
  return 'desktop';
}
function browserOf(ua) {
  ua = String(ua || '');
  const name = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return `${name}${os ? ' on ' + os : ''} (${deviceOf(ua)})`;
}

// Who's playing: a verified profile wins over whatever name the page sent.
function whoFrom(body) {
  const p = body.token ? profiles.verify(body.token) : null;
  if (p) return { player: p.name, profileId: p.id };
  return { player: cleanName(body.name), profileId: null };
}

// ---- most played ---------------------------------------------------------------------------
// The home page's game order: the games this profile has spent the most
// on-screen time in over the last 90 days come first, then what everyone
// plays most, then the admin's order for anything nobody has touched.
const ORDER_WINDOW = 90 * DAY;

function gameOrder({ token, now = Date.now() } = {}) {
  const { order } = homeGames.get();
  const me = token ? profiles.verify(token) : null;
  const since = now - ORDER_WINDOW;
  const timeBy = (extra, args) => new Map(db.db.prepare(
    `SELECT game, SUM(active_ms) AS ms FROM arcade_visits WHERE started_at >= ? ${extra} GROUP BY game`
  ).all(since, ...args).map(r => [r.game, r.ms]));
  const mine = me ? timeBy('AND profile_id = ?', [me.id]) : new Map();
  const everyone = timeBy('', []);
  return order.slice().sort((a, b) =>
    (mine.get(b) || 0) - (mine.get(a) || 0) ||
    (everyone.get(b) || 0) - (everyone.get(a) || 0) ||
    order.indexOf(a) - order.indexOf(b));
}

// ---- visits ------------------------------------------------------------------------------
function startVisit({ game, name, token, ua, now = Date.now() }) {
  if (!knownGame(game)) throw Object.assign(new Error('Unknown game.'), { status: 400 });
  const id = crypto.randomBytes(9).toString('base64url');
  const who = whoFrom({ name, token });
  db.db.prepare(`INSERT INTO arcade_visits (id, game, player, profile_id, device, started_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, game, who.player, who.profileId, deviceOf(ua), now, now);
  return id;
}

function beat({ id, activeMs, plays, name, token, now = Date.now() }) {
  const v = db.db.prepare('SELECT id FROM arcade_visits WHERE id = ?').get(String(id || ''));
  if (!v) return false;
  const add = Math.max(0, Math.min(BEAT_MAX_MS, Math.round(Number(activeMs) || 0)));
  const morePlays = Math.max(0, Math.min(50, Math.round(Number(plays) || 0)));
  const who = whoFrom({ name, token });
  db.db.prepare(`UPDATE arcade_visits SET active_ms = active_ms + ?, plays = plays + ?, last_seen = ?,
      player = CASE WHEN ? <> '' THEN ? ELSE player END,
      profile_id = COALESCE(?, profile_id)
    WHERE id = ?`).run(add, morePlays, now, who.player, who.player, who.profileId, v.id);
  return true;
}

// ---- errors --------------------------------------------------------------------------------
// Numbers and ids change between runs of the same bug; leave them out of the code.
const normalize = s => String(s || '').replace(/\b[0-9a-f]{8,}\b/gi, '#').replace(/\d+/g, '#').slice(0, 200);
const codeFor = (source, game, message, location) => 'E-' + crypto.createHash('sha1')
  .update([source, game, normalize(message), String(location || '').replace(/:\d+(:\d+)?$/, '')].join('|'))
  .digest('hex').slice(0, 6).toUpperCase();

function recordError({ source = 'client', game = '', message, location = '', stack = '', ua = '', player = '', now = Date.now() }) {
  message = clip(message || 'Unknown error', 500);
  game = knownGame(game) ? game : '';
  const code = codeFor(source, game, message, location);
  const had = db.db.prepare('SELECT code FROM arcade_errors WHERE code = ?').get(code);
  if (had) {
    // Seen again: count it, and reopen it if it had been marked fixed.
    db.db.prepare(`UPDATE arcade_errors SET count = count + 1, last_seen = ?, resolved = 0,
      stack = CASE WHEN ? <> '' THEN ? ELSE stack END, browser = ?, player = ? WHERE code = ?`)
      .run(now, clip(stack, 4000), clip(stack, 4000), ua ? browserOf(ua) : '', cleanName(player), code);
  } else {
    db.db.prepare(`INSERT INTO arcade_errors (code, source, game, message, location, stack, browser, player, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, source, game, message, clip(location, 300), clip(stack, 4000), ua ? browserOf(ua) : '', cleanName(player), now, now);
    // Keep the log small: drop the oldest fixed ones first, then the oldest.
    const n = db.db.prepare('SELECT COUNT(*) AS n FROM arcade_errors').get().n;
    if (n > MAX_ERRORS) {
      db.db.prepare(`DELETE FROM arcade_errors WHERE code IN (SELECT code FROM arcade_errors
        ORDER BY resolved DESC, last_seen ASC LIMIT ?)`).run(n - MAX_ERRORS);
    }
  }
  return code;
}

function prune(now = Date.now()) {
  db.db.prepare('DELETE FROM arcade_visits WHERE started_at < ?').run(now - KEEP_VISITS);
}

// ---- what the admin page gets ----------------------------------------------------------------
// Visits go out as compact rows; the page does the adding up, so every chart
// and the log agree with each other and filter instantly.
function summary(days) {
  const since = days > 0 ? Date.now() - days * DAY : 0;
  const rows = db.db.prepare(`SELECT game, player, device, started_at, active_ms, plays FROM arcade_visits
    WHERE started_at >= ? ORDER BY started_at DESC LIMIT 50000`).all(since);
  const games = [], players = [];
  const idx = (list, v) => { let i = list.indexOf(v); if (i < 0) { i = list.length; list.push(v); } return i; };
  const visits = rows.map(r => [r.started_at, Math.round(r.active_ms / 1000), idx(games, r.game), idx(players, r.player || ''), DEVICES.indexOf(r.device), r.plays]);
  const openErrors = db.db.prepare('SELECT COUNT(*) AS n FROM arcade_errors WHERE resolved = 0').get().n;
  return { since, games, players, devices: DEVICES, visits, openErrors };
}

const errorList = () => db.db.prepare('SELECT * FROM arcade_errors ORDER BY resolved ASC, last_seen DESC').all().map(e => ({
  code: e.code, source: e.source, game: e.game, message: e.message, location: e.location, stack: e.stack,
  browser: e.browser, player: e.player, count: e.count, firstSeen: e.first_seen, lastSeen: e.last_seen, resolved: !!e.resolved
}));

// ---- routes ---------------------------------------------------------------------------------
const limiter = (limit, what) => rateLimit({
  windowMs: 10 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: `Too many ${what}. Try again in a few minutes.` }
});

function routes({ requireAdmin }) {
  const router = express.Router();
  const send = fn => (req, res, next) => {
    try { fn(req, res); } catch (e) {
      if (e.status && e.status < 500) res.status(e.status).json({ error: e.message });
      else next(e);
    }
  };

  router.post('/visit', limiter(120, 'visits'), send((req, res) => {
    const b = req.body || {};
    res.status(201).json({ id: startVisit({ game: String(b.game || ''), name: b.name, token: b.token, ua: req.get('User-Agent') }) });
  }));
  // Heartbeats and the goodbye (sent with sendBeacon as the page closes).
  router.post('/beat', limiter(1500, 'updates'), send((req, res) => {
    const b = req.body || {};
    res.json({ ok: beat({ id: b.id, activeMs: b.activeMs, plays: b.plays, name: b.name, token: b.token }) });
  }));
  // POST so the profile token stays out of URLs and logs.
  router.post('/game-order', limiter(300, 'requests'), send((req, res) => {
    res.json({ order: gameOrder({ token: (req.body || {}).token }) });
  }));
  router.post('/error', limiter(60, 'error reports'), send((req, res) => {
    const b = req.body || {};
    const code = recordError({
      source: 'client', game: String(b.game || ''), message: b.message,
      location: b.location, stack: b.stack, ua: req.get('User-Agent'), player: b.name
    });
    res.status(201).json({ code });
  }));

  router.get('/admin/summary', requireAdmin, send((req, res) => {
    prune();
    const days = Math.max(0, Math.min(400, Number(req.query.days) || 0));
    res.json(summary(days));
  }));
  router.get('/admin/errors', requireAdmin, send((req, res) => res.json(errorList())));
  router.post('/admin/errors/:code/resolve', requireAdmin, send((req, res) => {
    const r = db.db.prepare('UPDATE arcade_errors SET resolved = ? WHERE code = ?').run(req.body && req.body.reopen ? 0 : 1, req.params.code);
    if (!r.changes) return res.status(404).json({ error: 'No error with that code.' });
    res.json({ ok: true });
  }));
  router.delete('/admin/errors', requireAdmin, send((req, res) => {
    const only = req.query.resolved === '1';
    db.db.prepare(only ? 'DELETE FROM arcade_errors WHERE resolved = 1' : 'DELETE FROM arcade_errors').run();
    res.json({ ok: true });
  }));
  router.delete('/admin/visits', requireAdmin, send((req, res) => {
    db.db.prepare('DELETE FROM arcade_visits').run();
    res.json({ ok: true });
  }));
  // Lets the tests check that a real crash is logged and answered with a code.
  if (process.env.NODE_ENV === 'test') router.get('/_boom', send(() => { throw new Error('Test explosion 1234'); }));
  return router;
}

const where = req => `${req.method} ${(req.baseUrl || '') + (req.route ? req.route.path : req.path)}`;

// Many routes catch their own errors and answer 500 themselves. This sees
// those answers on the way out, so they land in the log (with a code the
// player sees) no matter which part of the arcade sent them.
function watchResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 500 && !res.locals.errorLogged && body && typeof body.error === 'string') {
      try {
        const code = recordError({ source: 'server', game: gameOfUrl(req.originalUrl), message: body.error, location: where(req), ua: req.get('User-Agent') });
        body = { ...body, error: `${body.error} (${code})`, code };
      } catch { /* answer anyway */ }
    }
    return json(body);
  };
  next();
}

// Server crashes: an Express error handler that logs the error, then tells
// the player something went wrong along with its code.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status < 500) return res.status(status).json({ error: err.expose === false ? 'Bad request.' : err.message || 'Bad request.' });
  let code = '';
  try {
    code = recordError({
      source: 'server', game: gameOfUrl(req.originalUrl), message: err.message || String(err),
      location: where(req),
      stack: err.stack || '', ua: req.get('User-Agent')
    });
  } catch { /* the log itself failed; still answer */ }
  console.error(`[${code || 'error'}]`, err);
  res.locals.errorLogged = true;
  res.status(500).json({ error: `Something went wrong on the server${code ? ` (${code})` : ''}.`, code });
}

function gameOfUrl(url) {
  const m = /^\/api\/([a-z]+)/.exec(String(url || ''));
  return m && homeGames.GAMES.includes(m[1]) ? m[1] : '';
}

// Crashes outside any request (timers, rooms). Logged, then Node does what it
// would have done anyway.
function watchProcess() {
  process.on('uncaughtExceptionMonitor', err => {
    try { recordError({ source: 'server', message: err && err.message || String(err), location: 'process', stack: err && err.stack || '' }); } catch { /* exiting anyway */ }
  });
}

module.exports = { routes, errorHandler, watchResponses, watchProcess, recordError, startVisit, beat, summary, codeFor, deviceOf, gameOrder };
