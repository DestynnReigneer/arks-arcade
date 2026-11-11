'use strict';

// Optional: signing in through ARKS ID, a family sign-in service the arcade
// can share with other apps. Off unless ARKS_ID_URL and ARKS_ID_SECRET are set
// in .env; without them the arcade keeps its own profiles and PINs, and adult levels are off
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
//     lived adult pass, the only thing that unlocks adult levels. Kids, teens
//     and guests can't unlock them.
//   - Guest play is only offered on a device ARKS ID doesn't know, or one an
//     admin owns, so nobody can dodge the adult rules by playing as a guest.
//   - Clips the admin sends go through ARKS ID's clip inbox, so they pop up in
//     whichever app the person opens next.
//   - Feedback goes to ARKS ID's one inbox instead of the Comm Center's, and
//     "My feedback" comes from there (see comm.js).
//   - A TV signs in with a pairing code an adult approves on their phone
//     (contract v14, arcade/tv.js). Its account has the kid role, and it counts
//     as an adult only while its adults' night is on.
//   - A photo or team picture someone picked on ARKS ID shows here too. The
//     arcade's server fetches it from ARKS ID and serves it from the arcade
//     itself (/api/arksid/photo/<profile>), so the browser only ever talks to
//     the arcade. See "Photos" below.

const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const adultPin = require('./adult-pin');
const Avatars = require('../public/avatars');
const { photoPath, looksLike, photoAvatar, isPhotoAvatar } = require('./arksid-photo');

