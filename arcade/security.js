'use strict';

// The arcade's security settings. The shared code (the constant-time
// compare and the headers) is kit/security.js, a copy of the shared kit that
// every app uses; this file only says what's the arcade's own.

const kit = require('../kit/security');

// Browser-side protection on every response:
// - scripts may only come from this server (no injected outside scripts),
// - no other site can put the arcade in a hidden frame,
// - browsers don't guess file types or leak full URLs to other sites.
// Inline scripts/styles stay allowed: a few pages use them, and every page
// writes player text with textContent, not as HTML.
const { headers, CSP } = kit.createHeaders({
  csp: [
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
  ],
  frameOptions: 'SAMEORIGIN',
  referrerPolicy: 'same-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=()'
});

// Only believe X-Forwarded-For (the visitor's real address, for rate limits)
// when you've said the arcade sits behind a reverse proxy. Otherwise anyone
// could send that header and dodge every rate limit. The arcade runs behind
// whatever proxy its owner has, so it also takes a hop count or true.
function trustProxySetting() {
  const v = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!v || v === '0' || v === 'false' || v === 'no') return false;
  if (v === 'true' || v === 'yes') return 1;
  return /^\d+$/.test(v) ? Number(v) : v;   // a hop count, or a subnet like "172.16.0.0/12"
}

// Every change (anything but GET and HEAD) has to come from the arcade's own
// pages, and one that carries a body has to send it as JSON. A browser always
// says which site a cross-site write came from (Origin), so another site can't
// act through a visitor's browser; and a plain HTML form can't send JSON, so a
// form posted from elsewhere is refused even by a browser that leaves Origin off.
// Requests with no Origin at all (ARKS ID's server, scripts, the tests) pass.
function writesFromHere(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  kit.sameOrigin(req, res, () => {
    const hasBody = Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding');
    if (hasBody && !req.is('application/json')) {
      return res.status(415).json({ error: 'Changes have to be sent as JSON.' });
    }
    next();
  });
}

module.exports = { sameSecret: kit.sameSecret, headers, CSP, trustProxySetting, writesFromHere };
