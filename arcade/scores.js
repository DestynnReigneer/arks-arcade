'use strict';

// One high-score table for the simpler arcade games (Spin & Solve, Chess,
// Dino Dash, Know-It-All, Snake, Brick Breaker, Block Drop, Tower Defense). Wordless and Rambler keep their own: their scores carry more
// detail than "initials and a number".

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const comm = require('./comm');

// Each game's boards and the highest score that could honestly be reached,
// so a typo'd or tampered post can't sit at #1 forever.
const GAMES = {
  // Adult boards are open to read like every other board (the maintainer's call, 2026-11-11); their #1s are never
  // announced. Playing the adult levels still needs an adult's ARKS ID sign-in.
  // Spin & Solve runs on the server (spinsolve/game.js), which saves the total itself; the page can't post one.
  spinsolve: { label: 'Spin & Solve', boards: { solo: 'Solo', adult: 'Adult' }, adultBoards: ['adult'], max: 200000, serverOnly: true },
  chess: { label: 'Chess', boards: { easy: 'vs Easy', medium: 'vs Medium', hard: 'vs Hard' }, max: 5000 },
  dino: { label: 'Dino Dash', boards: { run: 'Distance' }, max: 9999999 },
  trivia: { label: 'Know-It-All', boards: { solo: 'Family', adult: 'Adult' }, adultBoards: ['adult'], max: 30000 },
  snake: { label: 'Snake', boards: { classic: 'Classic', wrap: 'Wrap-around' }, max: 200000 },
  bricks: { label: 'Brick Breaker', boards: { classic: 'Classic' }, max: 9999999 },
  blocks: { label: 'Block Drop', boards: { marathon: 'Marathon', rush: '2-Minute Rush' }, max: 99999999 },
  // The 3D cabinet games send their own score (the deliberate exception to "the server decides"); the max is the
  // highest score a real game could reach, so anything above it is refused.
  bigswing: { label: 'Big Swing', boards: { runs: 'Runs' }, max: 300 },
  // Bucket Drop's best normal game is 750; above that, the score must be 750 plus a jackpot really won here.
  bucketdrop: { label: 'Bucket Drop', boards: { points: 'Points' }, max: 1000000, check: points => require('./cab-jackpot').check('bucketdrop', points) },
  launcher: { label: 'ARKS Launcher', boards: { points: 'Points' }, max: 50000 },
  train: { label: 'ARKS Train Station', boards: { points: 'Points' }, max: 100000 },
  // ARKS Racer keeps finishing times in thousandths of a second, fastest first, one board per track. Three laps take
  // at least about 38 seconds even on speed pads the whole way, and the clock never gives more than 80.
  racer: { label: 'ARKS Racer', boards: { sunset: 'Sunset Strip', neon: 'Neon Night', ocean: 'Ocean Drive', midnight: 'Midnight Run', golden: 'Golden Coast', teal: 'Crystal Cove', star: 'Star Road', forest: 'Laser Forest' }, lowerIsBetter: true, min: 30000, max: 85000 },
  towers: { label: 'Tower Defense', boards: { meadow: 'Meadow', lake: 'Frozen Lake', canyon: 'Canyon', swamp: 'Swamp', castle: 'Castle', volcano: 'Volcano' }, max: 9999999 }
};

const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
// A game whose score is a time (lower is better) keeps it in thousandths of a second.
const shown = (g, points) => (g.lowerIsBetter ? `${(points / 1000).toFixed(2)} seconds` : points.toLocaleString('en-US'));

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
  const order = GAMES[game].lowerIsBetter ? 'ASC' : 'DESC';
  return db.db.prepare(`
    SELECT * FROM arcade_scores WHERE game = ? AND board = ? ORDER BY score ${order}, created_at ASC LIMIT ?
  `).all(game, key, cap).map(r => {
    // A profile's current choice (name or initials) wins over what was saved.
    const now = r.profile_id ? require('./profiles').boardName(r.profile_id) : null;
    return {
      id: r.id, initials: r.initials, score: r.score, detail: r.detail, board: r.board, createdAt: r.created_at,
      profileName: now ? now.label : r.profile_name || null, profileAvatar: now ? now.avatar : r.profile_avatar || null
    };
  });
}

function save(game, { initials, score, board, detail, profileToken, fromServer }) {
  const { g, key } = boardOf(game, board);
  if (g.serverOnly && !fromServer) throw fail(`${g.label} saves its scores from the game itself.`, 403);
  // Playing as a profile: the score is theirs, no initials needed.
  const profile = profileToken ? require('./profiles').verify(profileToken) : null;
  const who = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(who)) throw fail('Initials must be 1-3 letters or numbers.', 400);
  const points = Math.round(Number(score));
  if (!Number.isFinite(points) || points < (g.min || 1) || points > g.max) throw fail('That score does not look right.', 400);
  // a game with its own check (a jackpot that must really have been won here)
  if (g.check && !g.check(points)) throw fail('That score does not look right.', 400);
  const info = db.db.prepare(`
    INSERT INTO arcade_scores (game, board, initials, score, detail, profile_id, profile_name, profile_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(game, key, who, points, String(detail || '').slice(0, 80), profile ? profile.id : null, profile ? profile.name : null, profile ? profile.avatar : null);
  const rank = db.db.prepare(`
    SELECT COUNT(*) AS c FROM arcade_scores WHERE game = ? AND board = ? AND score ${g.lowerIsBetter ? '<' : '>'} ?
  `).get(game, key, points).c + 1;
  if (rank === 1 && !(g.adultBoards || []).includes(key)) {
    const where = Object.keys(g.boards).length > 1 ? ` (${g.boards[key]})` : '';
    const shout = profile ? require('./profiles').boardName(profile.id).label : who;
    comm.safePost({
      kind: 'highscore', emoji: '🏆', game,
      title: `${shout} took #1 on ${g.label}${where}`,
      body: `${shout} just set the top score on ${g.label}${where} with ${shown(g, points)}. Think you can beat it?`
    });
  }
  return { id: Number(info.lastInsertRowid), score: points, rank, board: key };
}

const router = express.Router();
const saveLimiter = rateLimit({
  // the test suite saves many scores from one address, so it gets more (never in production)
  windowMs: 10 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 300 : 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many scores at once. Take a breather.' }
});

router.get('/:game', (req, res, next) => {
  try {
    const { key } = boardOf(req.params.game, req.query.board);
    res.json(list(req.params.game, key, req.query.limit));
  } catch (e) { next(e); }
});

router.post('/:game', saveLimiter, (req, res, next) => {
  // fromServer is only ever set by a game's own server code, never by a request.
  try { res.status(201).json(save(req.params.game, { ...(req.body || {}), fromServer: false })); } catch (e) { next(e); }
});

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = { router, list, save, GAMES };
