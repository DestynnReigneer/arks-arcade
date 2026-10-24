'use strict';

// /api/spinsolve: puzzle levels and packs, theme requests, and the admin side
// of building packs (copy a prompt, paste the AI's answer back). The game
// itself runs in the browser.

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const adultPin = require('../arcade/adult-pin');
const P = require('./puzzles');
const banter = require('./banter');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS spin_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🎡',
    level TEXT NOT NULL DEFAULT 'kids',
    puzzles TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS spin_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    pack_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const unlocked = req => adultPin.matches(req.get('X-Adult-Pin') || '');

function rowToPack(r, withPuzzles = false) {
  const puzzles = JSON.parse(r.puzzles);
  return {
    id: r.id, label: r.label, emoji: r.emoji, level: r.level, adult: P.LEVELS[r.level].adult,
    count: puzzles.length, createdAt: r.created_at, ...(withPuzzles ? { puzzles } : {})
  };
}
const allPacks = () => db.db.prepare('SELECT * FROM spin_packs ORDER BY created_at DESC, id DESC').all();

function requireLevel(level, req) {
  if (P.LEVELS[level].adult && !unlocked(req)) throw fail('That PIN is not right.', 403);
}

module.exports = function spinRoutes({ requireAdmin, notify }) {
  const router = express.Router();

  // Levels, and the packs you're allowed to see: adult packs only once unlocked.
  router.get('/config', (req, res) => {
    const open = unlocked(req);
    res.json({
      levels: Object.values(P.LEVELS).map(l => ({ ...l, builtin: P.BUILTIN[l.id].length })),
      adultRequiresPin: adultPin.status().set,
      packs: allPacks().map(r => rowToPack(r)).filter(p => !p.adult || open)
    });
  });

  router.post('/unlock', adultPin.tryLimiter(), (req, res) => {
    res.json(adultPin.check(req, res));
  });

  // The puzzles for a game: one pack, or every built-in and pack puzzle at a level.
  router.get('/puzzles', (req, res, next) => {
    try {
      const packId = Number(req.query.pack);
      if (packId) {
        const row = db.db.prepare('SELECT * FROM spin_packs WHERE id = ?').get(packId);
        if (!row) throw fail('That puzzle pack is gone.', 404);
        requireLevel(row.level, req);
        const pack = rowToPack(row, true);
        return res.json({ level: row.level, puzzles: pack.puzzles.map(p => ({ ...p, pack: pack.label })), banter: banter.forLevel(row.level) });
      }
      const level = P.levelOf(req.query.level);
      requireLevel(level, req);
      const fromPacks = allPacks().filter(r => r.level === level)
        .flatMap(r => JSON.parse(r.puzzles).map(p => ({ ...p, pack: r.label })));
      res.json({ level, puzzles: [...P.BUILTIN[level], ...fromPacks], banter: banter.forLevel(level) });
    } catch (e) { next(e); }
  });

  const requestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many theme requests. Try again later.' }
  });

  router.post('/requests', requestLimiter, (req, res) => {
    const body = req.body || {};
    const topic = clean(body.topic, 60);
    if (!topic) return res.status(400).json({ error: 'Please enter a theme idea.' });
    const request = { topic, note: clean(body.note, 200), requestedBy: clean(body.requestedBy, 30) };
    const info = db.db.prepare('INSERT INTO spin_requests (topic, note, requested_by) VALUES (?, ?, ?)')
      .run(request.topic, request.note, request.requestedBy);
    notify(request, 'Spin & Solve');
    res.status(201).json({ id: Number(info.lastInsertRowid), ...request });
  });

  // ---- admin ------------------------------------------------------------------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/requests', (req, res) => {
    const status = ['pending', 'done', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
    res.json(db.db.prepare('SELECT * FROM spin_requests WHERE status = ? ORDER BY created_at DESC').all(status).map(r => ({
      id: r.id, topic: r.topic, note: r.note, requestedBy: r.requested_by, status: r.status, packId: r.pack_id, createdAt: r.created_at
    })));
  });

  admin.post('/requests/:id/dismiss', (req, res) => {
    const info = db.db.prepare("UPDATE spin_requests SET status = 'dismissed' WHERE id = ? AND status = 'pending'").run(Number(req.params.id));
    if (!info.changes) return res.status(400).json({ error: 'Request not found or already handled.' });
    res.json({ dismissed: true });
  });

  admin.get('/packs', (req, res) => {
    res.json(allPacks().map(r => rowToPack(r, true)));
  });

  admin.post('/packs', (req, res, next) => {
    try {
      const body = req.body || {};
      const label = clean(body.label, 40);
      if (!label) throw fail('Give the pack a name.');
      const level = P.levelOf(body.level);
      const { puzzles, skipped } = P.checkAll(body.puzzles);
      if (puzzles.length < 5) {
        throw fail(`Need at least 5 usable puzzles (got ${puzzles.length}).` +
          (skipped.length ? ` Skipped: ${skipped.slice(0, 3).map(s => `${s.answer} (${s.reason})`).join('; ')}` : ''));
      }
      const emoji = clean(body.emoji, 8) || '🎡';
      const info = db.db.prepare('INSERT INTO spin_packs (label, emoji, level, puzzles) VALUES (?, ?, ?, ?)')
        .run(label, emoji, level, JSON.stringify(puzzles));
      const id = Number(info.lastInsertRowid);
      const requestId = Number(body.requestId);
      if (requestId) {
        db.db.prepare("UPDATE spin_requests SET status = 'done', pack_id = ? WHERE id = ? AND status = 'pending'").run(id, requestId);
      }
      // Adult packs stay off the home page, like adult Wordless themes.
      if (!P.LEVELS[level].adult) {
        comm.safePost({
          kind: 'theme', emoji, game: 'spinsolve',
          title: `New Spin & Solve puzzles: ${label}`,
          body: `${puzzles.length} new ${label} puzzles are ready to spin. Pick "${label}" from the puzzle list.`
        });
      }
      res.status(201).json({ pack: rowToPack(db.db.prepare('SELECT * FROM spin_packs WHERE id = ?').get(id)), skipped });
    } catch (e) { next(e); }
  });

  admin.delete('/packs/:id', (req, res) => {
    db.db.prepare('DELETE FROM spin_packs WHERE id = ?').run(Number(req.params.id));
    res.json({ deleted: true });
  });

  router.use('/admin', admin);
  router.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return router;
};
