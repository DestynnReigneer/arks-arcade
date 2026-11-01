'use strict';

// Small, dependency-free hardening every ARKS app shares.
//
// Part of the shared kit: every app has this exact file in kit/security.js.
// What differs between apps (the Content Security Policy, whether a page may
// be framed, which browser features are allowed, how the reverse proxy is
// described) is passed in by the app's own security.js.

const crypto = require('node:crypto');
const net = require('node:net');

// Compares a secret (a password, a PIN, an app secret) in constant time, so
// response timing can't be used to guess it a character at a time.
function sameSecret(supplied, expected) {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(supplied || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

const NO_FEATURES = 'camera=(), microphone=(), geolocation=(), payment=()';

// The headers on every response. The app passes its own policy:
//   csp:               a list of CSP directives (or one string)
//   frameOptions:      'DENY' (no site may frame it) or 'SAMEORIGIN'
//   referrerPolicy:    'no-referrer' or 'same-origin'
//   permissionsPolicy: which browser features pages may ask for
// -> { headers, CSP }: headers is the Express middleware, CSP the policy text.
function createHeaders({ csp, frameOptions = 'DENY', referrerPolicy = 'no-referrer', permissionsPolicy = NO_FEATURES } = {}) {
  if (!csp) throw new Error('createHeaders needs the app\'s Content Security Policy (csp).');
  const CSP = Array.isArray(csp) ? csp.join('; ') : String(csp);
  const values = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': frameOptions,
    'Referrer-Policy': referrerPolicy,
    'Permissions-Policy': permissionsPolicy,
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
  function headers(req, res, next) {
    res.set(values);
    next();
  }
  return { headers, CSP };
}

// Changes must come from the app's own pages. Browsers send Origin on
// cross-site writes; a mismatch means another site is trying to act through
// someone's browser.
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('Origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* bad Origin */ }
    if (host !== req.get('Host')) return res.status(403).json({ error: 'This request came from another site, so it was refused.' });
  }
  next();
}

// Only believe X-Forwarded-For when it comes from the reverse proxy. The
// setting is the proxy's own address (or a subnet), never "1" or "true": if
// the app's port can also be reached directly, trusting any hop would let a
// device that skips the proxy claim a new address on every guess, and wrong
// guesses are counted per address. Blank means no proxy.
function trustProxySetting(v = process.env.TRUST_PROXY) {
  const s = String(v || '').trim();
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : false;
}

// -> an error message to stop the server with, or null when the setting is
// blank or a comma-separated list of addresses and CIDR subnets.
// example: how the app describes the right value in that message.
function trustProxyProblem(v = process.env.TRUST_PROXY, { example = "your reverse proxy's address" } = {}) {
  const list = trustProxySetting(v);
  if (!list) return null;
  for (const item of list) {
    const [addr, bits, extra] = item.split('/');
    const kind = net.isIP(addr);
    const okBits = bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= (kind === 6 ? 128 : 32));
    if (!kind || !okBits || extra !== undefined) {
      return `TRUST_PROXY must be ${example}, a subnet, or blank, not "${item}".`;
    }
  }
  return null;
}

module.exports = { sameSecret, createHeaders, sameOrigin, trustProxySetting, trustProxyProblem };
