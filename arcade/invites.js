'use strict';

// Invites: asking someone in the family to play, by name, with no code to type.
//
// A game with rooms sends an invite to profiles (send()); each one gets a
// notification on their phone (arcade/push.js, with the sign-in service on) and a
// row in the Invites list at the top of the home page (GET /api/invites). Tapping
// it opens the game's lobby. An invite goes away once that person is in the room,
// or the room is gone.
//
// Who's asking always comes from the profile token, never from the address, so
// nobody can read someone else's invites. Games register a check (register())
// that says whether a room is still open to that person.

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const profiles = () => require('./profiles');
// The most people one invite (or one "Only People Selected" lobby) can name. Games
// with rooms use this same number, so what they accept is what gets checked and sent.
const MAX_TO = 12;
const TTL_MS = 3 * 24 * 60 * 60 * 1000;   // an invite nobody answered fades after 3 days
// A repeat invite to the same room only buzzes the phone again after this long,
// and one person can invite at most PER_HOUR people an hour, so nobody's phone
// can be flooded.
const RENOTIFY_MS = 10 * 60 * 1000;
const PER_HOUR = 20;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS arcade_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    room TEXT NOT NULL,
    from_profile TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_profile TEXT NOT NULL,
    title TEXT NOT NULL,
    href TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (game, room, to_profile)
  );
  CREATE INDEX IF NOT EXISTS arcade_invites_to ON arcade_invites (to_profile);
`);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

let notifier = null;
function setNotifier(fn) { notifier = fn; }

// game -> { open(room, profileId) -> { open: bool, detail } }
const games = new Map();
function register(game, check) { games.set(game, check); }

// Every approved profile but you, for the "choose who to play with" list.
function people(exceptId) {
  return db.db.prepare("SELECT id, name, avatar FROM arcade_profiles WHERE status = 'approved' AND id != ? ORDER BY name COLLATE NOCASE")
    .all(String(exceptId || '')).map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
}

// from: { id, name }. to: profile ids. notify: { title, body } for the phone.
const recentSends = new Map();   // from profile -> times an invite went out
function send({ game, room, from, to, title, href, notify }) {
  const ids = [...new Set((Array.isArray(to) ? to : []).map(String))].filter(id => id && id !== from.id).slice(0, MAX_TO);
  if (!ids.length) throw fail('Choose someone to play with first.');
  // Everyone is checked before anyone is invited.
  const people = ids.map(id => {
    const p = db.db.prepare("SELECT id, name FROM arcade_profiles WHERE id = ? AND status = 'approved'").get(id);
    if (!p) throw fail('One of the people you picked doesn\'t have a profile here anymore.');
    return p;
  });
  const now = Date.now();
  const times = (recentSends.get(from.id) || []).filter(t => now - t < 60 * 60 * 1000);
  if (times.length + people.length > PER_HOUR) throw fail('That\'s a lot of invites in an hour. Give people a chance to answer first.', 429);
  for (const p of people) times.push(now);
  recentSends.set(from.id, times);
  const sent = [];
  for (const p of people) {
    const before = db.db.prepare('SELECT created_at FROM arcade_invites WHERE game = ? AND room = ? AND to_profile = ?').get(game, String(room), p.id);
    const buzz = !before || now - before.created_at >= RENOTIFY_MS;
    db.db.prepare(`INSERT INTO arcade_invites (game, room, from_profile, from_name, to_profile, title, href, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (game, room, to_profile) DO UPDATE SET created_at = CASE WHEN ? THEN excluded.created_at ELSE created_at END, from_name = excluded.from_name`)
      .run(game, String(room), from.id, from.name, p.id, title, href, now, buzz ? 1 : 0);
    sent.push({ id: p.id, name: p.name });
    if (buzz && notifier && notify) {
      try { notifier(p.id, { title: notify.title, body: notify.body, url: href, tag: `inv-${game}-${room}`, kind: 'invite', from: from.id, game: notify.title }); } catch { /* never stops a game */ }
    }
  }
  return sent;
}

// Someone got in, or the room is gone.
// Every invite for a game, for games whose rooms don't survive a restart.
function clearGame(game) {
  db.db.prepare('DELETE FROM arcade_invites WHERE game = ?').run(game);
}

function clear(game, room, profileId) {
  if (profileId) db.db.prepare('DELETE FROM arcade_invites WHERE game = ? AND room = ? AND to_profile = ?').run(game, String(room), String(profileId));
  else db.db.prepare('DELETE FROM arcade_invites WHERE game = ? AND room = ?').run(game, String(room));
}

// Who in a room has been invited and hasn't come in yet (for the lobby's seats).
function pending(game, room) {
  return db.db.prepare(`SELECT i.to_profile AS id, p.name FROM arcade_invites i JOIN arcade_profiles p ON p.id = i.to_profile
    WHERE i.game = ? AND i.room = ? ORDER BY i.id`).all(game, String(room));
}

// One person's invites, newest first. Ones whose room has closed are dropped.
function mine(profileId) {
  db.db.prepare('DELETE FROM arcade_invites WHERE created_at < ?').run(Date.now() - TTL_MS);
  const out = [];
  for (const row of db.db.prepare('SELECT * FROM arcade_invites WHERE to_profile = ? ORDER BY created_at DESC').all(String(profileId))) {
    const check = games.get(row.game);
    const state = check ? check(row.room, profileId) : { open: false };
    if (!state || !state.open) { clear(row.game, row.room, profileId); continue; }
    out.push({ game: row.game, title: row.title, from: row.from_name, detail: state.detail || '', href: row.href, at: row.created_at });
  }
  return out;
}

function routes() {
  const router = express.Router();
  const limit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
    message: { error: 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.' } });
  router.get('/api/invites', limit, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const profile = profiles().verify(req.get('X-Profile-Token'));
    res.json({ invites: profile ? mine(profile.id) : [] });
  });
  router.get('/api/invites/people', limit, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const profile = profiles().verify(req.get('X-Profile-Token'));
    if (!profile) return res.status(401).json({ error: 'Pick your profile first, so the game knows who\'s inviting.' });
    res.json({ people: people(profile.id) });
  });
  return router;
}

// Whether every id names an approved profile here (checked before a room stores them).
function allProfiles(ids) {
  const q = db.db.prepare("SELECT 1 FROM arcade_profiles WHERE id = ? AND status = 'approved'");
  return ids.every(id => typeof id === 'string' && id.length <= 64 && !!q.get(id));
}

module.exports = { register, send, clear, clearGame, pending, mine, people, allProfiles, routes, setNotifier, MAX_TO };
