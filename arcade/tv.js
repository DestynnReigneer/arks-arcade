'use strict';

// The arcade on a TV (ARKS ID contract v14). Only with ARKS ID on.
//
// Setting up a TV: the TV's page asks this server to start, this server asks
// ARKS ID for a pairing code, keeps the pollToken to itself (the page only
// ever sees the code and the address for its QR code), and asks ARKS ID
// whether anyone has answered as often as ARKS ID allows. Once an adult has
// approved it on their own phone, the code is traded at /api/token like any
// sign-in, and the TV gets the arcade's usual sign-in cookie as its own
// account (a TV account, with the kid role).
//
// Adults' night: the TV asks for an unlock code, an adult approves it on
// their phone, and while ARKS ID says the TV's session has adultMode set the
// TV counts as an adult for adult levels (arcade/arksid.js). Back to family
// ends it at once. The TV reports games being played, at most once a minute,
// so adults' night doesn't run out mid-game.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');

const PAIR_COOKIE = 'arcade_tvpair';
const PAIR_MAX = 200;                 // pairings waiting at once, across every TV
const ACTIVITY_MS = 55 * 1000;        // at most about once a minute
const WAITING_CHECK_MS = 1500;        // while an unlock code is showing
const CHECK_MS = 20 * 1000;           // otherwise

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// A QR code as a picture the page can show straight away.
async function qrFor(text) {
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#12111c', light: '#ffffff' } });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Only ARKS ID's own addresses go in a QR code.
function sameSite(url, base) {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

function createTv({ arks, now = Date.now }) {
  const client = arks.client;
  const pairings = new Map();   // pairing id -> { pollToken, interval, nextAt, expiresAt }
  const lastActivity = new Map();   // session id -> when it was last reported

  function sweep() {
    for (const [id, p] of pairings) if (p.expiresAt < now()) pairings.delete(id);
    for (const [id, at] of lastActivity) if (now() - at > 10 * 60 * 1000) lastActivity.delete(id);
  }

  const pairLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many new codes from this TV. Wait a few minutes.' } });

  // The TV signed in on this device, or null (a person, or nobody).
  async function tvOf(req, opts) {
    const me = await arks.current(req, opts);
    return me && me.tv ? me : null;
  }

  function routes() {
    const router = express.Router();
    router.use('/api/tv', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    // Start setting up this TV: a code to show, and the QR code of its address.
    router.post('/api/tv/pair', pairLimiter, async (req, res) => {
      sweep();
      if (pairings.size >= PAIR_MAX) return res.status(503).json({ error: 'Too many TVs are being set up right now. Try again in a minute.' });
      let started;
      try { started = await client.tvPair(); } catch { return res.status(502).json({ error: 'ARKS ID didn\'t answer. Check that it\'s running, then try again.' }); }
      const userCode = String(started.userCode || '');
      if (!/^[A-Z]{6}$/.test(userCode) || typeof started.pollToken !== 'string' || !sameSite(started.pairUrl, client.url)) {
        return res.status(502).json({ error: 'ARKS ID gave an answer the arcade doesn\'t understand.' });
      }
      const id = crypto.randomBytes(24).toString('base64url');
      const interval = Math.max(2, Number(started.interval) || 5) * 1000;
      const expiresIn = Math.max(30, Math.min(1800, Number(started.expiresIn) || 600)) * 1000;
      pairings.set(id, { pollToken: started.pollToken, interval, nextAt: now() + interval, expiresAt: now() + expiresIn });
      res.cookie(PAIR_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/api/tv', maxAge: expiresIn });
      res.json({
        userCode, pairUrl: started.pairUrl,
        enterUrl: sameSite(started.enterUrl, client.url) ? started.enterUrl : `${client.url}/tv`,
        expiresIn: expiresIn / 1000, interval: interval / 1000, qr: await qrFor(started.pairUrl)
      });
    });

    // Has anyone answered yet? The page asks every couple of seconds; this
    // server only asks ARKS ID as often as ARKS ID said it may.
    router.get('/api/tv/pair', async (req, res) => {
      const id = readCookie(req, PAIR_COOKIE);
      const p = id && pairings.get(id);
      if (!p || p.expiresAt < now()) {
        if (id) pairings.delete(id);
        return res.json({ status: 'expired' });
      }
      if (now() < p.nextAt) return res.json({ status: 'pending', interval: p.interval / 1000 });
      p.nextAt = now() + p.interval;
      let answer;
      try { answer = await client.tvPoll(p.pollToken); } catch { return res.json({ status: 'pending', interval: p.interval / 1000, trouble: true }); }
      if (answer.status === 'slow_down') {
        p.interval = Math.max(p.interval + 5000, (Number(answer.interval) || 0) * 1000);
        p.nextAt = now() + p.interval;
        return res.json({ status: 'pending', interval: p.interval / 1000 });
      }
      if (answer.status === 'pending') return res.json({ status: 'pending', interval: p.interval / 1000 });
      pairings.delete(id);
      res.clearCookie(PAIR_COOKIE, { path: '/api/tv' });
      if (answer.status !== 'approved' || typeof answer.code !== 'string') return res.json({ status: 'expired' });
      // Approved: trade the code exactly as a sign-in's callback does.
      let traded = null;
      try { traded = await client.token(answer.code); } catch { /* unreachable */ }
      const started = traded && traded.user && traded.user.kind === 'tv' ? arks.start(traded) : null;
      if (!started) return res.json({ status: 'expired' });
      const [name, opts] = arks.signinCookie(req);
      res.cookie(name, started.token, opts);
      res.json({ status: 'approved', tv: { name: String(traded.user.name || '').slice(0, 20) } });
    });

    // This TV, and whether adults' night is on. waiting=1 while an unlock
    // code is showing, so the TV switches within a second or two.
    router.get('/api/tv/state', async (req, res) => {
      const me = await arks.current(req, { within: req.query.waiting === '1' ? WAITING_CHECK_MS : CHECK_MS });
      res.json({
        on: true, signedIn: !!me, tv: me && me.tv ? { name: me.profile.name } : null,
        adultMode: me && me.tv ? me.adultMode : null
      });
    });

    // Adults' night: a code and QR code for an adult's phone.
    router.post('/api/tv/unlock', async (req, res) => {
      const me = await tvOf(req);
      if (!me) return res.status(403).json({ error: 'Only a TV that\'s set up can have an adults\' night.' });
      let r;
      try { r = await client.tvCall('/api/tv/unlock', me.sessionId); } catch { return res.status(502).json({ error: 'ARKS ID didn\'t answer. Try again in a moment.' }); }
      const d = r.data || {};
      if (r.status !== 200 || !/^[A-Z]{6}$/.test(String(d.userCode || '')) || !sameSite(d.unlockUrl, client.url)) {
        return res.status(502).json({ error: 'ARKS ID couldn\'t make an unlock code just now. Try again in a moment.' });
      }
      const adultMode = arks.noteAdultMode(me.account.user_id, d.adultMode);
      res.json({
        userCode: d.userCode, unlockUrl: d.unlockUrl,
        enterUrl: sameSite(d.enterUrl, client.url) ? d.enterUrl : `${client.url}/tv`,
        expiresIn: Number(d.expiresIn) || 600, adultMode, qr: await qrFor(d.unlockUrl)
      });
    });

    // Back to family: at once here, and ARKS ID is told.
    router.post('/api/tv/lock', async (req, res) => {
      const me = await tvOf(req);
      if (!me) return res.json({ ok: true, adultMode: null });
      arks.noteAdultMode(me.account.user_id, null);
      try { await client.tvCall('/api/app/tv/lock', me.sessionId); } catch { /* it's family here either way */ }
      res.json({ ok: true, adultMode: null });
    });

    // A game is being played on the TV (a question, a move): passed on to
    // ARKS ID at most about once a minute, so adults' night keeps going.
    router.post('/api/tv/activity', async (req, res) => {
      const me = await tvOf(req);
      if (!me) return res.json({ ok: true, adultMode: null });
      const last = lastActivity.get(me.sessionId) || 0;
      if (now() - last < ACTIVITY_MS) return res.json({ ok: true, adultMode: me.adultMode, sent: false });
      lastActivity.set(me.sessionId, now());
      let adultMode = me.adultMode;
      try {
        const r = await client.tvCall('/api/app/tv/activity', me.sessionId);
        if (r.status === 200) adultMode = arks.noteAdultMode(me.account.user_id, (r.data || {}).adultMode);
      } catch { /* try again next time */ }
      res.json({ ok: true, adultMode, sent: true });
    });
    return router;
  }

  return { routes, _pairings: pairings };
}

// Without ARKS ID, a TV just shows the arcade: nothing to set up.
function offRoutes() {
  const router = express.Router();
  router.get('/api/tv/state', (req, res) => res.set('Cache-Control', 'no-store').json({ on: false, signedIn: false, tv: null, adultMode: null }));
  router.all(/^\/api\/tv\//, (req, res) => res.status(404).json({ error: 'TVs sign in through ARKS ID, and this arcade doesn\'t use it.' }));
  return router;
}

module.exports = { createTv, offRoutes, qrFor };
