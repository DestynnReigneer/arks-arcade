'use strict';

// Tables for the party card games (Uh-Oh: Part Deux, Dare Devil). A table lives
// in memory, and it's written down as it changes (room-store.js) and read back
// when the arcade starts, so a restart ends nobody's game: the seats, the hands
// and whose turn it is all come back. Two kinds:
//   - local: one phone passed around; one token speaks for every seat.
//   - room: everyone on their own phone, a four-letter code, live updates.
//     A phone in a room can hold more players (seats) and be passed around
//     between them, and a room can be hosted by a screen (a TV): it shows the
//     table to everyone and starts the game, but it isn't a player itself.
// Adult levels get a lobby password the host makes up. Each game supplies
// its own engine; this handles the seats, codes, passwords and sockets.
//
// The lobby: a room shows up in List Hosted Games and on the home page, and anyone at
// the arcade can join it. Nobody is picked or told about it: people find it in the
// lists. Whoever joins taps Ready, and the host
// can start once everyone is (a TV-hosted room starts from the remote as before). The
// lobby and the game have a chat (room-chat.js). A card game can't be joined partway,
// because nobody can be dealt in mid-round.
//
//   makeTables({ game, title, engine, act, levels, minPlayers, maxPlayers, cleanOptions })
//     game, title: the game's id and name (for the chat and the lists)
//     engine.createGame({ players, level, drinking, ...options })
//     engine.snapshot(game, viewerId, { allHands })
//     engine.removePlayer(game, playerId)
//     act(game, actorId, body)          one move; throws if not allowed
//     levels: { [id]: { adult } }       which levels are adult

const crypto = require('node:crypto');
const roomPassword = require('./room-password');
const adultJoin = require('./adult-join');
const roomChat = require('./room-chat');
const roomStore = require('./room-store');

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

