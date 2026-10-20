'use strict';

// Dare Devil: a party deck. On your turn, draw a card and do what it says:
// a dare, a truth, a new rule, a challenge... Do it for points, or chicken
// out and pay for it (lose a point, or drink in Drinking mode). Most points
// when the deck runs out wins.

const crypto = require('node:crypto');
const cards = require('./cards');

const LENGTHS = { quick: 15, standard: 30, long: 50 };

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGame({ players, level = 'kids', drinking = false, length = 'standard' }) {
  if (!Array.isArray(players) || players.length < 2) throw fail('Dare Devil needs at least 2 players.');
  const lv = cards.levelOf(level);
  const size = LENGTHS[length] || LENGTHS.standard;
  // Deal from the shuffled pool; the 💣 cards go near the end for a big finish.
  const pool = shuffle(cards.pool(lv));
  const bombs = pool.filter(c => c.type === 'bomb');
  const rest = pool.filter(c => c.type !== 'bomb');
  let deck = rest.slice(0, Math.max(1, size - Math.min(2, bombs.length)));
  deck = [...deck, ...bombs.slice(0, size - deck.length)];
  const tail = shuffle(deck.slice(-6));
  deck = [...deck.slice(0, -6), ...tail];
  return {
    level: lv, drinking: !!drinking && cards.LEVELS[lv].adult, length,
    players: players.map(p => ({ id: p.id, name: p.name, score: 0, chickens: 0, done: 0 })),
    deck, total: deck.length, turn: 0, phase: 'draw', card: null, rule: null,
    winner: null, log: ['Draw a card to start!'], callouts: [], seq: 0
  };
}

const current = game => game.players[game.turn];
const say = (game, text) => { game.log.push(text); if (game.log.length > 30) game.log.shift(); };
function callout(game, who, text) {
  game.seq++;
  const p = game.players.find(x => x.id === who);
  game.callouts.push({ n: game.seq, who, name: p ? p.name : null, text });
  if (game.callouts.length > 12) game.callouts.shift();
}

function requireTurn(game, pid) {
  if (game.phase === 'over') throw fail('The game is over.', 409);
  if (current(game).id !== pid) throw fail('It\'s not your turn.', 409);
}

// Reveal the next card, with {other} filled in as someone else at the table.
function draw(game, pid) {
  requireTurn(game, pid);
  if (game.phase !== 'draw') throw fail('Finish the card you drew first.', 409);
  const raw = game.deck.shift();
  const others = game.players.filter(p => p.id !== pid);
  const other = others[crypto.randomInt(others.length)];
  const t = cards.TYPES[raw.type];
  game.card = { ...raw, text: raw.text.replace(/\{other\}/g, other.name), emoji: t.emoji, label: t.label, points: t.points, other: other.id };
  if (raw.type === 'rule') game.rule = game.card.text;
  game.phase = 'card';
  say(game, `${current(game).name} drew ${t.emoji} ${t.label}`);
  return game;
}

// Did it: points, then the next player.
function done(game, pid) {
  requireTurn(game, pid);
  if (game.phase !== 'card') throw fail('Draw a card first.', 409);
  const p = current(game);
  p.score += game.card.points;
  p.done++;
  say(game, `${p.name} did it! +${game.card.points} 🔥`);
  return next(game);
}

// Chickened out: lose a point, or drink in Drinking mode.
function chicken(game, pid) {
  requireTurn(game, pid);
  if (game.phase !== 'card') throw fail('Draw a card first.', 409);
  const p = current(game);
  p.chickens++;
  if (game.drinking) {
    say(game, `${p.name} chickened out 🐔`);
    callout(game, p.id, 'Chicken! 🐔 Drink 3 sips.');
  } else {
    p.score = Math.max(0, p.score - 1);
    say(game, `${p.name} chickened out 🐔 −1`);
  }
  return next(game);
}

function next(game) {
  game.card = null;
  if (!game.deck.length) return finish(game);
  game.turn = (game.turn + 1) % game.players.length;
  game.phase = 'draw';
  return game;
}

function finish(game) {
  game.phase = 'over';
  const ranked = game.players.slice().sort((a, b) => b.score - a.score || a.chickens - b.chickens);
  game.winner = ranked[0].id;
  say(game, `${ranked[0].name} is the Dare Devil! 😈🏆`);
  if (game.drinking && ranked.length > 1) callout(game, ranked[ranked.length - 1].id, 'Fewest points: finish your drink 🍻');
  return game;
}

function removePlayer(game, pid) {
  const idx = game.players.findIndex(p => p.id === pid);
  if (idx < 0) return game;
  const [gone] = game.players.splice(idx, 1);
  if (game.players.length < 2 && game.phase !== 'over') return finish(game);
  if (idx < game.turn) game.turn--;
  if (game.turn >= game.players.length) game.turn = 0;
  if (gone && game.card && game.phase === 'card' && idx === game.turn) { game.card = null; game.phase = 'draw'; }
  say(game, `${gone.name} left the game`);
  return game;
}

function snapshot(game) {
  return {
    phase: game.phase, level: game.level, drinking: game.drinking,
    turn: game.phase === 'over' ? null : current(game).id,
    card: game.card, rule: game.rule, left: game.deck.length, total: game.total,
    players: game.players.map(p => ({ id: p.id, name: p.name, score: p.score, chickens: p.chickens })),
    winner: game.winner, log: game.log.slice(-8), callouts: game.callouts
  };
}

module.exports = { LENGTHS, createGame, draw, done, chicken, removePlayer, snapshot };
