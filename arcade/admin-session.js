'use strict';

// Who gets into the admin page (2026-11-11, the same in every ARKS app).
//
// - With ARKS ID on: someone signed in with an ARKS ID admin account is
//   straight in, with no PIN or password. The admin page asks
//   /api/admin/session, which hands them the same admin cookie as recovery,
//   marked as coming from ARKS ID, and every admin request checks with ARKS ID
//   again, so signing out there (or losing the admin role) ends it.
// - Recovery, for when nobody can sign in that way (and the only way in on a
//   copy of the arcade without ARKS ID): ADMIN_PIN (6 digits) on the PIN pad,
//   or ADMIN_PASSWORD. The browser gets an httpOnly, SameSite=Strict cookie, so
//   the page never keeps the PIN or password where a script could read it.
//
// Sessions live in memory: a restart signs everyone out. The X-Admin-Token
// header (the password) still works for scripts and the tests.

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { sameSecret } = require('./security');

// ADMIN_PASSWORD is the name in .env; ADMIN_TOKEN is the older one, still honored.
const SECRET = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || '';
// The recovery PIN, typed on the PIN pad. Optional; when it's set it's 6 digits.
const PIN = /^\d{6}$/.test(String(process.env.ADMIN_PIN || '').trim()) ? String(process.env.ADMIN_PIN).trim() : '';
if (process.env.ADMIN_PIN && !PIN) console.warn('ADMIN_PIN in .env has to be exactly 6 digits, so it is ignored. The password still works.');
const COOKIE = 'arcade_admin';
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
// An ARKS ID admin's cookie is short-lived; it's renewed each time the admin page opens.
const ARKS_LIFETIME_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();   // session id -> { expires, viaArks }

// Set by server.js when ARKS ID is on: async req -> the signed-in person is an ARKS ID admin.
let arksAdmin = null;
function useArksId(check) { arksAdmin = check; }
const arksOn = () => !!arksAdmin;

function sessionId(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return '';
}

function sessionOf(req) {
  const id = sessionId(req);
  const s = id && sessions.get(id);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(id); return null; }
  return s;
}

// Quick check for places that can't wait (which themes the admin page lists,
// say): the password header, or an admin cookie. requireAdmin also makes sure
// an ARKS ID admin is still one.
function isAdmin(req) {
  const header = req.get('X-Admin-Token');
  if (header) return !!SECRET && sameSecret(header, SECRET);
  return !!sessionOf(req);
}

async function isArksAdmin(req) {
  if (!arksAdmin) return false;
  try { return !!(await arksAdmin(req)); } catch { return false; }
}

// Admin routes: deny by default.
function requireAdmin(req, res, next) {
  const header = req.get('X-Admin-Token');
  if (header) return isAdmin(req) ? next() : res.status(401).json({ error: 'Admin sign-in needed.' });
  const s = sessionOf(req);
  if (s && !s.viaArks) return next();
  // An ARKS ID admin's cookie, or no cookie at all: ask ARKS ID.
  isArksAdmin(req).then(ok => {
    if (ok) return next();
    if (s) sessions.delete(sessionId(req));
    res.status(401).json({ error: 'Admin sign-in needed.' });
  }, next);
}

function setCookie(req, res, value, maxAgeSeconds) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function startSession(req, res, viaArks) {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expires < now) sessions.delete(id);
  const life = viaArks ? ARKS_LIFETIME_MS : LIFETIME_MS;
  const id = crypto.randomBytes(32).toString('base64url');
  sessions.set(id, { expires: now + life, viaArks });
  setCookie(req, res, id, life / 1000);
}

function routes() {
  const router = express.Router();
  // Slows guessing: ten tries per quarter hour per address, PIN and password together.
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true,
    message: { error: 'Too many tries, wait a few minutes, then try again.' } });

  // Recovery: { pin } (ADMIN_PIN) or { password } (ADMIN_PASSWORD).
  router.post('/login', loginLimiter, (req, res) => {
    const body = req.body || {};
    if (typeof body.pin === 'string') {
      if (!PIN) return res.status(400).json({ error: 'There\'s no admin PIN set up. Use the password instead.', noPin: true });
      if (!sameSecret(body.pin, PIN)) return res.status(401).json({ error: 'Incorrect PIN.' });
    } else {
      if (!SECRET) return res.status(400).json({ error: 'There\'s no admin password set up. Use the PIN instead.', noPassword: true });
      if (!sameSecret(body.password, SECRET)) return res.status(401).json({ error: 'Incorrect password.' });
    }
    startSession(req, res, false);
    res.json({ ok: true });
  });

  // What the admin page shows: the console (admin), the not-the-admin card
  // (arksId on, not an admin), or recovery straight away (no ARKS ID).
  router.get('/session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ways = { arksId: arksOn(), hasPin: !!PIN, hasPassword: !!SECRET };
    const s = sessionOf(req);
    if (isAdmin(req) && !(s && s.viaArks)) return res.json({ admin: true, signedIn: false, ...ways });
    if (await isArksAdmin(req)) {
      if (!s) startSession(req, res, true);
      return res.json({ admin: true, signedIn: true, ...ways });
    }
    if (s) { sessions.delete(sessionId(req)); setCookie(req, res, '', 0); }
    res.json({ admin: false, signedIn: false, ...ways });
  });

  router.post('/logout', (req, res) => {
    sessions.delete(sessionId(req));
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { isAdmin, requireAdmin, routes, useArksId };
