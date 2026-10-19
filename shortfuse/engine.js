'use strict';

// Short Fuse's rules, with no idea whether it is running on one phone or
// eight. Everything here works on a plain game object and either changes it
// or throws; tables.js decides who is allowed to ask and tells everyone.
//
// A turn: play as many action cards as you like, then draw one card to end it.
// Draw a bomb without a Defuse and you are out. Last one standing wins.

const crypto = require('node:crypto');
const cards = require('./cards');

const ACTIONS = ['skip', 'attack', 'shuffle', 'peek', 'favor'];
const HAND_SIZE = 6;             // plus a Defuse each
const LOG_LIMIT = 40;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- setup -----------------------------------------------------------------

function createGame({ players, level }) {
  const n = players.length;
  if (n < 2) throw fail('Short Fuse needs at least 2 players.');

  // Past five players one deck runs thin, so use two.
  const copies = n <= 5 ? 1 : 2;
  const all = {};
  let next = 1;
  const make = type => {
    const id = 'c' + next++;
    all[id] = { id, type, variant: crypto.randomInt(1000) };
    return id;
  };

  const pile = [];
  const add = (type, count) => { for (let i = 0; i < count * copies; i++) pile.push(make(type)); };
  add('skip', 4);
  add('attack', 4);
  add('shuffle', 4);
  add('peek', 5);
  add('favor', 4);
  add('nope', 5);
  for (const j of cards.JUNK_TYPES) add(j, 4);
  shuffle(pile);

  const seats = players.map(p => ({ id: p.id, name: p.name, hand: [], out: false }));
  for (const s of seats) {
    s.hand.push(make('defuse'));
    for (let i = 0; i < HAND_SIZE; i++) s.hand.push(pile.pop());
  }

  // Bombs go in only after the deal, so nobody starts holding one.
  const spare = Math.max(1, Math.min(3, 6 * copies - n));
  for (let i = 0; i < spare; i++) pile.push(make('defuse'));
  for (let i = 0; i < n - 1; i++) pile.push(make('bomb'));
  shuffle(pile);

  const game = {
    level: cards.levelOf(level),
    cards: all,
    seats,
    deck: pile,             // deck[0] is the top
    discard: [],
    turn: crypto.randomInt(n),
    turnsOwed: 1,
    phase: 'play',          // play | reaction | favor | defuse | over
    pending: null,
    peek: null,
    lastDraw: null,
    defusing: null,
    winner: null,
    log: [],
    seq: 0
  };
  say(game, `${current(game).name} goes first.`);
  return game;
}

// ---- helpers ---------------------------------------------------------------

function say(game, text) {
  game.seq++;
  game.log.push({ seq: game.seq, text });
  if (game.log.length > LOG_LIMIT) game.log.shift();
}

const current = game => game.seats[game.turn];
const seatOf = (game, id) => game.seats.find(s => s.id === id) || null;
const alive = game => game.seats.filter(s => !s.out);
const nameOf = (game, id) => (seatOf(game, id) || { name: '?' }).name;
const typeOf = (game, id) => game.cards[id].type;

function requireSeat(game, id) {
  const seat = seatOf(game, id);
  if (!seat) throw fail('You are not in this game.', 403);
  if (seat.out) throw fail('You have already blown up.', 409);
  return seat;
}

function requireTurn(game, id, phase = 'play') {
  if (game.phase === 'over') throw fail('The game is over.', 409);
  if (game.phase !== phase) throw fail('Not now.', 409);
  const seat = requireSeat(game, id);
  if (current(game).id !== seat.id) throw fail('It is not your turn.', 409);
  return seat;
}

function takeFromHand(seat, cardId) {
  const i = seat.hand.indexOf(cardId);
  if (i === -1) throw fail('That card is not in your hand.');
  return seat.hand.splice(i, 1)[0];
}

function advance(game) {
  const n = game.seats.length;
  let i = game.turn;
  do { i = (i + 1) % n; } while (game.seats[i].out);
  game.turn = i;
  game.turnsOwed = 1;
  game.peek = null;
}

// One turn done. Attacked players keep going until they have paid off theirs.
function finishTurn(game) {
  game.turnsOwed--;
  game.peek = null;
  if (game.turnsOwed > 0) {
    say(game, `${current(game).name} has ${game.turnsOwed} more turn${game.turnsOwed === 1 ? '' : 's'} to take.`);
  } else {
    advance(game);
  }
}

function checkWinner(game) {
  const left = alive(game);
  if (left.length === 1) {
    game.phase = 'over';
    game.winner = left[0].id;
    game.pending = null;
    say(game, `🏆 ${left[0].name} is the last one standing!`);
    return true;
  }
  return false;
}

// ---- playing cards ---------------------------------------------------------

