'use strict';

// One PIN in front of every adult option in the arcade. ADULT_PIN in .env sets
// it at install; after that the admin page can change or remove it, and the
// admin's choice wins. Unset everywhere means a confirmation tap is all that
// guards adult content -- fine on a LAN, not once the server is reachable.

const db = require('../db');

const KEY = 'adult_pin';
const PIN_RE = /^[0-9]{6}$/;

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

// null in the settings table means "never changed from the admin page".
function current() {
  const saved = db.getSetting(KEY, null);
  if (saved !== null && saved !== undefined) return String(saved);
  return String(process.env.ADULT_PIN || '');
}

function status() {
  const saved = db.getSetting(KEY, null);
  const source = saved !== null && saved !== undefined ? 'admin' : process.env.ADULT_PIN ? 'env' : 'none';
  return { set: !!current(), source };
}

// An empty pin removes the lock (and overrides any ADULT_PIN in .env).
function set(pin) {
  const value = String(pin == null ? '' : pin).trim();
  if (value && !PIN_RE.test(value)) throw fail('The PIN must be 6 digits.', 400);
  db.setSetting(KEY, value);
  return status();
}

function matches(supplied) {
  const pin = current();
  return !pin || String(supplied || '') === pin;
}

// The PIN pads take exactly 6 digits, so an old .env PIN of another length
// could never be typed in. Say so at startup instead of failing silently.
if (process.env.ADULT_PIN && !PIN_RE.test(String(process.env.ADULT_PIN).trim())) {
  console.warn('ADULT_PIN in .env must be 6 digits, or the PIN pads cannot enter it. Change it in .env or on the admin page.');
}

module.exports = { current, status, set, matches };
