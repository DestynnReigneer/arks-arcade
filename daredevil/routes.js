'use strict';

// /api/daredevil: Dare Devil on one phone or a phone each.

const { makeRoutes } = require('../arcade/party-routes');
const cards = require('./cards');
const engine = require('./engine');
const tables = require('./tables');

module.exports = makeRoutes({
  tables,
  config: () => ({ levels: Object.values(cards.LEVELS), types: cards.TYPES, lengths: engine.LENGTHS })
});
