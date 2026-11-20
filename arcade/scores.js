'use strict';

// One high-score table for the simpler arcade games (Spin & Solve, Chess,
// Dino Dash, Know-It-All, Snake, Brick Breaker, Block Drop, Tower Defense). Wordless and Rambler keep their own: their scores carry more
// detail than "initials and a number".

const crypto = require('node:crypto');
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
  // Bucket Drop's best normal game is 750; above that, the score must be 750 plus a jackpot really won here. The game
  // is played one way, Big cups and Fast (the maintainer's call, 2026-11-14), so it has one board. The board keeps the
  // key from when each Cups and Speed pair had its own; the other pairs' scores stay in the database with no board.
  bucketdrop: { label: 'Bucket Drop', boards: { 'big-fast': 'Points' }, max: 1000000, check: points => require('./cab-jackpot').check('bucketdrop', points) },
  launcher: { label: 'ARKS Launcher', boards: { points: 'Points' }, max: 50000 },
  train: { label: 'ARKS Train Station', boards: { points: 'Points' }, max: 100000 },
  // ARKS Racer keeps finishing times in thousandths of a second, fastest first, one board per track. Three laps take
  // at least about 38 seconds even on speed pads the whole way, and the clock never gives more than 80.
  racer: { label: 'ARKS Racer', boards: { sunset: 'Sunset Strip', neon: 'Neon Night', ocean: 'Ocean Drive', midnight: 'Midnight Run', golden: 'Golden Coast', teal: 'Crystal Cove', star: 'Star Road', forest: 'Laser Forest' }, lowerIsBetter: true, min: 30000, max: 85000 },
  // Tower Defense: one board per map, and All levels for a game carried on from one level to the next (Easy, Medium,
  // Hard), which is saved by itself as it goes. The most one map can give is about 82,400 (every monster of all 25
  // waves, every wave's clear bonus, the win and 20 lives), so a map's board takes up to 100,000 and All levels,
  // three maps at most, up to 300,000. A run's score is kept up to date in place (runBoards, below).
  towers: {
    label: 'Tower Defense', boards: { meadow: 'Meadow', lake: 'Frozen Lake', canyon: 'Canyon', swamp: 'Swamp', castle: 'Castle', volcano: 'Volcano', all: 'All levels' },
    max: 100000, boardMax: { all: 300000 }, runBoards: ['all']
  }
};

const { boardWho } = require('./board-who');
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
// run_key: on a board that keeps a run up to date (runBoards), a fingerprint of the key handed to the page that
// saved it, so only that page can raise the run's score later.
for (const col of ['profile_id TEXT', 'profile_name TEXT', 'profile_avatar TEXT', 'run_key TEXT']) {
  try { db.db.exec(`ALTER TABLE arcade_scores ADD COLUMN ${col}`); } catch { /* already there */ }
}
// Bucket Drop's scores from when it had one Points board move to the board for the settings
// written in their detail ("12 of 50, Big cups, fast"). Runs once; a row it can't read stays put.
for (const r of db.db.prepare("SELECT id, detail FROM arcade_scores WHERE game = 'bucketdrop' AND board = 'points'").all()) {
  const m = /(Big|Normal|Small) cups, (chill|normal|fast|wild)/.exec(r.detail || '');
  if (m) db.db.prepare('UPDATE arcade_scores SET board = ? WHERE id = ?').run(`${m[1].toLowerCase()}-${m[2]}`, r.id);
}

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

function boardOf(game, board) {
  const g = typeof game === 'string' && Object.hasOwn(GAMES, game) ? GAMES[game] : null;
  if (!g) throw fail('Unknown game.', 404);
  const key = board && Object.hasOwn(g.boards, String(board)) ? String(board) : Object.keys(g.boards)[0];
  return { g, key };
}

