'use strict';

// Who gets into the admin page (2026-11-11, the same in every ARKS app).
//
// - With ARKS ID on: someone signed in with an ARKS ID admin account is
//   straight in, with no PIN or password. The admin page asks
//   /api/admin/session, which hands them an admin cookie marked as coming from
//   ARKS ID (renewed each time the page opens). That cookie never counts on its
//   own: every check asks ARKS ID again, so signing out (here or there) or
//   losing the admin role ends it, and signing out of the arcade clears it.
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
const { sameOrigin } = require('../kit/security');

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
// Set by server.js: a short message to the admin (Discord) when recovery opens the admin page.
let notify = () => {};
function useNotify(fn) { notify = fn || (() => {}); }

// Wrong PINs, passwords and X-Admin-Token headers share one count, like the
// Hub's: 10 wrong from one address pauses that address for 15 minutes, and 30
// wrong from anywhere in an hour pauses everyone for 15 minutes. The overall
// cap is what stops someone who sends a made-up address with every guess.
const MAX_TRIES = 10, PAUSE_MS = 15 * 60 * 1000;
const GLOBAL_MAX = 30, GLOBAL_WINDOW_MS = 60 * 60 * 1000, GLOBAL_PAUSE_MS = 15 * 60 * 1000;
const failures = new Map();   // address -> { count, pausedUntil }
let recentWrong = [], everyoneUntil = 0;
function pausedFor(ip) {
  const now = Date.now();
  if (everyoneUntil > now) return Math.ceil((everyoneUntil - now) / 1000);
  const f = failures.get(ip);
  return f && f.pausedUntil > now ? Math.ceil((f.pausedUntil - now) / 1000) : 0;
}
function countWrong(ip) {
  const now = Date.now();
  recentWrong = recentWrong.filter(t => now - t < GLOBAL_WINDOW_MS);
  recentWrong.push(now);
  if (recentWrong.length >= GLOBAL_MAX) {
    recentWrong = [];
    everyoneUntil = now + GLOBAL_PAUSE_MS;
    notify('🔒 **The Arcade\'s admin page paused recovery for everyone** after 30 wrong PINs or passwords in an hour. It opens again in 15 minutes.');
  }
  const f = failures.get(ip) || { count: 0, pausedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_TRIES) { f.count = 0; f.pausedUntil = now + PAUSE_MS; }
  failures.set(ip, f);
}
const countRight = ip => failures.delete(ip);
function resetTries() { failures.clear(); recentWrong = []; everyoneUntil = 0; }
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

// Quick check, no waiting: the password header, or a recovery cookie. An
// ARKS ID admin's cookie never counts here; use isAdminNow() for them.
function isAdmin(req) {
  const header = req.get('X-Admin-Token');
  if (header) return !!SECRET && !pausedFor(req.ip) && sameSecret(header, SECRET);
  const s = sessionOf(req);
  return !!(s && !s.viaArks);
}

async function isArksAdmin(req) {
  if (!arksAdmin) return false;
  try { return !!(await arksAdmin(req)); } catch { return false; }
}

// The full check: isAdmin(), or someone ARKS ID says is an admin right now.
async function isAdminNow(req) {
  if (isAdmin(req)) return true;
  if (req.get('X-Admin-Token')) return false;
  return isArksAdmin(req);
}

// Admin routes: deny by default. Changes have to come from the arcade's own
// pages (kit/security.js sameOrigin), and a wrong X-Admin-Token is counted.
function requireAdmin(req, res, next) {
  sameOrigin(req, res, () => {
    const header = req.get('X-Admin-Token');
    if (header) {
      const wait = pausedFor(req.ip);
      if (wait) return res.status(429).set('Retry-After', String(wait)).json({ error: 'Too many tries, wait a few minutes, then try again.' });
      if (isAdmin(req)) return next();
      countWrong(req.ip);
      return res.status(401).json({ error: 'Admin sign-in needed.' });
    }
    const s = sessionOf(req);
    if (s && !s.viaArks) return next();
    // An ARKS ID admin's cookie, or no cookie at all: ask ARKS ID.
    isArksAdmin(req).then(ok => {
      if (ok) return next();
      if (s) sessions.delete(sessionId(req));
      res.status(401).json({ error: 'Admin sign-in needed.' });
    }, next);
  });
}

// Signing out of the arcade (arcade/arksid.js) or Exit: the admin cookie goes too.
function end(req, res) {
  sessions.delete(sessionId(req));
  setCookie(req, res, '', 0);
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
  // A light per-address limit on top of the shared count below, so a flood of
  // requests is turned away before any comparing happens.
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true,
    message: { error: 'Too many tries, wait a few minutes, then try again.' } });

  // Recovery: { pin } (ADMIN_PIN) or { password } (ADMIN_PASSWORD), counted together.
  router.post('/login', sameOrigin, loginLimiter, (req, res) => {
    const body = req.body || {};
    const usingPin = typeof body.pin === 'string';
    if (usingPin && !PIN) return res.status(400).json({ error: 'There\'s no admin PIN set up. Use the password instead.', noPin: true });
    if (!usingPin && !SECRET) return res.status(400).json({ error: 'There\'s no admin password set up. Use the PIN instead.', noPassword: true });
    const wait = pausedFor(req.ip);
    if (wait) return res.status(429).set('Retry-After', String(wait)).json({ error: 'Too many tries, wait a few minutes, then try again.', retryAfter: wait });
    if (!(usingPin ? sameSecret(body.pin, PIN) : sameSecret(body.password, SECRET))) {
      countWrong(req.ip);
      return res.status(401).json({ error: usingPin ? 'Incorrect PIN.' : 'Incorrect password.' });
    }
    countRight(req.ip);
    startSession(req, res, false);
    // Recovery is never used quietly.
    notify(`🔑 **The Arcade's admin page was opened with the recovery ${usingPin ? 'PIN' : 'password'}.** If that wasn't you, change ADMIN_PIN and ADMIN_PASSWORD and restart the arcade.`);
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
      // A fresh cookie each time the page opens, so it lasts 12 hours from the last visit.
      if (s) sessions.delete(sessionId(req));
      startSession(req, res, true);
      return res.json({ admin: true, signedIn: true, ...ways });
    }
    if (s) { sessions.delete(sessionId(req)); setCookie(req, res, '', 0); }
    res.json({ admin: false, signedIn: false, ...ways });
  });

  router.post('/logout', sameOrigin, (req, res) => {
    end(req, res);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { isAdmin, isAdminNow, requireAdmin, routes, useArksId, useNotify, end, resetTries };
