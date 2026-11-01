'use strict';

// The Comm Center: the arcade's message board. The home page reads posts from
// here; players send feedback to it; the admin answers feedback and posts
// announcements. The arcade also posts on its own when something worth
// shouting about happens -- a new theme, a new top score.

const express = require('express');
const db = require('../db');
const adultPin = require('./adult-pin');
const extras = require('./feedback');

// Added for the feedback bug's card: the page it was sent from, details about
// the device, a screenshot, and the profile that sent it.
// Then (2026-11-01), tracking the way GitHub tracks issues: each side's own
// copy (admin_hidden, sender_hidden), when the sender last fixed what they
// wrote, and a thread of replies between the admin and the sender.
for (const [col, decl] of [['page', 'TEXT'], ['details', 'TEXT'], ['picture', 'TEXT'], ['profile_id', 'TEXT'],
  ['admin_hidden', 'INTEGER NOT NULL DEFAULT 0'], ['sender_hidden', 'INTEGER NOT NULL DEFAULT 0'], ['edited_at', 'TEXT']]) {
  const cols = db.db.prepare('PRAGMA table_info(comm_feedback)').all().map(c => c.name);
  if (!cols.includes(col)) db.db.exec(`ALTER TABLE comm_feedback ADD COLUMN ${col} ${decl}`);
}
db.db.exec(`CREATE TABLE IF NOT EXISTS comm_feedback_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  from_admin INTEGER NOT NULL DEFAULT 0,
  profile_id TEXT,
  name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const GAMES = ['wordless', 'rambler', 'spinsolve', 'chess', 'dino', 'trivia', 'partdeux', 'daredevil', 'snake', 'bricks', 'blocks', 'towers'];
const FEEDBACK_KINDS = ['feature', 'issue', 'message'];
const STATUSES = ['new', 'pending', 'in-progress', 'completed', 'canceled'];
// Done ones (Fixed, Won't fix) move to the Archive, for the admin and the sender.
const ARCHIVED = ['completed', 'canceled'];
const replyCount = id => db.db.prepare('SELECT COUNT(*) AS n FROM comm_feedback_replies WHERE feedback_id = ?').get(id).n;
const repliesOf = id => db.db.prepare('SELECT * FROM comm_feedback_replies WHERE feedback_id = ? ORDER BY id').all(id)
  .map(r => ({ id: r.id, fromAdmin: !!r.from_admin, name: r.name, body: r.body, createdAt: r.created_at }));
// Gone for good once neither side keeps a copy.
function forgetFeedback(id) {
  const row = db.db.prepare('SELECT picture FROM comm_feedback WHERE id = ?').get(id);
  db.db.prepare('DELETE FROM comm_feedback_replies WHERE feedback_id = ?').run(id);
  db.db.prepare('DELETE FROM comm_feedback WHERE id = ?').run(id);
  if (row) extras.removePicture(row.picture);
}

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const gameOrNull = g => (GAMES.includes(g) ? g : null);

function rowToPost(r) {
  return { id: r.id, kind: r.kind, emoji: r.emoji, title: r.title, body: r.body, game: r.game, createdAt: r.created_at };
}

function rowToFeedback(r) {
  return {
    id: r.id, kind: r.kind, message: r.message, from: r.from_name, game: r.game,
    status: r.status, note: r.admin_note, createdAt: r.created_at, updatedAt: r.updated_at,
    page: r.page || null, details: r.details ? JSON.parse(r.details) : null, hasPicture: !!r.picture,
    editedAt: r.edited_at || null, fromProfile: !!r.profile_id, replyCount: replyCount(r.id)
  };
}

// ---- posting, from anywhere in the arcade ----------------------------------

function post({ kind = 'announcement', emoji = '📣', title, body = '', game = null }) {
  const info = db.db.prepare(`
    INSERT INTO comm_posts (kind, emoji, title, body, game) VALUES (?, ?, ?, ?, ?)
  `).run(kind, clean(emoji, 8) || '📣', clean(title, 80), clean(body, 1000), gameOrNull(game));
  return Number(info.lastInsertRowid);
}

// Never let a message-board hiccup break the thing that triggered it: a top
// score must still save even if its shout-out cannot.
function safePost(entry) {
  try { return post(entry); } catch (e) { console.warn('Comm Center post failed:', e.message); return null; }
}

function listPosts(limit = 20) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return db.db.prepare('SELECT * FROM comm_posts ORDER BY created_at DESC, id DESC LIMIT ?').all(cap).map(rowToPost);
}

// ---- routes -----------------------------------------------------------------

const router = express.Router();

// Admins send as much feedback as they like. A profile gets 30 in 3 minutes,
// then a 3-minute wait; someone without a profile gets 5 an hour from one
// device (arcade/burst-limit.js). server.js says who's an admin through
// setAdminCheck. It's checked after the note itself, so a refused empty note
// doesn't use one up.
const limits = require('./burst-limit');
const sends = limits.createBurstLimit();
const guestSends = limits.createBurstLimit({ max: limits.GUEST_MAX, windowMs: limits.GUEST_WINDOW_MS, waitMs: 0 });
let adminCheck = async () => false;
async function overLimit(req, profile) {
  try { if (await adminCheck(req)) return null; } catch { /* not an admin */ }
  if (profile) {
    const r = sends.take(['profile:' + profile.id, 'ip:' + req.ip]);
    return r.ok ? null : limits.waitMessage(r.waitSeconds);
  }
  const r = guestSends.take(['ip:' + req.ip]);
  return r.ok ? null : limits.guestWaitMessage(r.waitSeconds);
}

// When the pictures folder is full, the admin hears about it once, as a note
// in their own inbox. It's said again only after there was room once more.
const FULL_FLAG = 'feedback_pictures_full_flagged';
function flagPicturesFull() {
  if (db.getSetting(FULL_FLAG, false)) return;
  db.setSetting(FULL_FLAG, true);
  db.db.prepare("INSERT INTO comm_feedback (kind, message, from_name) VALUES ('message', ?, 'The arcade')").run(
    'The feedback pictures folder is full: the screenshots people sent add up to 500 MB, the most the arcade keeps. ' +
    'New notes still arrive, but without their pictures, until you delete some old feedback that has one. ' +
    'You get this note once each time the folder fills up.');
  if (onFeedback) onFeedback('📡 **The feedback pictures folder is full** (500 MB). New notes arrive without their screenshots until some old feedback is deleted.');
}

router.get('/posts', (req, res) => {
  res.json(listPosts(req.query.limit));
});

// The feedback card (public/feedback.js). It can carry a screenshot, so this
// route reads a bigger body than the rest of the arcade (see server.js).
router.post('/feedback', express.json({ limit: extras.BODY_LIMIT }), async (req, res, next) => {
  try {
    const body = req.body || {};
    const kind = FEEDBACK_KINDS.includes(body.kind) ? body.kind : 'message';
    const message = clean(body.message, 5000);
    if (!message) throw fail('Write a line or two about what happened first.', 400);
    let picture = body.picture ? extras.readPicture(body.picture) : null;
    // A profile's name comes from its token, so nobody can sign as someone else.
    const profile = body.profileToken ? require('./profiles').verify(body.profileToken) : null;
    const limited = await overLimit(req, profile);
    if (limited) throw fail(limited, 429);
    // No room left for pictures: the note still goes in, without it.
    let pictureDropped = false;
    if (picture && !extras.pictureFits(picture)) { picture = null; pictureDropped = true; flagPicturesFull(); }
    const from = profile ? profile.name : clean(body.from, 30);
    const page = extras.cleanPage((body.details || {}).page);
    const info = db.db.prepare(`
      INSERT INTO comm_feedback (kind, message, from_name, game, page, details, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(kind, message, from, gameOrNull(body.game), page, JSON.stringify(extras.details(req, body.details)), profile ? profile.id : null);
    const id = Number(info.lastInsertRowid);
    if (picture) {
      db.db.prepare('UPDATE comm_feedback SET picture = ? WHERE id = ?').run(extras.savePicture(id, picture), id);
      if (db.getSetting(FULL_FLAG, false)) db.setSetting(FULL_FLAG, false);
    }
    if (onFeedback) {
      const label = { feature: '💡 Feature idea', issue: '🐛 Something\'s broken', message: '💬 Message' }[kind];
      onFeedback(`📡 **New arcade feedback** (${label}) from ${from || 'a guest'}${page ? ` on \`${page}\`` : ''}${picture ? ', with a screenshot' : ''}\n> ${message.split('\n')[0].slice(0, 140)}`);
    }
    res.status(201).json(pictureDropped ? {
      id, pictureDropped,
      note: 'Your note arrived, but the picture couldn\'t come with it, because the arcade has no room left for screenshots right now. The admin has been told.'
    } : { id });
  } catch (e) { next(e); }
});

// ---- the sender's side: "My feedback" (2026-11-01) ---------------------------
// Everything here takes the profile's token in the body, so it never sits in
// an address. Only feedback that profile sent, and only its copy.
function mine(req) {
  const profile = require('./profiles').verify((req.body || {}).token);
  if (!profile) throw fail('Pick who\'s playing first.', 401);
  return profile;
}
function minePiece(req, profile) {
  const row = db.db.prepare('SELECT * FROM comm_feedback WHERE id = ? AND sender_hidden = 0').get(Number(req.params.id));
  if (!row || row.profile_id !== profile.id) throw fail('That message isn\'t there anymore.', 404);
  return row;
}
const senderView = (r, full) => ({
  id: r.id, kind: r.kind, message: r.message, game: r.game, status: r.status, createdAt: r.created_at, editedAt: r.edited_at || null,
  hasPicture: !!r.picture, replyCount: replyCount(r.id), ...(full ? { replies: repliesOf(r.id) } : {})
});
router.post('/mine', (req, res, next) => {
  try {
    const profile = mine(req);
    const archive = (req.body || {}).view === 'archive';
    const rows = db.db.prepare(`SELECT * FROM comm_feedback WHERE profile_id = ? AND sender_hidden = 0 AND status ${archive ? '' : 'NOT'} IN ('completed', 'canceled') ORDER BY created_at DESC, id DESC LIMIT 200`).all(profile.id);
    res.json({ items: rows.map(r => senderView(r, false)) });
  } catch (e) { next(e); }
});
router.post('/mine/:id', (req, res, next) => {
  try { const p = mine(req); res.json({ thread: senderView(minePiece(req, p), true) }); } catch (e) { next(e); }
});
router.post('/mine/:id/edit', (req, res, next) => {
  try {
    const p = mine(req), row = minePiece(req, p);
    if (ARCHIVED.includes(row.status)) throw fail('That one is done already, so it can\'t be changed. Send a new one instead.', 409);
    const message = clean((req.body || {}).message, 5000);
    if (!message) throw fail('Write something first.', 400);
    db.db.prepare("UPDATE comm_feedback SET message = ?, edited_at = datetime('now') WHERE id = ?").run(message, row.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.post('/mine/:id/reply', (req, res, next) => {
  try {
    const p = mine(req), row = minePiece(req, p);
    const body = clean((req.body || {}).body, 5000);
    if (!body) throw fail('Write your reply first.', 400);
    db.db.prepare('INSERT INTO comm_feedback_replies (feedback_id, from_admin, profile_id, name, body) VALUES (?, 0, ?, ?, ?)').run(row.id, p.id, p.name, body);
    // A reply after it's done means it isn't done after all: back on the admin's list.
    if (ARCHIVED.includes(row.status)) db.db.prepare("UPDATE comm_feedback SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(row.id);
    if (row.admin_hidden) db.db.prepare('UPDATE comm_feedback SET admin_hidden = 0 WHERE id = ?').run(row.id);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
router.post('/mine/:id/delete', (req, res, next) => {
  try {
    const p = mine(req), row = minePiece(req, p);
    if (row.admin_hidden) forgetFeedback(row.id);
    else db.db.prepare('UPDATE comm_feedback SET sender_hidden = 1 WHERE id = ?').run(row.id);
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// Set by server.js: sends a line to Discord when feedback arrives.
let onFeedback = null;

// ---- admin ------------------------------------------------------------------

function adminRouter(requireAdmin) {
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/feedback', (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = status
      ? db.db.prepare('SELECT * FROM comm_feedback WHERE admin_hidden = 0 AND status = ? ORDER BY created_at DESC').all(status)
      : db.db.prepare('SELECT * FROM comm_feedback WHERE admin_hidden = 0 ORDER BY created_at DESC').all();
    res.json({ statuses: STATUSES, items: rows.map(rowToFeedback) });
  });

  admin.patch('/feedback/:id', (req, res, next) => {
    try {
      const body = req.body || {};
      const row = db.db.prepare('SELECT * FROM comm_feedback WHERE id = ?').get(Number(req.params.id));
      if (!row) throw fail('No such message.', 404);
      const status = body.status === undefined ? row.status : body.status;
      if (!STATUSES.includes(status)) throw fail('Unknown status.', 400);
      const note = body.note === undefined ? row.admin_note : clean(body.note, 500);
      db.db.prepare(`
        UPDATE comm_feedback SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?
      `).run(status, note, row.id);
      res.json(rowToFeedback(db.db.prepare('SELECT * FROM comm_feedback WHERE id = ?').get(row.id)));
    } catch (e) { next(e); }
  });

  admin.get('/feedback/:id/picture', (req, res) => {
    const row = db.db.prepare('SELECT picture FROM comm_feedback WHERE id = ?').get(Number(req.params.id) || 0);
    const file = row && extras.picturePath(row.picture);
    if (!file) return res.status(404).json({ error: 'No screenshot for that one.' });
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(file.endsWith('.png') ? 'png' : 'jpeg').sendFile(file);
  });

  // The thread: replies between the admin and the sender. Opening a new one counts as seeing it.
  admin.get('/feedback/:id/replies', (req, res, next) => {
    try {
      const row = db.db.prepare('SELECT * FROM comm_feedback WHERE id = ? AND admin_hidden = 0').get(Number(req.params.id));
      if (!row) throw fail('No such message.', 404);
      if (row.status === 'new') db.db.prepare("UPDATE comm_feedback SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(row.id);
      res.json({ replies: repliesOf(row.id) });
    } catch (e) { next(e); }
  });
  admin.post('/feedback/:id/replies', (req, res, next) => {
    try {
      const row = db.db.prepare('SELECT * FROM comm_feedback WHERE id = ? AND admin_hidden = 0').get(Number(req.params.id));
      if (!row) throw fail('No such message.', 404);
      const body = clean((req.body || {}).body, 5000);
      if (!body) throw fail('Write your reply first.', 400);
      db.db.prepare("INSERT INTO comm_feedback_replies (feedback_id, from_admin, name, body) VALUES (?, 1, 'Admin', ?)").run(row.id, body);
      if (row.status === 'new') db.db.prepare("UPDATE comm_feedback SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(row.id);
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });
  // Delete for me: the sender keeps their copy unless they deleted it too, or
  // it came from someone with no profile.
  admin.delete('/feedback/:id', (req, res) => {
    const row = db.db.prepare('SELECT * FROM comm_feedback WHERE id = ?').get(Number(req.params.id) || 0);
    if (row && (row.sender_hidden || !row.profile_id)) forgetFeedback(row.id);
    else if (row) db.db.prepare('UPDATE comm_feedback SET admin_hidden = 1 WHERE id = ?').run(row.id);
    res.json({ deleted: true });
  });

  admin.post('/posts', (req, res, next) => {
    try {
      const body = req.body || {};
      if (!clean(body.title, 80)) throw fail('Give the announcement a title.', 400);
      const id = post({ kind: 'announcement', emoji: body.emoji, title: body.title, body: body.body, game: body.game });
      res.status(201).json({ id });
    } catch (e) { next(e); }
  });

  admin.delete('/posts/:id', (req, res) => {
    db.db.prepare('DELETE FROM comm_posts WHERE id = ?').run(Number(req.params.id));
    res.json({ deleted: true });
  });

  // The home page's game list: order and which ones show.
  const homeGames = require('./home-games');
  admin.get('/home-games', (req, res) => res.json(homeGames.get()));
  admin.post('/home-games', (req, res, next) => {
    try { res.json(homeGames.set(req.body || {})); } catch (e) { next(e); }
  });

  // The adult PIN lives here rather than under one game: it guards adult
  // content anywhere in the arcade.
  admin.get('/adult-pin', (req, res) => res.json(adultPin.status()));
  admin.post('/adult-pin', (req, res, next) => {
    try { res.json(adultPin.set((req.body || {}).pin)); } catch (e) { next(e); }
  });

  admin.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return admin;
}

router.use((err, req, res, next) => {
  // The body was bigger than any note with a 1.5 MB picture can be.
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That picture is bigger than 1.5 MB, which is the most a note can carry. Try a smaller one.' });
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = { router, adminRouter, post, safePost, listPosts, STATUSES, setFeedbackNotify: fn => { onFeedback = fn; }, setAdminCheck: fn => { adminCheck = fn; } };
