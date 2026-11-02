'use strict';

// Know-It-All with a room code. The server runs the clock, keeps the right
// answer to itself until time's up, and decides every score.
//
// Two styles:
//   - together: everyone answers each question on their own phone at the same
//     time, and faster right answers score more.
//   - turns: each question belongs to one player in turn. A device can hold
//     several players (seats), so one phone can be passed around, or the TV
//     remote can play for everyone. Before each turn the room waits until
//     that player says they're ready, then the clock starts.
//
// A room can also be shown on a screen (a TV): the screen hosts it, shows the
// questions, the code to join and the scores, and isn't a player itself.

const crypto = require('node:crypto');
const store = require('./store');
const bank = require('./bank');
const Rules = require('../public/trivia-rules');
const roomPassword = require('../arcade/room-password');

const rooms = new Map();
const MAX_ROOMS = 200;
const MAX_PLAYERS = 12;
const MAX_TURN_QUESTIONS = 100;
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
    packId: Number(s.packId) || null,
    style: s.style === 'turns' ? 'turns' : 'together'
  };
}
const turns = r => r.settings.style === 'turns';

// screen: this device shows the game (a TV) and doesn't play.
function create({ name, settings, password, screen = false }) {
  if (rooms.size >= MAX_ROOMS) throw fail('Too many trivia games running. Try again later.', 503);
  const host = { id: makeId(), token: makeToken(), name: cleanName(name, screen ? 'TV' : 'Host'), score: 0, streak: 0, clients: 0, owner: null };
  const r = {
    code: makeCode(), hostId: host.id, players: screen ? [] : [host], screen: screen ? { ...host, screen: true } : null,
    settings: cleanSettings(settings),
    phase: 'lobby', qIndex: -1, questions: [], answers: {}, qEndsAt: 0, qStartedAt: 0, turnId: null,
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

// A device in the room: a player, or the screen.
const member = (r, id) => r.players.find(x => x.id === id) || (r.screen && r.screen.id === id ? r.screen : null);

function authenticate(r, playerId, token) {
  const p = member(r, playerId);
  if (!p || !p.token || p.token !== token) throw fail('You are not in this game.', 403);
  return p;
}

// Can this device answer for that player? Its own, or a seat it holds.
const controls = (device, player) => !!player && !player.screen && (player.id === device.id || player.owner === device.id);

function uniqueName(r, raw) {
  const used = new Set(r.players.map(p => p.name.toLowerCase()));
  const base = cleanName(raw, `Player ${r.players.length + 1}`);
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} ${n}`;
  return out;
}

function join(code, name, password) {
  const r = room(code);
  roomPassword.check(r, password);
  if (r.phase !== 'lobby') throw fail('That game has already started.', 409);
  if (r.players.length >= MAX_PLAYERS) throw fail('That game is full.', 409);
  const p = { id: makeId(), token: makeToken(), name: uniqueName(r, name), score: 0, streak: 0, clients: 0, owner: null };
  r.players.push(p);
  touch(r);
  return { code: r.code, playerId: p.id, token: p.token };
}

// Another player on this device, for taking turns (passing one phone
// around, or the TV remote playing for everyone).
function addSeat(code, playerId, token, name) {
  const r = room(code);
  const device = authenticate(r, playerId, token);
  if (!turns(r)) throw fail('Extra players on one device are for games where you take turns.', 400);
  if (r.phase !== 'lobby') throw fail('That game has already started.', 409);
  if (r.players.length >= MAX_PLAYERS) throw fail('That game is full.', 409);
  const seat = { id: makeId(), token: null, name: uniqueName(r, name), score: 0, streak: 0, clients: 0, owner: device.id };
  r.players.push(seat);
  touch(r);
  return { seatId: seat.id, name: seat.name };
}

function removeSeat(code, playerId, token, seatId) {
  const r = room(code);
  const device = authenticate(r, playerId, token);
  const seat = r.players.find(x => x.id === seatId);
  if (!seat || seat.owner !== device.id) throw fail('That player isn\'t on this device.', 403);
  if (r.phase !== 'lobby') throw fail('That game has already started.', 409);
  r.players = r.players.filter(x => x !== seat);
  touch(r);
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
  if (!r.players.length) throw fail('Nobody has joined yet.', 409);
  const s = r.settings;
  // Taking turns: everyone gets the number of questions picked.
  const count = turns(r) ? Math.min(MAX_TURN_QUESTIONS, s.count * r.players.length) : s.count;
  r.questions = store.pick({ level: s.level, genres: s.genres, difficulty: s.difficulty, count, packId: s.packId }).map(store.deal);
  if (!r.questions.length) throw fail('No questions match those settings.', 409);
  for (const x of r.players) { x.score = 0; x.streak = 0; }
  r.qIndex = -1;
  r.finale = null;
  nextQuestion(r);
}

function nextQuestion(r) {
  clearTimeout(r.timer);
  r.qIndex++;
  if (r.qIndex >= r.questions.length || !r.players.length) return finish(r);
  r.answers = {};
  r.reveal = null;
  if (turns(r)) {
    // Whose turn: round the table. The clock waits until they're ready.
    r.turnId = r.players[r.qIndex % r.players.length].id;
    r.phase = 'ready';
    touch(r);
    return;
  }
  startClock(r);
}

function startClock(r) {
  r.phase = 'question';
  r.qStartedAt = Date.now();
  r.qEndsAt = r.qStartedAt + r.settings.seconds * 1000;
  r.timer = setTimeout(() => reveal(r), r.settings.seconds * 1000 + 200);
  touch(r);
}

// Taking turns: the player whose turn it is (or whoever holds their device,
// or the host) says they're ready, and the clock starts.
function ready(code, playerId, token) {
  const r = room(code);
  const device = authenticate(r, playerId, token);
  if (r.phase !== 'ready') throw fail('Not waiting for anyone right now.', 409);
  const turn = r.players.find(x => x.id === r.turnId);
  if (device.id !== r.hostId && !controls(device, turn)) throw fail('It\'s not your turn.', 403);
  startClock(r);
}

// seat: which player this device is answering for (a seat it holds).
function answer(code, playerId, token, choice, seat) {
  const r = room(code);
  const device = authenticate(r, playerId, token);
  if (r.phase !== 'question') throw fail('Not taking answers right now.', 409);
  const p = seat ? r.players.find(x => x.id === seat) : device;
  if (!controls(device, p)) throw fail('You can only answer for the players on your device.', 403);
  if (turns(r) && p.id !== r.turnId) throw fail('It\'s not your turn.', 409);
  if (r.answers[p.id]) throw fail('You already answered.', 409);
  const q = r.questions[r.qIndex];
  const c = Number(choice);
  if (!Number.isInteger(c) || c < 0 || c >= q.answers.length) throw fail('Pick one of the answers.');
  r.answers[p.id] = { choice: c, at: Date.now() };
  // Everyone's in: no need to wait for the clock.
  if (turns(r)) return reveal(r);
  const online = r.players.filter(x => x.clients > 0 || x.id === p.id);
  if (online.every(x => r.answers[x.id])) reveal(r);
  else touch(r);
}

function reveal(r) {
  if (r.phase !== 'question') return;
  clearTimeout(r.timer);
  const q = r.questions[r.qIndex];
  const total = r.settings.seconds * 1000;
  // Taking turns, only the player whose turn it was is scored.
  const scored = turns(r) ? r.players.filter(p => p.id === r.turnId) : r.players;
  const results = scored.map(p => {
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
  else if (r.phase === 'ready') startClock(r);
}

function finish(r) {
  clearTimeout(r.timer);
  r.phase = 'over';
  r.turnId = null;
  const standings = r.players.map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
  r.finale = { standings, callouts: Rules.afterGame(standings, { ...r.settings, ...extras(r.settings.level) }) };
  touch(r);
}

function leave(code, playerId, token) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  // The screen going away ends the game: there's nothing left to watch.
  if (p.screen) { close(r); return; }
  // A device leaving takes its seats with it.
  r.players = r.players.filter(x => x.id !== p.id && x.owner !== p.id);
  if (!r.players.length && !r.screen) { close(r); return; }
  if (r.hostId === p.id) r.hostId = r.players[0].id;
  if (r.turnId && !r.players.some(x => x.id === r.turnId)) {
    // Whoever's turn it was has gone: on to the next question.
    if (r.phase === 'ready' || r.phase === 'question') { r.phase = 'reveal'; r.reveal = { correctIndex: null, results: [], callouts: [] }; nextQuestion(r); return; }
  }
  touch(r);
}

function snapshot(r, viewerId) {
  const q = r.qIndex >= 0 && r.qIndex < r.questions.length ? r.questions[r.qIndex] : null;
  const showQ = q && (r.phase === 'question' || r.phase === 'reveal');
  const viewer = member(r, viewerId);
  const turn = r.turnId && ['ready', 'question', 'reveal'].includes(r.phase) ? r.players.find(p => p.id === r.turnId) : null;
  const host = member(r, r.hostId);
  // The players this device answers for.
  const mine = viewer ? r.players.filter(p => controls(viewer, p)).map(p => p.id) : [];
  const answering = turn ? (mine.includes(turn.id) ? turn.id : null) : (viewer && !viewer.screen ? viewer.id : null);
  return {
    code: r.code,
    phase: r.phase,
    you: viewerId,
    host: r.hostId === viewerId,
    isScreen: !!(viewer && viewer.screen),
    screen: !!r.screen,
    locked: !!r.password,
    lobbyPassword: r.hostId === viewerId ? r.password : null,
    hostName: host ? host.name : '',
    settings: { ...r.settings, levelLabel: bank.LEVELS[r.settings.level].label },
    players: r.players.map(p => ({
      id: p.id, name: p.name, score: p.score, streak: p.streak, answered: !!r.answers[p.id],
      online: p.owner ? !!(member(r, p.owner) || {}).clients : p.clients > 0,
      // Whose device a seat is on: the screen's, or another player's.
      on: p.owner ? (r.screen && r.screen.id === p.owner ? 'screen' : (r.players.find(x => x.id === p.owner) || {}).name || null) : null
    })),
    mine,
    turn: turn ? { id: turn.id, name: turn.name, yours: mine.includes(turn.id) } : null,
    question: showQ ? {
      index: r.qIndex, total: r.questions.length, genre: q.genre, difficulty: q.difficulty,
      question: q.question, answers: q.answers
    } : null,
    upNext: q && r.phase === 'ready' ? { index: r.qIndex, total: r.questions.length, genre: q.genre, difficulty: q.difficulty } : null,
    answeringFor: answering,
    yourChoice: answering && r.answers[answering] ? r.answers[answering].choice : null,
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

module.exports = { create, join, addSeat, removeSeat, start, ready, answer, next, leave, snapshot, room, authenticate, subscribe, cleanSettings, _rooms: rooms };
