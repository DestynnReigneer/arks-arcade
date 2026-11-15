'use strict';

// Rooms kept between restarts.
//
// A game's rooms live in memory, because they're busy: a clock, live updates,
// a word every second. This writes each room down as it changes and hands
// them back when the arcade starts, so a restart (a new image) or a power cut
// ends nobody's game. Each game decides what a room looks like as plain data
// and how to bring one back; this only keeps the text.
//
//   const store = require('../arcade/room-store')('scuffle');
//   store.saveSoon(code, () => pack(room))   written within a moment; changes in a row become one write
//   store.saveNow(code, pack(room))          written at once
//   store.remove(code)                       the room closed
//   store.restoreEach(row => { ... })       each kept room, once, when the arcade starts (row: { code, data, savedAt })
//
// What's written holds seat tokens and, for an adult room, its lobby
// password, so it stays in the database and no route ever sends it out.

const db = require('../db');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS saved_rooms (
    game TEXT NOT NULL,
    code TEXT NOT NULL,
    data TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (game, code)
  );
`);

// How long a change may wait to be written. Short enough that a restart loses
// next to nothing, long enough that ten words found in one second are one write.
const WAIT_MS = 400;
const stores = [];

function roomStore(game) {
  const put = db.db.prepare(`INSERT INTO saved_rooms (game, code, data, saved_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (game, code) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at`);
  const del = db.db.prepare('DELETE FROM saved_rooms WHERE game = ? AND code = ?');
  const waiting = new Map();   // code -> { timer, pack }

  function forget(code) {
    const w = waiting.get(code);
    if (!w) return null;
    clearTimeout(w.timer);
    waiting.delete(code);
    return w;
  }
  function saveNow(code, data) {
    forget(code);
    if (!data) return;
    try { put.run(game, String(code), JSON.stringify(data), Date.now()); } catch (e) { console.error(`${game}: a room could not be saved:`, e.message); }
  }
  function write(code, pack) {
    let data = null;
    try { data = pack(); } catch (e) { console.error(`${game}: a room could not be saved:`, e.message); }
    saveNow(code, data);
  }
  function saveSoon(code, pack) {
    const w = waiting.get(code);
    if (w) { w.pack = pack; return; }
    const entry = { pack, timer: null };
    entry.timer = setTimeout(() => { waiting.delete(code); write(code, entry.pack); }, WAIT_MS);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
    waiting.set(code, entry);
  }
  function remove(code) {
    forget(code);
    try { del.run(game, String(code)); } catch { /* it's gone from memory either way */ }
  }
  // Rows that can't be read anymore are cleared instead of stopping the arcade from starting.
  function all() {
    const out = [];
    for (const row of db.db.prepare('SELECT code, data, saved_at FROM saved_rooms WHERE game = ?').all(game)) {
      let data = null;
      try { data = JSON.parse(row.data); } catch { /* not a room anymore */ }
      if (data && typeof data === 'object') out.push({ code: row.code, data, savedAt: row.saved_at });
      else remove(row.code);
    }
    return out;
  }
  // Hands each kept room to bring(), one at a time, when the arcade starts. A room
  // bring() can't put back together (it throws, or returns false) is said in the
  // log and removed, so one bad row can never keep the arcade from starting.
  // -> how many came back.
  function restoreEach(bring) {
    let back = 0;
    for (const row of all()) {
      let came = false;
      try { came = bring(row) !== false; } catch (e) { console.error(`${game}: left out a saved room that could not be read: ${e.message}`); }
      if (came) back++; else remove(row.code);
    }
    return back;
  }
  // Everything still waiting, written now.
  function flush() {
    for (const [code, w] of [...waiting]) { forget(code); write(code, w.pack); }
  }
  const store = { saveSoon, saveNow, remove, all, restoreEach, flush };
  stores.push(store);
  return store;
}

// For when the arcade is told to stop: nothing a room changed in its last moment is lost.
roomStore.flushAll = () => { for (const s of stores) { try { s.flush(); } catch { /* the others still get their turn */ } } };

module.exports = roomStore;
