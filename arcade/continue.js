'use strict';

// The Continue row on the home page: the games one person has in progress.
//
// It only ever answers for the person asking. Who that is comes from their
// own profile token, never from an id in the address, so nobody can look up
// someone else's games. Without a profile there's nothing to list.
//
// Each game that keeps its progress on the server adds itself to SOURCES with
// a function that takes a profile and hands back its unfinished games as
// { game, ref, leave, others, title, detail, href, yourTurn, updatedAt }. ref is what
// POST /leave needs to find that game again, and leave says what leaving does
// there, so the page can ask the right question (others: who else is in it).

const express = require('express');
const rateLimit = require('express-rate-limit');

const profiles = () => require('./profiles');
const MAX_ROWS = 12;

const clock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function wordsWithFamily(profile) {
  const { games } = require('../crisscross/games').mine(profile);
  return games.filter(g => g.status !== 'over').map(g => {
    const others = g.players.filter(p => !p.you && !p.bot).map(p => p.name);
    const turn = g.status === 'playing' && g.players[g.turn] ? g.players[g.turn] : null;
    let detail = 'Waiting for players';
    if (g.yourTurn) detail = 'Your move';
    else if (turn) detail = `${turn.bot ? 'The computer' : turn.name}'s move`;
    // Your own lobby closes when you leave it; someone else's you just leave.
    // In a game, two players means it ends; with more, the others play on.
    const leave = g.status !== 'playing' ? (g.host ? 'close' : 'lobby') : others.length === 1 ? 'ends' : 'continues';
    return {
      game: 'crisscross', ref: g.id, leave, others,
      title: others.length ? `Words with Family with ${others.join(', ')}` : 'Words with Family',
      detail, href: `crisscross.html?game=${encodeURIComponent(g.id)}`, yourTurn: !!g.yourTurn, updatedAt: g.updatedAt
    };
  });
}

// Sudoku and Clueless Crosswords are daily puzzles, so only today's count:
// yesterday's puzzle is gone at midnight.
function daily(game, name, page) {
  return profile => require(`../${game}/routes`).inProgress(profile.id).map(r => ({
    game, ref: r.level, leave: 'give-up',
    title: `${name}, today's ${r.label} Challenge`,
    detail: `${clock(r.playMs)} played so far`,
    href: `${page}?level=${encodeURIComponent(r.level)}`, yourTurn: false, updatedAt: r.updatedAt
  }));
}

// Chess on two phones, saved since the lobby came in (chess/rooms.js).
function chess(profile) {
  return require('../chess/rooms').mine(profile).map(g => ({
    game: 'chess', ref: g.code, leave: 'resign', others: g.opponent ? [g.opponent] : [],
    title: g.opponent ? `Chess with ${g.opponent}` : 'Chess',
    detail: g.yourTurn ? 'Your move' : `${g.opponent || 'Their'}'s move`,
    href: `chess.html?room=${encodeURIComponent(g.code)}`, yourTurn: g.yourTurn, updatedAt: g.updatedAt
  }));
}

// Spin & Solve: a game that was played and left, kept through a restart (spinsolve/game.js).
// The three touched last, so a pile of abandoned games doesn't crowd the row.
function spinSolve(profile) {
  return require('../spinsolve/game').mine(profile.id).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3).map(g => ({
    game: 'spinsolve', ref: g.id, leave: 'end',
    title: g.solo ? 'Spin & Solve' : `Spin & Solve with ${g.names.slice(1).join(', ')}`,
    detail: `Round ${g.round} of ${g.rounds}${g.solo ? `, $${g.total.toLocaleString('en-US')} so far` : ''}`,
    href: `spinsolve.html?game=${encodeURIComponent(g.id)}`, yourTurn: false, updatedAt: g.updatedAt
  }));
}

const SOURCES = [wordsWithFamily, chess, spinSolve, daily('sudoku', 'Sudoku', 'sudoku.html'), daily('clueless', 'Clueless Crosswords', 'clueless.html')];

// Games waiting on you first, then whatever was touched last.
function listFor(profile) {
  const rows = [];
  for (const source of SOURCES) {
    try { rows.push(...source(profile)); } catch { /* one game's trouble doesn't hide the others */ }
  }
  rows.sort((a, b) => (b.yourTurn - a.yourTurn) || (b.updatedAt - a.updatedAt));
  return rows.slice(0, MAX_ROWS);
}

const router = express.Router();
const limit = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  message: { error: 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.' }
});
router.get('/', limit, (req, res) => {
  const profile = profiles().verify(req.get('X-Profile-Token'));
  res.set('Cache-Control', 'no-store').json({ games: profile ? listFor(profile) : [] });
});

// Leaving a game from the Continue row (press and hold its row). Each game is left
// the way its own page leaves it, as the person asking: the profile token says who
// that is, and each game checks they're really in it.
const LEAVE = {
  crisscross: (profile, ref) => {
    const games = require('../crisscross/games');
    games.act(ref, { profile, key: '' }, games.moves.resign());
  },
  chess: (profile, ref) => {
    const rooms = require('../chess/rooms');
    const seat = rooms.seatFor(ref, profile);
    rooms.act(ref, seat.playerId, seat.token, 'resign');
  },
  spinsolve: (profile, ref) => {
    const game = require('../spinsolve/game');
    const g = game.games.get(ref);
    if (g && g.profileId === profile.id) game.drop(ref);
  },
  // Giving up a daily puzzle throws away today's unfinished run, so opening it
  // again starts over from the beginning with a new clock (the maintainer's call).
  sudoku: (profile, ref) => require('../sudoku/routes').giveUp(profile.id, ref),
  clueless: (profile, ref) => require('../clueless/routes').giveUp(profile.id, ref)
};

router.post('/leave', limit, (req, res) => {
  const profile = profiles().verify(req.get('X-Profile-Token'));
  if (!profile) return res.status(401).json({ error: 'Pick your profile first.' });
  const { game, ref } = req.body || {};
  const leave = Object.hasOwn(LEAVE, String(game)) ? LEAVE[game] : null;
  if (!leave || typeof ref !== 'string' || !ref || ref.length > 64) {
    return res.status(400).json({ error: 'That game can\'t be left from here.' });
  }
  try {
    leave(profile, ref);
  } catch (err) {
    // A game that's already over or gone is what leaving wanted anyway.
    const status = err && err.status;
    if (status !== 404 && status !== 409) {
      return res.status(status || 500).json({ error: status ? err.message : 'That didn\'t work. Try again in a moment.' });
    }
  }
  res.set('Cache-Control', 'no-store').json({ ok: true, games: listFor(profile) });
});

module.exports = { router, listFor };
