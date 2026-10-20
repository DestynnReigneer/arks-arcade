'use strict';

// One high-score table for the simpler arcade games (Spin & Solve, Chess,
// Dino Dash). Wordless and Rambler keep their own: their scores carry more
// detail than "initials and a number".

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('./comm');
const adultPin = require('./adult-pin');

// Each game's boards and the highest score that could honestly be reached,
// so a typo'd or tampered post can't sit at #1 forever.
const GAMES = {
  // Adult boards are read only with the adult PIN and never announced.
  spinsolve: { label: 'Spin & Solve', boards: { solo: 'Solo', adult: 'Adult' }, adultBoards: ['adult'], max: 200000 },
  chess: { label: 'Chess', boards: { easy: 'vs Easy', medium: 'vs Medium', hard: 'vs Hard' }, max: 5000 },
  dino: { label: 'Dino Dash', boards: { run: 'Distance' }, max: 9999999 },
  trivia: { label: 'Know-It-All', boards: { solo: 'Family', adult: 'Adult' }, adultBoards: ['adult'], max: 30000 }
};

const INITIALS_RE = /^[A-Z0-9]{1,3}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS arcade_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    board TEXT NOT NULL,
    initials TEXT NOT NULL,
    score INTEGER NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS arcade_scores_board ON arcade_scores (game, board, score DESC);
`);
// Scores credited to an arcade profile show its name and avatar.
for (const col of ['profile_id TEXT', 'profile_name TEXT', 'profile_avatar TEXT']) {
  try { db.db.exec(`ALTER TABLE arcade_scores ADD COLUMN ${col}`); } catch { /* already there */ }
}
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

function boardOf(game, board) {
  const g = GAMES[game];
  if (!g) throw fail('Unknown game.', 404);
  const key = board && g.boards[board] ? board : Object.keys(g.boards)[0];
  return { g, key };
}

function list(game, board, limit = 25) {
  const { key } = boardOf(game, board);
  const cap = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  return db.db.prepare(`
    SELECT * FROM arcade_scores WHERE game = ? AND board = ? ORDER BY score DESC, created_at ASC LIMIT ?
  `).all(game, key, cap).map(r => ({
    id: r.id, initials: r.initials, score: r.score, detail: r.detail, board: r.board, createdAt: r.created_at,
    profileName: r.profile_name || null, profileAvatar: r.profile_avatar || null
  }));
}

function save(game, { initials, score, board, detail, profileToken }) {
  const { g, key } = boardOf(game, board);
  // Playing as a profile: the score is theirs, no initials needed.
  const profile = profileToken ? require('./profiles').verify(profileToken) : null;
  const who = profile ? initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(who)) throw fail('Initials must be 1-3 letters or numbers.', 400);
  const points = Math.round(Number(score));
  if (!Number.isFinite(points) || points < 1 || points > g.max) throw fail('That score does not look right.', 400);
  const info = db.db.prepare(`
    INSERT INTO arcade_scores (game, board, initials, score, detail, profile_id, profile_name, profile_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(game, key, who, points, String(detail || '').slice(0, 80), profile ? profile.id : null, profile ? profile.name : null, profile ? profile.avatar : null);
  const rank = db.db.prepare(`
    SELECT COUNT(*) AS c FROM arcade_scores WHERE game = ? AND board = ? AND score > ?
  `).get(game, key, points).c + 1;
  if (rank === 1 && !(g.adultBoards || []).includes(key)) {
    const where = Object.keys(g.boards).length > 1 ? ` (${g.boards[key]})` : '';
    const shout = profile ? profile.name : who;
    comm.safePost({
      kind: 'highscore', emoji: '🏆', game,
      title: `${shout} took #1 on ${g.label}${where}`,
      body: `${shout} just set the top score on ${g.label}${where} with ${points.toLocaleString('en-US')}. Think you can beat it?`
    });
  }
  return { id: Number(info.lastInsertRowid), score: points, rank, board: key };
}

const router = express.Router();
const saveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many scores at once. Take a breather.' }
});

router.get('/:game', (req, res, next) => {
  try {
    const { g, key } = boardOf(req.params.game, req.query.board);
    if ((g.adultBoards || []).includes(key) && !adultPin.matches(req.get('X-Adult-Pin') || '')) {
      throw fail('That PIN is not right.', 403);
    }
    res.json(list(req.params.game, key, req.query.limit));
  } catch (e) { next(e); }
});

router.post('/:game', saveLimiter, (req, res, next) => {
  try { res.status(201).json(save(req.params.game, req.body || {})); } catch (e) { next(e); }
});

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = { router, list, save, GAMES };
