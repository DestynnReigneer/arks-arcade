'use strict';

// /api/chess: games on two phones. Playing the computer and pass-and-play
// happen entirely in the browser and never touch the server.
//
// A seat is proven with its playerId and token. Who someone is in the family
// comes from the X-Profile-Token header, never the address: it's what lets a
// host invite people and lets a seat follow its profile to another device.

const express = require('express');
const rateLimit = require('express-rate-limit');
const rooms = require('./rooms');

const router = express.Router();
const profiles = () => require('../arcade/profiles');
const profileOf = req => profiles().verify(req.get('X-Profile-Token')) || null;

const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many new games at once. Try again in a few minutes.' }
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Slow down a little, then try again.' }
});

const b = req => req.body || {};
const auth = req => [req.params.code, b(req).playerId, b(req).token];
const wrap = fn => (req, res, next) => { try { res.json(fn(req, res)); } catch (e) { next(e); } };

router.post('/rooms', createLimiter, (req, res, next) => {
  try {
    res.status(201).json(rooms.create({ name: b(req).name, color: b(req).color, profile: profileOf(req) }));
  } catch (e) { next(e); }
});

router.post('/rooms/:code/join', createLimiter, wrap(req => rooms.join(req.params.code, b(req).name, profileOf(req))));

// Your seat on this device too (your profile proves it's yours).
router.post('/rooms/:code/seat', createLimiter, wrap(req => {
  const profile = profileOf(req);
  if (!profile) throw Object.assign(new Error('Pick your profile first.'), { status: 401 });
  return rooms.seatFor(req.params.code, profile);
}));

router.post('/rooms/:code/settings', wrap(req => rooms.setSettings(...auth(req), { color: b(req).color })));
router.post('/rooms/:code/start', wrap(req => rooms.start(...auth(req))));
router.post('/rooms/:code/invite', createLimiter, wrap(req => rooms.invite(...auth(req), b(req).to)));
router.post('/rooms/:code/chat', chatLimiter, wrap(req => rooms.say(...auth(req), b(req).text)));
router.post('/rooms/:code/mute', wrap(req => rooms.mute(...auth(req), b(req).seat, !!b(req).on)));
router.post('/rooms/:code/leave', wrap(req => rooms.leave(...auth(req))));

router.post('/rooms/:code/move', wrap(req => {
  const { from, to, promo } = b(req);
  return rooms.move(...auth(req), { from, to, promo });
}));

router.post('/rooms/:code/act', wrap(req => rooms.act(...auth(req), b(req).action)));

router.get('/rooms/:code', wrap(req => {
  const r = rooms.room(req.params.code);
  const p = rooms.authenticate(r, req.query.playerId, req.query.token);
  return rooms.snapshot(r, p.id);
}));

router.get('/rooms/:code/events', (req, res, next) => {
  try { rooms.subscribe(req.params.code, req.query.playerId, req.query.token, res); } catch (e) { next(e); }
});

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = router;
