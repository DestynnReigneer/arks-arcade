'use strict';

// Words with Family's results, for the trophy page's three boards (games won,
// best game score, best single word).
//
// A game's own row (crisscross_games) can be cleared out later (pass-and-play
// games are forgotten after a month), so when a game ends each profile that
// played it gets a row here that stays. Bots and players without a profile
// aren't on the boards. The first time this runs, games that finished before
// it existed are filled in from their saved state.

const db = require('../db');

// The first version (2026-11-10) keyed rows by (game_id, profile_id) with no id of
// their own. The admin's Boards tab takes rows off by id, so a table made that
// way is copied once into this shape. It all happens in one transaction, and a
// leftover crisscross_results_v1 (from a copy that stopped partway) is copied
// again, so nothing gets stranded. The old table's index moves with it on the
// rename, so it's dropped first and made again on the new table.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS crisscross_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    dictionary TEXT NOT NULL DEFAULT 'kids',
    won INTEGER NOT NULL,
    score INTEGER NOT NULL,
    best_word TEXT NOT NULL DEFAULT '',
    best_word_score INTEGER NOT NULL DEFAULT 0,
    players INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    UNIQUE (game_id, profile_id)
  );
  CREATE INDEX IF NOT EXISTS crisscross_results_profile ON crisscross_results (profile_id);
`;
const tableExists = name => !!db.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const old = tableExists('crisscross_results')
  && !db.db.prepare('PRAGMA table_info(crisscross_results)').all().some(c => c.name === 'id');
if (old || tableExists('crisscross_results_v1')) {
  db.db.exec('BEGIN');
  try {
    if (old) {
      db.db.exec('DROP INDEX IF EXISTS crisscross_results_profile');
      db.db.exec('ALTER TABLE crisscross_results RENAME TO crisscross_results_v1');
    }
    db.db.exec(SCHEMA);
    db.db.exec(`INSERT OR IGNORE INTO crisscross_results (game_id, profile_id, dictionary, won, score, best_word, best_word_score, players, finished_at)
      SELECT game_id, profile_id, dictionary, won, score, best_word, best_word_score, players, finished_at FROM crisscross_results_v1 ORDER BY finished_at;
      DROP TABLE crisscross_results_v1;`);
    db.db.exec('COMMIT');
  } catch (e) { db.db.exec('ROLLBACK'); throw e; }
} else {
  db.db.exec(SCHEMA);
}

const insert = db.db.prepare(`INSERT OR IGNORE INTO crisscross_results
  (game_id, profile_id, dictionary, won, score, best_word, best_word_score, players, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

// state: a finished game's state from engine.js.
function record(gameId, state, finishedAt = Date.now()) {
  if (!state || !state.over || !Array.isArray(state.players)) return;
  const winners = new Set(state.over.winners || []);
  const best = state.players.map(() => ({ word: '', score: 0 }));
  for (const m of state.moves || []) {
    if (m.kind !== 'play' || !best[m.seat]) continue;
    for (const w of m.words || []) if (w.score > best[m.seat].score) best[m.seat] = { word: String(w.word || '').toUpperCase(), score: w.score };
  }
  state.players.forEach((p, seat) => {
    if (!p || p.bot || !p.profileId) return;
    insert.run(String(gameId), String(p.profileId), state.dictionary || 'kids', winners.has(seat) ? 1 : 0,
      state.scores[seat] || 0, best[seat].word, best[seat].score, state.players.length, finishedAt);
  });
}

// Games that finished before this file existed.
const FILLED = 'crisscross_results_filled';
function fillIn() {
  if (db.getSetting(FILLED, null)) return;
  const rows = db.db.prepare("SELECT id, state, updated_at FROM crisscross_games WHERE status = 'over'").all();
  for (const r of rows) {
    try { record(r.id, JSON.parse(r.state), r.updated_at); } catch { /* one bad game doesn't stop the rest */ }
  }
  db.setSetting(FILLED, '1');
}

module.exports = { record, fillIn };
