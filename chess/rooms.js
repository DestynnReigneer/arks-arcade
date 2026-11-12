'use strict';

// Chess on two phones. Each game is a room with a four-letter code and one seat
// per color. The server owns the position and checks every move with the same
// engine the page uses, so a phone can only ever play a legal move. Updates go
// to both phones over server-sent events.
//
// Playing together (the play-together design, 2026-11-11):
//  - A room starts in its lobby. The host chooses the color, invites people
//    from the family by name (arcade/invites.js) or shares a link or the code,
//    and starts the game once someone's in. Whoever joins sees the setting but
//    can't change it.
//  - The lobby and the game have a chat (arcade/room-chat.js), filtered with the
//    kids word list, and the host can mute someone.
//  - A seat taken with a profile belongs to that profile, not the browser tab:
//    opening the room on another device (seatFor) puts them back in it.
//  - Rooms are saved in the database on every change and read back when the
//    server starts, so a restart doesn't lose a game. A game between two
//    profiles that nobody touches for 30 days is cleared, chat and all. Anything
//    else (a lobby nobody started, a game with a guest in it or no moves yet, a
//    finished game) is cleared after a quiet day, so rooms can't be filled up.
//  - Each profile can be in at most 5 unfinished games, and one address can
//    host at most 10 at once.

const crypto = require('node:crypto');
const Chess = require('../public/chess-engine');
const db = require('../db');
const invites = require('../arcade/invites');
const chat = require('../arcade/room-chat').create('chess');

const rooms = new Map();
const MAX_ROOMS = 300;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_TTL_MS = 24 * 60 * 60 * 1000;
const PER_PROFILE = 5;
const PER_ADDRESS = 10;
const SWEEP_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['w', 'b', 'random'];

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const makeToken = () => crypto.randomBytes(24).toString('hex');
const makeId = () => crypto.randomBytes(8).toString('hex');
const cleanName = (raw, fallback) => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16) || fallback;

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code) || db.db.prepare('SELECT 1 FROM chess_rooms WHERE code = ?').get(code));
  return code;
}

