'use strict';

const crypto = require('node:crypto');

// The rolled boards, held server-side so scoring never trusts the client: the
// browser is told the letters, but every word it claims is re-walked here
// against the board the server actually rolled.
//
// This lives in its own module because both the single-device routes and the
// room state machine need to put boards in it. Rooms have to stash a board
// *before* they broadcast the round start, or clients receive a null board id
// and every word check 404s.
//
// A board for a round on one device (solo, the daily, or taking turns)
// is also written down (keep), and read back when the arcade starts, so a
// round that was being played can still be checked and scored after a
// restart. A room's board isn't: it's kept with its room (rooms.js).
const boards = new Map();
const store = require('../arcade/room-store')('rambler-boards');
const TTL_MS = 60 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;

// id: only when a room's board comes back after a restart, so the pages in the
// middle of that round can keep checking words against the id they have.
function stash(built, id) {
  const kept = typeof id === 'string' && /^[0-9a-f]{24}$/.test(id) && !boards.has(id) ? id : null;
  const key = kept || crypto.randomBytes(12).toString('hex');
  boards.set(key, { ...built, id: key, createdAt: Date.now(), result: null });
  return boards.get(key);
}

// Writes a board down, with whatever has been added to it since it was stashed (its result, once scored).
function keep(entry) {
  if (entry && boards.get(entry.id) === entry) store.saveSoon(entry.id, () => ({ ...entry }));
  return entry;
}

// Brings the kept boards back when the arcade starts. -> how many came back.
function restore(now = Date.now()) {
  return store.restoreEach(({ code, data, savedAt }) => {
    const createdAt = Number(data.createdAt) || savedAt;
    const good = /^[0-9a-f]{24}$/.test(code) && data.id === code && !boards.has(code) && Array.isArray(data.board) && data.board.length > 0 &&
      Number.isInteger(data.cols) && Number.isInteger(data.rows) && typeof data.profile === 'string';
    if (!good || now - createdAt > TTL_MS) return false;
    boards.set(code, { ...data, id: code, createdAt, result: data.result || null });
    return true;
  });
}

function get(id) {
  return boards.get(String(id || '')) || null;
}

function require_(id) {
  const entry = get(id);
  if (!entry) {
    throw Object.assign(new Error('That board has expired. Start a new round.'), { status: 404 });
  }
  return entry;
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of boards) {
    if (entry.createdAt < cutoff) { boards.delete(id); store.remove(id); }
  }
}

const sweeper = setInterval(sweep, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

const cameBack = restore();
if (cameBack) console.log(`Rambler picked ${cameBack} board${cameBack === 1 ? '' : 's'} back up.`);

module.exports = {
  stash,
  keep,
  get,
  require: require_,
  sweep,
  get count() { return boards.size; }
};
