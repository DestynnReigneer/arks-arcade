'use strict';

// Know-It-All on everyone's phone: a room code, everyone answers each
// question at the same time, faster right answers score more. The server
// runs the clock and keeps the right answer to itself until time's up.

const crypto = require('node:crypto');
const store = require('./store');
const bank = require('./bank');
const Rules = require('../public/trivia-rules');
const roomPassword = require('../arcade/room-password');

const rooms = new Map();
const MAX_ROOMS = 200;
const MAX_PLAYERS = 12;
const REVEAL_MS = 6000;
const REVEAL_EXTRA_MS = 3500;       // more time to read a drink or a dare
const TTL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const makeToken = () => crypto.randomBytes(24).toString('hex');
const makeId = () => crypto.randomBytes(8).toString('hex');
const cleanName = (raw, fallback) => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16) || fallback;

function makeCode() {
  let code;
  do code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  while (rooms.has(code));
  return code;
}

// Settings from the setup screen, kept within sensible bounds.
function cleanSettings(s = {}) {
  const level = bank.levelOf(s.level);
  const adult = bank.LEVELS[level].adult;
  return {
    level,
    drinking: adult && !!s.drinking,
    couples: adult && !!s.couples,
    genres: (Array.isArray(s.genres) ? s.genres : []).map(g => String(g).slice(0, 30)).slice(0, 30),
    difficulty: ['easy', 'medium', 'hard'].includes(s.difficulty) ? s.difficulty : 'mixed',
    count: [5, 10, 15, 20].includes(Number(s.count)) ? Number(s.count) : 10,
    seconds: [10, 15, 20, 30].includes(Number(s.seconds)) ? Number(s.seconds) : 20,
    packId: Number(s.packId) || null
  };
}

function create({ name, settings, password }) {
  if (rooms.size >= MAX_ROOMS) throw fail('Too many trivia games running. Try again later.', 503);
  const host = { id: makeId(), token: makeToken(), name: cleanName(name, 'Host'), score: 0, streak: 0, clients: 0 };
  const r = {
    code: makeCode(), hostId: host.id, players: [host], settings: cleanSettings(settings),
    phase: 'lobby', qIndex: -1, questions: [], answers: {}, qEndsAt: 0, qStartedAt: 0,
    reveal: null, finale: null, timer: null, clients: new Set(), lastActivity: Date.now(),
    password: null
  };
  // Adult games get a lobby password the host makes up; guests need it to join.
  if (bank.LEVELS[r.settings.level].adult) r.password = roomPassword.requireNew(password);
  rooms.set(r.code, r);
  return { code: r.code, playerId: host.id, token: host.token };
}

function room(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw fail('No trivia game with that code.', 404);
  return r;
}

function authenticate(r, playerId, token) {
  const p = r.players.find(x => x.id === playerId);
  if (!p || p.token !== token) throw fail('You are not in this game.', 403);
  return p;
}

function join(code, name, password) {
  const r = room(code);
  roomPassword.check(r, password);
  if (r.phase !== 'lobby') throw fail('That game has already started.', 409);
  if (r.players.length >= MAX_PLAYERS) throw fail('That game is full.', 409);
  const used = new Set(r.players.map(p => p.name.toLowerCase()));
  let base = cleanName(name, `Player ${r.players.length + 1}`);
  let nameOut = base;
  for (let n = 2; used.has(nameOut.toLowerCase()); n++) nameOut = `${base} ${n}`;
  const p = { id: makeId(), token: makeToken(), name: nameOut, score: 0, streak: 0, clients: 0 };
  r.players.push(p);
  touch(r);
  return { code: r.code, playerId: p.id, token: p.token };
}

function touch(r) { r.lastActivity = Date.now(); broadcast(r); }
const extras = level => bank.LEVELS[level].adult
  ? { drinks: bank.DRINKS[level], dares: bank.DARES[level] }
  : { drinks: null, dares: null };

function start(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (p.id !== r.hostId) throw fail('Only the host can start.', 403);
  if (r.phase !== 'lobby' && r.phase !== 'over') throw fail('Already playing.', 409);
  const s = r.settings;
  r.questions = store.pick({ level: s.level, genres: s.genres, difficulty: s.difficulty, count: s.count, packId: s.packId }).map(store.deal);
  if (!r.questions.length) throw fail('No questions match those settings.', 409);
  for (const x of r.players) { x.score = 0; x.streak = 0; }
  r.qIndex = -1;
  r.finale = null;
  nextQuestion(r);
}