// ---- saving ---------------------------------------------------------------------------------------------
db.db.exec(`
  CREATE TABLE IF NOT EXISTS chess_rooms (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

function save(r) {
  const data = {
    code: r.code, phase: r.phase, hostId: r.hostId, settings: r.settings, muted: [...r.muted], ip: r.ip || '',
    players: r.players.map(({ id, token, name, color, profileId }) => ({ id, token, name, color, profileId })),
    state: r.state, moves: r.moves, lastMove: r.lastMove, ended: r.ended, drawOffer: r.drawOffer,
    rematch: [...r.rematch], lastActivity: r.lastActivity
  };
  db.db.prepare('INSERT INTO chess_rooms (code, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(r.code, JSON.stringify(data), r.lastActivity);
}

function load() {
  for (const row of db.db.prepare('SELECT data FROM chess_rooms').all()) {
    try {
      const d = JSON.parse(row.data);
      rooms.set(d.code, {
        ...d, muted: new Set(d.muted || []), rematch: new Set(d.rematch || []), clients: new Set(),
        players: d.players.map(p => ({ ...p, clients: 0 }))
      });
    } catch { /* a broken row is skipped */ }
  }
}

function drop(r) {
  for (const c of r.clients) {
    try { c.res.write('event: closed\ndata: {}\n\n'); c.res.end(); } catch { /* gone */ }
  }
  rooms.delete(r.code);
  db.db.prepare('DELETE FROM chess_rooms WHERE code = ?').run(r.code);
  chat.clear(r.code);
  invites.clear('chess', r.code);
}

// ---- the room -------------------------------------------------------------------------------------------
function newGame(r) {
  r.state = Chess.fromFen();
  r.moves = [];
  r.lastMove = null;
  r.ended = null;       // { result, reason, winner }
  r.drawOffer = null;   // color that offered
  r.rematch = new Set();
}

function changed(r) {
  r.lastActivity = Date.now();
  save(r);
  broadcast(r);
}

// Unfinished games someone with this profile is in.
const unfinished = profileId => [...rooms.values()].filter(r => !r.ended && r.players.some(p => p.profileId === profileId)).length;
function roomForProfile(profile) {
  if (profile && unfinished(profile.id) >= PER_PROFILE) {
    throw fail(`You already have ${PER_PROFILE} chess games going. Finish or resign one first.`, 409);
  }
}

// profile: { id, name } when the host has one (needed to invite people).
// ip: who's asking, for the per-address cap.
function create({ name, color, profile, ip = '' }) {
  if (rooms.size >= MAX_ROOMS) throw fail('The arcade is full of chess games. Try again later.', 503);
  if (ip && [...rooms.values()].filter(r => r.ip === ip && !r.ended).length >= PER_ADDRESS) {
    throw fail('That\'s a lot of chess games at once. Finish one first.', 429);
  }
  roomForProfile(profile);
  const host = { id: makeId(), token: makeToken(), name: cleanName(profile ? profile.name : name, 'Player 1'), color: null,
    profileId: profile ? profile.id : null, clients: 0 };
  const r = { code: makeCode(), phase: 'lobby', hostId: host.id, settings: { color: COLORS.includes(color) ? color : 'w' },
    players: [host], muted: new Set(), clients: new Set(), lastActivity: Date.now(), ip };
  newGame(r);
  rooms.set(r.code, r);
  save(r);
  return { code: r.code, playerId: host.id, token: host.token };
}

function room(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw fail('No chess game with that code.', 404);
  return r;
}

function authenticate(r, playerId, token) {
  const p = r.players.find(x => x.id === playerId);
  if (!p || p.token !== token) throw fail('You are not in this game.', 403);
  return p;
}

function host(r, playerId, token) {
  const p = authenticate(r, playerId, token);
  if (p.id !== r.hostId) throw fail('Only the host can do that.', 403);
  return p;
}

const seatOf = (r, profile) => (profile ? r.players.find(p => p.profileId && p.profileId === profile.id) : null);
const ticket = (r, p) => ({ code: r.code, playerId: p.id, token: p.token, color: p.color });

// Joining from an invite, a link or the code. Someone already in it with this
// profile gets their own seat back.
function join(code, name, profile) {
  const r = room(code);
  const mine = seatOf(r, profile);
  if (mine) return ticket(r, mine);
  if (r.phase !== 'lobby') throw fail('That game has already started.', 409);
  if (r.players.length >= 2) throw fail('That game already has two players.', 409);
  roomForProfile(profile);
  const p = { id: makeId(), token: makeToken(), name: cleanName(profile ? profile.name : name, 'Player 2'), color: null,
    profileId: profile ? profile.id : null, clients: 0 };
  r.players.push(p);
  if (profile) invites.clear('chess', r.code, profile.id);
  chat.note(r.code, `${p.name} joined`);
  changed(r);
  return ticket(r, p);
}

// Your seat in a room, on any device, found by your profile.
function seatFor(code, profile) {
  const r = room(code);
  const mine = seatOf(r, profile);
  if (!mine) throw fail('You don\'t have a seat in this game.', 404);
  return ticket(r, mine);
}

function setSettings(code, playerId, token, { color }) {
  const r = room(code);
  host(r, playerId, token);
  if (r.phase !== 'lobby') throw fail('The game has already started.', 409);
  if (!COLORS.includes(color)) throw fail('Choose white, black or random.');
  r.settings.color = color;
  changed(r);
  return snapshot(r, playerId);
}

function start(code, playerId, token) {
  const r = room(code);
  host(r, playerId, token);
  if (r.phase !== 'lobby') throw fail('The game has already started.', 409);
  if (r.players.length < 2) throw fail('Wait for someone to join first.', 409);
  const pick = r.settings.color === 'random' ? (crypto.randomInt(2) ? 'w' : 'b') : r.settings.color;
  for (const p of r.players) p.color = p.id === r.hostId ? pick : (pick === 'w' ? 'b' : 'w');
  r.phase = 'playing';
  newGame(r);
  invites.clear('chess', r.code);
  chat.note(r.code, 'The game started');
  changed(r);
  return snapshot(r, playerId);
}

function invite(code, playerId, token, to) {
  const r = room(code);
  const h = host(r, playerId, token);
  if (r.phase !== 'lobby') throw fail('The game has already started.', 409);
  if (!h.profileId) throw fail('Pick your profile first, so the people you invite know who it\'s from.', 401);
  const seated = new Set(r.players.map(p => p.profileId).filter(Boolean));
  const sent = invites.send({
    game: 'chess', room: r.code, from: { id: h.profileId, name: h.name }, to: (Array.isArray(to) ? to : []).filter(id => !seated.has(String(id))),
    title: 'Chess', href: `chess.html?room=${r.code}`,
    notify: { title: 'Chess', body: `${h.name} invited you to Chess. Get in here!` }
  });
  changed(r);
  return { sent, state: snapshot(r, playerId) };
}

function say(code, playerId, token, text) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  chat.say(r.code, { seat: p.id, name: p.name, muted: r.muted.has(p.id), family: true }, text);
  r.lastActivity = Date.now();
  broadcast(r);
  return { ok: true };
}

function mute(code, playerId, token, target, on) {
  const r = room(code);
  host(r, playerId, token);
  const t = r.players.find(p => p.id === target);
  if (!t || t.id === r.hostId) throw fail('Choose someone else in the game.');
  if (on) r.muted.add(t.id); else r.muted.delete(t.id);
  changed(r);
  return snapshot(r, playerId);
}

// The host taking someone out of a seat in the lobby (someone who came in on
// the code before the person the host invited, say).
function remove(code, playerId, token, target) {
  const r = room(code);
  host(r, playerId, token);
  if (r.phase !== 'lobby') throw fail('The game has already started.', 409);
  const t = r.players.find(p => p.id === target);
  if (!t || t.id === r.hostId) throw fail('Choose someone else in the game.');
  r.players = r.players.filter(p => p.id !== t.id);
  r.muted.delete(t.id);
  for (const c of r.clients) {
    if (c.playerId !== t.id) continue;
    try { c.res.write('event: removed\ndata: {}\n\n'); c.res.end(); } catch { /* gone */ }
  }
  chat.note(r.code, `${t.name} was taken out of the game`);
  changed(r);
  return snapshot(r, playerId);
}

// Leaving the lobby. The host leaving closes the room; anyone else gives up
// their seat. Once the game has started, a seat is kept (resign ends it).
function leave(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (p.id === r.hostId && r.phase === 'lobby') { drop(r); return { ok: true, closed: true }; }
  if (r.phase === 'lobby') {
    r.players = r.players.filter(x => x.id !== p.id);
    r.muted.delete(p.id);
    chat.note(r.code, `${p.name} left`);
    changed(r);
  }
  return { ok: true };
}

function snapshot(r, viewerId) {
  const seat = c => {
    const p = r.players.find(x => x.color === c);
    return p ? { name: p.name, online: p.clients > 0 } : null;
  };
  const me = r.players.find(p => p.id === viewerId);
  const live = Chess.status(r.state);
  const hostP = r.players.find(p => p.id === r.hostId);
  return {
    code: r.code,
    phase: r.phase,
    host: !!me && me.id === r.hostId,
    hostName: hostP ? hostP.name : '',
    settings: { ...r.settings },
    seats: r.players.map(p => ({ id: p.id, name: p.name, online: p.clients > 0, host: p.id === r.hostId,
      muted: r.muted.has(p.id), you: p.id === viewerId })),
    invited: r.phase === 'lobby' ? invites.pending('chess', r.code).map(i => i.name) : [],
    muted: !!me && r.muted.has(me.id),
    chat: chat.list(r.code, viewerId),
    fen: Chess.toFen(r.state),
    turn: r.state.turn,
    moves: r.moves,
    lastMove: r.lastMove,
    check: !!live.check,
    ended: r.ended,
    drawOffer: r.drawOffer,
    rematch: [...r.rematch],
    players: { w: seat('w'), b: seat('b') },
    you: me ? me.color : null
  };
}

function finish(r, ended) {
  r.ended = ended;
  r.drawOffer = null;
}

// ---- telling people -------------------------------------------------------------------------------------
// When it becomes someone's move and they aren't looking at the game, their
// phone gets a notification (arcade/push.js, only with the sign-in service on).
let notifier = null;
function setNotifier(fn) { notifier = fn; }
function tellTurn(r, mover) {
  const next = r.players.find(p => p.color === r.state.turn);
  if (!notifier || !next || !next.profileId || next.clients > 0 || r.ended) return;
  try {
    notifier(next.profileId, { title: 'Chess', body: `${mover.name} moved. Your move!`, url: `chess.html?room=${r.code}`, tag: `chess-${r.code}` });
  } catch { /* a notification never stops a game */ }
}

function playing(r) {
  if (r.phase !== 'playing') throw fail('The game hasn\'t started yet.', 409);
}

function move(code, playerId, token, wanted) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  playing(r);
  if (r.ended) throw fail('This game is over.', 409);
  if (r.state.turn !== p.color) throw fail('It is not your turn.', 409);
  const played = Chess.play(r.state, wanted || {});
  if (!played) throw fail('That move is not allowed.', 400);
  r.moves.push(played.san);
  r.lastMove = { from: played.from, to: played.to };
  r.drawOffer = null;
  const s = Chess.status(r.state);
  if (s.over) finish(r, { result: s.result, reason: s.reason, winner: s.winner });
  changed(r);
  tellTurn(r, p);
  return snapshot(r, p.id);
}

function act(code, playerId, token, action) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  playing(r);
  if (action === 'resign') {
    if (r.ended) throw fail('This game is over.', 409);
    const winner = p.color === 'w' ? 'b' : 'w';
    finish(r, { result: winner === 'w' ? '1-0' : '0-1', reason: 'resignation', winner });
  } else if (action === 'offer-draw') {
    if (r.ended) throw fail('This game is over.', 409);
    r.drawOffer = p.color;
  } else if (action === 'accept-draw') {
    if (!r.drawOffer || r.drawOffer === p.color) throw fail('There is no draw offer to accept.', 409);
    finish(r, { result: '1/2-1/2', reason: 'agreement', winner: null });
  } else if (action === 'decline-draw') {
    r.drawOffer = null;
  } else if (action === 'rematch') {
    if (!r.ended) throw fail('Finish this game first.', 409);
    r.rematch.add(p.color);
    // Both said yes: swap colors and go again.
    if (r.rematch.size === 2) {
      for (const x of r.players) x.color = x.color === 'w' ? 'b' : 'w';
      newGame(r);
    }
  } else {
    throw fail('Unknown action.');
  }
  changed(r);
  return snapshot(r, p.id);
}

// ---- live updates ---------------------------------------------------------------------------------------

function broadcast(r) {
  for (const c of r.clients) {
    try { c.res.write(`event: state\ndata: ${JSON.stringify(snapshot(r, c.playerId))}\n\n`); } catch { /* closed */ }
  }
}

function subscribe(code, playerId, token, res) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  const client = { playerId: p.id, res };
  r.clients.add(client);
  p.clients++;
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  broadcast(r);
  const close = () => {
    clearInterval(heartbeat);
    if (r.clients.delete(client)) {
      p.clients = Math.max(0, p.clients - 1);
      broadcast(r);
    }
  };
  res.on('close', close);
  res.on('error', close);
}

// ---- other parts of the arcade --------------------------------------------------------------------------

// The Continue row: one person's games in progress.
function mine(profile) {
  const out = [];
  for (const r of rooms.values()) {
    const me = seatOf(r, profile);
    if (!me || r.phase !== 'playing' || r.ended) continue;
    const other = r.players.find(p => p.id !== me.id);
    const yourTurn = r.state.turn === me.color;
    out.push({ code: r.code, opponent: other ? other.name : '', yourTurn, updatedAt: r.lastActivity });
  }
  return out;
}

// An invite stays open while the lobby has a free seat.
invites.register('chess', (code, profileId) => {
  const r = rooms.get(code);
  if (!r || r.phase !== 'lobby' || r.players.length >= 2 || r.players.some(p => p.profileId === profileId)) return { open: false };
  const h = r.players.find(p => p.id === r.hostId);
  return { open: true, detail: `${h ? h.name : 'The host'} is waiting` };
});

// Only a game between two profiles that has really started is kept long.
const keepsLong = r => r.phase === 'playing' && !r.ended && r.moves.length > 0 && r.players.length === 2 && r.players.every(p => p.profileId);

function sweep(now = Date.now()) {
  for (const r of [...rooms.values()]) {
    const ttl = keepsLong(r) ? TTL_MS : SHORT_TTL_MS;
    if (now - r.lastActivity >= ttl) drop(r);
  }
  // A backstop: chat and invites for rooms that are gone.
  db.db.prepare("DELETE FROM room_chat WHERE game = 'chess' AND room NOT IN (SELECT code FROM chess_rooms)").run();
  db.db.prepare("DELETE FROM arcade_invites WHERE game = 'chess' AND room NOT IN (SELECT code FROM chess_rooms)").run();
}

load();
const sweeper = setInterval(sweep, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = { create, join, seatFor, setSettings, start, invite, say, mute, remove, leave, move, act, snapshot, room,
  authenticate, subscribe, mine, sweep, setNotifier, _rooms: rooms };
