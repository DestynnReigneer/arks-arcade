'use strict';

// The HTTP side of a party card game (Uh-Oh: Part Deux, Dare Devil): one
// phone or a phone each, adult levels behind the PIN for hosting and a
// lobby password for joining. Each game passes in its tables and config.

const express = require('express');
const rateLimit = require('express-rate-limit');
const adultPin = require('./adult-pin');
const roomPassword = require('./room-password');

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function makeRoutes({ tables, config }) {
  const router = express.Router();
  // Hosting adult content needs the adult PIN; joining someone's adult room
  // needs only that room's lobby password.
  const assertLevelAllowed = (level, req) => {
    if (!tables.isAdult(level)) return;
    if (!adultPin.matches(req.get('X-Adult-Pin') || '')) throw fail('That PIN is not right.', 403);
  };
  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many new games at once.' } });
  const creds = req => [req.params.code, (req.body || {}).playerId || req.query.playerId, (req.body || {}).token || req.query.token];
  const token = req => req.get('X-Table-Token');

  router.get('/config', (req, res) => res.json({ ...config(), adultRequiresPin: adultPin.status().set, maxPlayers: tables.MAX_PLAYERS }));
  router.post('/unlock', adultPin.tryLimiter(), (req, res) => res.json(adultPin.check(req, res)));

  router.post('/local', limiter, (req, res, next) => {
    try {
      const body = req.body || {};
      assertLevelAllowed(body.level, req);
      const t = tables.createLocal({ names: body.names, level: body.level, drinking: body.drinking, options: body.options });
      res.status(201).json({ token: t.token, ...tables.localSnapshot(t) });
    } catch (e) { next(e); }
  });
  router.get('/local/:id', (req, res, next) => { try { res.json(tables.localSnapshot(tables.local(req.params.id, token(req)))); } catch (e) { next(e); } });
  router.post('/local/:id/act', (req, res, next) => { try { res.json(tables.actLocal(req.params.id, token(req), req.body || {})); } catch (e) { next(e); } });
  router.post('/local/:id/rematch', (req, res, next) => { try { res.json(tables.rematchLocal(req.params.id, token(req))); } catch (e) { next(e); } });

  router.post('/rooms', limiter, (req, res, next) => {
    try {
      const body = req.body || {};
      assertLevelAllowed(body.level, req);
      const { table, player } = tables.createRoom({ name: body.name, level: body.level, drinking: body.drinking, password: body.password, options: body.options });
      res.status(201).json({ code: table.id, playerId: player.id, token: player.token });
    } catch (e) { next(e); }
  });
  router.post('/rooms/:code/join', limiter, (req, res, next) => {
    try {
      const body = req.body || {};
      const { table, player } = tables.joinRoom(req.params.code, body.name, body.password);
      res.status(201).json({ code: table.id, playerId: player.id, token: player.token });
    } catch (e) { next(e); }
  });
  router.post('/rooms/:code/settings', (req, res, next) => {
    try {
      const body = req.body || {};
      if (body.level !== undefined) assertLevelAllowed(body.level, req);
      tables.settings(...creds(req), { level: body.level, drinking: body.drinking, password: body.password, options: body.options });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  router.post('/rooms/:code/start', (req, res, next) => { try { tables.startRoom(...creds(req)); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/act', (req, res, next) => { try { res.json(tables.actRoom(...creds(req), req.body || {})); } catch (e) { next(e); } });
  router.post('/rooms/:code/leave', (req, res, next) => { try { tables.leaveRoom(...creds(req)); res.json({ ok: true }); } catch (e) { next(e); } });
  router.get('/rooms/:code', (req, res, next) => {
    try {
      const [code, playerId, tok] = creds(req);
      const t = tables.room(code);
      const p = tables.authenticate(t, playerId, tok);
      res.json(tables.roomSnapshot(t, p.id));
    } catch (e) { next(e); }
  });
  router.get('/rooms/:code/events', (req, res, next) => {
    try { tables.subscribe(req.params.code, req.query.playerId, req.query.token, res); } catch (e) { next(e); }
  });

  router.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message, ...roomPassword.extra(err) });
  });
  return router;
}

module.exports = { makeRoutes };
