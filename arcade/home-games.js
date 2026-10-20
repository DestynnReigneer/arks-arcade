'use strict';

// Which games the home page shows, and in what order. Set from the admin
// page's Arcade tab; the home page reads it from /api/arcade-info. A game
// added in a later release (not in the saved order yet) goes on the end.

const db = require('../db');

const GAMES = ['wordless', 'rambler', 'shortfuse', 'spinsolve', 'chess', 'dino', 'trivia', 'partdeux', 'daredevil'];
const KEY = 'home_games';

function get() {
  const saved = db.getSetting(KEY, null) || {};
  const order = (Array.isArray(saved.order) ? saved.order : []).filter(id => GAMES.includes(id));
  for (const id of GAMES) if (!order.includes(id)) order.push(id);
  const hidden = (Array.isArray(saved.hidden) ? saved.hidden : []).filter(id => GAMES.includes(id));
  return { order, hidden };
}

function set({ order, hidden } = {}) {
  const clean = list => [...new Set((Array.isArray(list) ? list : []).filter(id => GAMES.includes(id)))];
  const next = { order: clean(order), hidden: clean(hidden) };
  if (next.hidden.length >= GAMES.length) {
    throw Object.assign(new Error('Leave at least one game showing.'), { status: 400 });
  }
  db.setSetting(KEY, next);
  return get();
}

module.exports = { GAMES, get, set };
