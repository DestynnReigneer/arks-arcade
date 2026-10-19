'use strict';

// /api/chess: two-phone games. Playing the computer and pass-and-play happen
// entirely in the browser and never touch the server.

const express = require('express');
const rateLimit = require('express-rate-limit');
const rooms = require('./rooms');

const router = express.Router();

const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many new games at once. Try again in a few minutes.' }
});

const auth = req => [req.params.code, (req.body || {}).playerId, (req.body || {}).token];

router.post('/rooms', createLimiter, (req, res, next) => {
  try {
    const body = req.body || {};
    res.status(201).json(rooms.create({ name: body.name, color: body.color }));
  } catch (e) { next(e); }
});

router.post('/rooms/:code/join', createLimiter, (req, res, next) => {
  try { res.json(rooms.join(req.params.code, (req.body || {}).name)); } catch (e) { next(e); }
});

router.post('/rooms/:code/move', (req, res, next) => {
  try {
    const [code, playerId, token] = auth(req);
    const { from, to, promo } = req.body || {};
    res.json(rooms.move(code, playerId, token, { from, to, promo }));
  } catch (e) { next(e); }
});

router.post('/rooms/:code/act', (req, res, next) => {
  try {
    const [code, playerId, token] = auth(req);
    res.json(rooms.act(code, playerId, token, (req.body || {}).action));
  } catch (e) { next(e); }
});

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

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = router;
