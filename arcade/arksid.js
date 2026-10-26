'use strict';

// Optional: signing in through ARKS ID, a family sign-in service the arcade
// can share with other apps. Off unless ARKS_ID_URL and ARKS_ID_SECRET are set
// in .env; without them the arcade keeps its own profiles, PINs and adult PIN
// exactly as before (see docs/SETUP.md).
//
// With it on, ARKS ID owns everything about a person:
//   - People sign in on ARKS ID (the arcade never sees a PIN), which sends
//     them back with a one-time code that the arcade's server trades for who
//     they are. Each account is linked to an arcade profile (by name the first
//     time, and the admin can move a link), and the device gets that profile's
//     token, so every game credits scores exactly as before.
//   - Name, role and "name or initials on the boards" come from the account.
//     The arcade's own profile requests and profile PINs switch off.
//   - Adult levels follow the role: a signed-in adult or admin gets a short-
//     lived adult pass that works wherever the adult PIN used to. Kids, teens
//     and guests can't unlock them.
//   - Guest play is only offered on a device ARKS ID doesn't know, or one an
//     admin owns, so nobody can dodge the adult rules by playing as a guest.
//   - Clips the admin sends go through ARKS ID's clip inbox, so they pop up in
//     whichever app the person opens next.

const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const adultPin = require('./adult-pin');
const Avatars = require('../public/avatars');

const COOKIE = 'arcade_me';
const STATE_COOKIE = 'arcade_state';
const DEVICE_COOKIE = 'arcade_dev';
const COOKIE_MS = 15 * 24 * 60 * 60 * 1000;   // the longest a sign-in lasts; ARKS ID decides sooner
const CHECK_MS = 3 * 60 * 1000;               // re-check with ARKS ID this often
const DEVICE_MS = 24 * 60 * 60 * 1000;        // how long "whose device is this?" is remembered
const PASS_MS = 12 * 60 * 60 * 1000;          // how long an adult pass works
const TIMEOUT_MS = 5000;
const ROLES = ['admin', 'adult', 'teen', 'kid'];
const GROWN_UP = ['admin', 'adult'];

// ---- Settings ----
// ARKS_ID_URL is where people's browsers go to sign in. ARKS_ID_API_URL is
// where the arcade's server reaches it (it can be a home-network address);
// it falls back to ARKS_ID_URL. ARKS_ID_SECRET is the arcade's app secret
// from ARKS ID's settings.
function settings(env = process.env) {
  const url = String(env.ARKS_ID_URL || '').trim().replace(/\/+$/, '');
  const api = String(env.ARKS_ID_API_URL || '').trim().replace(/\/+$/, '') || url;
  const secret = String(env.ARKS_ID_SECRET || '').trim();
  return { url, api, secret, on: !!(url || secret || env.ARKS_ID_API_URL) };
}

