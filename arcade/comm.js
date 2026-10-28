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
for (const [col, decl] of [['page', 'TEXT'], ['details', 'TEXT'], ['picture', 'TEXT'], ['profile_id', 'TEXT']]) {
  const cols = db.db.prepare('PRAGMA table_info(comm_feedback)').all().map(c => c.name);
  if (!cols.includes(col)) db.db.exec(`ALTER TABLE comm_feedback ADD COLUMN ${col} ${decl}`);
}

const GAMES = ['wordless', 'rambler', 'spinsolve', 'chess', 'dino', 'trivia', 'partdeux', 'daredevil', 'snake', 'bricks', 'blocks', 'towers'];
const FEEDBACK_KINDS = ['feature', 'issue', 'message'];
const STATUSES = ['new', 'pending', 'in-progress', 'completed', 'canceled'];

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
    page: r.page || null, details: r.details ? JSON.parse(r.details) : null, hasPicture: !!r.picture
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

// Admins send as much feedback as they like; everyone else gets 30 in 3
// minutes, then a 3-minute wait (arcade/burst-limit.js). server.js says who's
// an admin through setAdminCheck.
const { createBurstLimit, waitMessage } = require('./burst-limit');
const sends = createBurstLimit();
let adminCheck = async () => false;
async function feedbackLimiter(req, res, next) {
  try { if (await adminCheck(req)) return next(); } catch { /* not an admin */ }
  const r = sends.take(['ip:' + req.ip]);
  if (!r.ok) return res.status(429).json({ error: waitMessage(r.waitSeconds) });
  next();
}

router.get('/posts', (req, res) => {
  res.json(listPosts(req.query.limit));
});

// The feedback card (public/feedback.js). It can carry a screenshot, so this
// route reads a bigger body than the rest of the arcade (see server.js).
router.post('/feedback', express.json({ limit: '5mb' }), feedbackLimiter, (req, res, next) => {
  try {
    const body = req.body || {};
    const kind = FEEDBACK_KINDS.includes(body.kind) ? body.kind : 'message';
    const message = clean(body.message, 5000);
    if (!message) throw fail('Write a line or two about what happened first.', 400);
    const picture = body.picture ? extras.readPicture(body.picture) : null;
    // A profile's name comes from its token, so nobody can sign as someone else.
    const profile = body.profileToken ? require('./profiles').verify(body.profileToken) : null;
    const from = profile ? profile.name : clean(body.from, 30);
    const page = extras.cleanPage((body.details || {}).page);
    const info = db.db.prepare(`
      INSERT INTO comm_feedback (kind, message, from_name, game, page, details, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(kind, message, from, gameOrNull(body.game), page, JSON.stringify(extras.details(req, body.details)), profile ? profile.id : null);
    const id = Number(info.lastInsertRowid);
    if (picture) db.db.prepare('UPDATE comm_feedback SET picture = ? WHERE id = ?').run(extras.savePicture(id, picture), id);
    if (onFeedback) {
      const label = { feature: '💡 Feature idea', issue: '🐛 Something\'s broken', message: '💬 Message' }[kind];
      onFeedback(`📡 **New arcade feedback** (${label}) from ${from || 'a guest'}${page ? ` on \`${page}\`` : ''}${picture ? ', with a screenshot' : ''}\n> ${message.split('\n')[0].slice(0, 140)}`);
    }
    res.status(201).json({ id });
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
      ? db.db.prepare('SELECT * FROM comm_feedback WHERE status = ? ORDER BY created_at DESC').all(status)
      : db.db.prepare('SELECT * FROM comm_feedback ORDER BY created_at DESC').all();
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

  admin.delete('/feedback/:id', (req, res) => {
    const row = db.db.prepare('SELECT picture FROM comm_feedback WHERE id = ?').get(Number(req.params.id) || 0);
    db.db.prepare('DELETE FROM comm_feedback WHERE id = ?').run(Number(req.params.id));
    if (row) extras.removePicture(row.picture);
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
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = { router, adminRouter, post, safePost, listPosts, STATUSES, setFeedbackNotify: fn => { onFeedback = fn; }, setAdminCheck: fn => { adminCheck = fn; } };
