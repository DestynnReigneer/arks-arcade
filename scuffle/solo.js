'use strict';

// Shuffle Scuffle on your own: the daily set and free play.
//
// The server keeps the game. Starting one hands the page a long random game
// id; each round's clock starts on the server when the round does, every
// word is checked here, and the points are added up here. The browser never
// sends a score or a time, and it only sees a round's words once the round is
// over. Games live in memory (a few minutes each); only saved daily scores go
// in the database.

const crypto = require('node:crypto');
const db = require('../db');
const comm = require('../arcade/comm');
const { today } = require('../rambler/progress');
const game = require('./game');

const GRACE_MS = 1500;               // a word sent as the clock runs out still counts
const KEEP_MS = 3 * 60 * 60 * 1000;  // unfinished games are forgotten after this
const MAX_GAMES = 5000;
const MAX_WORDS = 300;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS scuffle_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    who TEXT NOT NULL,
    initials TEXT NOT NULL,
    profile_id TEXT,
    profile_name TEXT,
    profile_avatar TEXT,
    dictionary TEXT NOT NULL DEFAULT 'kids',
    score INTEGER NOT NULL,
    words INTEGER NOT NULL DEFAULT 0,
    full_words INTEGER NOT NULL DEFAULT 0,
    best_word TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (day, who)
  );
  CREATE INDEX IF NOT EXISTS scuffle_scores_day ON scuffle_scores (day, score);
  CREATE INDEX IF NOT EXISTS scuffle_scores_all ON scuffle_scores (score);
  CREATE TABLE IF NOT EXISTS scuffle_daily_plays (
    day TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    PRIMARY KEY (day, profile_id)
  );
