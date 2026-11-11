'use strict';

// The trophy page: every leaderboard in the arcade on one page, with the
// person asking's own place on each (their Trophy Shelf).
//
// Who's asking comes from their own profile token, the same as the Continue
// row, so "you" is never taken from the address. Without a profile the page
// still shows every board, just with no "you".
//
// Every board is open to everyone, adult ones included (the maintainer's call,
// 2026-11-11): a board only shows names, scores and dates.
//
// Each board below says where its scores live. Daily games' boards also get a
// Today list. Words with Family's boards come from crisscross/results.js.

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const profiles = () => require('./profiles');
const TOP = 10;

// ---- the boards ------------------------------------------------------------------------------

// A board read straight from a table: one row per score.
//   table, where/args (which rows are this board's), value (the column ranked),
//   low (lower is better), pid (the column holding the profile), day (has a day column),
//   at (when a row was made, in ms), detail (a short line under the name)
const sqlTime = r => (r.created_at ? Date.parse(String(r.created_at).replace(' ', 'T') + 'Z') || null : null);

function tableBoard(def) {
  return { at: sqlTime, pid: 'profile_id', where: [], args: [], ...def };
}

function games() {
  const scores = require('./scores').GAMES;
  const fromScores = (id, extra = {}) => {
    const g = scores[id];
    return {
      id, label: g.label, ...extra,
      boards: Object.entries(g.boards).map(([b, label]) => tableBoard({
        id: b, label, table: 'arcade_scores', where: ['game = ?', 'board = ?'], args: [id, b],
        value: 'score', low: !!g.lowerIsBetter, unit: g.lowerIsBetter ? 'lap' : 'points',
        adult: (g.adultBoards || []).includes(b)
      }))
    };
  };
  const levels = (obj, make) => Object.entries(obj).map(([id, v]) => make(id, v.label));
  const tumblerRules = require('../tumbler/routes').RULES_VERSION;

  return [
    { id: 'crisscross', label: 'Words with Family', emoji: '🔡', group: 'word', boards: [
      { id: 'wins', label: 'Games won', unit: 'count', custom: wins },
      tableBoard({ id: 'best', label: 'Best game score', unit: 'points', table: 'crisscross_results', value: 'score', at: r => r.finished_at }),
      tableBoard({ id: 'word', label: 'Best single word', unit: 'points', table: 'crisscross_results', value: 'best_word_score',
        where: ['best_word_score > 0'], at: r => r.finished_at, detail: r => r.best_word })
    ] },
    { id: 'sudoku', label: 'Sudoku', emoji: '🧩', group: 'word', boards: levels(require('../sudoku/generator').LEVELS, (id, label) => tableBoard({
      id, label, table: 'sudoku_scores', where: ['level = ?'], args: [id], value: 'time_ms', low: true, unit: 'time', day: true })) },
    { id: 'clueless', label: 'Clueless Crosswords', emoji: '📰', group: 'word', boards: levels(require('../clueless/maker').LEVELS, (id, label) => tableBoard({
      id, label, table: 'clueless_scores', where: ['level = ?'], args: [id], value: 'time_ms', low: true, unit: 'time', day: true })) },
    { id: 'scuffle', label: 'Shuffle Scuffle', emoji: '🔀', group: 'word', boards: [['kids', 'Family daily'], ['adult', 'Unfiltered daily']].map(([id, label]) => tableBoard({
      id, label, table: 'scuffle_scores', where: ['dictionary = ?'], args: [id], value: 'score', unit: 'points', day: true })) },
    { id: 'rambler', label: 'Rambler', emoji: '🔠', group: 'word', boards: [['4', '4x4 Classic'], ['5', '5x5 Big'], ['marathon', 'Marathon']].map(([id, label]) => tableBoard({
      id, label, table: 'rambler_scores', where: ['board_key = ?'], args: [id], value: 'score', unit: 'points', pid: 'player_id' })) },
    // Scores on adult themes stay off, as on Wordless's own board (the theme's name would show).
    { id: 'wordless', label: 'Wordless', emoji: '🔤', group: 'word', boards: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['ludicrous', 'Ludicrous']].map(([id, label]) => tableBoard({
      id, label, table: 'scores', where: ['difficulty = ?', 'theme_id NOT IN (SELECT id FROM themes WHERE adult = 1)'], args: [id], value: 'score', unit: 'points' })) },

    { id: 'tumbler', label: 'Tumbler Rumble', emoji: '🔓', group: 'cabinet', boards: [tableBoard({
      id: 'pops', label: 'Pops', table: 'tumbler_scores', where: ['rules = ?'], args: [tumblerRules], value: 'score', unit: 'count', day: true })] },
    fromScores('racer', { emoji: '🏎️', group: 'cabinet' }),
    fromScores('bigswing', { emoji: '⚾', group: 'cabinet' }),
    fromScores('bucketdrop', { emoji: '🪣', group: 'cabinet' }),
    fromScores('launcher', { emoji: '🚀', group: 'cabinet' }),
    fromScores('train', { emoji: '🚂', group: 'cabinet' }),

    fromScores('blocks', { emoji: '🟪', group: 'classic' }),
    fromScores('snake', { emoji: '🐍', group: 'classic' }),
    fromScores('dino', { emoji: '🦖', group: 'classic' }),
    fromScores('bricks', { emoji: '🧱', group: 'classic' }),
    fromScores('towers', { emoji: '🏰', group: 'classic' }),

    fromScores('chess', { emoji: '♞', group: 'party' }),
    fromScores('trivia', { emoji: '🧠', group: 'party' }),
    fromScores('spinsolve', { emoji: '🎡', group: 'party' })
  ];
}

