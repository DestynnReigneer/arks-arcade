'use strict';

// Tables for the party card games (Uh-Oh: Part Deux, Dare Devil), kept in
// memory like the other games' rooms:
//   - local: one phone passed around; one token speaks for every seat.
//   - room: everyone on their own phone, a four-letter code, live updates.
// Adult levels get a lobby password the host makes up. Each game supplies
// its own engine; this handles the seats, codes, passwords and sockets.
//
//   makeTables({ engine, act, levels, minPlayers, maxPlayers, cleanOptions })
//     engine.createGame({ players, level, drinking, ...options })
//     engine.snapshot(game, viewerId, { allHands })
//     engine.removePlayer(game, playerId)
//     act(game, actorId, body)          one move; throws if not allowed
//     levels: { [id]: { adult } }       which levels are adult

const crypto = require('node:crypto');
const roomPassword = require('./room-password');

const TTL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const MAX_TABLES = 300;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Room codes are unique across every party game, so a code means one thing.
const allCodes = new Set();

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const makeToken = () => crypto.randomBytes(24).toString('hex');
const makeId = () => crypto.randomBytes(8).toString('hex');
const cleanName = (raw, fallback) => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16) || fallback;

function makeTables({ engine, act, levels, minPlayers = 2, maxPlayers = 8, cleanOptions = () => ({}) }) {
  const tables = new Map();
  const levelOf = id => (levels[id] ? id : Object.keys(levels)[0]);
  const isAdult = level => !!levels[levelOf(level)].adult;

  function makeCode() {
    let code;
    do code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    while (allCodes.has(code));
    allCodes.add(code);
    return code;
  }

  function roomForMore() {
    if (tables.size < MAX_TABLES) return;
    sweep();
    if (tables.size >= MAX_TABLES) throw fail('Too many games running. Try again later.', 503);
  }

  const newGame = (players, t) => engine.createGame({ players, level: t.level, drinking: t.drinking && isAdult(t.level), ...t.options });

  // ---- one phone ---------------------------------------------------------------------

  function createLocal({ names, level, drinking, options }) {
    roomForMore();
    const clean = (Array.isArray(names) ? names : []).map((n, i) => cleanName(n, `Player ${i + 1}`)).slice(0, maxPlayers);
    if (clean.length < minPlayers) throw fail(`Add at least ${minPlayers} players.`);
    const t = {
      id: 'L' + crypto.randomBytes(6).toString('hex').toUpperCase(), kind: 'local', token: makeToken(), names: clean,
      level: levelOf(level), drinking: !!drinking, options: cleanOptions(options || {}), lastActivity: Date.now()
    };
    t.game = newGame(clean.map((name, i) => ({ id: `p${i}`, name })), t);
    tables.set(t.id, t);
    return t;
  }

  function local(id, token) {
    const t = tables.get(String(id || ''));
    if (!t || t.kind !== 'local') throw fail('That game has ended.', 404);
    if (t.token !== token) throw fail('Not your game.', 403);
    return t;
  }

  const localSnapshot = t => ({ id: t.id, kind: 'local', level: t.level, drinking: t.drinking, options: t.options, game: engine.snapshot(t.game, null, { allHands: true }) });

  function actLocal(id, token, body) {
    const t = local(id, token);
    act(t.game, String(body.as || ''), body);
    t.lastActivity = Date.now();
    return localSnapshot(t);
  }

  function rematchLocal(id, token) {
    const t = local(id, token);
    t.game = newGame(t.names.map((name, i) => ({ id: `p${i}`, name })), t);
    t.lastActivity = Date.now();
    return localSnapshot(t);
  }

  // ---- a phone each -------------------------------------------------------------------

  function room(code) {
    const t = tables.get(String(code || '').toUpperCase());
    if (!t || t.kind !== 'room') throw fail('No game with that code.', 404);
    return t;
  }

  function authenticate(t, playerId, token) {
    const p = t.players.get(String(playerId || ''));
    if (!p || p.token !== token) throw fail('You are not in this game.', 403);
    return p;
  }

  function addPlayer(t, name) {
    const used = new Set([...t.players.values()].map(p => p.name.toLowerCase()));
    const base = cleanName(name, `Player ${t.players.size + 1}`);
    let n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base} ${i}`;
    const p = { id: makeId(), token: makeToken(), name: n, clients: 0 };
    t.players.set(p.id, p);
    return p;
  }

  function createRoom({ name, level, drinking, password, options }) {
    roomForMore();
    const lv = levelOf(level);
    const t = {
      id: makeCode(), kind: 'room', level: lv, drinking: !!drinking && isAdult(lv), options: cleanOptions(options || {}),
      password: isAdult(lv) ? roomPassword.requireNew(password) : null,
      players: new Map(), hostId: null, game: null, clients: new Set(), lastActivity: Date.now()
    };
    tables.set(t.id, t);
    const host = addPlayer(t, name || 'Host');
    t.hostId = host.id;
    return { table: t, player: host };
  }

  function joinRoom(code, name, password) {
    const t = room(code);
    roomPassword.check(t, password);
    if (t.game && t.game.phase !== 'over') throw fail('That game has already started. Wait for the next one.', 409);
    if (t.players.size >= maxPlayers) throw fail(`That game is full (${maxPlayers} players).`, 409);
    const p = addPlayer(t, name);
    touch(t);
    return { table: t, player: p };
  }

  function settings(code, playerId, token, { level, drinking, password, options }) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    if (p.id !== t.hostId) throw fail('Only the host can change that.', 403);
    if (t.game && t.game.phase !== 'over') throw fail('Not while a game is running.', 409);
    if (level !== undefined) {
      const lv = levelOf(level);
      if (isAdult(lv)) { if (!t.password) t.password = roomPassword.requireNew(password); } else t.password = null;
      t.level = lv;
    }
    if (drinking !== undefined) t.drinking = !!drinking;
    if (!isAdult(t.level)) t.drinking = false;
    if (options) t.options = cleanOptions({ ...t.options, ...options });
    touch(t);
  }

  function startRoom(code, playerId, token) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    if (p.id !== t.hostId) throw fail('Only the host can start.', 403);
    if (t.game && t.game.phase !== 'over') throw fail('Already playing.', 409);
    if (t.players.size < minPlayers) throw fail('Wait for at least one more player.', 409);
    t.game = newGame([...t.players.values()].map(x => ({ id: x.id, name: x.name })), t);
    touch(t);
  }

  function actRoom(code, playerId, token, body) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    if (!t.game) throw fail('The game hasn\'t started.', 409);
    act(t.game, p.id, body);
    touch(t);
    return roomSnapshot(t, p.id);
  }

  function leaveRoom(code, playerId, token) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    t.players.delete(p.id);
    if (t.game && t.game.phase !== 'over') engine.removePlayer(t.game, p.id);
    if (!t.players.size) return close(t);
    if (t.hostId === p.id) t.hostId = t.players.keys().next().value;
    touch(t);
  }

  function roomSnapshot(t, viewerId) {
    return {
      code: t.id, kind: 'room', level: t.level, drinking: t.drinking, options: t.options,
      you: viewerId, youAreHost: t.hostId === viewerId,
      locked: !!t.password, lobbyPassword: t.hostId === viewerId ? t.password : null,
      players: [...t.players.values()].map(p => ({ id: p.id, name: p.name, online: p.clients > 0, host: p.id === t.hostId })),
      game: t.game ? engine.snapshot(t.game, viewerId) : null
    };
  }

  function touch(t) {
    t.lastActivity = Date.now();
    for (const c of t.clients) {
      try { c.res.write(`event: state\ndata: ${JSON.stringify(roomSnapshot(t, c.playerId))}\n\n`); } catch { /* closed */ }
    }
  }

  function subscribe(code, playerId, token, res) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const client = { playerId: p.id, res };
    t.clients.add(client);
    p.clients++;
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
    touch(t);
    const end = () => {
      clearInterval(beat);
      if (t.clients.delete(client)) { p.clients = Math.max(0, p.clients - 1); touch(t); }
    };
    res.on('close', end);
    res.on('error', end);
  }

  function close(t) {
    if (t.clients) for (const c of t.clients) { try { c.res.end(); } catch { /* gone */ } }
    tables.delete(t.id);
    allCodes.delete(t.id);
  }

  function sweep() {
    const cutoff = Date.now() - TTL_MS;
    for (const t of [...tables.values()]) if (t.lastActivity < cutoff) close(t);
  }
  const sweeper = setInterval(sweep, 10 * 60 * 1000);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  return {
    MAX_PLAYERS: maxPlayers, isAdult, levelOf,
    createLocal, local, localSnapshot, actLocal, rematchLocal,
    createRoom, joinRoom, settings, startRoom, actRoom, leaveRoom, roomSnapshot, room, authenticate, subscribe,
    _tables: tables
  };
}

module.exports = { makeTables };
