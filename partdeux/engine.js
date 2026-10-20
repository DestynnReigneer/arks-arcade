'use strict';

// Uh-Oh: Part Deux. A shedding card game: match the top card by color or by
// number/symbol, and the first player to empty their hand wins. The action
// cards wear funny names at every spice level (cards.js).
//
// Pure functions over a plain game object: the
// rooms and tables modules own timing, sockets and who's allowed to act.

const crypto = require('node:crypto');
const cardNames = require('./cards');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const HAND_SIZE = 7;

// Which set of funny names each action wears.
const FLAVOR_OF = { skip: 'skip', draw2: 'attack', reverse: 'shuffle', nope: 'nope', gift: 'favor', wild: 'defuse', wild4: 'bomb' };

const RULES = {
  num: 'Match the color or the number.',
  skip: 'The next player misses their turn.',
  draw2: 'The next player draws 2 and misses their turn, unless they bounce it with a Nope.',
  reverse: 'Turn order flips. With two players it works like a Skip.',
  nope: 'Bounce a Draw Two or Draw Four on to the next player. Also plays as a normal card of its color.',
  gift: 'Give one of your other cards to any player. One card closer to winning!',
  wild: 'Play on anything and pick the next color.',
  wild4: 'Uh-Oh! Pick the next color; the next player draws 4 and misses their turn, unless they Nope it.'
};

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function shuffle(list, rand = () => crypto.randomInt(1 << 30) / (1 << 30)) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 116 cards: for each color one 0, two of 1-9, two Skips, two Draw Twos, two
// Reverses, one Nope and one Gift; plus four Wilds and four Uh-Oh Draw Fours.
function buildDeck() {
  const cards = {};
  let n = 0;
  const add = (kind, color = null, value = null) => {
    const id = `c${n++}`;
    cards[id] = { id, kind, color, value, variant: n };
  };
  for (const color of COLORS) {
    add('num', color, 0);
    for (let v = 1; v <= 9; v++) { add('num', color, v); add('num', color, v); }
    for (const kind of ['skip', 'draw2', 'reverse']) { add(kind, color); add(kind, color); }
    add('nope', color);
    add('gift', color);
  }
  for (let i = 0; i < 4; i++) { add('wild'); add('wild4'); }
  return cards;
}

function createGame({ players, level = 'kids', drinking = false, rand }) {
  if (!Array.isArray(players) || players.length < 2) throw fail('Uh-Oh needs at least 2 players.');
  if (players.length > 8) throw fail('Up to 8 players.');
  const cards = buildDeck();
  const deck = shuffle(Object.keys(cards), rand);
  const game = {
    level: cardNames.levelOf(level),
    drinking: !!drinking && cardNames.LEVELS[cardNames.levelOf(level)].adult,
    cards, deck, discard: [],
    players: players.map(p => ({ id: p.id, name: p.name, hand: [] })),
    turn: 0, dir: 1, color: null, pendingDraw: 0,
    phase: 'play', winner: null,
    drew: null,              // the card just drawn this turn, which may be played
    calledUhOh: null,        // who has called "Uh-Oh!" on their way to one card
    vulnerable: null,        // who went to one card without calling it (catchable)
    log: [], callouts: [], seq: 0, rand
  };
  for (let i = 0; i < HAND_SIZE; i++) for (const p of game.players) p.hand.push(take(game));
  // Start on a plain number card.
  let first = take(game);
  while (cards[first].kind !== 'num') { game.deck.unshift(first); game.deck = shuffle(game.deck, rand); first = take(game); }
  game.discard.push(first);
  game.color = cards[first].color;
  say(game, 'Cards dealt. Match the color or the number!');
  return game;
}

// ---- helpers ------------------------------------------------------------------------

function take(game) {
  if (!game.deck.length) {
    // Shuffle the discard pile (all but the top card) back in.
    const top = game.discard.pop();
    game.deck = shuffle(game.discard, game.rand);
    game.discard = top ? [top] : [];
  }
  return game.deck.pop() || null;
}

function say(game, text) {
  game.log.push(text);
  if (game.log.length > 30) game.log.shift();
}

// Party rules for Drinking mode, kept in a list the page shows and clears.
function callout(game, who, text) {
  game.seq++;
  game.callouts.push({ n: game.seq, who, name: who ? player(game, who).name : null, text });
  if (game.callouts.length > 12) game.callouts.shift();
}