// One action card, or a matching pair of junk cards to steal. Nothing happens
// yet: everyone gets a chance to Nope it first (resolve() makes it happen).
function play(game, actorId, { cards: ids, target } = {}) {
  const seat = requireTurn(game, actorId);
  const list = Array.isArray(ids) ? ids.map(String) : [];
  if (!list.length || list.length > 2) throw fail('Play one action card, or a matching pair.');
  if (new Set(list).size !== list.length) throw fail('Same card twice?');
  for (const id of list) if (!seat.hand.includes(id)) throw fail('That card is not in your hand.');

  const types = list.map(id => typeOf(game, id));
  let action;
  if (list.length === 1 && ACTIONS.includes(types[0])) action = types[0];
  else if (list.length === 2 && types[0] === types[1] && cards.isJunk(types[0])) action = 'steal';
  else if (types[0] === 'nope') throw fail('A Nope can only be played on someone else’s action.');
  else if (types[0] === 'defuse') throw fail('Save your Defuse for a bomb.');
  else throw fail(list.length === 2 ? 'A pair has to be two matching junk cards.' : 'Junk cards only work in matching pairs.');

  let victim = null;
  if (action === 'favor' || action === 'steal') {
    victim = seatOf(game, String(target || ''));
    if (!victim || victim.out || victim.id === seat.id) throw fail('Pick another player who is still in.');
    if (!victim.hand.length) throw fail(`${victim.name} has no cards.`);
  }

  for (const id of list) game.discard.push(takeFromHand(seat, id));
  game.pending = { action, by: seat.id, target: victim ? victim.id : null, cards: list, nopes: 0 };
  game.phase = 'reaction';

  const card = cards.view(game.cards[list[0]], game.level);
  const verb = {
    skip: 'skips', attack: 'attacks', shuffle: 'shuffles the deck', peek: 'peeks at the top cards',
    favor: `asks ${victim && victim.name} for a favor`, steal: `tries to steal from ${victim && victim.name}`
  }[action];
  say(game, `${seat.name} plays ${card.emoji} ${card.name} — ${verb}.`);
  return game.pending;
}

// Anyone still in, including the player who played the action, can Nope --
// and Nope a Nope. An odd number of Nopes cancels the action.
function nope(game, actorId) {
  if (game.phase !== 'reaction') throw fail('Nothing to Nope right now.', 409);
  const seat = requireSeat(game, actorId);
  const id = seat.hand.find(c => typeOf(game, c) === 'nope');
  if (!id) throw fail(`${seat.name} has no Nope.`);
  game.discard.push(takeFromHand(seat, id));
  game.pending.nopes++;
  const card = cards.view(game.cards[id], game.level);
  say(game, game.pending.nopes % 2
    ? `${seat.name}: ${card.emoji} ${card.name}!`
    : `${seat.name} Nopes the Nope! ${card.emoji}`);
  return game.pending;
}

function resolve(game) {
  if (game.phase !== 'reaction' || !game.pending) return null;
  const p = game.pending;
  game.phase = 'play';

  if (p.nopes % 2 === 1) {
    say(game, 'Noped. Nothing happens.');
    game.pending = null;
    return { noped: true };
  }

  const by = seatOf(game, p.by);
  switch (p.action) {
    case 'skip':
      game.pending = null;
      finishTurn(game);
      break;
    case 'attack': {
      // Attacked players who attack pass on what they still owe, plus two.
      const owed = game.turnsOwed > 1 ? game.turnsOwed + 2 : 2;
      game.pending = null;
      advance(game);
      game.turnsOwed = owed;
      say(game, `${current(game).name} has to take ${owed} turns!`);
      break;
    }
    case 'shuffle':
      shuffle(game.deck);
      game.pending = null;
      break;
    case 'peek':
      game.peek = { playerId: by.id, cards: game.deck.slice(0, 3) };
      game.pending = null;
      break;
    case 'favor':
      // Now the target has to choose what to give up.
      game.phase = 'favor';
      say(game, `${nameOf(game, p.target)} has to give ${by.name} a card.`);
      break;
    case 'steal': {
      const victim = seatOf(game, p.target);
      if (victim && victim.hand.length) {
        const i = crypto.randomInt(victim.hand.length);
        const id = victim.hand.splice(i, 1)[0];
        by.hand.push(id);
        game.lastSteal = { by: by.id, from: victim.id, card: id };
        say(game, `${by.name} stole a card from ${victim.name}!`);
      }
      game.pending = null;
      break;
    }
  }
  return { noped: false };
}

function give(game, actorId, cardId) {
  if (game.phase !== 'favor' || !game.pending) throw fail('Nobody asked you for anything.', 409);
  if (game.pending.target !== actorId) throw fail('It is not you who has to give.', 403);
  const from = requireSeat(game, actorId);
  const to = seatOf(game, game.pending.by);
  to.hand.push(takeFromHand(from, String(cardId)));
  say(game, `${from.name} hands ${to.name} a card.`);
  game.pending = null;
  game.phase = 'play';
}

// ---- drawing -----------------------------------------------------------------

