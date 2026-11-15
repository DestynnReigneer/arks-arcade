'use strict';

// Shuffle Scuffle rooms: a device each, everyone racing on the same letters
// at the same time. A room is a lobby anyone can find in List Hosted Games and
// join; its four-letter code is only its name in links and QR codes. The
// server keeps the clock, checks every word and adds up every score; devices
// only send the words people spell.
// A room can be hosted by a screen (a TV): it shows the letters, the clock
// and everyone's counts to the whole room, and isn't a player itself.
// Rooms live in memory, and each one is written down as it changes
// (arcade/room-store.js) and read back when the arcade starts, so a restart
// or a power cut ends nobody's game: the seats, the scores, the round and the
// time left on its clock all come back, and the pages carry on by themselves.

const crypto = require('node:crypto');
const game = require('./game');
const roomPassword = require('../arcade/room-password');
const adultJoin = require('../arcade/adult-join');
const store = require('../arcade/room-store')('scuffle');
const clock = require('../arcade/room-clock');

const rooms = new Map();
const MAX_ROOMS = 200;
const MAX_PLAYERS = 12;
const MAX_WORDS = 300;
const GRACE_MS = 1500;
const TTL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const NOTICE_MS = 15000;
// No O/0 or I/1, so a code is easy to read in a link.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const makeToken = () => crypto.randomBytes(24).toString('hex');
const makeId = () => crypto.randomBytes(8).toString('hex');
const cleanName = (raw, fallback) => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16) || fallback;

function makeCode() {
  let code;
  do code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  while (rooms.has(code));
  return code;
}

const cleanSettings = (s = {}) => ({
  rounds: game.roundsOf(s.rounds),
  seconds: game.secondsOf(s.seconds),
  dictionary: game.profileOf(s.dictionary)
});

