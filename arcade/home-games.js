'use strict';

// Which games the home page shows, and in what order. Set from the admin
// page's Arcade tab; the home page reads it from /api/arcade-info. A game
// added in a later release (not in the saved order yet) goes on the end.
// With sort 'played' (the default) the home page puts the most-played games
// first (see stats.gameOrder), and this order only breaks ties.
//
// A closed game is one the admin has turned off while it's being worked on:
// it stays on the home page, faded, with a "Pardon our dust" sign, and its
// page shows the sign instead of the game.

const db = require('../db');

const GAMES = ['wordless', 'rambler', 'spinsolve', 'chess', 'dino', 'trivia', 'partdeux', 'daredevil', 'snake', 'bricks', 'blocks', 'towers'];
const KEY = 'home_games';

function get() {
  const saved = db.getSetting(KEY, null) || {};
  const order = (Array.isArray(saved.order) ? saved.order : []).filter(id => GAMES.includes(id));
  for (const id of GAMES) if (!order.includes(id)) order.push(id);
  const hidden = (Array.isArray(saved.hidden) ? saved.hidden : []).filter(id => GAMES.includes(id));
  const closed = (Array.isArray(saved.closed) ? saved.closed : []).filter(id => GAMES.includes(id));
  const sort = saved.sort === 'fixed' ? 'fixed' : 'played';
  return { order, hidden, closed, sort };
}

// Leaving `closed` out keeps the games that are already closed.
function set({ order, hidden, closed, sort } = {}) {
  const clean = list => [...new Set((Array.isArray(list) ? list : []).filter(id => GAMES.includes(id)))];
  const next = {
    order: clean(order), hidden: clean(hidden),
    closed: closed === undefined ? get().closed : clean(closed),
    sort: sort === 'fixed' ? 'fixed' : 'played'
  };
  if (next.hidden.length >= GAMES.length) {
    throw Object.assign(new Error('Leave at least one game showing.'), { status: 400 });
  }
  db.setSetting(KEY, next);
  return get();
}

module.exports = { GAMES, get, set };