const player = (game, id) => game.players.find(p => p.id === id);
const current = game => game.players[game.turn];
const top = game => game.cards[game.discard[game.discard.length - 1]];
const step = (game, n = 1) => {
  const len = game.players.length;
  game.turn = ((game.turn + n * game.dir) % len + len) % len;
};

function requireTurn(game, pid) {
  if (game.phase === 'over') throw fail('The game is over.', 409);
  if (current(game).id !== pid) throw fail('It\'s not your turn.', 409);
}

// Can this card go on the pile right now?
function canPlay(game, card) {
  if (game.pendingDraw > 0) return card.kind === 'nope';
  if (card.kind === 'wild' || card.kind === 'wild4') return true;
  const t = top(game);
  if (card.color === game.color) return true;
  if (card.kind === 'num') return t.kind === 'num' && t.value === card.value;
  return card.kind === t.kind;
}

function drawCards(game, p, n) {
  for (let i = 0; i < n; i++) { const c = take(game); if (c) p.hand.push(c); }
}

// Whoever just went to one card without calling it can be caught until the
// next player does something.
function clearVulnerable(game) { game.vulnerable = null; }

// ---- actions ---------------------------------------------------------------------

// Call "Uh-Oh!" before playing your second-to-last card.
function callUhOh(game, pid) {
  const p = player(game, pid);
  if (!p) throw fail('Not in this game.', 403);
  if (p.hand.length > 2) throw fail('Only when you\'re about to have one card left.', 409);
  game.calledUhOh = pid;
  if (game.vulnerable === pid) game.vulnerable = null;
  say(game, `${p.name}: "Uh-Oh!" 🚨`);
  return game;
}

// Anyone can catch a player who went to one card without calling it.
function catchUhOh(game, catcherId, targetId) {
  const target = player(game, targetId);
  const catcher = player(game, catcherId);
  if (!target || !catcher) throw fail('Not in this game.', 403);
  if (game.vulnerable !== targetId || target.hand.length !== 1) throw fail('Too late, or they called it.', 409);
  drawCards(game, target, 2);
  game.vulnerable = null;
  say(game, `${catcher.name} caught ${target.name}! They forgot to say Uh-Oh. +2 cards 🃏`);
  if (game.drinking) callout(game, targetId, 'Caught! Draw 2 and drink 2 🍺');
  return game;
}

// options: { color } for wilds; { giftCardId, target } for a Gift.
function play(game, pid, cardId, options = {}) {
  requireTurn(game, pid);
  const p = current(game);
  if (!p.hand.includes(cardId)) throw fail('That card isn\'t in your hand.');
  if (game.drew && game.drew !== cardId) throw fail('After drawing you can only play the card you drew.', 409);
  const card = game.cards[cardId];
  if (!canPlay(game, card)) throw fail(game.pendingDraw ? 'You have to draw, or bounce it with a Nope.' : 'That doesn\'t match the color or number.', 409);
  if ((card.kind === 'wild' || card.kind === 'wild4') && !COLORS.includes(options.color)) throw fail('Pick a color.');
  let gift = null;
  if (card.kind === 'gift') {
    const to = player(game, options.target);
    if (!to || to.id === pid) throw fail('Pick someone to give a card to.');
    if (!options.giftCardId || options.giftCardId === cardId || !p.hand.includes(options.giftCardId)) throw fail('Pick one of your other cards to give.');
    gift = { to, cardId: options.giftCardId };
  }

  clearVulnerable(game);
  p.hand.splice(p.hand.indexOf(cardId), 1);
  game.discard.push(cardId);
  game.drew = null;
  game.color = card.color || options.color;
  const name = view(card, game.level).name;
  const nextName = () => game.players[((game.turn + game.dir) % game.players.length + game.players.length) % game.players.length].name;

  if (gift) {
    p.hand.splice(p.hand.indexOf(gift.cardId), 1);
    gift.to.hand.push(gift.cardId);
    say(game, `${p.name} played ${name} and gave ${gift.to.name} a card 🎁`);
  } else if (card.kind === 'nope' && game.pendingDraw) {
    say(game, `${p.name} played ${name}! The +${game.pendingDraw} bounces to ${nextName()} 🙅`);
    if (game.drinking) callout(game, pid, 'Bounced it! Give out a sip 😏');
  } else if (card.kind === 'wild' || card.kind === 'wild4') {
    say(game, `${p.name} played ${name} and picked ${game.color}${card.kind === 'wild4' ? `. ${nextName()} draws 4!` : ''}`);
  } else {
    say(game, `${p.name} played ${card.kind === 'num' ? `${card.color} ${card.value}` : name}`);
  }

  // Going to one card: fine if you called it, catchable if you didn't.
  if (p.hand.length === 1) {
    if (game.calledUhOh === pid) game.calledUhOh = null;
    else game.vulnerable = pid;
  }
  if (!p.hand.length) return win(game, p);

  if (card.kind === 'draw2') game.pendingDraw += 2;
  if (card.kind === 'wild4') game.pendingDraw += 4;
  if (card.kind === 'reverse') {
    game.dir *= -1;
    if (game.players.length === 2) step(game);      // works like a Skip with two
  }
  if (card.kind === 'skip') step(game);
  step(game);
  return game;
}

