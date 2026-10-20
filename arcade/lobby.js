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
  rambler: { label: 'Rambler', emoji: '🥾', page: 'rambler.html' },
  shortfuse: { label: 'Short Fuse', emoji: '💣', page: 'shortfuse.html' },
  chess: { label: 'Chess', emoji: '♞', page: 'chess.html' },
  trivia: { label: 'Know-It-All', emoji: '🧠', page: 'trivia.html' }
};

// Each game keeps its rooms in its own module; this reads them without
// changing anything. status: open (can join), playing (wait for the next
// one), full.
function collect() {
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

  const sf = require('../shortfuse/tables');
  const cards = require('../shortfuse/cards');
  for (const t of sf._tables.values()) {
    if (t.mode !== 'room') continue;
    const host = t.players.get(t.hostId);
    const running = t.game && t.game.phase !== 'over';
    add('shortfuse', {
      adult: cards.LEVELS[t.level].adult, locked: !!t.password,
      code: t.id, host: host ? host.name : '', players: t.players.size, max: sf.MAX_PLAYERS,
      status: t.players.size >= sf.MAX_PLAYERS ? 'full' : running ? 'playing' : 'open',
      detail: `${cards.LEVELS[t.level].label} deck`
    });
  }

  const chess = require('../chess/rooms');
  for (const r of chess._rooms.values()) {
    add('chess', {
      code: r.code, host: r.players[0] ? r.players[0].name : '', players: r.players.length, max: 2,
      status: r.players.length >= 2 ? 'full' : 'open', detail: 'Two phones'
    });
  }

  const trivia = require('../trivia/rooms');
  const bank = require('../trivia/bank');
  for (const r of trivia._rooms.values()) {
    const host = r.players.find(p => p.id === r.hostId);
    add('trivia', {
      adult: bank.LEVELS[r.settings.level].adult, locked: !!r.password,
      code: r.code, host: host ? host.name : '', players: r.players.length, max: 12,
      status: r.players.length >= 12 ? 'full' : r.phase === 'lobby' ? 'open' : 'playing',
      detail: `${r.settings.count} questions${bank.LEVELS[r.settings.level].adult ? ' · ' + bank.LEVELS[r.settings.level].label : ''}`
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

router.get('/lobby', (req, res) => res.json({ rooms: collect(), publicUrl: publicUrl() }));

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
