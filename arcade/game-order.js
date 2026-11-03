'use strict';

// How the home page orders "your games", in a way that moves slowly.
//
// The rule, in plain words:
//   - Every time a game is opened and played for at least 20 seconds, that
//     counts as one play. Only the first three plays of a game on any one day
//     count, so one long evening doesn't outweigh weeks of steady play.
//   - Older plays count for less: a play loses half its weight every 14 days
//     (its "half-life"), so what you play now matters more than what you
//     played in the spring.
//   - The list starts from the order the person saw last time, and a game
//     only moves above the one right over it when its score beats that game's
//     by a clear margin: more than 1.25 times its score plus 1.5 plays. One
//     play is worth at most 1, so a single play never moves a game up on its
//     own, and a game played a few times can't jump past one played many
//     times. Games that are close keep the order they already had.
//
// Everything here is plain functions with no database, so test/unit.test.js
// can check the rule on its own. arcade/stats.js feeds it the visits.

const DAY = 24 * 60 * 60 * 1000;
const RULES = Object.freeze({
  halfLifeDays: 14,   // a play's weight halves every 14 days
  minMs: 20 * 1000,   // a visit shorter than this isn't a play
  perDay: 3,          // at most this many plays of one game count on one day
  ratio: 1.25,        // to move up, beat the game above by this much...
  gap: 1.5,           // ...plus this many plays
});

// visits: [{ game, started_at, active_ms }] -> Map(game -> score)
function playScores(visits, { now = Date.now(), rules = RULES } = {}) {
  const perDay = new Map(); // "game|day" -> plays counted so far
  const scores = new Map();
  for (const v of visits) {
    if (!v || !v.game || (Number(v.active_ms) || 0) < rules.minMs) continue;
    const day = Math.floor(Number(v.started_at) / DAY);
    const key = `${v.game}|${day}`;
    const n = perDay.get(key) || 0;
    if (n >= rules.perDay) continue;
    perDay.set(key, n + 1);
    const ageDays = Math.max(0, (now - Number(v.started_at)) / DAY);
    scores.set(v.game, (scores.get(v.game) || 0) + Math.pow(0.5, ageDays / rules.halfLifeDays));
  }
  return scores;
}

// The order to show: start from `start` (what was shown last time) and let a
// game climb past the one above it only while it clears the margin. Repeats
// until nothing moves. A climb needs a strictly higher score, so it always
// settles.
function dampedOrder(start, scores, rules = RULES) {
  const list = start.slice();
  const s = id => scores.get(id) || 0;
  for (let moved = true, guard = 0; moved && guard < list.length * list.length + 1; guard++) {
    moved = false;
    for (let i = 1; i < list.length; i++) {
      if (s(list[i]) > s(list[i - 1]) * rules.ratio + rules.gap) {
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        moved = true;
      }
    }
  }
  return list;
}

// The order the page sent back (what it showed last time), cleaned up: only
// games the arcade knows, each once, and any it left out go on the end in the
// admin's order. null if the page sent nothing usable.
function cleanPrevious(previous, order) {
  if (!Array.isArray(previous)) return null;
  const seen = new Set();
  const list = [];
  for (const id of previous.slice(0, 100)) {
    if (typeof id === 'string' && order.includes(id) && !seen.has(id)) { seen.add(id); list.push(id); }
  }
  if (!list.length) return null;
  for (const id of order) if (!seen.has(id)) list.push(id);
  return list;
}

module.exports = { RULES, DAY, playScores, dampedOrder, cleanPrevious };
