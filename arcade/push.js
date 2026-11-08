'use strict';

// Notifications on people's phones, sent by the sign-in service (its
// notifications API). The page asks the browser for a push subscription and
// gives it here; this server passes it on with the person's sign-in, and later
// asks the sign-in service to tell that person something ("it's your turn").
// The browser's service worker (public/sw.js) shows it and opens the game when
// it's tapped. Without the sign-in service there are no notifications, and the
// page never offers them.

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const KEY_MS = 60 * 60 * 1000;    // ask for the public key again after an hour

function createPush({ arks }) {
  let key = null, keyAt = 0;
  async function publicKey() {
    if (key && Date.now() - keyAt < KEY_MS) return key;
    const r = await arks.client.appCall('GET', '/push/key');
    if (r.status !== 200 || typeof r.data.publicKey !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(r.data.publicKey)) throw new Error('no push key');
    key = r.data.publicKey; keyAt = Date.now();
    return key;
  }

  // Tells the person behind an arcade profile something, on every phone they
  // turned notifications on. Never throws, and nobody waits for it: a game
  // move doesn't fail because a phone couldn't be reached.
  function tell(profileId, { title, body, url, tag }) {
    const p = db.db.prepare("SELECT arksid_user FROM arcade_profiles WHERE id = ? AND status = 'approved'").get(String(profileId || ''));
    if (!p || !p.arksid_user) return Promise.resolve(0);
    return arks.client.appCall('POST', '/push/send', { to: p.arksid_user, title, body, url, tag })
      .then(r => (r.status === 200 ? Number(r.data.sent) || 0 : 0), () => 0);
  }

  function routes() {
    const router = express.Router();
    router.use('/api/push', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    // Turning them on and off, from one address. The page asks for the key once per visit.
    router.use(['/api/push/subscribe', '/api/push/unsubscribe'], rateLimit({
      windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
      message: { error: 'That\'s a lot of tries in a row. Give it a few minutes and try again.' }
    }));
    const signedIn = async (req, res) => {
      let me = null;
      try { me = await arks.current(req); } catch { /* treated as signed out */ }
      if (!me || me.tv) { res.status(401).json({ error: 'Sign in on this phone first, so we know whose turns to tell you about.' }); return null; }
      return me;
    };
    const fromService = (res, r) => (r.status === 200 ? res.json({ ok: true })
      : res.status([401, 429].includes(r.status) ? r.status : 400).json({ error: r.data.error || 'Something went wrong. Give it a moment and try again.' }));

    router.get('/api/push/key', async (req, res) => {
      try { res.json({ on: true, publicKey: await publicKey() }); } catch { res.json({ on: false }); }
    });
    // { subscription } from the browser's PushManager.
    router.post('/api/push/subscribe', async (req, res) => {
      const me = await signedIn(req, res);
      if (!me) return;
      const sub = (req.body || {}).subscription;
      if (!sub || typeof sub !== 'object') return res.status(400).json({ error: 'There was no subscription to save.' });
      try { fromService(res, await arks.client.appCall('POST', '/push/subscribe', { session: me.sessionId, subscription: sub })); }
      catch { res.status(503).json({ error: 'Notifications can\'t be turned on right now. Try again in a minute or two.' }); }
    });
    router.post('/api/push/unsubscribe', async (req, res) => {
      const me = await signedIn(req, res);
      if (!me) return;
      try { fromService(res, await arks.client.appCall('POST', '/push/unsubscribe', { session: me.sessionId, endpoint: String((req.body || {}).endpoint || '') })); }
      catch { res.status(503).json({ error: 'Something went wrong. Give it a moment and try again.' }); }
    });
    return router;
  }

  return { routes, tell };
}

module.exports = { createPush };
