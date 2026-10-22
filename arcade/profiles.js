'use strict';

// Arcade profiles: Netflix-style "who's playing?" for the whole family.
// Anyone can ask for a profile (name + avatar); the admin approves it. A PIN
// is optional and can be added, changed or removed later by whoever owns the
// profile (the admin can clear a forgotten one). Picking a profile gives the
// device a signed token, which is how scores get credited to that profile:
// nobody can post a score as someone else without their PIN.
//
// Guests don't need a profile: they type a name or get "Guest 1", "Guest 2"...

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
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

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const cleanName = raw => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16);
const PIN_RE = /^\d{6}$/;

// A secret that signs profile tokens, made once and kept in the database.
function secret() {
  let s = db.getSetting('profile_secret', null);
  if (!s) { s = crypto.randomBytes(32).toString('hex'); db.setSetting('profile_secret', s); }
  return s;
}
const sign = (id, version) => crypto.createHmac('sha256', secret()).update(`${id}:${version}`).digest('base64url');
const tokenFor = r => `${r.id}.${sign(r.id, r.pin_version)}`;
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

const row = id => db.db.prepare('SELECT * FROM arcade_profiles WHERE id = ?').get(String(id || ''));
const pub = r => ({ id: r.id, name: r.name, avatar: r.avatar, hasPin: !!r.pin_hash, status: r.status, createdAt: r.created_at });

// The profile a token belongs to, if it's still valid (a PIN change or a
// deleted profile makes old tokens stop working).
function verify(token) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !sig) return null;
  const r = row(id);
  if (!r || r.status !== 'approved') return null;
  const expected = sign(r.id, r.pin_version);
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

function nameTaken(name, exceptId = null) {
  return !!db.db.prepare("SELECT 1 FROM arcade_profiles WHERE lower(name) = lower(?) AND status != 'rejected' AND id != ?").get(name, exceptId || '');
}

module.exports = function profileRoutes({ requireAdmin, notify }) {
  const router = express.Router();
  const askLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many profile requests. Try again later.' } });
  // Slows down anyone trying to guess a PIN.
  const pinLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many tries. Wait a few minutes.' } });

  // Approved profiles, for the picker.
  router.get('/', (req, res) => {
    res.json(db.db.prepare("SELECT * FROM arcade_profiles WHERE status = 'approved' ORDER BY name COLLATE NOCASE").all().map(pub));
  });

  // Ask for a new profile. A grown-up approves it in admin.
  router.post('/', askLimiter, (req, res, next) => {
    try {
      const body = req.body || {};
      const name = cleanName(body.name);
      if (!name) throw fail('Give your profile a name.');
      if (/^guest\b/i.test(name)) throw fail('"Guest" names are for guests. Pick another name.');
      if (nameTaken(name)) throw fail('Someone already has that name.', 409);
      const avatar = Avatars.valid(body.avatar) ? body.avatar : Avatars.DEFAULT;
      const pin = String(body.pin || '').trim();
      if (pin && !PIN_RE.test(pin)) throw fail('A PIN is 6 digits (or leave it blank).');
      const id = crypto.randomBytes(8).toString('hex');
      const salt = pin ? crypto.randomBytes(16).toString('hex') : null;
      db.db.prepare('INSERT INTO arcade_profiles (id, name, avatar, pin_hash, pin_salt) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, avatar, pin ? hashPin(pin, salt) : null, salt);
      notify({ topic: `New profile: ${name}`, note: 'Approve it in Admin → Arcade → Profiles.', requestedBy: name }, 'arcade profile');
      res.status(201).json({ id, name, avatar, status: 'pending' });
    } catch (e) { next(e); }
  });

  // Pick a profile on this device (with its PIN, if it has one).
  router.post('/:id/use', pinLimiter, (req, res, next) => {
    try {
      const r = row(req.params.id);
      if (!r || r.status !== 'approved') throw fail('That profile isn\'t available.', 404);
      if (r.pin_hash) {
        const pin = String((req.body || {}).pin || '');
        if (!PIN_RE.test(pin) || hashPin(pin, r.pin_salt) !== r.pin_hash) throw fail('That PIN isn\'t right.', 401);
      }
      res.json({ profile: pub(r), token: tokenFor(r) });
    } catch (e) { next(e); }
  });

  // Add, change or remove your own PIN. The token proves this device picked the
  // profile; if it already has a PIN, the current one is needed too, so someone
  // who finds the profile left open can't lock its owner out.
  router.post('/:id/pin', pinLimiter, (req, res, next) => {
    try {
      const me = verify((req.body || {}).token);
      if (!me || me.id !== req.params.id) throw fail('Pick your profile first.', 401);
      const before = row(me.id);
      if (before.pin_hash) {
        const current = String((req.body || {}).current || '');
        if (!PIN_RE.test(current) || hashPin(current, before.pin_salt) !== before.pin_hash) {
          throw fail('Your current PIN isn\'t right.', 401);
        }
      }
      const pin = String((req.body || {}).pin || '').trim();
      if (pin && !PIN_RE.test(pin)) throw fail('A PIN is 6 digits.');
      const salt = pin ? crypto.randomBytes(16).toString('hex') : null;
      db.db.prepare("UPDATE arcade_profiles SET pin_hash = ?, pin_salt = ?, pin_version = pin_version + 1, updated_at = datetime('now') WHERE id = ?")
        .run(pin ? hashPin(pin, salt) : null, salt, me.id);
      const r = row(me.id);
      res.json({ profile: pub(r), token: tokenFor(r) });
    } catch (e) { next(e); }
  });

  // Change your own avatar.
  router.patch('/:id', (req, res, next) => {
    try {
      const me = verify((req.body || {}).token);
      if (!me || me.id !== req.params.id) throw fail('Pick your profile first.', 401);
      const avatar = (req.body || {}).avatar;
      if (!Avatars.valid(avatar)) throw fail('Pick one of the avatars.');
      db.db.prepare("UPDATE arcade_profiles SET avatar = ?, updated_at = datetime('now') WHERE id = ?").run(avatar, me.id);
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
    res.json(db.db.prepare("SELECT * FROM arcade_profiles WHERE status != 'rejected' ORDER BY status DESC, name COLLATE NOCASE").all().map(pub));
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
  // A forgotten PIN: take it off. Devices using the profile have to pick it again.
  admin.post('/:id/clear-pin', (req, res) => {
    db.db.prepare("UPDATE arcade_profiles SET pin_hash = NULL, pin_salt = NULL, pin_version = pin_version + 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ cleared: true });
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
