'use strict';

// Where Know-It-All's questions live: the built-in bank, packs made from the
// admin page, and questions downloaded from Open Trivia DB (opentdb.com,
// CC BY-SA 4.0) when the server has internet. Downloads are saved here so
// the game keeps working offline afterward.

const crypto = require('node:crypto');
const db = require('../db');
const bank = require('./bank');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS trivia_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,              -- 'opentdb' or 'pack'
    ext_id TEXT UNIQUE,                -- de-duplicates downloads
    pack_id INTEGER,
    level TEXT NOT NULL DEFAULT 'kids',
    genre TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    question TEXT NOT NULL,
    correct TEXT NOT NULL,
    wrong TEXT NOT NULL,               -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS trivia_questions_level ON trivia_questions (level, genre);
  CREATE TABLE IF NOT EXISTS trivia_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🧠',
    level TEXT NOT NULL DEFAULT 'kids',
    genre TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS trivia_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    pack_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const rowToQuestion = r => ({
  id: `q-${r.id}`, source: r.source, level: r.level, genre: r.genre, difficulty: r.difficulty,
  question: r.question, correct: r.correct, wrong: JSON.parse(r.wrong)
});

// ---- checking a question ------------------------------------------------------------
// Trivia is about facts, not spelling, so titles and names are kept exactly
// as they are ("Fifty Shades of Grey" stays Grey).

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function checkQuestion(raw) {
  const question = clean(raw && raw.question, 300);
  const correct = clean(raw && raw.correct, 120);
  const wrong = (Array.isArray(raw && raw.wrong) ? raw.wrong : []).map(w => clean(w, 120)).filter(Boolean);
  const difficulty = DIFFICULTIES.includes(raw && raw.difficulty) ? raw.difficulty : 'medium';
  if (question.length < 8) return { error: 'question too short' };
  if (!correct) return { error: 'no correct answer' };
  if (wrong.length < 1 || wrong.length > 3) return { error: 'needs 1 to 3 wrong answers' };
  const all = [correct, ...wrong].map(a => a.toLowerCase());
  if (new Set(all).size !== all.length) return { error: 'duplicate answers' };
  return { question: { question, correct, wrong, difficulty } };
}

// ---- packs and requests ------------------------------------------------------------------

