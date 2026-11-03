'use strict';

// /api/scuffle: Shuffle Scuffle's solo games, the daily board and rooms.

const express = require('express');
const rateLimit = require('express-rate-limit');
const adultPin = require('../arcade/adult-pin');
const adultJoin = require('../arcade/adult-join');
const roomPassword = require('../arcade/room-password');
const { today } = require('../rambler/progress');
const game = require('./game');
const solo = require('./solo');
const rooms = require('./rooms');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// The grown-up word list needs the adult PIN (or, with ARKS ID, an adult
// pass), checked on every path that could reach it. Guests joining a room
// don't need it: the room's own lobby password lets them in.
function assertDictionary(dictionary, req) {
  if (game.profileOf(dictionary) !== 'adult') return;
  const supplied = req.get('X-Adult-Pin') || (req.body && req.body.adultPin) || '';
  if (!adultPin.matches(supplied)) throw fail('That PIN is not right.', 403);
}

function nextMidnight(now = new Date()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

const router = express.Router();
const limiter = (limit, windowMin = 10, message = 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.') =>
  rateLimit({ windowMs: windowMin * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: message } });
const startLimit = limiter(120), wordLimit = limiter(3000), saveLimit = limiter(30), roomLimit = limiter(40, 10, 'Too many new games at once.');
const body = req => req.body || {};
const wrap = fn => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

router.get('/config', (req, res) => res.json({
  day: today(), resetsAt: nextMidnight().toISOString(),
  rounds: game.ROUND_CHOICES, seconds: game.SECOND_CHOICES,
  defaultRounds: game.DEFAULT_ROUNDS, defaultSeconds: game.DEFAULT_SECONDS,
  daily: game.DAILY, points: game.POINTS, fullBonus: game.FULL_BONUS, firstBonus: game.FIRST_BONUS,
  adultRequiresPin: adultPin.status().set, maxPlayers: rooms.MAX_PLAYERS
}));
router.post('/unlock', adultPin.tryLimiter(), (req, res) => res.json(adultPin.check(req, res)));

// ---- on your own ------------------------------------------------------------------
router.post('/solo', startLimit, (req, res, next) => {
  try {
    assertDictionary(body(req).dictionary, req);
    res.status(201).json(solo.start(body(req)));
  } catch (e) { next(e); }
});
router.get('/solo/:id', wrap(req => solo.view(req.params.id)));
router.post('/solo/:id/next', wordLimit, wrap(req => solo.next(req.params.id)));
router.post('/solo/:id/word', wordLimit, wrap(req => solo.word(req.params.id, body(req).word)));
router.post('/solo/:id/stop', wordLimit, wrap(req => solo.stop(req.params.id)));
router.post('/solo/:id/save', saveLimit, (req, res, next) => {
  try { res.status(201).json(solo.save(req.params.id, body(req))); } catch (e) { next(e); }
});
router.get('/board', wrap(req => solo.board({ scope: req.query.scope, day: req.query.day, limit: req.query.limit, dictionary: req.query.dictionary })));
// Which of today's dailies this profile has finished. A POST, so the profile
// token stays out of the address.
router.post('/daily-status', startLimit, wrap(req => solo.dailyStatus(body(req))));

// ---- rooms ---------------------------------------------------------------------------
const creds = req => [req.params.code, body(req).playerId, body(req).token];
router.post('/rooms', roomLimit, (req, res, next) => {
  try {
    const settings = rooms.cleanSettings(body(req).settings || {});
    assertDictionary(settings.dictionary, req);
    // screen: a TV hosts the room and shows it; it doesn't play.
    res.status(201).json(rooms.create({ name: body(req).name, settings, password: body(req).password, screen: body(req).screen === true }));
  } catch (e) { next(e); }
});
// A phone signed in to ARKS ID as a kid, a teen or a TV can't join a room on the unfiltered list.
router.post('/rooms/:code/join', roomLimit, async (req, res, next) => {
  try {
    await adultJoin.refuseKids(req, rooms.room(req.params.code).settings.dictionary === 'adult');
    res.json(rooms.join(req.params.code, body(req).name, body(req).password));
  } catch (e) { next(e); }
});
router.post('/rooms/:code/settings', (req, res, next) => {
  try {
    const s = body(req).settings || {};
    if (s.dictionary !== undefined) assertDictionary(s.dictionary, req);
    rooms.updateSettings(...creds(req), { ...s, password: body(req).password });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.post('/rooms/:code/start', wrap(req => { rooms.start(...creds(req)); return { ok: true }; }));
router.post('/rooms/:code/word', wordLimit, wrap(req => rooms.word(...creds(req), body(req).word)));
router.post('/rooms/:code/done', wrap(req => { rooms.done(...creds(req)); return { ok: true }; }));
router.post('/rooms/:code/next', wrap(req => { rooms.next(...creds(req)); return { ok: true }; }));
router.post('/rooms/:code/leave', wrap(req => { rooms.leave(...creds(req)); return { ok: true }; }));
router.get('/rooms/:code', wrap(req => {
  const r = rooms.room(req.params.code);
  return rooms.snapshot(r, rooms.authenticate(r, req.query.playerId, req.query.token).id);
}));
router.get('/rooms/:code/events', (req, res, next) => {
  try { rooms.subscribe(req.params.code, req.query.playerId, req.query.token, res); } catch (e) { next(e); }
});

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message, ...roomPassword.extra(err) });
});

module.exports = router;
