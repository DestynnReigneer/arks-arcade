'use strict';

// The live chat in a game's lobby and next to the board, like a stream chat.
//
// Each game keeps its rooms its own way; this keeps their chat. A message is
// stored with the game and room it belongs to, so a game that lasts days keeps
// its chat, and it's cleared when the room is (clear()).
//
// In family games (anything that isn't an adult room) every word the kids word
// list turns away is starred out before anyone sees it. The room's host can mute
// someone, and each seat can send at most 5 messages in 10 seconds.

const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

const MAX_TEXT = 200;
const KEEP = 60;             // messages a room hands out (the most recent)
const STORE = 200;           // messages a room keeps; older ones are deleted
const BURST = 5, BURST_MS = 10 * 1000;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS room_chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    room TEXT NOT NULL,
    at INTEGER NOT NULL,
    seat TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    system INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS room_chat_room ON room_chat (game, room, id);
`);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// ---- the family filter ----------------------------------------------------------------------------------
// The kids blocklist and the words only the unfiltered list has. (spice-adult.txt
// is left out: it only steers which Rambler boards come up, and it's full of
// everyday words like STRIP and DRUNK.) The kids allowlist wins, the same as in
// the dictionary (rambler/dictionary.js).
const readWords = file => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'words', file), 'utf8').split(/\r?\n/)
      .map(l => l.replace(/#.*/, '').trim().toLowerCase()).filter(w => /^[a-z]{3,}$/.test(w));
  } catch { return []; }
};
let blocked = null;
function blockedWords() {
  if (blocked) return blocked;
  blocked = new Set([...readWords('blocklist-kids.txt'), ...readWords('supplement-adult.txt')]);
  for (const w of readWords('allowlist-kids.txt')) blocked.delete(w);
  // Fine in a chat even though a word game keeps them off the kids list: "nice
  // shots", "that was lit", and Wang is a name.
  for (const w of ['shot', 'shots', 'lit', 'wang']) blocked.delete(w);
  return blocked;
}
// A word and the usual endings on it (shits, shitty, shitting, fucked). Endings
// only count on stems of 4 letters or more, so BRA doesn't catch BRAIN, and -er
// isn't an ending here at all, so BUTT doesn't catch BUTTER.
function isBlocked(word) {
  const set = blockedWords();
  const w = word.toLowerCase();
  if (set.has(w)) return true;
  for (const end of ['s', 'es', 'ed', 'ing', 'y', 'ty', 'ting', 'ted', 'in']) {
    const stem = w.slice(0, -end.length);
    if (w.endsWith(end) && stem.length >= 4 && set.has(stem)) return true;
  }
  // Plurals of the short ones (tits, cocks) still count.
  return w.endsWith('s') && w.length >= 4 && set.has(w.slice(0, -1));
}
// Letters hidden with stars, keeping the first one so it still reads like a word.
function familyFilter(text) {
  return text.replace(/[A-Za-z]+/g, w => (isBlocked(w) ? w[0] + '*'.repeat(w.length - 1) : w));
}

// ---- the chat itself ------------------------------------------------------------------------------------
const recent = new Map();    // `${game}|${room}|${seat}` -> send times
const clean = t => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

// One game's chat.
function create(game) {
  const toMessage = (row, viewerSeat) => ({
    id: row.id, at: row.at, name: row.name, text: row.text,
    system: !!row.system, mine: !row.system && !!viewerSeat && row.seat === viewerSeat
  });

  function list(room, viewerSeat) {
    return db.db.prepare('SELECT * FROM room_chat WHERE game = ? AND room = ? ORDER BY id DESC LIMIT ?')
      .all(game, String(room), KEEP).reverse().map(r => toMessage(r, viewerSeat));
  }

  // A player's message. muted: the host turned them off. family: filter it.
  function say(room, { seat, name, muted, family }, raw) {
    let text = clean(raw);
    if (!text) throw fail('Type something first.');
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    if (muted) throw fail('The host muted you, so your messages don\'t go out.', 403);
    const key = `${game}|${room}|${seat}`;
    const now = Date.now();
    const times = (recent.get(key) || []).filter(t => now - t < BURST_MS);
    if (times.length >= BURST) throw fail('Slow down a little, then try again.', 429);
    times.push(now);
    recent.set(key, times);
    if (family) text = familyFilter(text);
    db.db.prepare('INSERT INTO room_chat (game, room, at, seat, name, text) VALUES (?, ?, ?, ?, ?, ?)')
      .run(game, String(room), now, String(seat), clean(name).slice(0, 30), text);
    trim(room);
  }

  // A room keeps its newest STORE messages, however long it lasts.
  function trim(room) {
    db.db.prepare(`DELETE FROM room_chat WHERE game = ? AND room = ? AND id <= (
      SELECT id FROM room_chat WHERE game = ? AND room = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`)
      .run(game, String(room), game, String(room), STORE);
  }

  // A line from the game itself ("Milo joined").
  function note(room, text) {
    db.db.prepare('INSERT INTO room_chat (game, room, at, text, system) VALUES (?, ?, ?, ?, 1)')
      .run(game, String(room), Date.now(), clean(text).slice(0, MAX_TEXT));
    trim(room);
  }

  function clear(room) {
    db.db.prepare('DELETE FROM room_chat WHERE game = ? AND room = ?').run(game, String(room));
    for (const k of [...recent.keys()]) if (k.startsWith(`${game}|${room}|`)) recent.delete(k);
  }

  // Every room's chat for this game, for games whose rooms don't survive a restart.
  const clearAll = () => db.db.prepare('DELETE FROM room_chat WHERE game = ?').run(game);
  return { list, say, note, clear, clearAll };
}

module.exports = { create, familyFilter, isBlocked, MAX_TEXT, STORE };
