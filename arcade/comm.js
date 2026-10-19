'use strict';

// The Comm Center: the arcade's message board. The home page reads posts from
// here; players send feedback to it; the admin answers feedback and posts
// announcements. The arcade also posts on its own when something worth
// shouting about happens -- a new theme, a new top score.

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const adultPin = require('./adult-pin');

const GAMES = ['wordless', 'rambler', 'shortfuse', 'spinsolve', 'chess', 'dino'];
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
    status: r.status, note: r.admin_note, createdAt: r.created_at, updatedAt: r.updated_at
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

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of messages. Try again in a while.' }
});

router.get('/posts', (req, res) => {
  res.json(listPosts(req.query.limit));
});

router.post('/feedback', feedbackLimiter, (req, res) => {
  const body = req.body || {};
  const kind = FEEDBACK_KINDS.includes(body.kind) ? body.kind : 'message';
  const message = clean(body.message, 1000);
  if (!message) return res.status(400).json({ error: 'Write a message first.' });
  const info = db.db.prepare(`
    INSERT INTO comm_feedback (kind, message, from_name, game) VALUES (?, ?, ?, ?)
  `).run(kind, message, clean(body.from, 30), gameOrNull(body.game));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

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

  admin.delete('/feedback/:id', (req, res) => {
    db.db.prepare('DELETE FROM comm_feedback WHERE id = ?').run(Number(req.params.id));
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

module.exports = { router, adminRouter, post, safePost, listPosts, STATUSES };
