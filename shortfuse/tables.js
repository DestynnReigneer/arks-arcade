'use strict';

// Where Short Fuse games live. Two kinds of table:
//   - local: one phone passed around. One token speaks for every seat.
//   - room: everyone on their own phone, joined by a four-letter code, kept in
//     sync over server-sent events like Rambler's rooms.
// In memory only: a game is worth less than the evening it lasts.

const crypto = require('node:crypto');
const engine = require('./engine');
const cards = require('./cards');
const roomPassword = require('../arcade/room-password');

const tables = new Map();

const MAX_PLAYERS = 8;
const MAX_TABLES = 300;
const TTL_MS = 6 * 60 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const REACTION_MS = 4000;        // how long a room waits for a Nope

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const makeToken = () => crypto.randomBytes(24).toString('hex');
const makeId = () => crypto.randomBytes(8).toString('hex');

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (tables.has(code));
  return code;
}

function cleanName(raw, fallback) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16) || fallback;
}

function uniqueNames(raw) {
  const seen = new Set();
  return raw.map((n, i) => {
    let name = cleanName(n, `Player ${i + 1}`);
    let k = 2;
    const base = name;
    while (seen.has(name.toLowerCase())) name = `${base} ${k++}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

function touch(t) { t.lastActivity = Date.now(); }

function room(code) {
  const t = tables.get(String(code || '').toUpperCase());
  if (!t || t.mode !== 'room') throw fail('No game with that code.', 404);
  return t;
}

function local(id) {
  const t = tables.get(String(id || ''));
  if (!t || t.mode !== 'local') throw fail('That game has ended.', 404);
  return t;
}

function makeRoomForMore() {
  if (tables.size < MAX_TABLES) return;
  sweep();
  if (tables.size >= MAX_TABLES) throw fail('Too many games running right now.', 503);
}

// ---- local (one phone) ---------------------------------------------------

function createLocal({ names, level }) {
  makeRoomForMore();
  const list = (Array.isArray(names) ? names : []).slice(0, MAX_PLAYERS);
  if (list.length < 2) throw fail('Add at least 2 players.');
  const players = uniqueNames(list).map((name, i) => ({ id: 'p' + i, name }));

  const t = {
    id: 'L' + makeId(),
    mode: 'local',
    token: makeToken(),
    level: cards.levelOf(level),
    players,
    game: engine.createGame({ players, level }),
    lastActivity: Date.now()
  };
  tables.set(t.id, t);
  return t;
}

function localState(id, token) {
  const t = local(id);
  if (t.token !== String(token || '')) throw fail('Not your game.', 403);
  touch(t);
  return t;
}

function localSnapshot(t) {
  return {
    mode: 'local',
    id: t.id,
    players: t.players,
    game: engine.snapshot(t.game, t.game.turn !== undefined ? t.game.seats[t.game.turn].id : null, { allHands: true })
  };
}

// ---- rooms (a phone each) --------------------------------------------------

function addPlayer(t, rawName) {
  const taken = new Set([...t.players.values()].map(p => p.name.toLowerCase()));
  let name = cleanName(rawName, `Player ${t.players.size + 1}`);
  if (taken.has(name.toLowerCase())) {
    let n = 2;
    while (taken.has(`${name} ${n}`.toLowerCase())) n++;
    name = `${name} ${n}`;
  }
  const player = { id: makeId(), token: makeToken(), name, clients: 0, joinedAt: Date.now() };
  t.players.set(player.id, player);
  touch(t);
  return player;
}

function createRoom({ name, level, password }) {
  makeRoomForMore();
  const lockWith = cards.LEVELS[cards.levelOf(level)].adult ? roomPassword.requireNew(password) : null;
  const t = {
    id: makeCode(),
    mode: 'room',
    level: cards.levelOf(level),
    players: new Map(),
    clients: new Set(),
    hostId: null,
    game: null,
    reactionTimer: null,
    lastActivity: Date.now(),
    password: lockWith
  };
  tables.set(t.id, t);
  const host = addPlayer(t, name || 'Host');
  t.hostId = host.id;
  return { table: t, player: host };
}

function authenticate(t, playerId, token) {
  const p = t.players.get(String(playerId || ''));
  if (!p || !token || p.token !== String(token)) throw fail('Not a member of this game.', 403);
  return p;
}

function requireHost(t, p) {
  if (t.hostId !== p.id) throw fail('Only the host can do that.', 403);
}

function joinRoom(code, name, password) {
  const t = room(code);
  roomPassword.check(t, password);
  if (t.game && t.game.phase !== 'over') throw fail('That game has already started. Wait for the next one.', 409);
  if (t.players.size >= MAX_PLAYERS) throw fail(`That game is full (${MAX_PLAYERS} players).`, 409);
  const player = addPlayer(t, name);
  broadcast(t);
  return { table: t, player };
}

function setLevel(code, playerId, token, level, password) {
  const t = room(code);
  const p = authenticate(t, playerId, token);
  requireHost(t, p);
  if (t.game && t.game.phase !== 'over') throw fail('Not while a game is running.', 409);
  const next = cards.levelOf(level);
  // Switching to an adult deck locks the lobby; back to Kids unlocks it.
  if (cards.LEVELS[next].adult) { if (!t.password) t.password = roomPassword.requireNew(password); } else t.password = null;
  t.level = next;
  touch(t);
  broadcast(t);
}

function startRoom(code, playerId, token) {
  const t = room(code);
  const p = authenticate(t, playerId, token);
  requireHost(t, p);
  if (t.game && t.game.phase !== 'over') throw fail('A game is already running.', 409);
  if (t.players.size < 2) throw fail('Wait for at least one more player.', 409);
  const players = [...t.players.values()].map(pl => ({ id: pl.id, name: pl.name }));
  t.game = engine.createGame({ players, level: t.level });
  touch(t);
  broadcast(t);
}

function leaveRoom(code, playerId, token) {
  const t = room(code);
  const p = authenticate(t, playerId, token);
  t.players.delete(p.id);
  if (t.game) {
    engine.removePlayer(t.game, p.id);
    clearReaction(t);
  }
  if (!t.players.size) return closeTable(t);
  if (t.hostId === p.id) {
    t.hostId = [...t.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
  }
  touch(t);
  broadcast(t);
}

function roomSnapshot(t, viewerId) {
  return {
    mode: 'room',
    code: t.id,
    level: t.level,
    hostId: t.hostId,
    youAreHost: t.hostId === viewerId,
    locked: !!t.password,
    lobbyPassword: t.hostId === viewerId ? t.password : null,
    you: viewerId,
    maxPlayers: MAX_PLAYERS,
    reactionMs: REACTION_MS,
    reactionEndsAt: t.reactionEndsAt || null,
    serverNow: Date.now(),
    players: [...t.players.values()].map(p => ({ id: p.id, name: p.name, connected: p.clients > 0, isHost: p.id === t.hostId })),
    game: t.game ? engine.snapshot(t.game, viewerId) : null
  };
}

// ---- the reaction window -----------------------------------------------------

function clearReaction(t) {
  clearTimeout(t.reactionTimer);
  t.reactionTimer = null;
  t.reactionEndsAt = null;
}

// Each Nope restarts the clock, so there is always time to Nope back.
function armReaction(t) {
  clearReaction(t);
  t.reactionEndsAt = Date.now() + REACTION_MS;
  t.reactionTimer = setTimeout(() => {
    t.reactionTimer = null;
    t.reactionEndsAt = null;
    if (t.game) engine.resolve(t.game);
    broadcast(t);
  }, REACTION_MS);
}

// ---- actions, for both kinds of table -----------------------------------------

function act(t, actorId, body) {
  const g = t.game;
  if (!g) throw fail('The game has not started.', 409);
  const action = String(body.action || '');
  let result = null;

  switch (action) {
    case 'play':
      result = engine.play(g, actorId, { cards: body.cards, target: body.target });
      if (t.mode === 'room') armReaction(t);
      break;
    case 'nope':
      result = engine.nope(g, actorId);
      if (t.mode === 'room') armReaction(t);
      break;
    case 'resolve':
      // On a shared phone, "nobody Nopes" is a button. Rooms use the timer.
      if (t.mode === 'room') throw fail('The table resolves that on its own.', 409);
      result = engine.resolve(g);
      break;
    case 'give':
      engine.give(g, actorId, body.card);
      break;
    case 'draw':
      result = engine.draw(g, actorId);
      break;
    case 'place':
      engine.placeBomb(g, actorId, body.position);
      break;
    default:
      throw fail('Unknown move.');
  }
  touch(t);
  if (t.mode === 'room') broadcast(t);
  return result;
}

function actLocal(id, token, body) {
  const t = localState(id, token);
  // A shared phone acts for whichever seat it says; the engine still checks
  // that seat is allowed to do the thing.
  act(t, String(body.as || ''), body);
  return localSnapshot(t);
}

function actRoom(code, playerId, token, body) {
  const t = room(code);
  const p = authenticate(t, playerId, token);
  act(t, p.id, body);
  return roomSnapshot(t, p.id);
}

function rematchLocal(id, token) {
  const t = localState(id, token);
  t.game = engine.createGame({ players: t.players, level: t.level });
  return localSnapshot(t);
}

// ---- SSE ---------------------------------------------------------------------

function send(client, payload) {
  try { client.res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* closed */ }
}

function broadcast(t) {
  if (t.mode !== 'room') return;
  for (const c of t.clients) send(c, roomSnapshot(t, c.playerId));
}

function subscribe(code, playerId, token, res) {
  const t = room(code);
  const p = authenticate(t, playerId, token);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  const client = { playerId: p.id, res };
  t.clients.add(client);
  p.clients++;
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  broadcast(t);
  const close = () => {
    clearInterval(heartbeat);
    if (t.clients.delete(client)) {
      p.clients = Math.max(0, p.clients - 1);
      broadcast(t);
    }
  };
  res.on('close', close);
  res.on('error', close);
}

// ---- housekeeping --------------------------------------------------------------

function closeTable(t) {
  if (t.reactionTimer) clearTimeout(t.reactionTimer);
  if (t.clients) for (const c of t.clients) { try { c.res.end(); } catch { /* gone */ } }
  tables.delete(t.id);
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const t of [...tables.values()]) {
    if (t.lastActivity < cutoff) closeTable(t);
  }
}

const sweeper = setInterval(sweep, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = {
  MAX_PLAYERS, REACTION_MS,
  createLocal, localState, localSnapshot, actLocal, rematchLocal,
  createRoom, joinRoom, setLevel, startRoom, leaveRoom, actRoom, roomSnapshot, authenticate, room, subscribe,
  _tables: tables
};