// -> a sentence saying what's wrong, or null.
function problem(env = process.env) {
  const s = settings(env);
  if (!s.on) return null;
  if (!s.url || !s.secret) return 'ARKS_ID_URL and ARKS_ID_SECRET go together. Set both to sign in through ARKS ID, or leave both blank.';
  for (const [name, value] of [['ARKS_ID_URL', s.url], ['ARKS_ID_API_URL', s.api]]) {
    let u;
    try { u = new URL(value); } catch { return `${name} has to be an address like https://id.example.com, not "${value}".`; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return `${name} has to start with https:// or http://.`;
  }
  if (s.secret.length < 32) return 'ARKS_ID_SECRET has to be the arcade\'s secret from ARKS ID, 32 or more characters.';
  return null;
}

// ---- Talking to ARKS ID (server to server, never the browser) ----
function createClient(s = settings(), fetchImpl = fetch) {
  if (!s.on || problem({ ARKS_ID_URL: s.url, ARKS_ID_API_URL: s.api, ARKS_ID_SECRET: s.secret })) return null;
  const auth = { Authorization: `Bearer ${s.secret}` };
  const call = (path, init = {}) => fetchImpl(s.api + path, { ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    url: s.url,
    async token(code) {
      const res = await post('/api/token', { code });
      if (res.status === 400) return null;
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      return res.json();
    },
    async session(id, touch) {
      const res = await call(`/api/session/${encodeURIComponent(id)}${touch ? '?touch=1' : ''}`);
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      return res.json();
    },
    // A guest's name and avatar, for the Create an account form (v7) -> a token.
    async prefill(name, art) {
      const res = await post('/api/prefill', { name, art });
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      const body = await res.json();
      return typeof body.prefill === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(body.prefill) ? body.prefill : null;
    },
    async device(code) {
      const res = await post('/api/device', { code });
      if (res.status === 400) return null;
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      return res.json();
    },
    async sendClip(to, clip) {
      const res = await post('/api/clips', { to, clip });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { sent: Number(body.sent) || 0 };
      if (res.status === 400 || res.status === 429) return { error: String(body.error || 'ARKS ID didn\'t take that clip.') };
      throw new Error(`ARKS ID answered ${res.status}`);
    },
    async nextClip(sessionId) {
      const res = await call(`/api/clips/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      const body = await res.json();
      return typeof body.clip === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.clip) ? body.clip : null;
    }
  };
}

// Only what the arcade uses from ARKS ID's user, checked and cut to size.
function cleanUser(u) {
  if (!u || typeof u.id !== 'string' || !/^u_[A-Za-z0-9]{1,40}$/.test(u.id)) return null;
  const name = String(u.name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!name || !ROLES.includes(u.role)) return null;
  const board = String(u.boardName || '').trim();
  return {
    id: u.id, name, role: u.role, initials: /^[A-Z]{1,3}$/.test(board) && board !== name.toUpperCase() ? board : null,
    // The avatar comes from the account too (contract v7): the character they
    // picked there, or their icon in their color. null: leave the profile's own.
    avatar: u.avatar && typeof u.avatar === 'object' ? Avatars.fromAccount(u.avatar) : null
  };
}

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

db.db.exec(`
  CREATE TABLE IF NOT EXISTS arcade_id_accounts (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS arcade_signins (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    checked_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL
  );
`);
{
  const cols = db.db.prepare('PRAGMA table_info(arcade_profiles)').all().map(c => c.name);
  if (!cols.includes('arksid_user')) db.db.exec('ALTER TABLE arcade_profiles ADD COLUMN arksid_user TEXT');
}

function createArksId({ client, now = Date.now, profiles }) {
  // A secret for signing adult passes and the device cookie, made once.
  function secret() {
    let s = db.getSetting('arksid_secret', null);
    if (!s) { s = crypto.randomBytes(32).toString('hex'); db.setSetting('arksid_secret', s); }
    return s;
  }
  const sign = text => crypto.createHmac('sha256', secret()).update(text).digest('base64url');
  const sameSig = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // Keeps the account's latest name and role, and its arcade profile in step.
  // -> the arcade profile row.
  function remember(user) {
    const t = now();
    db.db.prepare(`INSERT INTO arcade_id_accounts (user_id, name, role, seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, role = excluded.role, seen_at = excluded.seen_at`).run(user.id, user.name, user.role, t);
    let p = db.db.prepare('SELECT * FROM arcade_profiles WHERE arksid_user = ?').get(user.id);
    if (!p) {
      // First sign-in: the approved profile with the same name that isn't
      // linked yet, so its scores come along. No match: a new profile.
      p = db.db.prepare("SELECT * FROM arcade_profiles WHERE arksid_user IS NULL AND status = 'approved' AND lower(name) = lower(?) ORDER BY created_at LIMIT 1").get(user.name);
      if (p) db.db.prepare('UPDATE arcade_profiles SET arksid_user = ? WHERE id = ?').run(user.id, p.id);
      else {
        const id = crypto.randomBytes(8).toString('hex');
        db.db.prepare("INSERT INTO arcade_profiles (id, name, avatar, status, arksid_user) VALUES (?, ?, ?, 'approved', ?)").run(id, user.name, user.avatar || profiles.DEFAULT_AVATAR, user.id);
        p = db.db.prepare('SELECT * FROM arcade_profiles WHERE id = ?').get(id);
      }
    }
    // The name, the avatar and the board choice belong to ARKS ID now. The
    // profile's own PIN and locks are off.
    db.db.prepare(`UPDATE arcade_profiles SET name = ?, avatar = ?, board_show = ?, initials = ?, pin_hash = NULL, pin_salt = NULL,
      pin_fails = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(user.name, user.avatar || p.avatar, user.initials ? 'initials' : 'name', user.initials, p.id);
    p = db.db.prepare('SELECT * FROM arcade_profiles WHERE id = ?').get(p.id);
    profiles.syncRambler(p);
    return p;
  }

  function start(traded) {
    const user = cleanUser(traded && traded.user);
    if (!user || typeof traded.sessionId !== 'string' || !/^s_[A-Za-z0-9]{1,64}$/.test(traded.sessionId)) return null;
    remember(user);
    const token = crypto.randomBytes(32).toString('base64url');
    db.db.prepare('DELETE FROM arcade_signins WHERE expires_at < ?').run(now() - DEVICE_MS);
    db.db.prepare('INSERT INTO arcade_signins (token_hash, session_id, user_id, expires_at, checked_at, used_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hash(token), traded.sessionId, user.id, Number(traded.expiresAt) || now() + CHECK_MS, now(), now());
    return { token };
  }

  // Who this device is signed in as: { account, profile, sessionId } or null.
  // Checks with ARKS ID every few minutes, so a sign-out, rename or role
  // change there reaches the arcade quickly. If ARKS ID can't be reached, a
  // sign-in keeps working until it would have ended anyway.
  async function current(req, { fresh = false } = {}) {
    const token = readCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    const row = db.db.prepare('SELECT * FROM arcade_signins WHERE token_hash = ?').get(hash(token));
    if (!row) return null;
    db.db.prepare('UPDATE arcade_signins SET used_at = ? WHERE token_hash = ?').run(now(), row.token_hash);
    // fresh: the person just changed something on their ARKS ID account page,
    // so ask now instead of waiting for the next check (at most every 5 seconds).
    const due = now() - row.checked_at > CHECK_MS || (fresh && now() - row.checked_at > 5000);
    if (client && (due || now() >= row.expires_at)) {
      let s = null;
      try { s = await client.session(row.session_id, true); } catch { /* unreachable */ }
      const user = s && s.valid ? cleanUser(s.user) : null;
      if (s && (!s.valid || !user || user.id !== row.user_id)) { end(token); return null; }
      if (user) {
        remember(user);
        row.expires_at = Number(s.expiresAt) || row.expires_at;
        db.db.prepare('UPDATE arcade_signins SET expires_at = ?, checked_at = ? WHERE token_hash = ?').run(row.expires_at, now(), row.token_hash);
      }
    }
    if (now() >= row.expires_at) { end(token); return null; }
    const account = db.db.prepare('SELECT * FROM arcade_id_accounts WHERE user_id = ?').get(row.user_id);
    const profile = db.db.prepare("SELECT * FROM arcade_profiles WHERE arksid_user = ? AND status = 'approved'").get(row.user_id);
    if (!account || !profile) { end(token); return null; }
    return { account, profile, sessionId: row.session_id };
  }
  function end(token) {
    if (token) db.db.prepare('DELETE FROM arcade_signins WHERE token_hash = ?').run(hash(token));
  }

  // ---- The adult pass ----
  // "ap.<profile id>.<expires>.<signature>". It's checked against the linked
  // account's role every time, so a role change takes effect at once.
  function passFor(profile) {
    const exp = now() + PASS_MS;
    const body = `ap.${profile.id}.${exp}`;
    return `${body}.${sign(body)}`;
  }
  function passOk(pass) {
    const m = /^(ap\.([0-9a-f]{16})\.(\d{10,16}))\.([A-Za-z0-9_-]{43})$/.exec(String(pass || ''));
    if (!m || Number(m[3]) < now() || !sameSig(m[4], sign(m[1]))) return false;
    const row = db.db.prepare(`SELECT a.role FROM arcade_profiles p JOIN arcade_id_accounts a ON a.user_id = p.arksid_user
      WHERE p.id = ? AND p.status = 'approved'`).get(m[2]);
    return !!row && GROWN_UP.includes(row.role);
  }

  // ---- Whose device is this? (for guest play) ----
  // Remembered in a signed cookie for a day: known, and the owner's role.
  function deviceCookie(result) {
    const v = `${result.known ? 1 : 0}.${result.known && ROLES.includes(result.owner && result.owner.role) ? result.owner.role : '-'}.${now() + DEVICE_MS}`;
    return `${v}.${sign('dev.' + v)}`;
  }
  function deviceFrom(req) {
    const m = /^(([01])\.([a-z-]+)\.(\d+))\.([A-Za-z0-9_-]{43})$/.exec(readCookie(req, DEVICE_COOKIE) || '');
    if (!m || Number(m[4]) < now() || !sameSig(m[5], sign('dev.' + m[1]))) return null;
    return { known: m[2] === '1', ownerRole: m[3] === '-' ? null : m[3] };
  }

  // ---- Routes ----
  const cookieOpts = (req, extra) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', ...extra });
  // A path on this site to come back to; anything else becomes the home page.
  const cleanReturn = v => {
    const s = String(v || '/');
    return /^\/(?![/\\])[A-Za-z0-9._~\-/?=&%#]{0,300}$/.test(s) ? s : '/';
  };
  function arksIdUrl(req, res, page, ret, extra = '') {
    const state = crypto.randomBytes(24).toString('base64url');
    res.cookie(STATE_COOKIE, state, cookieOpts(req, { maxAge: 10 * 60 * 1000, path: '/auth' }));
    return `${client.url}/${page}?app=arcade&return=${encodeURIComponent(cleanReturn(ret))}&state=${state}${extra}`;
  }
  function toArksId(req, res, page) {
    res.set('Cache-Control', 'no-store');
    if (!client) return res.redirect(303, '/');
    res.redirect(303, arksIdUrl(req, res, page, req.query.return));
  }

  function routes() {
    const router = express.Router();
    router.get('/auth/signin', (req, res) => toArksId(req, res, 'signin'));
    router.get('/auth/device', (req, res) => toArksId(req, res, 'device'));
    // A guest making an account: { name, avatar, return } -> { url }. The name
    // and avatar they played with are handed to ARKS ID server to server, so
    // the sign-up form starts with them and they never ride in a web address.
    // If that fails, the plain sign-in page is fine.
    router.post('/auth/signup', express.json({ limit: '2kb' }), async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!client) return res.status(404).json({ error: 'Signing in isn\'t set up on this arcade.' });
      const b = req.body || {};
      const name = String(b.name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16);
      const art = typeof b.avatar === 'string' && Avatars.valid(b.avatar) && !b.avatar.startsWith('arks:') ? b.avatar : null;
      let token = null;
      if (name || art) { try { token = await client.prefill(name, art); } catch { /* unreachable: no prefill */ } }
      res.json({ url: arksIdUrl(req, res, 'signin', b.return, token ? `&prefill=${token}` : '') });
    });

    // Back from ARKS ID with a sign-in code, or a "whose device" code.
    router.get('/auth/callback', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const state = readCookie(req, STATE_COOKIE);
      res.clearCookie(STATE_COOKIE, { path: '/auth' });
      const back = cleanReturn(req.query.return);
      const code = String(req.query.code || req.query.device || '');
      const ok = client && state && req.query.state === state && /^[A-Za-z0-9_-]{20,100}$/.test(code);
      if (req.query.device !== undefined) {
        let result = null;
        if (ok) { try { result = await client.device(code); } catch { /* unreachable */ } }
        // Not sure whose device it is: treat it as a family member's, so guest
        // play stays off rather than on by mistake.
        res.cookie(DEVICE_COOKIE, deviceCookie(result || { known: true, owner: null }), cookieOpts(req, { maxAge: DEVICE_MS }));
        return res.redirect(303, back);
      }
      if (!ok) return res.redirect(303, '/?signin=failed');
      let traded = null;
      try { traded = await client.token(code); } catch { return res.redirect(303, '/?signin=unreachable'); }
      const started = traded && start(traded);
      if (!started) return res.redirect(303, '/?signin=failed');
      res.cookie(COOKIE, started.token, cookieOpts(req, { maxAge: COOKIE_MS }));
      res.redirect(303, back);
    });

    // Signing out of the arcade signs out of ARKS ID too.
    router.post('/auth/signout', (req, res) => {
      end(readCookie(req, COOKIE));
      res.clearCookie(COOKIE, { path: '/' }).set('Cache-Control', 'no-store')
        .json({ next: client ? `${client.url}/signout?app=arcade&return=%2F` : '/' });
    });

    // Who's playing on this device, for every page (public/profile.js).
    router.get('/api/arksid/me', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!client) return res.json({ on: false });
      const me = await current(req, { fresh: req.query.fresh === '1' });
      const dev = deviceFrom(req);
      const out = {
        on: true, accountUrl: `${client.url}/`, deviceChecked: !!dev,
        // Guests only on a device no family member owns, or an admin's.
        guestAllowed: !!dev && (!dev.known || dev.ownerRole === 'admin'),
        signedIn: !!me
      };
      if (me) {
        const p = profiles.pub(me.profile);
        Object.assign(out, { profile: p, token: profiles.tokenFor(me.profile), role: me.account.role, adult: GROWN_UP.includes(me.account.role) });
      }
      res.json(out);
    });

    // The adult pass, for a signed-in grown-up. It goes where the PIN used to.
    router.post('/api/arksid/adult-pass', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const me = client ? await current(req) : null;
      if (!me) return res.status(401).json({ error: 'Sign in with ARKS ID first.' });
      if (!GROWN_UP.includes(me.account.role)) return res.status(403).json({ error: 'Adult levels are for grown-ups\' ARKS ID accounts.' });
      res.json({ pass: passFor(me.profile) });
    });
    return router;
  }

  return { routes, current, remember, start, end, passOk, passFor, deviceFrom, client };
}

module.exports = { settings, problem, createClient, createArksId, cleanUser, COOKIE, DEVICE_COOKIE, GROWN_UP };