function createPack({ label, emoji, level, genre, questions }) {
  const lv = bank.levelOf(level);
  const g = clean(genre, 30) || 'General';
  const good = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of Array.isArray(questions) ? questions : []) {
    const { question, error } = checkQuestion(raw);
    if (error) { skipped.push({ question: clean(raw && raw.question, 80), reason: error }); continue; }
    if (seen.has(question.question.toLowerCase())) continue;
    seen.add(question.question.toLowerCase());
    good.push(question);
  }
  if (good.length < 5) {
    throw Object.assign(new Error(`Need at least 5 usable questions (got ${good.length}).` +
      (skipped.length ? ` Skipped: ${skipped.slice(0, 3).map(s => `${s.question} (${s.reason})`).join('; ')}` : '')), { status: 400 });
  }
  const info = db.db.prepare('INSERT INTO trivia_packs (label, emoji, level, genre) VALUES (?, ?, ?, ?)')
    .run(clean(label, 40) || g, clean(emoji, 8) || '🧠', lv, g);
  const packId = Number(info.lastInsertRowid);
  const insert = db.db.prepare(`
    INSERT INTO trivia_questions (source, pack_id, level, genre, difficulty, question, correct, wrong)
    VALUES ('pack', ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const q of good) insert.run(packId, lv, g, q.difficulty, q.question, q.correct, JSON.stringify(q.wrong));
  return { pack: packOf(packId), skipped };
}

function packOf(id) {
  const r = db.db.prepare('SELECT * FROM trivia_packs WHERE id = ?').get(id);
  if (!r) return null;
  const count = db.db.prepare('SELECT COUNT(*) AS c FROM trivia_questions WHERE pack_id = ?').get(id).c;
  return { id: r.id, label: r.label, emoji: r.emoji, level: r.level, genre: r.genre, count, adult: bank.LEVELS[r.level].adult, createdAt: r.created_at };
}

function listPacks() {
  return db.db.prepare('SELECT id FROM trivia_packs ORDER BY created_at DESC, id DESC').all().map(r => packOf(r.id));
}

function deletePack(id) {
  db.db.prepare('DELETE FROM trivia_questions WHERE pack_id = ?').run(id);
  db.db.prepare('DELETE FROM trivia_packs WHERE id = ?').run(id);
}

// ---- picking questions for a game ------------------------------------------------------------

// Every question available at a level: built-in, packs, and downloaded.
function pool(level) {
  const rows = db.db.prepare('SELECT * FROM trivia_questions WHERE level = ?').all(level).map(rowToQuestion);
  return [...bank.QUESTIONS[level], ...rows];
}

// The genres you can pick at a level, with how many questions each has.
function genres(level) {
  const counts = {};
  for (const q of pool(level)) counts[q.genre] = (counts[q.genre] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Picks a game's questions, spread across the chosen genres so one big
// genre (Open Trivia DB has a lot of Entertainment) doesn't take over.
function pick({ level, genres: wanted = [], difficulty = 'mixed', count = 10, packId = null }) {
  let list = packId
    ? db.db.prepare('SELECT * FROM trivia_questions WHERE pack_id = ?').all(packId).map(rowToQuestion)
    : pool(level);
  if (wanted.length) list = list.filter(q => wanted.includes(q.genre));
  if (DIFFICULTIES.includes(difficulty)) {
    const exact = list.filter(q => q.difficulty === difficulty);
    if (exact.length >= count) list = exact;
  }
  const byGenre = {};
  for (const q of shuffle(list)) (byGenre[q.genre] = byGenre[q.genre] || []).push(q);
  const buckets = shuffle(Object.values(byGenre));
  const out = [];
  while (out.length < count && buckets.some(b => b.length)) {
    for (const b of buckets) if (b.length && out.length < count) out.push(b.pop());
  }
  return out;
}

// The answers in a random order, and which one is right.
function deal(q) {
  const answers = shuffle([q.correct, ...q.wrong]);
  return { ...q, answers, correctIndex: answers.indexOf(q.correct) };
}

// ---- Open Trivia DB -----------------------------------------------------------------------------

const OTDB_GENRES = {
  'General Knowledge': 'General', 'Entertainment: Books': 'Books', 'Entertainment: Film': 'Movies',
  'Entertainment: Music': 'Music', 'Entertainment: Musicals & Theatres': 'Musicals & Theater',
  'Entertainment: Television': 'TV', 'Entertainment: Video Games': 'Video Games',
  'Entertainment: Board Games': 'Board Games', 'Science & Nature': 'Science', 'Science: Computers': 'Tech',
  'Science: Mathematics': 'Science', 'Mythology': 'Mythology', 'Sports': 'Sports', 'Geography': 'Geography',
  'History': 'History', 'Politics': 'Politics', 'Art': 'Art', 'Celebrities': 'Celebrities', 'Animals': 'Animals',
  'Vehicles': 'Vehicles', 'Entertainment: Comics': 'Comics', 'Science: Gadgets': 'Tech',
  'Entertainment: Japanese Anime & Manga': 'Anime & Manga', 'Entertainment: Cartoon & Animations': 'Cartoons'
};

const sync = { running: false, added: 0, skipped: 0, lastError: null, finishedAt: null };

function otdbCount() {
  return db.db.prepare("SELECT COUNT(*) AS c FROM trivia_questions WHERE source = 'opentdb'").get().c;
}

function status() {
  return {
    downloaded: otdbCount(), running: sync.running, addedThisRun: sync.added, skippedThisRun: sync.skipped,
    lastError: sync.lastError, finishedAt: sync.finishedAt || db.getSetting('trivia_otdb_synced', null),
    enabled: process.env.TRIVIA_ONLINE !== 'off'
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Downloads everything Open Trivia DB has, 50 at a time, one request every
// 5.5 seconds (their limit is one per 5). About 8 minutes for the lot.
async function syncOpenTdb({ force = false } = {}) {
  if (sync.running || process.env.TRIVIA_ONLINE === 'off' || process.env.NODE_ENV === 'test') return status();
  const last = db.getSetting('trivia_otdb_synced', null);
  if (!force && last && Date.now() - Date.parse(last) < 30 * 24 * 3600 * 1000 && otdbCount() > 1000) return status();
  Object.assign(sync, { running: true, added: 0, skipped: 0, lastError: null });
  const insert = db.db.prepare(`
    INSERT OR IGNORE INTO trivia_questions (source, ext_id, level, genre, difficulty, question, correct, wrong)
    VALUES ('opentdb', ?, 'kids', ?, ?, ?, ?, ?)
  `);
  const get = async url => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return res.json();
  };
  try {
    const { token } = await get('https://opentdb.com/api_token.php?command=request');
    for (let i = 0; i < 200; i++) {
      await sleep(5500);
      const data = await get(`https://opentdb.com/api.php?amount=50&encode=url3986&token=${token}`);
      if (data.response_code === 4 || data.response_code === 1) break;   // all fetched
      if (data.response_code === 5) { await sleep(6000); continue; }      // too fast; wait and retry
      if (data.response_code !== 0) throw new Error(`Open Trivia DB said ${data.response_code}`);
      for (const r of data.results) {
        const d = s => decodeURIComponent(s);
        const question = d(r.question);
        const correct = d(r.correct_answer);
        const wrong = r.incorrect_answers.map(d);
        const genre = OTDB_GENRES[d(r.category)] || 'General';
        const ext = crypto.createHash('sha1').update(question + correct).digest('hex');
        const info = insert.run(ext, genre, DIFFICULTIES.includes(r.difficulty) ? r.difficulty : 'medium', question, correct, JSON.stringify(wrong));
        if (info.changes) sync.added++;
      }
    }
    sync.finishedAt = new Date().toISOString();
    db.setSetting('trivia_otdb_synced', sync.finishedAt);
  } catch (e) {
    sync.lastError = e.message;
  } finally {
    sync.running = false;
  }
  return status();
}

module.exports = {
  DIFFICULTIES, checkQuestion, createPack, listPacks, deletePack, packOf,
  pool, genres, pick, deal, status, syncOpenTdb
};