const COOKIE = 'arcade_me';
const STATE_COOKIE = 'arcade_state';
const DEVICE_COOKIE = 'arcade_dev';
const COOKIE_MS = 15 * 24 * 60 * 60 * 1000;   // the longest a sign-in lasts; ARKS ID decides sooner
const CHECK_MS = 3 * 60 * 1000;               // re-check with ARKS ID this often
const DEVICE_MS = 24 * 60 * 60 * 1000;        // how long "whose device is this?" is remembered
const PASS_MS = 12 * 60 * 60 * 1000;          // how long an adult pass works
const TIMEOUT_MS = 5000;
const PHOTO_MAX = 2 * 1024 * 1024;              // ARKS ID's photos are 256 px, team pictures 512 px
const PHOTO_KEEP_MS = 10 * 60 * 1000;           // a fetched photo is kept in memory this long
const PHOTO_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
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
    },
    // ARKS ID's one feedback inbox (its contract v10): everything under
    // /api/app/feedback, for the shared kit's feedback-relay.js.
    // -> { status, data }. Throws when ARKS ID can't be reached.
    async appFeedback(method, path, body) {
      const init = body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
      const res = await call('/api/app/feedback' + path, init);
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    // Status reports for ARKS ID's admin console (its contract v12): path is
    // '/status' or '/event', for the shared kit's status-report.js.
    // -> { status, data }. Throws when ARKS ID can't be reached.
    async appReport(path, body) {
      const res = await post('/api/app' + path, body);
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    // Switches and the banner from ARKS ID's admin console (its contract
    // v13): everything under /api/app that the shared kit's switches.js asks
    // for. -> { status, data }. Throws when ARKS ID can't be reached.
    async appCall(method, path, body) {
      const init = body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
      const res = await call('/api/app' + path, init);
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    // TVs (its contract v14): the pairing code sign-in and adults' night.
    // The pollToken only ever lives on this server.
    async tvPair() {
      const res = await post('/api/tv/pair', {});
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      return res.json();
    },
    async tvPoll(pollToken) {
      const res = await post('/api/tv/pair/poll', { pollToken });
      if (!res.ok) throw new Error(`ARKS ID answered ${res.status}`);
      return res.json();
    },
    // /api/tv/unlock, /api/app/tv/activity and /api/app/tv/lock, all with the
    // TV's session -> { status, data }. Throws when ARKS ID can't be reached.
    async tvCall(path, session) {
      const res = await post(path, { session });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    // A photo or team picture, fetched by the arcade's server. Only ARKS ID's
    // own /avatars/ addresses, and only real pictures -> { type, body } or null.
    async photo(image) {
      const p = photoPath(image, s.url);
      if (!p) return null;
      const res = await call(p);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !PHOTO_TYPES.includes(type)) return null;
      const body = Buffer.from(await res.arrayBuffer());
      return body.length && body.length <= PHOTO_MAX && looksLike(type, body) ? { type, body } : null;
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
    id: u.id, name, role: u.role, kind: u.kind === 'tv' ? 'tv' : 'person', initials: /^[A-Z]{1,3}$/.test(board) && board !== name.toUpperCase() ? board : null,
    // The avatar comes from the account too (contract v7): the character they
    // picked there, or their icon in their color. null: leave the profile's own.
    avatar: u.avatar && typeof u.avatar === 'object' ? Avatars.fromAccount(u.avatar) : null,
    // A photo or team picture, if they picked one. It's checked again
    // (photoPath) before the arcade ever fetches it.
    image: u.avatar && typeof u.avatar.image === 'string' && u.avatar.image.length < 300 ? u.avatar.image : null
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
  const acols = db.db.prepare('PRAGMA table_info(arcade_id_accounts)').all().map(c => c.name);
  if (!acols.includes('image')) db.db.exec('ALTER TABLE arcade_id_accounts ADD COLUMN image TEXT');
  // 'tv' for a TV's own account (contract v14), 'person' for everyone else.
  if (!acols.includes('kind')) db.db.exec("ALTER TABLE arcade_id_accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'person'");
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
    // A picture the arcade would never fetch (another site, an odd path) counts as none.
    const image = user.avatar && user.image && client && photoPath(user.image, client.url) ? user.image : null;
    db.db.prepare(`INSERT INTO arcade_id_accounts (user_id, name, role, seen_at, image, kind) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, role = excluded.role, seen_at = excluded.seen_at, image = excluded.image, kind = excluded.kind`)
      .run(user.id, user.name, user.role, t, image, user.kind || 'person');
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
    // profile's own PIN and locks are off. A photo or team picture wins over
    // the icon, which stays inside the avatar as what to show if it can't load.
    const avatar = image ? photoAvatar(p.id, image, user.avatar) : user.avatar || p.avatar;
    db.db.prepare(`UPDATE arcade_profiles SET name = ?, avatar = ?, board_show = ?, initials = ?, pin_hash = NULL, pin_salt = NULL,
      pin_fails = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(user.name, avatar, user.initials ? 'initials' : 'name', user.initials, p.id);
    p = db.db.prepare('SELECT * FROM arcade_profiles WHERE id = ?').get(p.id);
    profiles.syncRambler(p);
    return p;
  }

  // ---- Adults' night on a TV (contract v14) ----
  // A TV's account always has the kid role. While ARKS ID says its session
  // has adultMode set, the TV counts as an adult for adult levels. It's
  // kept in memory only, from the latest session check, so restarting the
  // arcade or losing touch with ARKS ID means family mode, the safe direction.
  const tvAdult = new Map();   // TV account id -> { until, since, by }
  function cleanAdultMode(m) {
    if (!m || typeof m !== 'object' || !(Number(m.until) > now())) return null;
    const by = m.by && typeof m.by === 'object' ? String(m.by.name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 20) : '';
    return { until: Number(m.until), since: Number(m.since) || now(), by: by ? { name: by } : null };
  }
  function noteAdultMode(userId, m) {
    const clean = cleanAdultMode(m);
    if (clean) tvAdult.set(userId, clean); else tvAdult.delete(userId);
    return clean;
  }
  function adultModeOf(userId) {
    const m = tvAdult.get(userId);
    if (m && m.until > now()) return m;
    tvAdult.delete(userId);
    return null;
  }

  function start(traded) {
    const user = cleanUser(traded && traded.user);
    if (!user || typeof traded.sessionId !== 'string' || !/^s_[A-Za-z0-9]{1,64}$/.test(traded.sessionId)) return null;
    remember(user);
    // A TV starts in family mode unless ARKS ID says otherwise.
    if (user.kind === 'tv') noteAdultMode(user.id, traded.adultMode);
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
  // within: how old the last check may be, in milliseconds (a TV showing an
  // unlock code asks every couple of seconds).
  async function current(req, { fresh = false, within = CHECK_MS } = {}) {
    const token = readCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    const row = db.db.prepare('SELECT * FROM arcade_signins WHERE token_hash = ?').get(hash(token));
    if (!row) return null;
    db.db.prepare('UPDATE arcade_signins SET used_at = ? WHERE token_hash = ?').run(now(), row.token_hash);
    // fresh: the person just changed something on their ARKS ID account page,
    // so ask now instead of waiting for the next check (at most every 5 seconds).
    const due = now() - row.checked_at > Math.min(within, CHECK_MS) || (fresh && now() - row.checked_at > 5000);
    if (client && (due || now() >= row.expires_at)) {
      let s = null;
      try { s = await client.session(row.session_id, true); } catch { /* unreachable */ }
      const user = s && s.valid ? cleanUser(s.user) : null;
      if (s && (!s.valid || !user || user.id !== row.user_id)) { tvAdult.delete(row.user_id); end(token); return null; }
      // Losing touch with ARKS ID puts a TV back in family mode.
      if (!s) tvAdult.delete(row.user_id);
      if (user) {
        remember(user);
        if (user.kind === 'tv') noteAdultMode(user.id, s.adultMode);
        row.expires_at = Number(s.expiresAt) || row.expires_at;
        db.db.prepare('UPDATE arcade_signins SET expires_at = ?, checked_at = ? WHERE token_hash = ?').run(row.expires_at, now(), row.token_hash);
      }
    }
    if (now() >= row.expires_at) { end(token); return null; }
    const account = db.db.prepare('SELECT * FROM arcade_id_accounts WHERE user_id = ?').get(row.user_id);
    const profile = db.db.prepare("SELECT * FROM arcade_profiles WHERE arksid_user = ? AND status = 'approved'").get(row.user_id);
    if (!account || !profile) { end(token); return null; }
    const tv = account.kind === 'tv';
    return { account, profile, sessionId: row.session_id, tv, adultMode: tv ? adultModeOf(account.user_id) : null };
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
    const row = db.db.prepare(`SELECT a.role, a.kind, a.user_id FROM arcade_profiles p JOIN arcade_id_accounts a ON a.user_id = p.arksid_user
      WHERE p.id = ? AND p.status = 'approved'`).get(m[2]);
    if (!row) return false;
    // A TV's pass works only while its adults' night is on.
    if (row.kind === 'tv') return !!adultModeOf(row.user_id);
    return GROWN_UP.includes(row.role);
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
  // The sign-in cookie's name and options, for the TV's pairing (arcade/tv.js).
  const signinCookie = req => [COOKIE, cookieOpts(req, { maxAge: COOKIE_MS })];
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
  // silent=1 (contract v8): someone already signed in to ARKS ID comes back
  // signed in here with no tap; anyone else comes straight back, no page.
  function toArksId(req, res, page) {
    res.set('Cache-Control', 'no-store');
    if (!client) return res.redirect(303, '/');
    res.redirect(303, arksIdUrl(req, res, page, req.query.return, page === 'signin' && req.query.silent === '1' ? '&silent=1' : ''));
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
      // A silent try for someone who isn't signed in to ARKS ID: back where they were.
      if (client && state && req.query.state === state && req.query.error === 'signin_needed') return res.redirect(303, back);
      if (!ok) return res.redirect(303, '/?signin=failed');
      let traded = null;
      try { traded = await client.token(code); } catch { return res.redirect(303, '/?signin=unreachable'); }
      const started = traded && start(traded);
      if (!started) return res.redirect(303, '/?signin=failed');
      res.cookie(COOKIE, started.token, cookieOpts(req, { maxAge: COOKIE_MS }));
      res.redirect(303, back);
    });

    // Signing out of the arcade signs out of ARKS ID too, and this phone stops
    // getting that person's notifications (arcade/push.js), first, while the
    // sign-in still counts.
    router.post('/auth/signout', async (req, res) => {
      const token = readCookie(req, COOKIE);
      const row = token && token.length <= 100 ? db.db.prepare('SELECT session_id FROM arcade_signins WHERE token_hash = ?').get(hash(token)) : null;
      if (client && row) {
        try { await client.appCall('POST', '/push/unsubscribe', { session: row.session_id }); } catch { /* ARKS ID away: it drops them when the session ends everywhere */ }
      }
      end(token);
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
        // A TV (contract v14) counts as an adult only during adults' night.
        if (me.tv) Object.assign(out, { tv: true, adult: !!me.adultMode, adultMode: me.adultMode });
      }
      res.json(out);
    });

    // A person's photo or team picture, fetched from ARKS ID server to server
    // and served from here, so the page never loads anything from another
    // site. Only for someone signed in with ARKS ID or the admin: guests see
    // the person's icon instead, so family photos aren't shown to visitors.
    const photos = new Map();   // image address -> { type, body, at }
    router.get('/api/arksid/photo/:profileId', async (req, res) => {
      const nope = () => res.status(404).set('Cache-Control', 'no-store').end();
      if (!client || !/^[A-Za-z0-9]{1,40}$/.test(req.params.profileId)) return nope();
      if (!require('./admin-session').isAdmin(req) && !(await current(req))) return nope();
      const row = db.db.prepare(`SELECT a.image FROM arcade_profiles p JOIN arcade_id_accounts a ON a.user_id = p.arksid_user
        WHERE p.id = ? AND p.status = 'approved'`).get(req.params.profileId);
      if (!row || !row.image) return nope();
      let pic = photos.get(row.image);
      if (!pic || now() - pic.at > PHOTO_KEEP_MS) {
        photos.delete(row.image);
        let got = null;
        try { got = await client.photo(row.image); } catch { got = null; }
        if (!got) return nope();
        pic = { ...got, at: now() };
        if (photos.size >= 100) photos.delete(photos.keys().next().value);
        photos.set(row.image, pic);
      }
      // The address changes with each new picture (?v=), so the browser can keep it a while.
      res.set({ 'Content-Type': pic.type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(pic.body);
    });

    // The adult pass, for a signed-in adult. It goes where the PIN used to.
    router.post('/api/arksid/adult-pass', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const me = client ? await current(req) : null;
      if (!me) return res.status(401).json({ error: 'Sign in with ARKS ID first.' });
      if (me.tv && !me.adultMode) return res.status(403).json({ error: 'Adult levels on the TV need an adults\' night, unlocked from an adult\'s phone.' });
      if (!me.tv && !GROWN_UP.includes(me.account.role)) return res.status(403).json({ error: 'Adult levels are for adult ARKS ID accounts.' });
      res.json({ pass: passFor(me.profile) });
    });
    return router;
  }

  return { routes, current, remember, start, end, passOk, passFor, deviceFrom, client, noteAdultMode, adultModeOf, signinCookie };
}

module.exports = { settings, problem, createClient, createArksId, cleanUser, photoPath, photoAvatar, isPhotoAvatar, COOKIE, DEVICE_COOKIE, GROWN_UP };