function makeTables({ game = 'party', title = 'the game', engine, act, levels, minPlayers = 2, maxPlayers = 8, cleanOptions = () => ({}) }) {
  const tables = new Map();
  const chat = roomChat.create(game);
  const saved = roomStore(game);
  const levelOf = id => (typeof id === 'string' && Object.hasOwn(levels, id) ? id : Object.keys(levels)[0]);
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
    saved.saveNow(t.id, pack(t));
    return t;
  }

  // ---- kept between restarts -------------------------------------------------------
  // A table as plain data: everything but who's connected right now. It holds the
  // seats' tokens, every hand and, for an adult room, its lobby password, so it
  // never leaves the server.
  function pack(t) {
    if (t.kind === 'local') {
      return { id: t.id, kind: 'local', token: t.token, names: t.names, level: t.level, drinking: t.drinking, options: t.options, lastActivity: t.lastActivity, game: t.game };
    }
    return {
      id: t.id, kind: 'room', level: t.level, drinking: t.drinking, options: t.options, password: t.password,
      players: [...t.players.values()].map(p => ({
        id: p.id, token: p.token || null, name: p.name, owner: p.owner || null, profileId: p.profileId || null, ready: !!p.ready, adultSignin: p.adultSignin || null
      })),
      hostId: t.hostId, screen: t.screen ? { id: t.screen.id, token: t.screen.token, name: t.screen.name } : null,
      game: t.game, lastActivity: t.lastActivity, muted: [...t.muted]
    };
  }
  const keep = t => saved.saveSoon(t.id, () => (tables.get(t.id) === t ? pack(t) : null));

  // Brings the tables back when the arcade starts. The chat stays for the rooms
  // that came back. -> how many came back.
  function restore(now = Date.now()) {
    // A table that can't be put back together is left out and removed (room-store.js), so it can't stop the arcade from starting.
    const back = saved.restoreEach(({ code, data, savedAt }) => {
      const lastActivity = Number(data.lastActivity) || savedAt;
      let t = null;
      if (data.id === code && !tables.has(code) && !allCodes.has(code) && now - lastActivity <= TTL_MS) {
        if (data.kind === 'local' && typeof data.token === 'string' && Array.isArray(data.names) && data.game) {
          t = {
            id: code, kind: 'local', token: data.token, names: data.names.map((n, i) => cleanName(n, `Player ${i + 1}`)),
            level: levelOf(data.level), drinking: !!data.drinking, options: cleanOptions(data.options || {}), lastActivity, game: data.game
          };
        } else if (data.kind === 'room' && Array.isArray(data.players) && (data.players.length || data.screen)) {
          t = {
            id: code, kind: 'room', level: levelOf(data.level), drinking: !!data.drinking, options: cleanOptions(data.options || {}),
            password: data.password || null, players: new Map(), hostId: data.hostId,
            screen: data.screen ? { id: String(data.screen.id), token: String(data.screen.token), name: cleanName(data.screen.name, 'TV'), clients: 0, screen: true } : null,
            game: data.game || null, clients: new Set(), lastActivity, muted: new Set(Array.isArray(data.muted) ? data.muted : [])
          };
          for (const p of data.players) {
            t.players.set(String(p.id), {
              id: String(p.id), token: p.token ? String(p.token) : null, name: cleanName(p.name, 'Player'), clients: 0,
              owner: p.owner || null, profileId: p.profileId || null, ready: !!p.ready, adultSignin: p.adultSignin || null
            });
          }
          if (!member(t, t.hostId)) t.hostId = t.screen ? t.screen.id : ([...t.players.values()].find(x => x.token) || {}).id || null;
          // An adult level always has its password, and a family one never does; a room with no host can't be run.
          if (!isAdult(t.level)) { t.password = null; t.drinking = false; }
          if (!t.hostId || (isAdult(t.level) && !t.password)) t = null;
        }
      }
      if (!t) return false;
      tables.set(code, t);
      if (t.kind === 'room') allCodes.add(code);
      return true;
    });
    chat.keepOnly([...tables.values()].filter(t => t.kind === 'room').map(t => t.id));
    return back;
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
    keep(t);
    return localSnapshot(t);
  }

  function rematchLocal(id, token) {
    const t = local(id, token);
    t.game = newGame(t.names.map((name, i) => ({ id: `p${i}`, name })), t);
    t.lastActivity = Date.now();
    keep(t);
    return localSnapshot(t);
  }

  // ---- a phone each -------------------------------------------------------------------

  function room(code) {
    const t = tables.get(String(code || '').toUpperCase());
    if (!t || t.kind !== 'room') throw fail('This game isn\'t available.', 404);
    return t;
  }

  // A device in the room: a player with a phone of their own, or the screen.
  // Seats (more players on one phone) have no token, so they never sign in.
  const member = (t, id) => t.players.get(id) || (t.screen && t.screen.id === id ? t.screen : null);
  function authenticate(t, playerId, token) {
    const p = member(t, String(playerId || ''));
    if (!p || !p.token || p.token !== token) throw fail('You are not in this game.', 403);
    return p;
  }
  // The players a device plays for: itself (unless it's the screen) and its seats.
  const controlled = (t, device) => [...t.players.values()].filter(p => p.id === device.id || p.owner === device.id).map(p => p.id);

  function addPlayer(t, name, owner = null, profile = null) {
    const used = new Set([...t.players.values()].map(p => p.name.toLowerCase()));
    const base = cleanName(profile ? profile.name : name, `Player ${t.players.size + 1}`);
    let n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base} ${i}`;
    const p = { id: makeId(), token: owner ? null : makeToken(), name: n, clients: 0, owner, profileId: profile ? profile.id : null, ready: false };
    t.players.set(p.id, p);
    return p;
  }

  const playing = t => !!t.game && t.game.phase !== 'over';
  // A TV-hosted room keeps its own flow: the remote starts it whenever the room is set.
  const allReady = t => !!t.screen || [...t.players.values()].every(p => !p.token || p.id === t.hostId || p.ready);

  // screen: this device (a TV) hosts and shows the game, and doesn't play.
  // profile: the host's { id, name }.
  function createRoom({ name, level, drinking, password, options, screen = false, profile = null }) {
    roomForMore();
    const lv = levelOf(level);
    const t = {
      id: makeCode(), kind: 'room', level: lv, drinking: !!drinking && isAdult(lv), options: cleanOptions(options || {}),
      password: isAdult(lv) ? roomPassword.requireNew(password) : null,
      players: new Map(), hostId: null, screen: null, game: null, clients: new Set(), lastActivity: Date.now(),
      muted: new Set()
    };
    tables.set(t.id, t);
    if (screen) {
      t.screen = { id: makeId(), token: makeToken(), name: cleanName(name, 'TV'), clients: 0, screen: true };
      t.hostId = t.screen.id;
      saved.saveNow(t.id, pack(t));
      return { table: t, player: t.screen };
    }
    const host = addPlayer(t, name || 'Host', null, profile);
    host.ready = true;
    t.hostId = host.id;
    saved.saveNow(t.id, pack(t));
    return { table: t, player: host };
  }

  // Another player on this phone, to pass it around; or taking one off again.
  function addSeat(code, playerId, token, name) {
    const t = room(code);
    const device = authenticate(t, playerId, token);
    if (device.screen) throw fail('Players can join from their own devices.', 400);
    if (t.game && t.game.phase !== 'over') throw fail('That game has already started. Wait for the next one.', 409);
    if (t.players.size >= maxPlayers) throw fail(`That game is full (${maxPlayers} players).`, 409);
    const seat = addPlayer(t, name, device.id);
    touch(t);
    return { seatId: seat.id, name: seat.name };
  }

  function removeSeat(code, playerId, token, seatId) {
    const t = room(code);
    const device = authenticate(t, playerId, token);
    const seat = t.players.get(String(seatId || ''));
    if (!seat || seat.owner !== device.id) throw fail('That player isn\'t on this device.', 403);
    if (t.game && t.game.phase !== 'over') throw fail('That game has already started.', 409);
    t.players.delete(seat.id);
    touch(t);
  }

  // adultSignin: the sign-in this device has, when it's an adult's (arcade/adult-join.js). Kept on the server only.
  function joinRoom(code, name, password, profile = null, adultSignin = null) {
    const t = room(code);
    roomPassword.check(t, password);
    // One seat per profile: joining again (another device, or after a reload) gets the same seat back.
    const mine = profile && [...t.players.values()].find(p => p.token && p.profileId === profile.id);
    if (mine) { mine.adultSignin = adultSignin || null; touch(t); return { table: t, player: mine }; }
    if (t.game && t.game.phase !== 'over') throw fail('That game has already started. Wait for the next one.', 409);
    if (t.players.size >= maxPlayers) throw fail(`That game is full (${maxPlayers} players).`, 409);
    const p = addPlayer(t, name, null, profile);
    p.adultSignin = adultSignin || null;
    chat.note(t.id, `${p.name} joined`);
    touch(t);
    return { table: t, player: p };
  }

  // Someone in the lobby saying they're ready (or not yet). The host always is.
  function lobbyReady(code, playerId, token, on) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    if (playing(t)) throw fail('The game has already started.', 409);
    if (p.id === t.hostId || p.screen) return;
    p.ready = !!on;
    touch(t);
  }
  function say(code, playerId, token, text) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    chat.say(t.id, { seat: p.id, name: p.screen ? 'TV' : p.name, muted: t.muted.has(p.id), family: !isAdult(t.level),
      tell: { to: [...t.players.values()].filter(x => x.profileId && !(x.clients > 0)).map(x => x.profileId), from: p.profileId || null, game: title, url: `${game}.html?join=${t.id}` } }, text);
    touch(t);
  }
  const hostOnly = (t, p) => { if (p.id !== t.hostId) throw fail('Only the host can do that.', 403); };
  function mute(code, playerId, token, target, on) {
    const t = room(code);
    hostOnly(t, authenticate(t, playerId, token));
    const x = t.players.get(String(target || ''));
    if (!x || !x.token || x.id === t.hostId) throw fail('Choose someone else in the game.');
    if (on) t.muted.add(x.id); else t.muted.delete(x.id);
    touch(t);
  }
  // The host taking someone (and the players on their phone) out of the lobby.
  function remove(code, playerId, token, target) {
    const t = room(code);
    hostOnly(t, authenticate(t, playerId, token));
    if (playing(t)) throw fail('The game has already started.', 409);
    const x = t.players.get(String(target || ''));
    if (!x || !x.token || x.id === t.hostId) throw fail('Choose someone else in the game.');
    for (const id of controlled(t, x)) t.players.delete(id);
    t.muted.delete(x.id);
    for (const c of t.clients) {
      if (c.playerId !== x.id) continue;
      try { c.res.write('event: removed\ndata: {}\n\n'); c.res.end(); } catch { /* gone */ }
    }
    chat.note(t.id, `${x.name} was removed.`);
    touch(t);
  }

  // The lobby just turned adult. Adult levels are only for adults, so everyone the
  // arcade doesn't know to be one leaves, with the players they added on their own
  // device, and their page is told why. The host stays, and so does anyone signed
  // in with ARKS ID as an adult: that's asked again now, not remembered from when
  // they joined, so someone who signed out since, or whose account stopped being
  // an adult's, goes too. A guest can come back with the lobby password.
  function moveOutForAdultLevel(t) {
    const going = [...t.players.values()].filter(p => p.token && p.id !== t.hostId && !adultJoin.stillAdult(p.adultSignin));
    const names = [];
    for (const x of going) {
      for (const id of controlled(t, x)) { names.push(t.players.get(id).name); t.players.delete(id); }
      t.muted.delete(x.id);
      for (const c of t.clients) {
        if (c.playerId !== x.id) continue;
        try { c.res.write('event: moved\ndata: {"why":"adult"}\n\n'); c.res.end(); } catch { /* gone */ }
      }
    }
    if (!names.length) return;
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    chat.note(t.id, `${who} ${names.length === 1 ? 'was' : 'were'} removed, the host switched game mode to adult.`);
  }

  function settings(code, playerId, token, { level, drinking, password, options }) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    if (p.id !== t.hostId) throw fail('Only the host can change that.', 403);
    if (t.game && t.game.phase !== 'over') throw fail('Not while a game is running.', 409);
    if (level !== undefined) {
      const lv = levelOf(level);
      // It's the host's lobby, so the host can turn it adult at any time (the maintainer's
      // call, 2026-11-14). Nobody who joined a family game is left sitting in an adult one:
      // whoever isn't known to be an adult is moved out first. The password comes before
      // anything else, so a switch that's refused changes nothing.
      const turningAdult = isAdult(lv) && !isAdult(t.level);
      if (isAdult(lv)) { if (!t.password) t.password = roomPassword.requireNew(password); } else t.password = null;
      if (turningAdult) moveOutForAdultLevel(t);
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
    if (t.players.size < minPlayers) throw fail(t.players.size ? 'Wait for at least one more player.' : 'Nobody has joined yet.', 409);
    const first = !t.game;
    if (first && !allReady(t)) throw fail('Wait until everyone is ready.', 409);
    if (first) chat.note(t.id, 'The game started');
    t.game = newGame([...t.players.values()].map(x => ({ id: x.id, name: x.name })), t);
    touch(t);
  }

  // body.as: which of this phone's players makes the move (its own by default).
  function actRoom(code, playerId, token, body) {
    const t = room(code);
    const device = authenticate(t, playerId, token);
    if (!t.game) throw fail('The game hasn\'t started.', 409);
    const actor = body.as ? String(body.as) : device.screen ? null : device.id;
    if (!actor || !controlled(t, device).includes(actor)) throw fail('You can only play for the players on your device.', 403);
    act(t.game, actor, body);
    touch(t);
    return roomSnapshot(t, device.id);
  }

  function leaveRoom(code, playerId, token) {
    const t = room(code);
    const p = authenticate(t, playerId, token);
    // The screen going away ends the game: there's nothing left to look at.
    if (p.screen) return close(t);
    // A phone leaving takes the players it held with it.
    for (const id of controlled(t, p)) {
      t.players.delete(id);
      if (t.game && t.game.phase !== 'over') engine.removePlayer(t.game, id);
    }
    if (!t.players.size && !t.screen) return close(t);
    if (t.hostId === p.id) t.hostId = ([...t.players.values()].find(x => x.token) || {}).id || null;
    touch(t);
  }

  // Whose cards a device sees: on a phone of one player, theirs; on a phone
  // passed around, only the hand of whoever's turn it is (so nobody peeks at
  // someone else's); on the screen, nobody's.
  function viewerOf(t, device, mine) {
    if (!device || device.screen || !mine.length) return null;
    if (mine.length === 1) return mine[0];
    const turn = t.game && t.game.phase !== 'over' ? engine.snapshot(t.game, null).turn : null;
    return mine.includes(turn) ? turn : null;
  }

  function roomSnapshot(t, viewerId) {
    const device = member(t, viewerId);
    const mine = device ? controlled(t, device) : [];
    const as = viewerOf(t, device, mine);
    const owner = p => (p.owner ? member(t, p.owner) : null);
    const host = member(t, t.hostId);
    return {
      code: t.id, kind: 'room', level: t.level, drinking: t.drinking, options: t.options,
      you: viewerId, youAreHost: t.hostId === viewerId,
      // screen: a TV hosts this room; isScreen: you're that TV. mine: the
      // players this phone plays for; as: whose hand this snapshot shows.
      screen: !!t.screen, isScreen: !!(device && device.screen), hostName: host ? host.name : '', mine, as,
      locked: !!t.password, lobbyPassword: t.hostId === viewerId ? t.password : null,
      allReady: allReady(t), muted: !!(device && t.muted.has(device.id)), chat: chat.list(t.id, viewerId),
      players: [...t.players.values()].map(p => ({
        id: p.id, name: p.name, online: (owner(p) || p).clients > 0, host: p.id === t.hostId,
        on: owner(p) ? owner(p).name : null, device: !!p.token, ready: !p.token || p.id === t.hostId || !!p.ready, mutedChat: t.muted.has(p.id)
      })),
      game: t.game ? engine.snapshot(t.game, as) : null
    };
  }

  // Every change to a room ends here: it's sent to whoever is connected, and written down within a moment.
  function touch(t) {
    t.lastActivity = Date.now();
    keep(t);
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
    saved.remove(t.id);
    if (t.kind === 'room') chat.clear(t.id);
  }

  // List Hosted Games and the home page's list of lobbies: every room, for everyone.
  // profile: who's asking, so the room they're already in can be marked as theirs.
  function lobbies(profile) {
    const out = [];
    for (const t of tables.values()) {
      if (t.kind !== 'room') continue;
      const host = member(t, t.hostId);
      out.push({ code: t.id, host: host ? host.name : '', screen: !!t.screen, players: [...t.players.values()].map(p => p.name), count: t.players.size, max: maxPlayers,
        status: t.players.size >= maxPlayers ? 'full' : playing(t) ? 'playing' : 'open', level: t.level, adult: isAdult(t.level), locked: !!t.password,
        drinking: !!t.drinking, mine: !!profile && [...t.players.values()].some(p => p.profileId === profile.id) });
    }
    return out;
  }

  function sweep() {
    const cutoff = Date.now() - TTL_MS;
    for (const t of [...tables.values()]) if (t.lastActivity < cutoff) close(t);
  }
  const sweeper = setInterval(sweep, 10 * 60 * 1000);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  // The tables that were open when the arcade last stopped.
  const cameBack = restore();
  if (cameBack) console.log(`${title} picked ${cameBack} game${cameBack === 1 ? '' : 's'} back up.`);

  return {
    MAX_PLAYERS: maxPlayers, isAdult, levelOf,
    createLocal, local, localSnapshot, actLocal, rematchLocal,
    createRoom, joinRoom, lobbyReady, say, mute, remove, lobbies, addSeat, removeSeat, settings, startRoom, actRoom, leaveRoom, roomSnapshot, room, authenticate, subscribe,
    _tables: tables
  };
}

module.exports = { makeTables };
