'use strict';

// What unlocks adult levels: an adult's ARKS ID sign-in, nothing else
// (the maintainer's call, 2026-11-11).
//
// With ARKS ID sign-in on (arcade/arksid.js), a signed-in adult's page gets
// a short-lived adult pass, signed by the server so it can't be guessed, and
// that pass goes wherever an adult check is made (the X-Adult-Pin header or a
// `pin` field, names kept from when it was a typed PIN). Kids', teens' and
// guests' pages never get one.
//
// Without ARKS ID there is no way to unlock adult levels, so they stay off.
// The typed 6-digit PIN (ADULT_PIN, or set on the admin page) is gone: it could
// be guessed, and a role from a real sign-in is a better answer to "is this a
// adult?". An old ADULT_PIN in .env is ignored, with a note at startup.

const rateLimit = require('express-rate-limit');

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

let passCheck = null;
function usePasses(check) { passCheck = check; }

// The test suite runs most games without ARKS ID, so it gets a fixed pass of
// its own: only when NODE_ENV is test and TEST_ADULT_PASS is set, never in a
// real install.
const testPass = () => (process.env.NODE_ENV === 'test' && process.env.TEST_ADULT_PASS) || '';

// `set` stays true so the games show their unlock screen (which says to sign in
// with ARKS ID, or that adult levels need it); `arksId` says which.
function status() {
  return { set: true, source: passCheck ? 'arksid' : 'off', arksId: !!passCheck };
}

function set() {
  throw fail('Adult levels unlock with an adult\'s ARKS ID sign-in, so there is no adult PIN to set.', 400);
}

function matches(supplied) {
  const s = String(supplied || '');
  if (passCheck) return passCheck(s);
  return !!testPass() && s === testPass();
}

if (process.env.ADULT_PIN) {
  console.warn('ADULT_PIN in .env is no longer used: adult levels unlock with an adult\'s ARKS ID sign-in. You can remove it.');
}

// Every place that checks an adult pass from a request body shares one limiter:
// 20 wrong ones in 10 minutes from one address, then a wait. Right ones don't
// count. The routes say whether a check was right through res.locals.pinOk.
const tries = new rateLimit.MemoryStore();
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  store: tries,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.locals.pinOk === true,
  message: { error: 'Too many tries, wait a few minutes, then try again.' }
});
const tryLimiter = () => limiter;
const resetTries = () => tries.resetAll();

function check(req, res) {
  const ok = matches((req.body || {}).pin);
  res.locals.pinOk = ok;
  return { ok };
}

module.exports = { status, set, matches, tryLimiter, resetTries, check, usePasses };
