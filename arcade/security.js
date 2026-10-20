'use strict';

// Small, dependency-free hardening shared by the whole arcade.

const crypto = require('node:crypto');

// Compares the admin password in constant time, so response timing can't be
// used to guess it a character at a time.
function sameSecret(supplied, expected) {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(supplied || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Browser-side protection on every response:
// - scripts may only come from this server (no injected outside scripts),
// - no other site can put the arcade in a hidden frame,
// - browsers don't guess file types or leak full URLs to other sites.
// Inline scripts/styles stay allowed: a few pages use them, and every page
// writes player text with textContent, not as HTML.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

function headers(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  next();
}

// Only believe X-Forwarded-For (the visitor's real address, for rate limits)
// when you've said the arcade sits behind a reverse proxy. Otherwise anyone
// could send that header and dodge every rate limit.
function trustProxySetting() {
  const v = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!v || v === '0' || v === 'false' || v === 'no') return false;
  if (v === 'true' || v === 'yes') return 1;
  return /^\d+$/.test(v) ? Number(v) : v;   // a hop count, or a subnet like "172.16.0.0/12"
}

module.exports = { sameSecret, headers, trustProxySetting };