function nextQuestion(r) {
  clearTimeout(r.timer);
  r.qIndex++;
  if (r.qIndex >= r.questions.length) return finish(r);
  r.phase = 'question';
  r.answers = {};
  r.reveal = null;
  r.qStartedAt = Date.now();
  r.qEndsAt = r.qStartedAt + r.settings.seconds * 1000;
  r.timer = setTimeout(() => reveal(r), r.settings.seconds * 1000 + 200);
  touch(r);
}

function answer(code, playerId, token, choice) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (r.phase !== 'question') throw fail('Not taking answers right now.', 409);
  if (r.answers[p.id]) throw fail('You already answered.', 409);
  const q = r.questions[r.qIndex];
  const c = Number(choice);
  if (!Number.isInteger(c) || c < 0 || c >= q.answers.length) throw fail('Pick one of the answers.');
  r.answers[p.id] = { choice: c, at: Date.now() };
  // Everyone's in: no need to wait for the clock.
  const online = r.players.filter(x => x.clients > 0 || x.id === p.id);
  if (online.every(x => r.answers[x.id])) reveal(r);
  else touch(r);
}

function reveal(r) {
  if (r.phase !== 'question') return;
  clearTimeout(r.timer);
  const q = r.questions[r.qIndex];
  const total = r.settings.seconds * 1000;
  const results = r.players.map(p => {
    const a = r.answers[p.id];
    const correct = !!a && a.choice === q.correctIndex;
    const pts = Rules.points(q.difficulty, correct, a ? r.qEndsAt - a.at : 0, total);
    p.score += pts;
    p.streak = correct ? p.streak + 1 : 0;
    return { id: p.id, name: p.name, choice: a ? a.choice : null, correct, points: pts, streak: p.streak };
  });
  const callouts = Rules.afterQuestion(results, { ...r.settings, ...extras(r.settings.level) });
  r.phase = 'reveal';
  r.reveal = { correctIndex: q.correctIndex, results, callouts };
  r.timer = setTimeout(() => nextQuestion(r), REVEAL_MS + (callouts.length ? REVEAL_EXTRA_MS : 0));
  touch(r);
}

function next(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (p.id !== r.hostId) throw fail('Only the host can skip ahead.', 403);
  if (r.phase === 'reveal') nextQuestion(r);
  else if (r.phase === 'question') reveal(r);
}

function finish(r) {
  clearTimeout(r.timer);
  r.phase = 'over';
  const standings = r.players.map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
  r.finale = { standings, callouts: Rules.afterGame(standings, { ...r.settings, ...extras(r.settings.level) }) };
  touch(r);
}

function leave(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  r.players = r.players.filter(x => x.id !== p.id);
  if (!r.players.length) { close(r); return; }
  if (r.hostId === p.id) r.hostId = r.players[0].id;
  touch(r);
}

function snapshot(r, viewerId) {
  const q = r.qIndex >= 0 && r.qIndex < r.questions.length ? r.questions[r.qIndex] : null;
  const showQ = q && (r.phase === 'question' || r.phase === 'reveal');
  return {
    code: r.code,
    phase: r.phase,
    you: viewerId,
    host: r.hostId === viewerId,
    locked: !!r.password,
    lobbyPassword: r.hostId === viewerId ? r.password : null,
    hostName: (r.players.find(p => p.id === r.hostId) || {}).name,
    settings: { ...r.settings, levelLabel: bank.LEVELS[r.settings.level].label },
    players: r.players.map(p => ({ id: p.id, name: p.name, score: p.score, streak: p.streak, online: p.clients > 0, answered: !!r.answers[p.id] })),
    question: showQ ? {
      index: r.qIndex, total: r.questions.length, genre: q.genre, difficulty: q.difficulty,
      question: q.question, answers: q.answers
    } : null,
    yourChoice: r.answers[viewerId] ? r.answers[viewerId].choice : null,
    endsAt: r.phase === 'question' ? r.qEndsAt : null,
    serverNow: Date.now(),
    reveal: r.phase === 'reveal' ? r.reveal : null,
    finale: r.phase === 'over' ? r.finale : null
  };
}

// ---- live updates ----------------------------------------------------------------

function broadcast(r) {
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
  broadcast(r);
  const close = () => {
    clearInterval(heartbeat);
    if (r.clients.delete(client)) { p.clients = Math.max(0, p.clients - 1); broadcast(r); }
  };
  res.on('close', close);
  res.on('error', close);
}

function close(r) {
  clearTimeout(r.timer);
  for (const c of r.clients) { try { c.res.end(); } catch { /* gone */ } }
  rooms.delete(r.code);
}

const sweeper = setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const r of [...rooms.values()]) if (r.lastActivity < cutoff) close(r);
}, 10 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = { create, join, start, answer, next, leave, snapshot, room, authenticate, subscribe, cleanSettings, _rooms: rooms };
