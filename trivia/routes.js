'use strict';

// /api/trivia: Know-It-All's questions, rooms, theme requests, and the admin
// side (packs from an AI prompt, the Open Trivia DB download).

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('../arcade/comm');
const adultPin = require('../arcade/adult-pin');
const bank = require('./bank');
const store = require('./store');
const rooms = require('./rooms');

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const unlocked = req => adultPin.matches(req.get('X-Adult-Pin') || (req.body && req.body.adultPin) || '');
function requireLevel(level, req) {
  if (bank.LEVELS[level].adult && !unlocked(req)) throw fail('That PIN is not right.', 403);
}
const extrasFor = level => bank.LEVELS[level].adult ? { drinks: bank.DRINKS[level], dares: bank.DARES[level] } : { drinks: null, dares: null };
const CREDIT = 'Some questions from Open Trivia DB (opentdb.com), licensed CC BY-SA 4.0.';

module.exports = function triviaRoutes({ requireAdmin, notify }) {
  const router = express.Router();

  // Levels, genres per level (adult ones only once unlocked), and packs.
  router.get('/config', (req, res) => {
    const open = unlocked(req);
    const levels = Object.values(bank.LEVELS).map(l => ({
      ...l, genres: !l.adult || open ? store.genres(l.id) : []
    }));
    res.json({
      levels,
      adultRequiresPin: adultPin.status().set,
      packs: store.listPacks().filter(p => !p.adult || open),
      online: store.status(),
      credit: CREDIT
    });
  });

  router.post('/unlock', adultPin.tryLimiter(), (req, res) => res.json(adultPin.check(req, res)));

  // Questions for a game on this phone (solo or pass-and-play), answers included.
  router.get('/questions', (req, res, next) => {
    try {
      const packId = Number(req.query.pack) || null;
      const pack = packId ? store.packOf(packId) : null;
      const level = pack ? pack.level : bank.levelOf(req.query.level);
      requireLevel(level, req);
      const settings = rooms.cleanSettings({ ...req.query, level, genres: String(req.query.genres || '').split(',').filter(Boolean) });
      const questions = store.pick({ level, genres: settings.genres, difficulty: settings.difficulty, count: settings.count, packId }).map(store.deal);
      res.json({ level, questions, ...extrasFor(level) });
    } catch (e) { next(e); }
  });

  const requestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Try again later.' } });
  router.post('/requests', requestLimiter, (req, res) => {
    const body = req.body || {};
    const topic = clean(body.topic, 60);
    if (!topic) return res.status(400).json({ error: 'Please enter a topic.' });
    const request = { topic, note: clean(body.note, 200), requestedBy: clean(body.requestedBy, 30) };
    const info = db.db.prepare('INSERT INTO trivia_requests (topic, note, requested_by) VALUES (?, ?, ?)').run(request.topic, request.note, request.requestedBy);
    notify(request, 'Know-It-All');
    res.status(201).json({ id: Number(info.lastInsertRowid), ...request });
  });

  // ---- rooms ----------------------------------------------------------------------
  const createLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many new games at once.' } });
  const creds = req => [req.params.code, (req.body || {}).playerId, (req.body || {}).token];

  router.post('/rooms', createLimiter, (req, res, next) => {
    try {
      const body = req.body || {};
      const settings = rooms.cleanSettings(body.settings || {});
      requireLevel(settings.level, req);
      res.status(201).json(rooms.create({ name: body.name, settings, password: body.password }));
    } catch (e) { next(e); }
  });
  // Guests don't need the adult PIN: an adult game's own lobby password lets them in.
  router.post('/rooms/:code/join', createLimiter, (req, res, next) => {
    try { res.json(rooms.join(req.params.code, (req.body || {}).name, (req.body || {}).password)); } catch (e) { next(e); }
  });
  router.post('/rooms/:code/start', (req, res, next) => { try { rooms.start(...creds(req)); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/answer', (req, res, next) => { try { rooms.answer(...creds(req), (req.body || {}).choice); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/next', (req, res, next) => { try { rooms.next(...creds(req)); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/leave', (req, res, next) => { try { rooms.leave(...creds(req)); res.json({ ok: true }); } catch (e) { next(e); } });
  router.get('/rooms/:code', (req, res, next) => {
    try {
      const r = rooms.room(req.params.code);
      const p = rooms.authenticate(r, req.query.playerId, req.query.token);
      res.json(rooms.snapshot(r, p.id));
    } catch (e) { next(e); }
  });
  router.get('/rooms/:code/events', (req, res, next) => {
    try { rooms.subscribe(req.params.code, req.query.playerId, req.query.token, res); } catch (e) { next(e); }
  });

  // ---- admin -------------------------------------------------------------------------
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.get('/requests', (req, res) => {
    const status = ['pending', 'done', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
    res.json(db.db.prepare('SELECT * FROM trivia_requests WHERE status = ? ORDER BY created_at DESC').all(status).map(r => ({
      id: r.id, topic: r.topic, note: r.note, requestedBy: r.requested_by, status: r.status, packId: r.pack_id, createdAt: r.created_at
    })));
  });
  admin.post('/requests/:id/dismiss', (req, res) => {
    const info = db.db.prepare("UPDATE trivia_requests SET status = 'dismissed' WHERE id = ? AND status = 'pending'").run(Number(req.params.id));
    if (!info.changes) return res.status(400).json({ error: 'Request not found or already handled.' });
    res.json({ dismissed: true });
  });
  admin.get('/packs', (req, res) => res.json(store.listPacks()));
  admin.post('/packs', (req, res, next) => {
    try {
      const body = req.body || {};
      const made = store.createPack(body);
      const requestId = Number(body.requestId);
      if (requestId) db.db.prepare("UPDATE trivia_requests SET status = 'done', pack_id = ? WHERE id = ? AND status = 'pending'").run(made.pack.id, requestId);
      if (!made.pack.adult) {
        comm.safePost({
          kind: 'theme', emoji: made.pack.emoji, game: 'trivia',
          title: `New Know-It-All questions: ${made.pack.label}`,
          body: `${made.pack.count} new ${made.pack.label} questions are ready. Think you know it all?`
        });
      }
      res.status(201).json(made);
    } catch (e) { next(e); }
  });
  admin.delete('/packs/:id', (req, res) => { store.deletePack(Number(req.params.id)); res.json({ deleted: true }); });
  admin.get('/online', (req, res) => res.json(store.status()));
  admin.post('/online/sync', (req, res) => {
    store.syncOpenTdb({ force: true });
    res.json({ ...store.status(), running: true });
  });

  router.use('/admin', admin);
  router.use((err, req, res, next) => { res.status(err.status || 500).json({ error: err.message, ...require('../arcade/room-password').extra(err) }); });
  return router;
};
