'use strict';

// Optional files the person running the arcade can add on their own server,
// in two folders next to the compose file (see docs/CUSTOM-MEDIA.md):
//
//   brand/  avatar.svg, logo-wide.svg, logo-square.svg: shown in the header
//           and footer instead of the plain title. favicon.svg: the browser
//           tab's icon.
//   media/  sprites/  pictures for the clickable characters on the home page
//           coin/     sounds for the third INSERT COIN click
//           clips/    GIFs, videos and sounds: secret commands, surprises,
//                     and clips the admin sends to someone's screen
//
// Nothing here ships with the arcade. Without the folders, the arcade uses its
// own pixel characters, the browser's announcer voice and the plain title.

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const profiles = require('./profiles');

const BRAND_DIR = process.env.BRAND_DIR || path.join(__dirname, '..', 'brand');
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media');
const MB = 1024 * 1024;

const IMAGE = ['png', 'gif', 'webp', 'svg', 'jpg', 'jpeg'];
const AUDIO = ['mp3', 'ogg', 'wav', 'm4a'];
const VIDEO = ['mp4', 'webm'];
const KINDS = {
  sprites: { ext: IMAGE, max: 2 * MB },
  coin: { ext: AUDIO, max: 2 * MB },
  clips: { ext: [...IMAGE, ...AUDIO, ...VIDEO], max: 50 * MB }
};
const BRAND_FILES = { avatar: 'avatar.svg', wide: 'logo-wide.svg', square: 'logo-square.svg', favicon: 'favicon.svg' };
// Plain names only, so a file name can't reach outside its folder or into HTML.
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9]+$/i;

const extOf = name => name.split('.').pop().toLowerCase();
const stemOf = name => name.slice(0, name.lastIndexOf('.')).toLowerCase();
const typeOf = name => (VIDEO.includes(extOf(name)) ? 'video' : AUDIO.includes(extOf(name)) ? 'audio' : 'image');

function listKind(kind) {
  const { ext, max } = KINDS[kind];
  const dir = path.join(MEDIA_DIR, kind);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(n => SAFE_NAME.test(n) && ext.includes(extOf(n))).filter(n => {
    try { const st = fs.statSync(path.join(dir, n)); return st.isFile() && st.size <= max; } catch { return false; }
  }).sort().map(n => ({ name: stemOf(n), url: `/custom/media/${kind}/${n}`, type: typeOf(n) }));
}

function brand() {
  const out = {};
  for (const [key, file] of Object.entries(BRAND_FILES)) {
    out[key] = fs.existsSync(path.join(BRAND_DIR, file)) ? `/custom/brand/${file}` : null;
  }
  return out;
}

// Reading the folders on every page load is cheap but pointless; a short cache
// still picks up new files within a minute.
let cache = null;
let cachedAt = 0;
function catalog(now = Date.now()) {
  if (!cache || now - cachedAt > 30 * 1000) {
    const n = parseInt(process.env.CLIP_SURPRISE, 10);
    cache = {
      brand: brand(),
      sprites: listKind('sprites'),
      coin: listKind('coin'),
      clips: listKind('clips'),
      // One page load in N plays a random clip by surprise. 0 turns it off.
      surprise: Number.isFinite(n) && n >= 0 ? n : 200
    };
    cachedAt = now;
  }
  return cache;
}

// Clips the admin has sent, waiting for each profile's next open screen.
// Kept in memory: a restart clears anything not yet seen.
const inbox = new Map();
const MAX_WAITING = 5;

function send(clipName, profileIds) {
  const clip = catalog(0).clips.find(c => c.name === String(clipName || '').toLowerCase());
  if (!clip) throw Object.assign(new Error('There is no clip with that name.'), { status: 400 });
  for (const id of profileIds) {
    const list = inbox.get(id) || [];
    inbox.set(id, [...list, clip.name].slice(-MAX_WAITING));
  }
  return { sent: profileIds.length };
}

// arks: arcade/arksid.js when signing in through ARKS ID is on. Then a sent
// clip goes through ARKS ID's clip inbox, so it pops up in whichever ARKS app
// the person opens next, and the inbox is read from there.
function routes({ requireAdmin, arks = null }) {
  const router = express.Router();
  router.get('/', (req, res) => res.json(catalog()));
  if (arks) {
    router.post('/inbox', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
      const me = await arks.current(req);
      let name = null;
      if (me) { try { name = await arks.client.nextClip(me.sessionId); } catch { /* try again next time */ } }
      // A clip this arcade has no file for is skipped.
      res.json({ clip: name ? catalog().clips.find(c => c.name === name) || null : null });
    });
    router.post('/admin/send', requireAdmin, async (req, res, next) => {
      try {
        const b = req.body || {};
        const clip = catalog(0).clips.find(c => c.name === String(b.clip || '').toLowerCase());
        if (!clip) throw Object.assign(new Error('There is no clip with that name.'), { status: 400 });
        let to = 'everyone';
        if (b.to !== 'everyone') {
          const row = require('../db').db.prepare('SELECT arksid_user FROM arcade_profiles WHERE id = ?').get(String(b.to || ''));
          if (!row || !row.arksid_user) throw Object.assign(new Error('Pick someone who signs in with ARKS ID.'), { status: 400 });
          to = row.arksid_user;
        }
        let r;
        try { r = await arks.client.sendClip(to, clip.name); } catch { throw Object.assign(new Error("ARKS ID didn't answer, so the clip wasn't sent. Try again in a moment."), { status: 502 }); }
        if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
        res.json({ sent: r.sent });
      } catch (e) { next(e); }
    });
  }
  // POST so the profile token stays out of URLs and logs.
  router.post('/inbox', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }), (req, res) => {
    const me = profiles.verify((req.body || {}).token);
    if (!me) return res.json({ clip: null });
    const list = inbox.get(me.id) || [];
    const name = list.shift();
    if (list.length) inbox.set(me.id, list); else inbox.delete(me.id);
    res.json({ clip: name ? catalog().clips.find(c => c.name === name) || null : null });
  });
  router.post('/admin/send', requireAdmin, (req, res, next) => {
    try {
      const b = req.body || {};
      const all = profiles.approvedIds();
      const ids = b.to === 'everyone' ? all : all.filter(id => id === b.to);
      if (!ids.length) throw Object.assign(new Error('Pick someone to send it to.'), { status: 400 });
      res.json(send(b.clip, ids));
    } catch (e) { next(e); }
  });
  return router;
}

// The files themselves. Only the three brand names and the three media
// folders are served, never a directory listing.
function staticFiles() {
  const router = express.Router();
  const opts = { dotfiles: 'ignore', index: false, fallthrough: true, maxAge: '1h' };
  // Opened on their own, these files may never run scripts (an SVG could try).
  router.use((req, res, next) => { res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"); next(); });
  router.use('/brand', (req, res, next) => (Object.values(BRAND_FILES).includes(req.path.slice(1)) ? next() : res.status(404).end()),
    express.static(BRAND_DIR, opts));
  // Only plain names with the folder's own kind of file ending: a .txt or
  // anything else dropped in the folder is never served.
  for (const kind of Object.keys(KINDS)) {
    router.use(`/media/${kind}`, (req, res, next) => {
      const name = req.path.slice(1);
      return SAFE_NAME.test(name) && KINDS[kind].ext.includes(extOf(name)) ? next() : res.status(404).end();
    }, express.static(path.join(MEDIA_DIR, kind), opts));
  }
  router.use((req, res) => res.status(404).end());
  return router;
}

module.exports = { routes, staticFiles, catalog, send, KINDS, BRAND_FILES };
