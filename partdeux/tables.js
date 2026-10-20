'use strict';

// Uh-Oh: Part Deux tables: the shared party-game plumbing (one phone or a
// phone each, lobby passwords for adult decks) around this game's engine.

const { makeTables } = require('../arcade/party-tables');
const engine = require('./engine');
const cardNames = require('./cards');

function act(game, actorId, body) {
  const a = body.action;
  if (a === 'play') return engine.play(game, actorId, body.cardId, { color: body.color, giftCardId: body.giftCardId, target: body.target });
  if (a === 'draw') return engine.draw(game, actorId);
  if (a === 'pass') return engine.pass(game, actorId);
  if (a === 'uhoh') return engine.callUhOh(game, actorId);
  if (a === 'catch') return engine.catchUhOh(game, actorId, body.target);
  throw Object.assign(new Error('Unknown move.'), { status: 400 });
}

module.exports = makeTables({ engine, act, levels: cardNames.LEVELS, minPlayers: 2, maxPlayers: 8 });
