'use strict';

// The Continue row on the home page: the games one person has in progress.
//
// It only ever answers for the person asking. Who that is comes from their
// own profile token, never from an id in the address, so nobody can look up
// someone else's games. Without a profile there's nothing to list.
//
// Each game that keeps its progress on the server adds itself to SOURCES with
// a function that takes a profile and hands back its unfinished games as
// { game, title, detail, href, yourTurn, updatedAt }.

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
    return {
      game: 'crisscross',
      title: others.length ? `Words with Family with ${others.join(', ')}` : 'Words with Family',
      detail, href: `crisscross.html?game=${encodeURIComponent(g.id)}`, yourTurn: !!g.yourTurn, updatedAt: g.updatedAt
    };
  });
}

// Sudoku and Clueless Crosswords are daily puzzles, so only today's count:
// yesterday's puzzle is gone at midnight.
function daily(game, name, page) {
  return profile => require(`../${game}/routes`).inProgress(profile.id).map(r => ({
    game,
    title: `${name}, today's ${r.label}`,
    detail: `${clock(r.playMs)} on the clock`,
    href: `${page}?level=${encodeURIComponent(r.level)}`, yourTurn: false, updatedAt: r.updatedAt
  }));
}

const SOURCES = [wordsWithFamily, daily('sudoku', 'Sudoku', 'sudoku.html'), daily('clueless', 'Clueless Crosswords', 'clueless.html')];

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

module.exports = { router, listFor };
