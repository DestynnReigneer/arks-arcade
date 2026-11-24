'use strict';

// Arcade profiles: Netflix-style "who's playing?" for the whole family.
// Anyone can ask for a profile (name + avatar); the admin approves it.
// Picking a profile gives the device a signed token, which is how scores get
// credited to that profile. Profiles used to be able to have a PIN; that was
// taken out on 2026-11-24 (the pin_* columns and the lock columns are left in
// the table, unused, so no data is dropped).
//
// Guests don't need a profile: they type a name or get "Guest 1", "Guest 2"...

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const adultPin = require('./adult-pin');
const Avatars = require('../public/avatars');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS arcade_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    pin_hash TEXT,
    pin_salt TEXT,
    pin_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Added after the first release: pin_fails and locked_until (no longer used,
// from when profiles had PINs), and what the high-score boards show for this
// profile (its name, or initials).
for (const [col, decl] of [['pin_fails', 'INTEGER NOT NULL DEFAULT 0'], ['locked_until', 'INTEGER'],
  ['board_show', "TEXT NOT NULL DEFAULT 'name'"], ['initials', 'TEXT']]) {
  const cols = db.db.prepare('PRAGMA table_info(arcade_profiles)').all().map(c => c.name);
  if (!cols.includes(col)) db.db.exec(`ALTER TABLE arcade_profiles ADD COLUMN ${col} ${decl}`);
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const cleanName = raw => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16);

// A secret that signs profile tokens, made once and kept in the database.
function secret() {
  let s = db.getSetting('profile_secret', null);
  if (!s) { s = crypto.randomBytes(32).toString('hex'); db.setSetting('profile_secret', s); }
  return s;
}
const sign = (id, version) => crypto.createHmac('sha256', secret()).update(`${id}:${version}`).digest('base64url');
// A profile token. pin_version is only a token version now (from the PIN
// days); it's kept so tokens already handed out keep working. One handed out at an ARKS ID sign-in also names that sign-in
// (signin: a short key for it, never the sign-in's id), and works only while the
// sign-in does (the maintainer, 2026-11-15): signing out ends it everywhere it was
// copied to, the way the adult pass ends.
const tokenFor = (r, signin) => (signin
  ? `${r.id}.${signin}.${sign(r.id, `${r.pin_version}:${signin}`)}`
  : `${r.id}.${sign(r.id, r.pin_version)}`);
// arcade/arksid.js says whether a sign-in key is still going for that profile's account.
let signinAlive = null;
function useSignins(fn) { signinAlive = typeof fn === 'function' ? fn : null; }

const row = id => db.db.prepare('SELECT * FROM arcade_profiles WHERE id = ?').get(String(id || ''));
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const initialsOf = r => r.initials || String(r.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P';
const pub = r => ({
  id: r.id, name: r.name, avatar: r.avatar, status: r.status, createdAt: r.created_at,
  boardShow: r.board_show === 'initials' ? 'initials' : 'name', initials: initialsOf(r)
});

// What the high-score boards show for a profile right now: its name, or the
// initials it chose. Boards look this up every time they're shown, so
// changing the choice changes past scores too. null for a profile that's
// gone, so the board falls back to what was saved with the score.
function boardName(id) {
  const r = id ? row(id) : null;
  if (!r || r.status !== 'approved') return null;
  return { label: r.board_show === 'initials' ? initialsOf(r) : r.name, avatar: r.avatar, initials: initialsOf(r) };
}

// The profile a token belongs to, if it's still valid (a deleted profile
// makes old tokens stop working).
function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [id, key] = parts;
  const sig = parts[parts.length - 1];
  if (!id || !sig) return null;
  const r = row(id);
  if (!r || r.status !== 'approved') return null;
  let expected;
  if (parts.length === 3) {
    if (!/^[0-9a-f]{24}$/.test(key) || !signinAlive || !signinAlive(r, key)) return null;
    expected = sign(r.id, `${r.pin_version}:${key}`);
  } else {
    // A profile that belongs to an ARKS ID account only takes tokens tied to a sign-in.
    if (arksMode && r.arksid_user) return null;
    expected = sign(r.id, r.pin_version);
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? pub(r) : null;
}

// Rambler keeps its own coins and streaks per player; an approved profile
// gets a Rambler player with the same id so those carry over.
function syncRambler(r) {
  if (r.status !== 'approved') return;
  if (!db.getPlayer || !db.createPlayer) return;
  if (db.getPlayer(r.id)) db.updatePlayer(r.id, { name: r.name, avatar: r.avatar });
  else db.createPlayer({ id: r.id, name: r.name, avatar: r.avatar });
}

// With ARKS ID sign-in on (arcade/arksid.js), profiles come from ARKS ID
// accounts: nobody asks for one here, and names and the boards choice are
// changed in ARKS ID. Avatars are still the arcade's own.
let arksMode = false;
const OFF = 'Profiles come from ARKS ID on this arcade. Sign in with your ARKS ID instead.';
function setArksMode(on) { arksMode = !!on; }

function nameTaken(name, exceptId = null) {
  return !!db.db.prepare("SELECT 1 FROM arcade_profiles WHERE lower(name) = lower(?) AND status != 'rejected' AND id != ?").get(name, exceptId || '');
}

module.exports = function profileRoutes({ requireAdmin, notify }) {
  const router = express.Router();
  // Six new profiles an hour from one address. The test suites make more than
  // that, so only under NODE_ENV=test (never in production) the limit is higher.
  const askLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 60 : 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many profile requests. Try again later.' } });

  // Approved profiles, for the picker.
  router.get('/', (req, res) => {
    res.json(db.db.prepare("SELECT * FROM arcade_profiles WHERE status = 'approved' ORDER BY name COLLATE NOCASE").all().map(pub));
  });

  // Ask for a new profile. An adult approves it in admin.
  router.post('/', askLimiter, (req, res, next) => {
    try {
      if (arksMode) throw fail(OFF, 403);
      const body = req.body || {};
      const name = cleanName(body.name);
      if (!name) throw fail('Give your profile a name.');
      if (/^guest\b/i.test(name)) throw fail('"Guest" names are for guests. Pick another name.');
      if (nameTaken(name)) throw fail('Someone already has that name.', 409);
      const avatar = Avatars.valid(body.avatar) ? body.avatar : Avatars.DEFAULT;
      const id = crypto.randomBytes(8).toString('hex');
      db.db.prepare('INSERT INTO arcade_profiles (id, name, avatar) VALUES (?, ?, ?)').run(id, name, avatar);
      notify({ topic: `New profile: ${name}`, note: 'Approve it in Admin → Arcade → Profiles.', requestedBy: name }, 'arcade profile');
      res.status(201).json({ id, name, avatar, status: 'pending' });
    } catch (e) { next(e); }
  });

  // Pick a profile on this device.
  router.post('/:id/use', (req, res, next) => {
    try {
      if (arksMode) throw fail(OFF, 403);
      const r = row(req.params.id);
      if (!r || r.status !== 'approved') throw fail('That profile isn\'t available.', 404);
      res.json({ profile: pub(r), token: tokenFor(r) });
    } catch (e) { next(e); }
  });

  // Change your own avatar.
  router.patch('/:id', (req, res, next) => {
    try {
      const me = verify((req.body || {}).token);
      if (!me || me.id !== req.params.id) throw fail('Pick your profile first.', 401);
      const body = req.body || {};
      const now = row(me.id);
      // Each of these is optional, so the avatar and the board choice can be
      // saved separately.
      const avatar = body.avatar === undefined ? now.avatar : body.avatar;
      // Keeping the avatar you have is always fine, even an ARKS ID photo,
      // which isn't one of the avatars you can pick here.
      if (avatar !== now.avatar && !Avatars.valid(avatar)) throw fail('Pick one of the avatars.');
      if (arksMode && avatar !== now.avatar) throw fail('Your avatar is picked on your ARKS ID account page on this arcade.', 403);
      if (arksMode && (body.boardShow !== undefined || body.initials !== undefined)) throw fail('Name or initials on the boards is chosen in ARKS ID on this arcade.', 403);
      const show = body.boardShow === undefined ? now.board_show : body.boardShow === 'initials' ? 'initials' : 'name';
      let initials = body.initials === undefined ? now.initials : String(body.initials || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (initials && !INITIALS_RE.test(initials)) throw fail('Initials are 1 to 3 letters or numbers.');
      initials = initials || null;
      db.db.prepare("UPDATE arcade_profiles SET avatar = ?, board_show = ?, initials = ?, updated_at = datetime('now') WHERE id = ?").run(avatar, show, initials, me.id);
      const r = row(me.id);
      syncRambler(r);
      res.json({ profile: pub(r) });
    } catch (e) { next(e); }
  });

  // The next free guest name.
  router.post('/guest', (req, res) => {
    const n = (Number(db.getSetting('guest_counter', 0)) % 99) + 1;
    db.setSetting('guest_counter', n);
    res.json({ name: `Guest ${n}` });
  });

  // ---- admin --------------------------------------------------------------------
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.get('/', (req, res) => {
    const account = id => (id ? db.db.prepare('SELECT user_id, name, role FROM arcade_id_accounts WHERE user_id = ?').get(id) || null : null);
    res.json(db.db.prepare("SELECT * FROM arcade_profiles WHERE status != 'rejected' ORDER BY status DESC, name COLLATE NOCASE").all()
      .map(r => ({ ...pub(r), account: arksMode ? account(r.arksid_user) : undefined })));
  });
  // With ARKS ID on: every account the arcade has seen, and which profile it's
  // linked to, so a wrong first-time link can be moved.
  admin.get('/accounts', (req, res) => {
    if (!arksMode) return res.json({ on: false, accounts: [] });
    res.json({ on: true, accounts: db.db.prepare(`SELECT a.user_id, a.name, a.role, p.id AS profile_id FROM arcade_id_accounts a
      LEFT JOIN arcade_profiles p ON p.arksid_user = a.user_id ORDER BY a.name COLLATE NOCASE`).all().map(a => ({ ...a })) });
  });
  // { arksid_user } links this profile to that account (moving it from any
  // other profile), or null unlinks it. The next sign-in brings the name over.
  admin.post('/:id/link', (req, res, next) => {
    try {
      if (!arksMode) throw fail('ARKS ID sign-in is not turned on.', 400);
      const r = row(req.params.id);
      if (!r) throw fail('No such profile.', 404);
      const to = (req.body || {}).arksid_user;
      if (to !== null && !db.db.prepare('SELECT 1 FROM arcade_id_accounts WHERE user_id = ?').get(String(to || ''))) throw fail('Pick an ARKS ID account from the list.');
      if (to) db.db.prepare('UPDATE arcade_profiles SET arksid_user = NULL WHERE arksid_user = ?').run(to);
      db.db.prepare('UPDATE arcade_profiles SET arksid_user = ? WHERE id = ?').run(to, r.id);
      res.json({ linked: !!to });
    } catch (e) { next(e); }
  });
  admin.post('/:id/approve', (req, res, next) => {
    try {
      const r = row(req.params.id);
      if (!r) throw fail('No such profile.', 404);
      db.db.prepare("UPDATE arcade_profiles SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(r.id);
      syncRambler(row(r.id));
      res.json(pub(row(r.id)));
    } catch (e) { next(e); }
  });
  admin.post('/:id/reject', (req, res) => {
    db.db.prepare("UPDATE arcade_profiles SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ rejected: true });
  });
  admin.patch('/:id', (req, res, next) => {
    try {
      const r = row(req.params.id);
      if (!r) throw fail('No such profile.', 404);
      const body = req.body || {};
      const name = body.name === undefined ? r.name : cleanName(body.name);
      if (!name) throw fail('A profile needs a name.');
      if (name.toLowerCase() !== r.name.toLowerCase() && nameTaken(name, r.id)) throw fail('Someone already has that name.', 409);
      const avatar = Avatars.valid(body.avatar) ? body.avatar : r.avatar;
      db.db.prepare("UPDATE arcade_profiles SET name = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?").run(name, avatar, r.id);
      syncRambler(row(r.id));
      res.json(pub(row(r.id)));
    } catch (e) { next(e); }
  });
  // Lift every device lock (an ARKS ID adult pass's wrong tries).
  admin.post('/unlock-devices', async (req, res) => {
    await adultPin.resetTries();
    res.json({ unlocked: true });
  });
  admin.delete('/:id', (req, res) => {
    db.db.prepare('DELETE FROM arcade_profiles WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  });

  router.use('/admin', admin);
  router.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return router;
};

module.exports.verify = verify;
module.exports.pub = pub;
module.exports.tokenFor = tokenFor;
module.exports.syncRambler = syncRambler;
module.exports.setArksMode = setArksMode;
module.exports.useSignins = useSignins;
module.exports.arksMode = () => arksMode;
module.exports.DEFAULT_AVATAR = Avatars.DEFAULT;
module.exports.boardName = boardName;
module.exports.approvedIds = () => db.db.prepare("SELECT id FROM arcade_profiles WHERE status = 'approved'").all().map(r => r.id);
