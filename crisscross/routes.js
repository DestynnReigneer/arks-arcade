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
  if (!w.profile) throw fail('Online games are for people with a profile, so the game knows whose turn it is. Pick your profile first, or play on one phone instead.', 401);
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
const readLimit = limiter(3000), moveLimit = limiter(600), newLimit = limiter(40);
const wrap = fn => (req, res, next) => { try { res.json(fn(req, res)); } catch (e) { next(e); } };

router.get('/config', (req, res) => res.json({
  size: E.SIZE, center: E.CENTER, rack: E.RACK, layout: E.LAYOUT, values: E.VALUES,
  counts: Object.fromEntries(Object.entries(E.TILES).map(([k, [c]]) => [k, c])), bagSize: E.BAG_SIZE,
  allTilesBonus: E.ALL_TILES_BONUS, swapMin: E.SWAP_MIN, scorelessEnd: E.SCORELESS_END, maxPlayers: E.MAX_PLAYERS,
  adultRequiresPin: adultPin.status().set, arksId: arksMode()
}));
router.post('/unlock', adultPin.tryLimiter(), (req, res) => res.json(adultPin.check(req, res)));

// People who can be invited: every approved profile but you. With ARKS ID,
// adultOk says who could join a game on the unfiltered list.
router.get('/people', readLimit, wrap(req => {
  const { profile } = needProfile(req);
  const db = require('../db');
  return db.db.prepare("SELECT id, name, avatar FROM arcade_profiles WHERE status = 'approved' AND id != ? ORDER BY name COLLATE NOCASE")
    .all(profile.id).map(p => ({ id: p.id, name: p.name, avatar: p.avatar, adultOk: arksMode() ? games.grownUp(p.id) : null }));
}));

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
    const id = games.createOnline({
      host: w.profile, invite: b.invite, openSeats: b.openSeats, dictionary: b.dictionary,
      adultOk: arksMode() ? games.grownUp : null
    });
    res.status(201).json({ id, game: games.open(id, w) });
  } catch (e) { next(e); }
});

// The share link: who's in it so far, then taking a seat.
router.get('/invite/:code', readLimit, wrap(req => games.invitePreview(req.params.code)));
router.post('/invite/:code/join', newLimit, wrap(req => {
  const w = needProfile(req);
  adultGate(req, games.invitePreview(req.params.code).dictionary, w.profile);
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

module.exports = router;
