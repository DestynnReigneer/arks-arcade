'use strict';

// The HTTP side of a party card game (Uh-Oh: Part Deux, Dare Devil): one
// phone or a phone each, adult levels behind the PIN for hosting and a
// lobby password for joining. Each game passes in its tables and config.

const express = require('express');
const rateLimit = require('express-rate-limit');
const adultPin = require('./adult-pin');
const adultJoin = require('./adult-join');
const roomPassword = require('./room-password');

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function makeRoutes({ tables, config }) {
  const router = express.Router();
  // Hosting adult content needs an ARKS ID adult pass; joining someone's adult room
  // needs only that room's lobby password.
  const assertLevelAllowed = (level, req) => {
    if (!tables.isAdult(level)) return;
    if (!adultPin.matches(req.get('X-Adult-Pin') || '')) throw fail('Adult levels need an adult signed in with ARKS ID.', 403);
  };
  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many new games at once.' } });
  const creds = req => [req.params.code, (req.body || {}).playerId || req.query.playerId, (req.body || {}).token || req.query.token];
  const token = req => req.get('X-Table-Token');
  // Who someone is in the family comes from the X-Profile-Token header, never the address.
  const profileOf = req => require('./profiles').verify(req.get('X-Profile-Token')) || null;
  const listLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little, then try again.' } });
  const seatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little, then try again.' } });
  const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little, then try again.' } });
  // List Hosted Games: the rooms this person can see and join.
  router.get('/lobbies', listLimiter, (req, res) => res.json({ lobbies: tables.lobbies(profileOf(req)) }));
  // The lobby: Ready, the chat, and the host's Mute and Remove Player.
  router.post('/rooms/:code/lobby-ready', seatLimiter, (req, res, next) => { try { tables.lobbyReady(...creds(req), (req.body || {}).ready !== false); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/chat', chatLimiter, (req, res, next) => { try { tables.say(...creds(req), (req.body || {}).text); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/mute', seatLimiter, (req, res, next) => { try { tables.mute(...creds(req), (req.body || {}).seat, !!(req.body || {}).on); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/rooms/:code/remove', seatLimiter, (req, res, next) => { try { tables.remove(...creds(req), (req.body || {}).seat); res.json({ ok: true }); } catch (e) { next(e); } });

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
      // screen: a TV hosts the room and shows the table; it doesn't play.
      const { table, player } = tables.createRoom({ name: body.name, level: body.level, drinking: body.drinking, password: body.password, options: body.options, screen: body.screen === true,
        profile: profileOf(req), who: body.who, allowed: body.allowed });
      res.status(201).json({ code: table.id, playerId: player.id, token: player.token });
    } catch (e) { next(e); }
  });
  // Guests get into a adults room with its lobby password; a phone signed
  // in to ARKS ID as a kid, a teen or a TV doesn't, whatever it types.
  router.post('/rooms/:code/join', limiter, async (req, res, next) => {
    try {
      const body = req.body || {};
      await adultJoin.refuseKids(req, tables.isAdult(tables.room(req.params.code).level));
      const { table, player } = tables.joinRoom(req.params.code, body.name, body.password, profileOf(req));
      res.status(201).json({ code: table.id, playerId: player.id, token: player.token });
    } catch (e) { next(e); }
  });
  // Passing one phone around: more players on it, or taking one off again.
  router.post('/rooms/:code/seats', (req, res, next) => { try { res.status(201).json(tables.addSeat(...creds(req), (req.body || {}).name)); } catch (e) { next(e); } });
  router.post('/rooms/:code/seats/remove', (req, res, next) => { try { tables.removeSeat(...creds(req), (req.body || {}).seat); res.json({ ok: true }); } catch (e) { next(e); } });
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