// Draw: take the penalty if one is waiting, otherwise one card you may play.
function draw(game, pid) {
  requireTurn(game, pid);
  const p = current(game);
  if (game.drew) throw fail('You already drew. Play it or pass.', 409);
  clearVulnerable(game);
  if (game.pendingDraw) {
    const n = game.pendingDraw;
    drawCards(game, p, n);
    game.pendingDraw = 0;
    say(game, `${p.name} draws ${n} 😩`);
    if (game.drinking) callout(game, pid, `Drew ${n}: drink ${n} sips 🍺`);
    step(game);
    return game;
  }
  const c = take(game);
  if (!c) { step(game); return game; }
  p.hand.push(c);
  if (canPlay(game, game.cards[c])) {
    game.drew = c;
    say(game, `${p.name} drew a card. It can be played!`);
  } else {
    say(game, `${p.name} drew a card`);
    step(game);
  }
  return game;
}

// After drawing a playable card, keep it instead.
function pass(game, pid) {
  requireTurn(game, pid);
  if (!game.drew) throw fail('Draw first.', 409);
  game.drew = null;
  say(game, `${current(game).name} kept it`);
  step(game);
  return game;
}

function win(game, p) {
  game.phase = 'over';
  game.winner = p.id;
  game.pendingDraw = 0;
  say(game, `${p.name} is out of cards and wins! 🏆`);
  if (game.drinking) callout(game, null, `${p.name} wins! Everyone else drinks 🍻`);
  return game;
}

function removePlayer(game, pid) {
  const idx = game.players.findIndex(p => p.id === pid);
  if (idx < 0) return game;
  const [gone] = game.players.splice(idx, 1);
  game.deck.unshift(...gone.hand);
  if (game.players.length < 2 && game.phase !== 'over') return win(game, game.players[0]);
  if (idx < game.turn) game.turn--;
  game.turn %= game.players.length;
  game.drew = null;
  say(game, `${gone.name} left the game`);
  return game;
}

// ---- what a player gets to see -------------------------------------------------------

function view(card, level) {
  if (!card) return null;
  const base = { id: card.id, kind: card.kind, color: card.color, value: card.value, rule: RULES[card.kind] };
  if (card.kind === 'num') return { ...base, name: `${card.value}`, emoji: '', quip: '' };
  const variants = cardNames.FLAVOR[cardNames.levelOf(level)][FLAVOR_OF[card.kind]];
  const [emoji, name, quip] = variants[card.variant % variants.length];
  return { ...base, emoji, name, quip };
}

// viewerId: whose hand to show (null shows none). allHands: one shared phone.
function snapshot(game, viewerId, { allHands = false } = {}) {
  const v = c => view(game.cards[c], game.level);
  const me = player(game, viewerId);
  const turnId = game.phase === 'over' ? null : current(game).id;
  return {
    phase: game.phase, level: game.level, drinking: game.drinking,
    turn: turnId, dir: game.dir, color: game.color, pendingDraw: game.pendingDraw,
    top: v(game.discard[game.discard.length - 1]), deckCount: game.deck.length,
    drew: game.drew && viewerId === turnId ? game.drew : null,
    winner: game.winner, vulnerable: game.vulnerable, calledUhOh: game.calledUhOh,
    players: game.players.map(p => ({ id: p.id, name: p.name, cards: p.hand.length })),
    hand: me ? me.hand.map(v) : [],
    hands: allHands ? Object.fromEntries(game.players.map(p => [p.id, p.hand.map(v)])) : undefined,
    playable: me && viewerId === turnId ? me.hand.filter(c => (!game.drew || game.drew === c) && canPlay(game, game.cards[c])) : [],
    log: game.log.slice(-8), callouts: game.callouts
  };
}

module.exports = { COLORS, RULES, createGame, play, draw, pass, callUhOh, catchUhOh, removePlayer, snapshot, view, canPlay, _top: top };
