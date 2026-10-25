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

// Added after the first release: wrong PINs in a row, when a lock lifts, and
// what the high-score boards show for this profile (its name, or initials).
for (const [col, decl] of [['pin_fails', 'INTEGER NOT NULL DEFAULT 0'], ['locked_until', 'INTEGER'],
  ['board_show', "TEXT NOT NULL DEFAULT 'name'"], ['initials', 'TEXT']]) {
  const cols = db.db.prepare('PRAGMA table_info(arcade_profiles)').all().map(c => c.name);
  if (!cols.includes(col)) db.db.exec(`ALTER TABLE arcade_profiles ADD COLUMN ${col} ${decl}`);
}

// Two locks against PIN guessing. A profile locks after 5 wrong PINs in a
// row, whichever device they came from, and unlocks itself 15 minutes later.
// Separately, one device is blocked after 20 wrong PINs across all profiles
// in 10 minutes, so nobody can guess their way through everyone. Right PINs
// never count toward either. The admin can lift both.
const PROFILE_FAILS = 5;
const PROFILE_LOCK_MS = 15 * 60 * 1000;
const deviceStore = new rateLimit.MemoryStore();

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
const lockedFor = r => Math.max(0, (r.locked_until || 0) - Date.now());
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const initialsOf = r => r.initials || String(r.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P';
const pub = r => ({
  id: r.id, name: r.name, avatar: r.avatar, hasPin: !!r.pin_hash, status: r.status, createdAt: r.created_at,
  locked: lockedFor(r) > 0, boardShow: r.board_show === 'initials' ? 'initials' : 'name', initials: initialsOf(r)
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

// With ARKS ID sign-in on (arcade/arksid.js), profiles come from ARKS ID
// accounts: nobody asks for one here, and names, PINs and the boards choice
// are changed in ARKS ID. Avatars are still the arcade's own.
let arksMode = false;
const OFF = 'Profiles come from ARKS ID on this arcade. Sign in with your ARKS ID instead.';
function setArksMode(on) { arksMode = !!on; }

function nameTaken(name, exceptId = null) {
  return !!db.db.prepare("SELECT 1 FROM arcade_profiles WHERE lower(name) = lower(?) AND status != 'rejected' AND id != ?").get(name, exceptId || '');
}

module.exports = function profileRoutes({ requireAdmin, notify }) {
  const router = express.Router();
  const askLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many profile requests. Try again later.' } });
  // The device lock: only wrong PINs (401) count, so switching profiles a lot
  // at a party never blocks anyone.
  const pinLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
    skipSuccessfulRequests: true, store: deviceStore,
    message: { error: 'Too many wrong PINs from this device. Wait 10 minutes, or ask the admin to unlock it.' }
  });

  // Approved profiles, for the picker.
  router.get('/', (req, res) => {
    res.json(db.db.prepare("SELECT * FROM arcade_profiles WHERE status = 'approved' ORDER BY name COLLATE NOCASE").all().map(pub));
  });

  // Ask for a new profile. A grown-up approves it in admin.
  router.post('/', askLimiter, (req, res, next) => {
    try {
      if (arksMode) throw fail(OFF, 403);
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
      if (arksMode) throw fail(OFF, 403);
      const r = row(req.params.id);
      if (!r || r.status !== 'approved') throw fail('That profile isn\'t available.', 404);
      if (r.pin_hash) {
        const wait = lockedFor(r);
        if (wait) throw fail(`This profile is locked for ${Math.ceil(wait / 60000)} more minutes after too many wrong PINs. Ask the admin to unlock it, or wait.`, 423);
        const pin = String((req.body || {}).pin || '');
        if (!PIN_RE.test(pin) || hashPin(pin, r.pin_salt) !== r.pin_hash) {
          const fails = (r.pin_fails || 0) + 1;
          if (fails >= PROFILE_FAILS) {
            db.db.prepare('UPDATE arcade_profiles SET pin_fails = 0, locked_until = ? WHERE id = ?').run(Date.now() + PROFILE_LOCK_MS, r.id);
            throw fail('That PIN isn\'t right, and that was 5 wrong tries, so this profile is locked for 15 minutes. Ask the admin to unlock it, or wait.', 401);
          }
          db.db.prepare('UPDATE arcade_profiles SET pin_fails = ? WHERE id = ?').run(fails, r.id);
          const left = PROFILE_FAILS - fails;
          throw fail(`That PIN isn't right. ${left} more ${left === 1 ? 'try' : 'tries'} before this profile locks for 15 minutes.`, 401);
        }
        if (r.pin_fails || r.locked_until) db.db.prepare('UPDATE arcade_profiles SET pin_fails = 0, locked_until = NULL WHERE id = ?').run(r.id);
      }
      res.json({ profile: pub(r), token: tokenFor(r) });
    } catch (e) { next(e); }
  });

  // Add, change or remove your own PIN. The token proves this device picked the
  // profile; if it already has a PIN, the current one is needed too, so someone
  // who finds the profile left open can't lock its owner out.
  router.post('/:id/pin', pinLimiter, (req, res, next) => {
    try {
      if (arksMode) throw fail('PINs are set in ARKS ID on this arcade.', 403);
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
      const body = req.body || {};
      const now = row(me.id);
      // Each of these is optional, so the avatar and the board choice can be
      // saved separately.
      const avatar = body.avatar === undefined ? now.avatar : body.avatar;
      if (!Avatars.valid(avatar)) throw fail('Pick one of the avatars.');
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
  // A forgotten PIN: take it off. Devices using the profile have to pick it again.
  admin.post('/:id/clear-pin', (req, res) => {
    db.db.prepare("UPDATE arcade_profiles SET pin_hash = NULL, pin_salt = NULL, pin_version = pin_version + 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ cleared: true });
  });
  // Lift a profile's lock (and forget its wrong tries).
  admin.post('/:id/unlock', (req, res) => {
    db.db.prepare('UPDATE arcade_profiles SET pin_fails = 0, locked_until = NULL WHERE id = ?').run(req.params.id);
    res.json({ unlocked: true });
  });
  // Lift every device lock: profile PINs and the adult PIN alike.
  admin.post('/unlock-devices', async (req, res) => {
    await deviceStore.resetAll();
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
module.exports.DEFAULT_AVATAR = Avatars.DEFAULT;
module.exports.boardName = boardName;
module.exports.approvedIds = () => db.db.prepare("SELECT id FROM arcade_profiles WHERE status = 'approved'").all().map(r => r.id);