function draw(game, actorId) {
  const seat = requireTurn(game, actorId);
  const id = game.deck.shift();
  if (!id) throw fail('The deck is empty.', 409);   // cannot happen: bombs never run out before players do
  game.peek = null;
  game.lastDraw = { playerId: seat.id, card: id };

  if (typeOf(game, id) !== 'bomb') {
    seat.hand.push(id);
    say(game, `${seat.name} draws a card.`);
    finishTurn(game);
    return { bomb: false, card: id };
  }

  const bomb = cards.view(game.cards[id], game.level);
  const defuseId = seat.hand.find(c => typeOf(game, c) === 'defuse');
  if (defuseId) {
    game.discard.push(takeFromHand(seat, defuseId));
    const defuse = cards.view(game.cards[defuseId], game.level);
    game.phase = 'defuse';
    game.defusing = { playerId: seat.id, bomb: id };
    say(game, `${seat.name} drew ${bomb.emoji} ${bomb.name}… and used ${defuse.emoji} ${defuse.name}!`);
    return { bomb: true, defused: true, card: id };
  }

  seat.out = true;
  game.discard.push(id, ...seat.hand);
  seat.hand = [];
  say(game, `💥 ${seat.name} drew ${bomb.emoji} ${bomb.name} and blew up! ${bomb.quip}`);
  if (!checkWinner(game)) advance(game);
  return { bomb: true, defused: false, card: id };
}

// After a Defuse, the bomb goes back wherever its drawer likes. 0 is the top.
function placeBomb(game, actorId, position) {
  if (game.phase !== 'defuse' || !game.defusing) throw fail('No bomb to put back.', 409);
  if (game.defusing.playerId !== actorId) throw fail('Not your bomb.', 403);
  const pos = Math.max(0, Math.min(game.deck.length, parseInt(position, 10) || 0));
  game.deck.splice(pos, 0, game.defusing.bomb);
  game.defusing = null;
  game.phase = 'play';
  say(game, `${nameOf(game, actorId)} hides the bomb back in the deck. 🤫`);
  finishTurn(game);
}

// ---- leaving ---------------------------------------------------------------

// Someone leaves a multi-phone game: they are out, their cards are gone, and
// anything waiting on them is unpicked so nobody is left stuck.
function removePlayer(game, id) {
  const seat = seatOf(game, id);
  if (!seat || seat.out || game.phase === 'over') return;
  const wasTurn = current(game).id === id;

  if (game.defusing && game.defusing.playerId === id) {
    game.deck.splice(crypto.randomInt(game.deck.length + 1), 0, game.defusing.bomb);
    game.defusing = null;
  }
  if (game.pending && (game.pending.target === id || game.pending.by === id)) {
    game.pending = null;
  }
  if (game.phase !== 'over') game.phase = 'play';

  seat.out = true;
  game.discard.push(...seat.hand);
  seat.hand = [];
  say(game, `${seat.name} left the game.`);
  if (!checkWinner(game) && wasTurn) advance(game);
}

// ---- what one player is allowed to see ---------------------------------------

function snapshot(game, viewerId, { allHands = false } = {}) {
  const v = id => cards.view(game.cards[id], game.level);
  const handOf = seat => seat.hand.map(v).sort((a, b) => a.kind.localeCompare(b.kind) || a.type.localeCompare(b.type));
  const me = seatOf(game, viewerId);

  return {
    level: game.level,
    phase: game.phase,
    turn: current(game).id,
    turnsOwed: game.turnsOwed,
    deckCount: game.deck.length,
    bombsLeft: game.deck.filter(id => typeOf(game, id) === 'bomb').length,
    discardTop: game.discard.length ? v(game.discard[game.discard.length - 1]) : null,
    seats: game.seats.map(s => ({
      id: s.id, name: s.name, out: s.out, handCount: s.hand.length,
      hasNope: allHands ? s.hand.some(c => typeOf(game, c) === 'nope') : undefined
    })),
    hand: me ? handOf(me) : [],
    hands: allHands ? Object.fromEntries(game.seats.map(s => [s.id, handOf(s)])) : undefined,
    pending: game.pending ? {
      action: game.pending.action, by: game.pending.by, target: game.pending.target,
      nopes: game.pending.nopes, cards: game.pending.cards.map(v)
    } : null,
    // Peeks and draws are private, except on a shared phone where the screen
    // is already only showing whoever's turn it is.
    peek: game.peek && (allHands || game.peek.playerId === viewerId)
      ? { playerId: game.peek.playerId, cards: game.peek.cards.map(v) } : null,
    lastDraw: game.lastDraw && (allHands || game.lastDraw.playerId === viewerId)
      ? { playerId: game.lastDraw.playerId, card: v(game.lastDraw.card) } : null,
    defusing: game.defusing ? { playerId: game.defusing.playerId } : null,
    winner: game.winner,
    log: game.log.slice(-14)
  };
}

module.exports = {
  ACTIONS, HAND_SIZE,
  createGame, play, nope, resolve, give, draw, placeBomb, removePlayer, snapshot,
  _shuffle: shuffle
};
