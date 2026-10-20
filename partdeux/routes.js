'use strict';

// /api/partdeux: Uh-Oh: Part Deux on one phone or a phone each.

const { makeRoutes } = require('../arcade/party-routes');
const sfCards = require('../shortfuse/cards');
const engine = require('./engine');
const tables = require('./tables');

module.exports = makeRoutes({
  tables,
  config: () => ({ levels: sfCards.listLevels(), rules: engine.RULES, colors: engine.COLORS })
});