`);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const profiles = () => require('../arcade/profiles');
const games = new Map();

function sweep(now = Date.now()) {
  for (const [id, g] of games) if (now - g.touched > KEEP_MS) games.delete(id);
  db.db.prepare('DELETE FROM scuffle_daily_plays WHERE day < ?').run(today(new Date(now - 2 * 24 * 3600 * 1000)));
}
const sweeper = setInterval(sweep, 10 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

function need(id) {
  const g = games.get(String(id || ''));
  if (!g) throw fail('That game has ended. Start a new one from the menu.', 404);
  g.touched = Date.now();
  return g;
}

// Ends the round if its time is up. Called before anything reads a game, so
// there's no timer to keep for each one.
function settle(g, now = Date.now()) {
  const r = g.current;
  if (r && !r.ended && now > r.endsAt + GRACE_MS) endRound(g);
}

function endRound(g) {
  const r = g.current;
  if (!r || r.ended) return;
  r.ended = true;
  g.total += r.score;
  if (g.index === g.rounds.length - 1) g.finished = true;
}

function view(g, now = Date.now()) {
  settle(g, now);
  const r = g.current;
  const def = r ? g.rounds[g.index] : null;
  const phase = !r ? 'ready' : g.finished ? 'over' : r.ended ? 'reveal' : 'playing';
  return {
    gameId: g.id, mode: g.mode, day: g.day, dictionary: g.dictionary, seconds: g.seconds,
    totalRounds: g.rounds.length, index: g.index, phase, total: g.total, saved: g.saved,
    serverNow: now,
    round: r ? {
      letters: def.letters, length: def.letters.length, wordCount: def.words.length,
      endsAt: r.endsAt, score: r.score,
      found: [...r.found].map(([word, points]) => ({ word, points })),
      gotFull: [...r.found.keys()].some(w => w.length === def.letters.length)
    } : null,
    // Only once the round is over: the full word and everything that was there.
    reveal: r && r.ended ? { word: def.word, full: def.full, words: def.words } : null,
    // How each finished round went, for the end screen.
    past: g.played.filter(x => x.ended).map((x, i) => summary(g, i))
  };
}

function start({ mode, dictionary, rounds, seconds, profileToken }, now = Date.now()) {
  if (games.size >= MAX_GAMES) sweep(now);
  if (games.size >= MAX_GAMES) throw fail('The arcade is very busy right now. Try again in a minute.', 503);
  const daily = mode === 'daily';
  const dict = game.profileOf(dictionary);
  const day = today(new Date(now));
  const profile = profileToken ? profiles().verify(profileToken) : null;
  if (daily && profile) {
    // A profile gets one go at the day's set: the letters are the same all
    // day, so a second go would always score better.
    const had = db.db.prepare('SELECT game_id FROM scuffle_daily_plays WHERE day = ? AND profile_id = ?').get(day, profile.id);
    if (had) {
      const g = games.get(had.game_id);
      if (g) { g.touched = now; return view(g, now); }
      throw fail('You\'ve already played today\'s set. A new one arrives at midnight; free play is open any time.', 409);
    }
  }
  const g = {
    id: crypto.randomBytes(16).toString('hex'),
    mode: daily ? 'daily' : 'free', day, dictionary: dict,
    seconds: daily ? game.DAILY.seconds : game.secondsOf(seconds),
    rounds: daily ? game.dailyRounds(day, dict) : game.makeRounds({ count: game.roundsOf(rounds), profile: dict }),
    index: -1, current: null, played: [], total: 0, finished: false, saved: false,
    profileId: profile ? profile.id : null, touched: now
  };
  games.set(g.id, g);
  if (daily && profile) db.db.prepare('INSERT INTO scuffle_daily_plays (day, profile_id, game_id) VALUES (?, ?, ?)').run(day, profile.id, g.id);
  return view(g, now);
}

// Starts the next round; its clock starts now, on the server.
function next(id, now = Date.now()) {
  const g = need(id);
  settle(g, now);
  if (g.finished) throw fail('That was the last round.', 409);
  if (g.current && !g.current.ended) return view(g, now);
  g.index++;
  g.current = { startedAt: now, endsAt: now + g.seconds * 1000, found: new Map(), score: 0, ended: false };
  g.played.push(g.current);
  return view(g, now);
}

function summary(g, i) {
  const def = g.rounds[i], r = g.played[i];
  return { letters: def.letters, word: def.word, full: def.full, score: r.score, found: r.found.size, words: def.words.length };
}

function word(id, raw, now = Date.now()) {
  const g = need(id);
  settle(g, now);
  const r = g.current;
  if (!r || r.ended) throw fail('Time\'s up for this round.', 409);
  if (r.found.size >= MAX_WORDS) throw fail('That\'s every word this round can hold.', 409);
  const def = g.rounds[g.index];
  const verdict = game.checkWord(def, raw, r.found);
  if (verdict.ok) {
    verdict.points = game.pointsFor(verdict.word, def.letters.length);
    r.found.set(verdict.word, verdict.points);
    r.score += verdict.points;
    // Every word found: no reason to make them watch the clock.
    if (r.found.size === def.words.length) endRound(g);
  }
  return { ...verdict, state: view(g, now) };
}

function stop(id, now = Date.now()) {
  const g = need(id);
  settle(g, now);
  endRound(g);
  return view(g, now);
}

// ---- the daily board ----------------------------------------------------------------

const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');

function save(id, { initials, profileToken }) {
  const g = need(id);
  settle(g);
  if (g.mode !== 'daily') throw fail('Only the daily set goes on the board.', 400);
  if (!g.finished) throw fail('Finish every round first.', 409);
  if (g.saved) throw fail('This score is already on the board.', 409);
  const profile = profileToken ? profiles().verify(profileToken) : null;
  const ini = profile ? profile.initials || initialsOf(profile.name) : String(initials || '').toUpperCase().trim();
  if (!INITIALS_RE.test(ini)) throw fail('Initials must be 1-3 letters or numbers.');
  const who = profile ? `p:${profile.id}` : `g:${ini}`;
  if (db.db.prepare('SELECT 1 FROM scuffle_scores WHERE day = ? AND who = ?').get(g.day, who)) {
    throw fail('You already have a score on today\'s board. Only your first go counts, because the letters stay the same all day.', 409);
  }
  // Counted from what the server recorded for each round.
  let words = 0, fulls = 0, best = '';
  g.played.forEach((r, i) => {
    const length = g.rounds[i].letters.length;
    for (const w of r.found.keys()) {
      words++;
      if (w.length === length) fulls++;
      if (w.length > best.length) best = w;
    }
  });
  const info = db.db.prepare(`INSERT INTO scuffle_scores (day, who, initials, profile_id, profile_name, profile_avatar, dictionary, score, words, full_words, best_word)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(g.day, who, ini, profile ? profile.id : null, profile ? profile.name : null,
    profile ? profile.avatar : null, g.dictionary, g.total, words, fulls, best || null);
  g.saved = true;
  const scoreId = Number(info.lastInsertRowid);
  const dayRank = db.db.prepare('SELECT COUNT(*) AS c FROM scuffle_scores WHERE day = ? AND (score > ? OR (score = ? AND id < ?))')
    .get(g.day, g.total, g.total, scoreId).c + 1;
  const allRank = db.db.prepare('SELECT COUNT(*) AS c FROM scuffle_scores WHERE score > ? OR (score = ? AND id < ?)')
    .get(g.total, g.total, scoreId).c + 1;
  if (allRank === 1 && g.total > 0) {
    const shout = profile ? (profiles().boardName(profile.id) || {}).label || profile.name : ini;
    comm.safePost({
      kind: 'highscore', emoji: '🔀', game: 'scuffle',
      title: `${shout} set the best Shuffle Scuffle daily score ever`,
      body: `${shout} scored ${g.total.toLocaleString('en-US')} on the daily set, the highest anyone has managed. Today's letters are waiting if you want a go.`
    });
  }
  return { id: scoreId, dayRank, allRank, score: g.total };
}

// The kids and grown-up lists share one board, so a grown-up's best word
// might not be one to show the kids. The score still counts; only the word is
// left off.
const dictionary = require('../rambler/dictionary');
function board({ scope = 'day', day, limit = 20 }) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const rows = scope === 'all'
    ? db.db.prepare('SELECT * FROM scuffle_scores ORDER BY score DESC, id ASC LIMIT ?').all(cap)
    : db.db.prepare('SELECT * FROM scuffle_scores WHERE day = ? ORDER BY score DESC, id ASC LIMIT ?')
      .all(DAY_RE.test(String(day || '')) ? day : today(), cap);
  return rows.map(r => {
    const now = r.profile_id ? profiles().boardName(r.profile_id) : null;
    return {
      id: r.id, day: r.day, initials: r.initials, score: r.score, words: r.words, fullWords: r.full_words,
      bestWord: r.best_word && dictionary.isWord(r.best_word, 'kids') ? r.best_word : '',
      dictionary: r.dictionary,
      profileName: now ? now.label : r.profile_name || null, profileAvatar: now ? now.avatar : r.profile_avatar || null
    };
  });
}

module.exports = { start, next, word, stop, save, board, view: id => view(need(id)), GRACE_MS, _games: games };
