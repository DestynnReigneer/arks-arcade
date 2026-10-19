'use strict';

// Short Fuse's HTTP surface, mounted at /api/shortfuse. Every adult level goes
// through the same adult PIN as the rest of the arcade.

const express = require('express');
const rateLimit = require('express-rate-limit');
const cards = require('./cards');
const tables = require('./tables');
const adultPin = require('../arcade/adult-pin');

const router = express.Router();

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

function assertLevelAllowed(level, req) {
  const info = cards.LEVELS[cards.levelOf(level)];
  if (!info.adult) return;
  const supplied = req.get('X-Adult-Pin') || (req.body && req.body.adultPin) || '';
  if (!adultPin.matches(supplied)) throw fail('That PIN is not right.', 403);
}

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many games started. Try again later.' }
});

router.get('/config', (req, res) => {
  res.json({
    levels: cards.listLevels(),
    adultRequiresPin: adultPin.status().set,
    maxPlayers: tables.MAX_PLAYERS,
    reactionMs: tables.REACTION_MS,
    rules: cards.RULES
  });
});

// Lets the client check a PIN before it asks for a game with it.
router.post('/unlock', (req, res) => {
  res.json({ ok: adultPin.matches((req.body || {}).pin) });
});

// ---- one phone -------------------------------------------------------------

router.post('/local', createLimiter, (req, res, next) => {
  try {
    const body = req.body || {};
    assertLevelAllowed(body.level, req);
    const t = tables.createLocal({ names: body.names, level: body.level });
    res.status(201).json({ id: t.id, token: t.token, ...tables.localSnapshot(t) });
  } catch (e) { next(e); }
});

router.get('/local/:id', (req, res, next) => {
  try {
    res.json(tables.localSnapshot(tables.localState(req.params.id, req.get('X-Table-Token'))));
  } catch (e) { next(e); }
});

router.post('/local/:id/act', (req, res, next) => {
  try {
    res.json(tables.actLocal(req.params.id, req.get('X-Table-Token'), req.body || {}));
  } catch (e) { next(e); }
});

router.post('/local/:id/rematch', (req, res, next) => {
  try {
    res.json(tables.rematchLocal(req.params.id, req.get('X-Table-Token')));
  } catch (e) { next(e); }
});

// ---- a phone each -----------------------------------------------------------

const creds = req => ({ playerId: (req.body || {}).playerId || req.query.playerId, token: (req.body || {}).token || req.query.token });

router.post('/rooms', createLimiter, (req, res, next) => {
  try {
    const body = req.body || {};
    assertLevelAllowed(body.level, req);
    const { table, player } = tables.createRoom({ name: body.name, level: body.level });
    res.status(201).json({ code: table.id, playerId: player.id, token: player.token });
  } catch (e) { next(e); }
});

router.post('/rooms/:code/join', (req, res, next) => {
  try {
    const { table, player } = tables.joinRoom(req.params.code, (req.body || {}).name);
    res.status(201).json({ code: table.id, playerId: player.id, token: player.token });
  } catch (e) { next(e); }
});

router.post('/rooms/:code/level', (req, res, next) => {
  try {
    const { playerId, token } = creds(req);
    assertLevelAllowed((req.body || {}).level, req);
    tables.setLevel(req.params.code, playerId, token, (req.body || {}).level);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/rooms/:code/start', (req, res, next) => {
  try {
    const { playerId, token } = creds(req);
    tables.startRoom(req.params.code, playerId, token);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/rooms/:code/leave', (req, res, next) => {
  try {
    const { playerId, token } = creds(req);
    tables.leaveRoom(req.params.code, playerId, token);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/rooms/:code/act', (req, res, next) => {
  try {
    const { playerId, token } = creds(req);
    res.json(tables.actRoom(req.params.code, playerId, token, req.body || {}));
  } catch (e) { next(e); }
});

router.get('/rooms/:code', (req, res, next) => {
  try {
    const t = tables.room(req.params.code);
    const p = tables.authenticate(t, req.query.playerId, req.query.token);
    res.json(tables.roomSnapshot(t, p.id));
  } catch (e) { next(e); }
});

router.get('/rooms/:code/events', (req, res, next) => {
  try {
    tables.subscribe(req.params.code, req.query.playerId, req.query.token, res);
  } catch (e) { next(e); }
});

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = router;
