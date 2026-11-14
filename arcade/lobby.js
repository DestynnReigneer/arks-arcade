'use strict';

// The arcade's "join a game" board: every room being hosted right now, in
// any game, so a phone that just scanned the QR code can find the game
// everyone's in. Adult games are listed too (it's for parties), marked and
// locked: joining one needs the lobby password its host made up.
// Also: the address phones should use, and QR codes for it.

const os = require('node:os');
const express = require('express');
const QRCode = require('qrcode');

const GAMES = {
  rambler: { label: 'Rambler', emoji: '🔠', icon: 'rambler-logo.svg', page: 'rambler.html' },
  chess: { label: 'Chess', emoji: '♞', page: 'chess.html' },
  trivia: { label: 'Know-It-All', emoji: '🧠', page: 'trivia.html' },
  partdeux: { label: 'Uh-Oh: Part Deux', emoji: '🚨', page: 'partdeux.html' },
  daredevil: { label: 'Dare Devil', emoji: '😈', page: 'daredevil.html' },
  scuffle: { label: 'Shuffle Scuffle', emoji: '🔀', page: 'scuffle.html' }
};

// Each game keeps its rooms in its own module; this reads them without
// changing anything. status: open (can join), playing (wait for the next
// one), full.
// viewer: the profile asking (from its token), so a lobby only open to the people
// its host picked is listed only for them.
function collect(viewer = null) {
  const out = [];
  const add = (game, room) => out.push({ game, ...GAMES[game], href: `${GAMES[game].page}?join=${room.code}`, ...room });

  const rambler = require('../rambler/rooms');
  for (const r of rambler._rooms.values()) {
    const host = r.players.get(r.hostId);
    add('rambler', {
      adult: r.settings.profile === 'adult', locked: !!r.password,
      code: r.code, host: host ? host.name : '', players: r.players.size, max: rambler.MAX_PLAYERS,
      status: r.players.size >= rambler.MAX_PLAYERS ? 'full' : r.state === 'lobby' ? 'open' : 'playing',
      detail: `${r.settings.size === 5 ? '5x5' : '4x4'} board${r.settings.profile === 'adult' ? ' · Unfiltered' : ''}`
    });
  }

  const chess = require('../chess/rooms');
  // Only lobbies: a game in progress can be saved for weeks, and it's nobody else's.
  for (const l of chess.lobbies(viewer)) {
    add('chess', {
      code: l.code, host: l.host, players: l.count, max: l.max, status: l.status,
      detail: `Multiplayer-Multiple devices${l.who === 'selected' ? ' · People selected' : ''}`
    });
  }

  // Only rooms this person may join: open lobbies, and games everyone answers
  // together that are still going (joined from the next question).
  const trivia = require('../trivia/rooms');
  for (const l of trivia.lobbies(viewer)) {
    add('trivia', {
      adult: l.adult, locked: l.locked, code: l.code, host: l.host, players: l.count, max: l.max,
      status: l.status === 'full' ? 'full' : l.status === 'playing' ? 'live' : 'open',
      detail: l.question ? `Game started · question ${l.question.index} of ${l.question.total}` : `${l.adult ? l.level : 'Everyone on their own phone'}${l.who === 'selected' ? ' · People selected' : ''}`
    });
  }

  // The party card games share one kind of table. Only rooms this person may join
  // are listed (anyone, or the people the host picked).
  for (const [game, mod] of [['partdeux', '../partdeux/tables'], ['daredevil', '../daredevil/tables']]) {
    for (const l of require(mod).lobbies(viewer)) {
      add(game, {
        adult: l.adult, locked: l.locked, code: l.code, host: l.host, players: l.count, max: l.max, status: l.status,
        detail: `${l.level[0].toUpperCase() + l.level.slice(1)} deck${l.drinking ? ' · 🍺' : ''}${l.who === 'selected' ? ' · People selected' : ''}`
      });
    }
  }

  const scuffle = require('../scuffle/rooms');
  for (const r of scuffle._rooms.values()) {
    const host = r.players.find(p => p.id === r.hostId);
    const adult = r.settings.dictionary === 'adult';
    add('scuffle', {
      adult, locked: !!r.password,
      code: r.code, host: host ? host.name : '', players: r.players.length, max: scuffle.MAX_PLAYERS,
      // Latecomers can jump in mid-game, so a running game is still open.
      status: r.players.length >= scuffle.MAX_PLAYERS ? 'full' : 'open',
      detail: `${r.settings.rounds} rounds · ${r.settings.seconds}s each${adult ? ' · Unfiltered' : ''}`
    });
  }

  const rank = { open: 0, playing: 1, full: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status]);
}

// The address phones on the same network should use. PUBLIC_URL wins (set it
// to your arcade's real address, like http://arcade.home or a LAN IP); if
// it's blank we use this machine's LAN address, so a QR code scanned from a
// phone doesn't point at "localhost".
function publicUrl() {
  const set = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (set) return set;
  const port = process.env.PORT || 3000;
  const candidates = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) candidates.push(a.address);
    }
  }
  const lan = candidates.find(ip => /^192\.168\./.test(ip)) || candidates.find(ip => /^10\./.test(ip)) ||
    candidates.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) || candidates[0];
  return lan ? `http://${lan}:${port}` : `http://localhost:${port}`;
}

const router = express.Router();

// The home page checks this every few seconds.
const listLimiter = require('express-rate-limit')({
  windowMs: 10 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Slow down a little, then try again.' }
});
router.get('/lobby', listLimiter, (req, res) => {
  const viewer = require('./profiles').verify(req.get('X-Profile-Token')) || null;
  res.json({ rooms: collect(viewer), publicUrl: publicUrl() });
});

// A QR code as SVG. Only for links to this arcade, so it can't be used to
// make codes for anything else.
router.get('/qr', async (req, res, next) => {
  try {
    const text = String(req.query.text || '').slice(0, 300);
    const base = publicUrl();
    const ok = text.startsWith(base) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(text) ||
      (req.get('host') && text.startsWith(`${req.protocol}://${req.get('host')}`));
    if (!ok) return res.status(400).json({ error: 'QR codes are only for links to this arcade.' });
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#12111c', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (e) { next(e); }
});

module.exports = { router, collect, publicUrl };
