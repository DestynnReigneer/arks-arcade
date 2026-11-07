'use strict';

// A jackpot the whole arcade plays for, for the 3D cabinet games that have one (Bucket Drop so far). It grows a little
// after every game and goes back to its starting amount when someone wins it. It's kept in the settings table, so it
// survives a restart.
//
// These games send their own score (the deliberate exception to "the server decides every score"), so the jackpot is
// also how the board checks a jackpot score: it must be exactly the game's best normal score plus a jackpot that was
// really won here, a short time ago, and each win can be saved once.

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

// start: what it goes back to; step: what each game adds; base: the best score a game can make without the jackpot.
const JACKPOTS = {
  // 50 balls at 10 points, plus 25 for every 5 in a row: catching all 50 means a perfect streak, so exactly 750.
  bucketdrop: { start: 1000, step: 10, base: 750 }
};
const CLAIM_MS = 15 * 60 * 1000;

const key = game => `cab_jackpot_${game}`;
function state(game) {
  const j = JACKPOTS[game];
  const s = db.getSetting(key(game), null) || {};
  return { amount: Number.isFinite(s.amount) && s.amount >= j.start ? s.amount : j.start, won: Array.isArray(s.won) ? s.won : [] };
}
function put(game, s) { db.setSetting(key(game), s); }

// A game just ended. A win records the amount (so it can be saved) and starts the jackpot over; anything else adds to it.
function played(game, won) {
  const j = JACKPOTS[game], s = state(game), now = Date.now();
  s.won = s.won.filter(w => now - w.at < CLAIM_MS);
  if (won) { s.won.push({ amount: s.amount, at: now }); s.amount = j.start; } else s.amount += j.step;
  put(game, s);
  return s.amount;
}

// The board's check for a score from one of these games: up to `base` is a normal game; above it, it must be `base`
// plus a jackpot won in the last 15 minutes, and that win is used up.
function check(game, points) {
  const j = JACKPOTS[game];
  if (points <= j.base) return true;
  const s = state(game), now = Date.now();
  const i = s.won.findIndex(w => now - w.at < CLAIM_MS && j.base + w.amount === points);
  if (i < 0) return false;
  s.won.splice(i, 1); put(game, s);
  return true;
}

const router = express.Router();
const playedLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many games at once. Take a breather.' }
});
const known = (req, res, next) => (JACKPOTS[req.params.game] ? next() : res.status(404).json({ error: 'That game has no jackpot.' }));
router.get('/:game', known, (req, res) => res.json({ amount: state(req.params.game).amount }));
router.post('/:game/played', known, playedLimiter, (req, res) => res.json({ amount: played(req.params.game, !!(req.body && req.body.won)) }));

module.exports = { router, check, played, state, JACKPOTS };