function newPlayer(r, name) {
  const used = new Set(r.players.map(p => p.name.toLowerCase()));
  const base = cleanName(name, `Player ${r.players.length + 1}`);
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} ${n}`;
  return { id: makeId(), token: makeToken(), name: out, score: 0, found: new Map(), roundScore: 0, done: false, clients: 0, joinedAt: Date.now() };
}

// screen: this device (a TV) hosts and shows the game, and doesn't play.
function create({ name, settings, password, screen = false }) {
  if (rooms.size >= MAX_ROOMS) sweep();
  if (rooms.size >= MAX_ROOMS) throw fail('Too many games running right now. Try again later.', 503);
  const r = {
    code: makeCode(), settings: cleanSettings(settings), phase: 'lobby', players: [], hostId: null, screen: null,
    rounds: [], index: -1, endsAt: 0, firstFull: null, timer: null, clients: new Set(),
    lastActivity: Date.now(), password: null, history: []
  };
  // The adult list gets a lobby password the host makes up.
  if (r.settings.dictionary === 'adult') r.password = roomPassword.requireNew(password);
  if (screen) {
    r.screen = { id: makeId(), token: makeToken(), name: cleanName(name, 'TV'), clients: 0, screen: true };
    r.hostId = r.screen.id;
    rooms.set(r.code, r);
    store.saveNow(r.code, pack(r));
    return { code: r.code, playerId: r.screen.id, token: r.screen.token };
  }
  const host = newPlayer(r, name || 'Host');
  r.players.push(host);
  r.hostId = host.id;
  rooms.set(r.code, r);
  store.saveNow(r.code, pack(r));
  return { code: r.code, playerId: host.id, token: host.token };
}

// ---- kept between restarts ---------------------------------------------------------
// A room as plain data: everything but who's connected right now and its
// running timer. It holds the seats' tokens, the round's words and, for an
// adult room, its lobby password, so it never leaves the server.
function pack(r) {
  return {
    code: r.code, settings: r.settings, phase: r.phase, hostId: r.hostId, password: r.password,
    players: r.players.map(p => ({
      id: p.id, token: p.token, name: p.name, score: p.score, found: [...p.found], roundScore: p.roundScore,
      done: p.done, joinedAt: p.joinedAt, kid: !!p.kid
    })),
    screen: r.screen ? { id: r.screen.id, token: r.screen.token, name: r.screen.name } : null,
    rounds: r.rounds, index: r.index, endsAt: r.endsAt, firstFull: r.firstFull, history: r.history,
    lastActivity: r.lastActivity
  };
}

// Brings the rooms back when the arcade starts. A round that was being played
// gets the time it had left when it was last written down, because the clock
// stood still while the arcade was away. -> how many came back.
function restore(now = Date.now()) {
  return store.restoreEach(({ code, data, savedAt }) => {
    const good = typeof data.code === 'string' && data.code === code && !rooms.has(code) && Array.isArray(data.players) &&
      data.settings && ['lobby', 'playing', 'reveal', 'over'].includes(data.phase) && (data.players.length || data.screen);
    if (!good || now - (Number(data.lastActivity) || savedAt) > TTL_MS) return false;
    const r = {
      code, settings: cleanSettings(data.settings), phase: data.phase, hostId: data.hostId, password: data.password || null,
      players: data.players.map(p => ({
        id: String(p.id), token: String(p.token), name: cleanName(p.name, 'Player'), score: Number(p.score) || 0,
        found: new Map(Array.isArray(p.found) ? p.found : []), roundScore: Number(p.roundScore) || 0, done: !!p.done,
        clients: 0, joinedAt: Number(p.joinedAt) || now, kid: !!p.kid
      })),
      screen: data.screen ? { id: String(data.screen.id), token: String(data.screen.token), name: cleanName(data.screen.name, 'TV'), clients: 0, screen: true } : null,
      rounds: Array.isArray(data.rounds) ? data.rounds : [], index: Number.isInteger(data.index) ? data.index : -1,
      endsAt: Number(data.endsAt) || 0, firstFull: data.firstFull || null, timer: null, clients: new Set(),
      lastActivity: Number(data.lastActivity) || savedAt, history: Array.isArray(data.history) ? data.history : []
    };
    // An unfiltered room always has its password, and a family one never does.
    r.password = null;
    // A round or a reveal with no round behind it can't be shown: back to the lobby, seats and scores kept.
    if ((r.phase === 'playing' || r.phase === 'reveal') && !r.rounds[r.index]) { r.phase = 'lobby'; r.index = -1; r.rounds = []; }
    if (!member(r, r.hostId)) r.hostId = r.screen ? r.screen.id : r.players.slice().sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
    if (r.phase === 'playing') {
      const left = Math.min(r.settings.seconds * 1000, Math.max(1000, r.endsAt - savedAt));
      r.endsAt = now + left;
      r.timer = clock(left + GRACE_MS, () => endRound(r), () => close(r));
    }
    rooms.set(code, r);
    return true;
  });
}

function room(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw fail('This game isn\'t available.', 404);
  return r;
}

// A device in the room: a player, or the screen.
const member = (r, id) => r.players.find(x => x.id === id) || (r.screen && r.screen.id === id ? r.screen : null);
function authenticate(r, playerId, token) {
  const p = member(r, String(playerId || ''));
  if (!p || !token || p.token !== String(token)) throw fail('You are not in this game.', 403);
  return p;
}
const requireHost = (r, p) => { if (r.hostId !== p.id) throw fail('Only the host can do that.', 403); };

// Joining is open any time, even mid-game: a latecomer starts on zero.
// kid: this device is a kid's or a teen's (arcade/adult-join.js), so it leaves if the game turns adult.
function join(code, name, password, kid = false) {
  const r = room(code);
  roomPassword.check(r, password);
  if (r.players.length >= MAX_PLAYERS) throw fail(`That game is full (${MAX_PLAYERS} players).`, 409);
  const p = newPlayer(r, name);
  p.kid = !!kid;
  r.players.push(p);
  touch(r);
  return { code: r.code, playerId: p.id, token: p.token };
}

function updateSettings(code, playerId, token, settings = {}) {
  const r = room(code);
  requireHost(r, authenticate(r, playerId, token));
  if (r.phase === 'playing' || r.phase === 'reveal') throw fail('Change the settings between games.', 409);
  const next = cleanSettings({ ...r.settings, ...settings });
  // The password comes before anything else, so a switch that's refused changes nothing.
  const turningAdult = next.dictionary === 'adult' && r.settings.dictionary !== 'adult';
  if (next.dictionary === 'adult') { if (!r.password) r.password = roomPassword.requireNew(settings.password); } else r.password = null;
  if (turningAdult) moveOutForAdultWords(r);
  r.settings = next;
  touch(r);
}

// The room just switched to the unfiltered word list, which is only for adults.
// Everyone the arcade doesn't know to be one leaves, and their page is told why.
// The host stays, and so does anyone signed in with ARKS ID as an adult (asked
// now, not remembered from when they joined). A guest can come back with the
// password the host just made up.
function moveOutForAdultWords(r) {
  const going = r.players.filter(p => p.id !== r.hostId && p.kid);
  if (!going.length) return;
  const ids = new Set(going.map(p => p.id));
  r.players = r.players.filter(p => !ids.has(p.id));
  for (const c of [...r.clients]) {
    if (!ids.has(c.playerId)) continue;
    try { c.res.write('event: moved\ndata: {"why":"adult"}\n\n'); c.res.end(); } catch { /* gone */ }
    r.clients.delete(c);
  }
  const names = going.map(p => p.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  r.notice = { id: makeId(), at: Date.now(), text: `${who} ${names.length === 1 ? 'was' : 'were'} removed, the host switched game mode to adult.` };
}

// List Hosted Games and the home page's list of lobbies: every room, for everyone.
// Joining is open any time, so a room that's in the middle of a game is listed
// too, with the round it's on.
function lobbies() {
  return [...rooms.values()].map(r => {
    const host = member(r, r.hostId);
    const going = r.phase === 'playing' || r.phase === 'reveal';
    return {
      code: r.code, host: host ? host.name : '', screen: !!r.screen,
      players: r.players.map(p => p.name), count: r.players.length, max: MAX_PLAYERS,
      status: r.players.length >= MAX_PLAYERS ? 'full' : going ? 'playing' : 'open',
      round: going ? { index: r.index + 1, total: r.rounds.length } : null,
      rounds: r.settings.rounds, seconds: r.settings.seconds,
      adult: r.settings.dictionary === 'adult', locked: !!r.password
    };
  });
}

function start(code, playerId, token) {
  const r = room(code);
  requireHost(r, authenticate(r, playerId, token));
  if (r.phase === 'playing' || r.phase === 'reveal') throw fail('A game is already going.', 409);
  if (!r.players.length) throw fail('Nobody has joined yet.', 409);
  r.rounds = game.makeRounds({ count: r.settings.rounds, profile: r.settings.dictionary });
  r.history = [];
  for (const p of r.players) p.score = 0;
  r.index = -1;
  nextRound(r);
}

function nextRound(r) {
  clearTimeout(r.timer);
  r.index++;
  r.phase = 'playing';
  r.firstFull = null;
  r.endsAt = Date.now() + r.settings.seconds * 1000;
  for (const p of r.players) { p.found = new Map(); p.roundScore = 0; p.done = false; }
  r.timer = clock(r.settings.seconds * 1000 + GRACE_MS, () => endRound(r), () => close(r));
  touch(r);
}

function word(code, playerId, token, raw) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (p.screen) throw fail('TVs display the Game; Players play on devices.', 403);
  if (r.phase !== 'playing' || Date.now() > r.endsAt + GRACE_MS) throw fail('Time\'s up for this round.', 409);
  if (p.found.size >= MAX_WORDS) throw fail('That\'s every word this round can hold.', 409);
  const def = r.rounds[r.index];
  const verdict = game.checkWord(def, raw, p.found);
  if (verdict.ok) {
    // The first person in the room to find the full word gets a bonus.
    const first = verdict.full && !r.firstFull;
    if (first) r.firstFull = { id: p.id, name: p.name };
    verdict.first = first;
    verdict.points = game.pointsFor(verdict.word, def.letters.length, { first });
    p.found.set(verdict.word, verdict.points);
    p.roundScore += verdict.points;
    p.score += verdict.points;
    touch(r);
  }
  return verdict;
}

// "I'm done": when everyone still here is done, the round ends early.
function done(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (r.phase !== 'playing' || p.screen) return;
  p.done = true;
  const here = r.players.filter(x => x.clients > 0 || x.id === p.id);
  if (here.every(x => x.done)) endRound(r); else touch(r);
}

function endRound(r) {
  if (r.phase !== 'playing') return;
  clearTimeout(r.timer);
  const def = r.rounds[r.index];
  r.history.push({
    letters: def.letters, word: def.word, full: def.full, words: def.words, firstFull: r.firstFull,
    players: r.players.map(p => ({ id: p.id, name: p.name, roundScore: p.roundScore, words: [...p.found.keys()] }))
  });
  r.phase = r.index === r.rounds.length - 1 ? 'over' : 'reveal';
  touch(r);
}

function next(code, playerId, token) {
  const r = room(code);
  requireHost(r, authenticate(r, playerId, token));
  if (r.phase === 'playing') endRound(r);
  else if (r.phase === 'reveal') nextRound(r);
}

function leave(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  // The screen going away ends the game: there's nothing left to look at.
  if (p.screen) { close(r); return; }
  r.players = r.players.filter(x => x.id !== p.id);
  if (!r.players.length && !r.screen) { close(r); return; }
  if (r.hostId === p.id) r.hostId = r.players.slice().sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
  touch(r);
}

// What one player is allowed to see. Nobody sees another player's words, or
// the round's words, until the round is over: only how many they've found.
function snapshot(r, viewerId) {
  const me = r.players.find(p => p.id === viewerId);
  const def = r.index >= 0 ? r.rounds[r.index] : null;
  const last = r.history[r.history.length - 1] || null;
  const showing = r.phase === 'reveal' || r.phase === 'over';
  return {
    code: r.code, phase: r.phase, you: viewerId, host: r.hostId === viewerId,
    hostName: (member(r, r.hostId) || {}).name || '',
    // screen: a TV hosts this room; isScreen: you're that TV.
    screen: !!r.screen, isScreen: !!(r.screen && r.screen.id === viewerId),
    locked: !!r.password, lobbyPassword: r.hostId === viewerId ? r.password : null,
    // Something everyone still in the room should read once (who was moved out, and why).
    notice: r.notice && Date.now() - r.notice.at < NOTICE_MS ? { id: r.notice.id, text: r.notice.text } : null,
    settings: r.settings, maxPlayers: MAX_PLAYERS,
    index: r.index, totalRounds: r.rounds.length || r.settings.rounds,
    endsAt: r.phase === 'playing' ? r.endsAt : null, serverNow: Date.now(),
    round: def && r.phase === 'playing' ? {
      letters: def.letters, length: def.letters.length, wordCount: def.words.length,
      firstFull: r.firstFull ? r.firstFull.name : null
    } : null,
    mine: me ? { found: [...me.found].map(([word, points]) => ({ word, points })), roundScore: me.roundScore, done: me.done } : null,
    players: r.players.map(p => ({
      id: p.id, name: p.name, score: p.score, roundScore: p.roundScore, count: p.found.size,
      gotFull: def ? [...p.found.keys()].some(w => w.length === def.letters.length) : false,
      done: p.done, online: p.clients > 0
    })),
    reveal: showing && last ? last : null
  };
}

function touch(r) {
  r.lastActivity = Date.now();
  // Written down within a moment, unless the room closed in the meantime.
  store.saveSoon(r.code, () => (rooms.get(r.code) === r ? pack(r) : null));
  for (const c of r.clients) {
    try { c.res.write(`event: state\ndata: ${JSON.stringify(snapshot(r, c.playerId))}\n\n`); } catch { /* closed */ }
  }
}

function subscribe(code, playerId, token, res) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const client = { playerId: p.id, res };
  r.clients.add(client);
  p.clients++;
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  touch(r);
  const closed = () => {
    clearInterval(heartbeat);
    if (r.clients.delete(client)) { p.clients = Math.max(0, p.clients - 1); touch(r); }
  };
  res.on('close', closed);
  res.on('error', closed);
}

function close(r) {
  clearTimeout(r.timer);
  for (const c of r.clients) { try { c.res.end(); } catch { /* gone */ } }
  rooms.delete(r.code);
  store.remove(r.code);
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const r of [...rooms.values()]) if (r.lastActivity < cutoff) close(r);
}
const sweeper = setInterval(sweep, 10 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

// The rooms that were open when the arcade last stopped.
const cameBack = restore();
if (cameBack) console.log(`Shuffle Scuffle picked ${cameBack} room${cameBack === 1 ? '' : 's'} back up.`);

module.exports = {
  MAX_PLAYERS, create, join, updateSettings, start, word, done, next, leave, snapshot, room, authenticate,
  subscribe, cleanSettings, lobbies, _rooms: rooms
};
