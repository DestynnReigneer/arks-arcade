'use strict';

// Shuffle Scuffle rooms: a four-letter code, a phone each, everyone racing
// on the same letters at the same time. The server keeps the clock, checks
// every word and adds up every score; phones only send the words people type.
// Rooms live in memory, like the other games' rooms.

const crypto = require('node:crypto');
const game = require('./game');
const roomPassword = require('../arcade/room-password');

const rooms = new Map();
const MAX_ROOMS = 200;
const MAX_PLAYERS = 12;
const MAX_WORDS = 300;
const GRACE_MS = 1500;
const TTL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25000;
// No O/0 or I/1: these get read aloud across a room.
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

function create({ name, settings, password }) {
  if (rooms.size >= MAX_ROOMS) sweep();
  if (rooms.size >= MAX_ROOMS) throw fail('Too many games running right now. Try again later.', 503);
  const r = {
    code: makeCode(), settings: cleanSettings(settings), phase: 'lobby', players: [], hostId: null,
    rounds: [], index: -1, endsAt: 0, firstFull: null, timer: null, clients: new Set(),
    lastActivity: Date.now(), password: null, history: []
  };
  // The grown-up list gets a lobby password the host makes up.
  if (r.settings.dictionary === 'adult') r.password = roomPassword.requireNew(password);
  const host = newPlayer(r, name || 'Host');
  r.players.push(host);
  r.hostId = host.id;
  rooms.set(r.code, r);
  return { code: r.code, playerId: host.id, token: host.token };
}

function room(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw fail('No Shuffle Scuffle game with that code.', 404);
  return r;
}

function authenticate(r, playerId, token) {
  const p = r.players.find(x => x.id === String(playerId || ''));
  if (!p || !token || p.token !== String(token)) throw fail('You are not in this game.', 403);
  return p;
}
const requireHost = (r, p) => { if (r.hostId !== p.id) throw fail('Only the host can do that.', 403); };

// Joining is open any time, even mid-game: a latecomer starts on zero.
function join(code, name, password) {
  const r = room(code);
  roomPassword.check(r, password);
  if (r.players.length >= MAX_PLAYERS) throw fail(`That game is full (${MAX_PLAYERS} players).`, 409);
  const p = newPlayer(r, name);
  r.players.push(p);
  touch(r);
  return { code: r.code, playerId: p.id, token: p.token };
}

function updateSettings(code, playerId, token, settings = {}) {
  const r = room(code);
  requireHost(r, authenticate(r, playerId, token));
  if (r.phase === 'playing' || r.phase === 'reveal') throw fail('Change the settings between games.', 409);
  const next = cleanSettings({ ...r.settings, ...settings });
  if (next.dictionary === 'adult') { if (!r.password) r.password = roomPassword.requireNew(settings.password); } else r.password = null;
  r.settings = next;
  touch(r);
}

function start(code, playerId, token) {
  const r = room(code);
  requireHost(r, authenticate(r, playerId, token));
  if (r.phase === 'playing' || r.phase === 'reveal') throw fail('A game is already going.', 409);
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
  r.timer = setTimeout(() => endRound(r), r.settings.seconds * 1000 + GRACE_MS);
  touch(r);
}

function word(code, playerId, token, raw) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
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
  if (r.phase !== 'playing') return;
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
  r.players = r.players.filter(x => x.id !== p.id);
  if (!r.players.length) { close(r); return; }
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
    hostName: (r.players.find(p => p.id === r.hostId) || {}).name || '',
    locked: !!r.password, lobbyPassword: r.hostId === viewerId ? r.password : null,
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
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const r of [...rooms.values()]) if (r.lastActivity < cutoff) close(r);
}
const sweeper = setInterval(sweep, 10 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = {
  MAX_PLAYERS, create, join, updateSettings, start, word, done, next, leave, snapshot, room, authenticate,
  subscribe, cleanSettings, _rooms: rooms
};
