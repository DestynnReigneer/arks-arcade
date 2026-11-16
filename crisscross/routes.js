'use strict';

// /api/crisscross: Words with Family (once called Criss Cross), the crossword tile game.
//
// Who's asking comes from headers, never the address: X-Profile-Token (the
// profile's signed token) for online games, X-Game-Key for a pass-and-play
// game on one device, and X-Adult-Pin (an ARKS ID adult pass, or an ARKS ID adult
// pass) for games on the unfiltered list. The page only ever sends where it
// put its tiles; the server checks the move and decides the points.

const express = require('express');
const rateLimit = require('express-rate-limit');
const adultPin = require('../arcade/adult-pin');
const E = require('./engine');
const games = require('./games');

const fail = E.fail;
const profiles = () => require('../arcade/profiles');
const body = req => req.body || {};
const who = req => ({ profile: profiles().verify(req.get('X-Profile-Token')), key: String(req.get('X-Game-Key') || '') });
const needProfile = req => {
  const w = who(req);
  if (!w.profile) throw fail('Online games are for people with a profile, so the game knows whose turn it is. Pick your profile first, or play on one device instead.', 401);
  return w;
};
// With ARKS ID on, adult levels follow each person's role (see arcade/arksid.js).
const arksMode = () => adultPin.status().source === 'arksid';

// The unfiltered list: every request needs an ARKS ID adult pass, and with
// ARKS ID the person asking has to be an adult too. So everyone in an
// unfiltered game has to qualify, not just the one who started it.
function adultGate(req, dictionary, profile) {
  if (E.dictOf(dictionary) !== 'adult') return;
  if (!adultPin.matches(req.get('X-Adult-Pin') || (req.body && req.body.adultPin) || '')) {
    throw Object.assign(fail('This game uses the unfiltered word list, so it needs an adult signed in with ARKS ID.', 403), { adult: true });
  }
  if (arksMode() && profile && !games.grownUp(profile.id)) throw fail('Games on the unfiltered list are only for adults.', 403);
}

const router = express.Router();
const limiter = (limit, windowMin = 10) => rateLimit({
  windowMs: windowMin * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'That\'s a lot of taps in a short time. Take a breather and try again in a few minutes.' }
});
// The test suite starts many games from one address, so it gets more room (never in production).
const readLimit = limiter(3000), moveLimit = limiter(600), newLimit = limiter(process.env.NODE_ENV === 'test' ? 200 : 40);
const wrap = fn => (req, res, next) => { try { res.json(fn(req, res)); } catch (e) { next(e); } };

router.get('/config', (req, res) => res.json({
  size: E.SIZE, center: E.CENTER, rack: E.RACK, layout: E.LAYOUT, values: E.VALUES,
  counts: Object.fromEntries(Object.entries(E.TILES).map(([k, [c]]) => [k, c])), bagSize: E.BAG_SIZE,
  allTilesBonus: E.ALL_TILES_BONUS, swapMin: E.SWAP_MIN, scorelessEnd: E.SCORELESS_END, maxPlayers: E.MAX_PLAYERS,
  adultRequiresPin: adultPin.status().set, arksId: arksMode()
}));
router.post('/unlock', adultPin.tryLimiter(), (req, res) => res.json(adultPin.check(req, res)));

// List Hosted Games: every lobby that's waiting for players, for anyone who asks.
router.get('/lobbies', readLimit, wrap(req => ({ lobbies: games.lobbies(who(req).profile) })));

// Your games, and how many are waiting on you.
router.get('/mine', readLimit, wrap(req => games.mine(needProfile(req).profile)));
router.get('/turns', readLimit, wrap(req => {
  const { profile } = who(req);
  return { yourTurn: profile ? games.turnCount(profile.id) : 0 };
}));

router.post('/games', newLimit, (req, res, next) => {
  try {
    const b = body(req);
    if (b.kind === 'local') {
      adultGate(req, b.dictionary, who(req).profile);
      const { id, key } = games.createLocal({ players: b.players, dictionary: b.dictionary });
      return res.status(201).json({ id, key, game: games.open(id, { key }) });
    }
    const w = needProfile(req);
    adultGate(req, b.dictionary, w.profile);
    const id = games.createOnline({ host: w.profile, seats: b.seats, openSeats: b.openSeats, dictionary: b.dictionary });
    res.status(201).json({ id, game: games.open(id, w) });
  } catch (e) { next(e); }
});

// A lobby, from the list, a link or its QR code: who's in it so far, then taking a seat.
router.get('/lobby/:code', readLimit, wrap(req => games.lobbyPreview(req.params.code)));
router.post('/lobby/:code/join', newLimit, wrap(req => {
  const w = needProfile(req);
  adultGate(req, games.lobbyPreview(req.params.code).dictionary, w.profile);
  const id = games.join(req.params.code, w.profile);
  return { id, game: games.open(id, w) };
}));

// Everything about one game goes through this: the game must exist, and an
// unfiltered one needs an ARKS ID adult pass from whoever is asking.
function gameWho(req) {
  const w = who(req);
  adultGate(req, games.load(req.params.id).row.dictionary, w.profile);
  return w;
}
router.get('/games/:id', readLimit, wrap(req => games.open(req.params.id, gameWho(req))));
router.post('/games/:id/preview', readLimit, wrap(req => games.preview(req.params.id, gameWho(req), body(req).placements)));
router.post('/games/:id/start', moveLimit, wrap(req => {
  const w = gameWho(req);
  if (!w.profile) throw fail('Pick your profile first.', 401);
  games.startNow(req.params.id, w);
  return { game: games.open(req.params.id, w) };
}));
for (const kind of ['play', 'swap', 'pass', 'resign']) {
  router.post(`/games/:id/${kind}`, moveLimit, wrap(req => {
    const b = body(req);
    const fn = kind === 'play' ? games.moves.play(b.placements) : kind === 'swap' ? games.moves.swap(b.tiles) : games.moves[kind]();
    const { result, view } = games.act(req.params.id, gameWho(req), fn);
    return { result: result || {}, game: view };
  }));
}
router.post('/games/:id/hide', moveLimit, wrap(req => games.hide(req.params.id, gameWho(req))));

router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message, ...(err.adult ? { adult: true } : {}) });
});

// Only for the test suite: the hourly cleanup, run as if it were some other time.
if (process.env.NODE_ENV === 'test') {
  router.post('/test/sweep', wrap(req => { games.sweep(Number(body(req).now) || Date.now()); return { ok: true }; }));
}

module.exports = router;