function list(game, board, limit = 25) {
  const { g, key } = boardOf(game, board);
  const cap = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const order = g.lowerIsBetter ? 'ASC' : 'DESC';
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

const fingerprint = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const rankOf = (g, game, key, points) => db.db.prepare(`
  SELECT COUNT(*) AS c FROM arcade_scores WHERE game = ? AND board = ? AND score ${g.lowerIsBetter ? '<' : '>'} ?
`).get(game, key, points).c + 1;

// A run on a runBoards board (Tower Defense's All levels) is saved as it goes: the first save hands back a runKey,
// and a later save sending run: { id, key } raises that same row instead of adding another. Only the page holding
// the key can, the score can only go up, and the row keeps whoever it was saved under.
function raiseRun(g, game, key, points, detail, run) {
  const id = Number(run && run.id);
  const given = typeof (run && run.key) === 'string' ? run.key : '';
  const row = Number.isInteger(id) && given ? db.db.prepare('SELECT * FROM arcade_scores WHERE id = ? AND game = ? AND board = ?').get(id, game, key) : null;
  const same = row && row.run_key && crypto.timingSafeEqual(Buffer.from(row.run_key), Buffer.from(fingerprint(given)));
  if (!same) throw fail('That game isn\'t on the board anymore.', 404);
  if (points < row.score) throw fail('That score does not look right.', 400);
  const wasFirst = rankOf(g, game, key, row.score) === 1;
  db.db.prepare('UPDATE arcade_scores SET score = ?, detail = ? WHERE id = ?').run(points, String(detail || '').slice(0, 80), id);
  const rank = rankOf(g, game, key, points);
  if (rank === 1 && !wasFirst) announce(g, game, key, points, row.profile_id ? { id: row.profile_id } : null, row.profile_name, row.initials);
  return { id, score: points, rank, board: key, runKey: given };
}

function save(game, { initials, name, avatar, score, board, detail, profileToken, fromServer, run, playedBy }) {
  const { g, key } = boardOf(game, board);
  if (g.serverOnly && !fromServer) throw fail(`${g.label} saves its scores from the game itself.`, 403);
  const points = Math.round(Number(score));
  const max = (g.boardMax && Object.hasOwn(g.boardMax, key) && g.boardMax[key]) || g.max;
  if (!Number.isFinite(points) || points < (g.min || 1) || points > max) throw fail('That score does not look right.', 400);
  // a game with its own check (a jackpot that must really have been won here)
  if (g.check && !g.check(points)) throw fail('That score does not look right.', 400);
  const runBoard = (g.runBoards || []).includes(key);
  if (run && !runBoard) throw fail('Each game on this board is its own score.', 400);
  if (run) return raiseRun(g, game, key, points, detail, run);
  // Signed in, the score is the profile's; a guest's goes under their name, and a TV's under
  // the person picked on its end card (arcade/board-who.js).
  const as = boardWho({ profileToken, name, avatar, initials, playedBy });
  const { profile } = as;
  const who = as.initials;
  const runKey = runBoard ? crypto.randomBytes(18).toString('hex') : null;
  const info = db.db.prepare(`
    INSERT INTO arcade_scores (game, board, initials, score, detail, profile_id, profile_name, profile_avatar, run_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(game, key, who, points, String(detail || '').slice(0, 80), profile ? profile.id : null, as.name, as.avatar, runKey && fingerprint(runKey));
  const rank = rankOf(g, game, key, points);
  if (rank === 1) announce(g, game, key, points, profile, as.name, who);
  return { id: Number(info.lastInsertRowid), score: points, rank, board: key, ...(runKey ? { runKey } : {}) };
}

// A new #1 goes to the Comm Center (never on an adult board).
function announce(g, game, key, points, profile, name, who) {
  if ((g.adultBoards || []).includes(key)) return;
  const where = Object.keys(g.boards).length > 1 ? ` (${g.boards[key]})` : '';
  const shout = profile ? require('./profiles').boardName(profile.id).label : name || who;
  comm.safePost({
    trophy: { game: g.label, profileId: profile ? profile.id : null, name: shout, score: shown(g, points) + (g.lowerIsBetter ? '' : ' points'), board: Object.keys(g.boards).length > 1 ? g.boards[key] : '', url: `/${game}.html` },
    kind: 'highscore', emoji: '🏆', game,
    title: `${shout} took #1 on ${g.label}${where}`,
    body: `${shout} just set the top score on ${g.label}${where} with ${shown(g, points)}. Think you can beat it?`
  });
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