// Words with Family's games won: one row per profile, counted.
function wins() {
  return db.db.prepare(`SELECT profile_id, COUNT(*) AS value, MAX(finished_at) AS at FROM crisscross_results
    WHERE won = 1 GROUP BY profile_id ORDER BY value DESC, at ASC`).all()
    .map(r => ({ pid: r.profile_id, value: r.value, at: r.at, name: null, avatar: null, detail: '' }));
}

// ---- reading a board ---------------------------------------------------------------------------

const tableExists = name => !!db.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

function whose(pid, r) {
  const now = pid ? profiles().boardName(pid) : null;
  if (now) return { name: now.label, avatar: now.avatar };
  return { name: (r && r.profile_name) || (r && r.initials) || 'Someone', avatar: (r && r.profile_avatar) || null };
}

// Every row of a custom board, best first, as { pid, value, at, detail }.
function customRows(b) {
  return b.custom().map(r => ({ ...r, ...whose(r.pid, r) }));
}

function tableRead(b, today) {
  const where = [...b.where], args = [...b.args];
  if (today) { where.push('day = ?'); args.push(today); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const dir = b.low ? 'ASC' : 'DESC';
  const better = b.low ? '<' : '>';
  const top = db.db.prepare(`SELECT * FROM ${b.table} ${w} ORDER BY ${b.value} ${dir}, rowid ASC LIMIT ?`).all(...args, TOP)
    .map(r => ({ pid: r[b.pid] || null, value: r[b.value], at: b.at(r), detail: b.detail ? b.detail(r) || '' : '', ...whose(r[b.pid], r) }));
  const standing = pid => {
    if (!pid) return null;
    const mine = db.db.prepare(`SELECT ${b.low ? 'MIN' : 'MAX'}(${b.value}) AS v FROM ${b.table} ${w ? w + ' AND' : 'WHERE'} ${b.pid} = ?`).get(...args, pid);
    if (!mine || mine.v === null || mine.v === undefined) return null;
    const rank = db.db.prepare(`SELECT COUNT(*) AS c FROM ${b.table} ${w ? w + ' AND' : 'WHERE'} ${b.value} ${better} ?`).get(...args, mine.v).c + 1;
    let ahead = null;
    if (rank > 1) {
      const r = db.db.prepare(`SELECT * FROM ${b.table} ${w ? w + ' AND' : 'WHERE'} ${b.value} ${better} ? ORDER BY ${b.value} ${b.low ? 'DESC' : 'ASC'}, rowid DESC LIMIT 1`).get(...args, mine.v);
      if (r) ahead = { value: r[b.value], ...whose(r[b.pid], r) };
    }
    return { rank, value: mine.v, ahead };
  };
  return { top, standing };
}

function customRead(b) {
  const rows = customRows(b);
  const standing = pid => {
    if (!pid) return null;
    const i = rows.findIndex(r => r.pid === pid);
    if (i < 0) return null;
    const better = rows.filter(r => r.value > rows[i].value);
    const ahead = better.length ? better[better.length - 1] : null;
    return { rank: better.length + 1, value: rows[i].value, ahead: ahead ? { value: ahead.value, name: ahead.name, avatar: ahead.avatar } : null };
  };
  return { top: rows.slice(0, TOP), standing };
}

function readBoard(b, me, today) {
  if (!b.custom && !tableExists(b.table)) return { rows: [], you: null };
  const { top, standing } = b.custom ? customRead(b) : tableRead(b, today);
  return {
    rows: top.map((r, i) => ({ rank: i + 1, name: r.name, avatar: r.avatar, value: r.value, at: r.at, detail: r.detail, you: !!me && r.pid === me })),
    you: standing(me)
  };
}

// ---- the whole page -----------------------------------------------------------------------------

function page({ profile }) {
  const me = profile ? profile.id : null;
  const today = require('../rambler/progress').today();
  const shelf = { gold: 0, top3: 0, on: 0 };
  let closest = null;
  const out = games().map(g => ({
    id: g.id, label: g.label, emoji: g.emoji, group: g.group, href: `${g.id}.html`,
    daily: g.boards.some(b => b.day),
    boards: g.boards.map(b => {
      const base = { id: b.id, label: b.label, unit: b.unit, low: !!b.low, adult: !!b.adult, daily: !!b.day };
      const all = readBoard(b, me);
      if (all.you) {
        shelf.on++;
        if (all.you.rank === 1) shelf.gold++;
        if (all.you.rank <= 3) shelf.top3++;
        const a = all.you.ahead;
        if (a) {
          const gap = Math.abs(a.value - all.you.value);
          const rel = gap / Math.max(1, Math.abs(a.value));
          if (!closest || rel < closest.rel) closest = { rel, game: g.id, gameLabel: g.label, board: b.id, boardLabel: b.label, unit: b.unit, gap, name: a.name, href: `${g.id}.html` };
        }
      }
      const board = { ...base, ...all };
      if (b.day) board.today = readBoard(b, me, today);
      return board;
    })
  }));
  if (closest) delete closest.rel;
  return {
    you: profile ? { id: profile.id, ...whose(profile.id, { profile_name: profile.name, profile_avatar: profile.avatar }) } : null,
    today, shelf, closest, games: out
  };
}

const router = express.Router();
const limit = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.' }
});

router.get('/', limit, (req, res, next) => {
  try {
    const profile = profiles().verify(req.get('X-Profile-Token'));
    const data = page({ profile });
    res.set('Cache-Control', 'no-store');
    // The top bar's trophy only needs the number of boards you're #1 on.
    if (req.query.summary === '1') return res.json({ gold: data.shelf.gold, you: !!profile });
    res.json(data);
  } catch (e) { next(e); }
});

module.exports = { router, page, games };
