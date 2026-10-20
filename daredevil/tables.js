'use strict';

// Dare Devil tables: the shared party-game plumbing around this game's engine.

const { makeTables } = require('../arcade/party-tables');
const engine = require('./engine');
const cards = require('./cards');

function act(game, actorId, body) {
  if (body.action === 'draw') return engine.draw(game, actorId);
  if (body.action === 'done') return engine.done(game, actorId);
  if (body.action === 'chicken') return engine.chicken(game, actorId);
  throw Object.assign(new Error('Unknown move.'), { status: 400 });
}

const cleanOptions = o => ({ length: Object.keys(engine.LENGTHS).includes(o.length) ? o.length : 'standard' });

module.exports = makeTables({ engine, act, levels: cards.LEVELS, minPlayers: 2, maxPlayers: 12, cleanOptions });
