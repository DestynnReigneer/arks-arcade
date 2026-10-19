'use strict';

// Two-phone chess. Each game is a four-letter code with one seat per color.
// The server owns the position and checks every move with the same engine the
// page uses, so a phone can only ever play a legal move. Kept in memory, like
// the other games' rooms, and pushed to both phones over server-sent events.

const crypto = require('node:crypto');
const Chess = require('../public/chess-engine');

const rooms = new Map();
const MAX_ROOMS = 300;
const TTL_MS = 12 * 60 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;
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
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function newGame(r) {
  r.state = Chess.fromFen();
  r.moves = [];
  r.lastMove = null;
  r.ended = null;       // { result, reason, winner }
  r.drawOffer = null;   // color that offered
  r.rematch = new Set();
}

function create({ name, color }) {
  if (rooms.size >= MAX_ROOMS) throw fail('The arcade is full of chess games. Try again later.', 503);
  const pick = color === 'w' || color === 'b' ? color : (crypto.randomInt(2) ? 'w' : 'b');
  const host = { id: makeId(), token: makeToken(), name: cleanName(name, 'Player 1'), color: pick, clients: 0 };
  const r = { code: makeCode(), players: [host], clients: new Set(), lastActivity: Date.now() };
  newGame(r);
  rooms.set(r.code, r);
  return { code: r.code, playerId: host.id, token: host.token, color: host.color };
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

function join(code, name) {
  const r = room(code);
  if (r.players.length >= 2) throw fail('That game already has two players.', 409);
  const taken = r.players[0].color;
  const p = { id: makeId(), token: makeToken(), name: cleanName(name, 'Player 2'), color: taken === 'w' ? 'b' : 'w', clients: 0 };
  r.players.push(p);
  r.lastActivity = Date.now();
  broadcast(r);
  return { code: r.code, playerId: p.id, token: p.token, color: p.color };
}

function snapshot(r, viewerId) {
  const seat = c => {
    const p = r.players.find(x => x.color === c);
    return p ? { name: p.name, online: p.clients > 0 } : null;
  };
  const me = r.players.find(p => p.id === viewerId);
  const live = Chess.status(r.state);
  return {
    code: r.code,
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

function move(code, playerId, token, wanted) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  if (r.players.length < 2) throw fail('Wait for your opponent to join.', 409);
  if (r.ended) throw fail('This game is over.', 409);
  if (r.state.turn !== p.color) throw fail('It is not your turn.', 409);
  const played = Chess.play(r.state, wanted || {});
  if (!played) throw fail('That move is not allowed.', 400);
  r.moves.push(played.san);
  r.lastMove = { from: played.from, to: played.to };
  r.drawOffer = null;
  const s = Chess.status(r.state);
  if (s.over) finish(r, { result: s.result, reason: s.reason, winner: s.winner });
  r.lastActivity = Date.now();
  broadcast(r);
  return snapshot(r, p.id);
}

function act(code, playerId, token, action) {
  const r = room(code);
  const p = authenticate(r, playerId, token);
  r.lastActivity = Date.now();
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
  broadcast(r);
  return snapshot(r, p.id);
}

// ---- live updates ---------------------------------------------------------------

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

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const r of [...rooms.values()]) {
    if (r.lastActivity >= cutoff) continue;
    for (const c of r.clients) { try { c.res.end(); } catch { /* gone */ } }
    rooms.delete(r.code);
  }
}
const sweeper = setInterval(sweep, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = { create, join, move, act, snapshot, room, authenticate, subscribe, _rooms: rooms };
