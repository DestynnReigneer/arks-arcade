'use strict';

// Admin sign-in. The password is checked once, and the browser gets an
// httpOnly, SameSite=Strict cookie, so the admin page never keeps the password
// where a script on the page could read it. Sessions live in memory: a
// restart signs the admin out. The X-Admin-Token header still works for
// scripts and the tests.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { sameSecret } = require('./security');

// ADMIN_PASSWORD is the name in .env; ADMIN_TOKEN is the older one, still honored.
const SECRET = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || '';
const COOKIE = 'arcade_admin';
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const sessions = new Map();   // session id -> expiry time (ms)

function sessionId(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return '';
}

function isAdmin(req) {
  if (!SECRET) return false;
  const header = req.get('X-Admin-Token');
  if (header) return sameSecret(header, SECRET);
  const id = sessionId(req);
  const expires = id && sessions.get(id);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(id); return false; }
  return true;
}

// If no password is configured, admin routes are disabled entirely (deny by default).
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin sign-in needed.' });
  next();
}

function setCookie(req, res, value, maxAgeSeconds) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function routes() {
  const router = express.Router();
  // Slows password guessing: ten tries per quarter hour per address.
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });

  router.post('/login', loginLimiter, (req, res) => {
    if (!SECRET) return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
    if (!sameSecret(req.body && req.body.password, SECRET)) {
      return res.status(401).json({ error: 'Wrong password.' });
    }
    const now = Date.now();
    for (const [id, expires] of sessions) if (expires < now) sessions.delete(id);
    const id = crypto.randomBytes(32).toString('base64url');
    sessions.set(id, now + LIFETIME_MS);
    setCookie(req, res, id, LIFETIME_MS / 1000);
    res.json({ ok: true });
  });

  router.get('/session', (req, res) => res.json({ admin: isAdmin(req) }));

  router.post('/logout', (req, res) => {
    sessions.delete(sessionId(req));
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { isAdmin, requireAdmin, routes };
