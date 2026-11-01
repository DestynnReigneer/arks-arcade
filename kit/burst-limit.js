'use strict';

// The feedback limit (Destynn, 2026-10-27, and 2026-11-01 for guests).
// Admins have none at all: they use the feedback card to log their own bugs
// while building. Anyone signed in can send 30 in 3 minutes, and the 31st
// starts a 3-minute wait. Someone who isn't signed in gets 5 an hour.
//
// Part of the shared kit: every app has this exact file in kit/burst-limit.js.
// Each app decides who counts as an admin or as signed in, and which keys to
// count (a device, an address, a profile), and passes them in.
//
// createBurstLimit({ max, windowMs, waitMs }): at most `max` in any `windowMs`.
// Going over starts a fixed wait of `waitMs`. With waitMs: 0 there is no fixed
// wait, so it's a rolling window: the next one can go once the oldest is
// `windowMs` old.

const MAX = 30;
const WINDOW_MS = 3 * 60 * 1000;
const WAIT_MS = 3 * 60 * 1000;
const GUEST_MAX = 5;
const GUEST_WINDOW_MS = 60 * 60 * 1000;

function createBurstLimit({ now = Date.now, max = MAX, windowMs = WINDOW_MS, waitMs = WAIT_MS } = {}) {
  const seen = new Map();   // key -> { times: [...], until }
  function entry(key) {
    let e = seen.get(key);
    if (!e) { e = { times: [], until: 0 }; seen.set(key, e); }
    e.times = e.times.filter(t => now() - t < windowMs);
    return e;
  }
  return {
    // keys: who's sending (a device, an address). -> { ok } or { ok: false, waitSeconds }
    take(keys) {
      keys = [].concat(keys).filter(Boolean);
      const entries = keys.map(entry);
      const waiting = entries.find(e => e.until > now());
      if (waiting) return { ok: false, waitSeconds: Math.ceil((waiting.until - now()) / 1000) };
      const full = entries.find(e => e.times.length >= max);
      if (full && !waitMs) return { ok: false, waitSeconds: Math.max(1, Math.ceil((full.times[0] + windowMs - now()) / 1000)) };
      if (full) { full.until = now() + waitMs; return { ok: false, waitSeconds: Math.ceil(waitMs / 1000) }; }
      entries.forEach(e => e.times.push(now()));
      if (seen.size > 5000) for (const [k, e] of seen) if (!e.times.length && e.until <= now()) seen.delete(k);
      return { ok: true };
    }
  };
}

// "a minute" or "5 minutes", for the messages below. With hours: true, a
// wait of 60 minutes or more is "an hour".
function howLong(waitSeconds, { hours = false } = {}) {
  const m = Math.max(1, Math.ceil(waitSeconds / 60));
  return hours && m >= 60 ? 'an hour' : m === 1 ? 'a minute' : m + ' minutes';
}

// The message for someone who hit the limit.
function waitMessage(waitSeconds) {
  return `That's a lot of feedback in a short time. Try again in ${howLong(waitSeconds, { hours: true })}.`;
}

// The message for someone who isn't signed in and sent GUEST_MAX this hour.
// The app says what "signed in" means to its own people:
//   without: how the sentence starts, like "Without signing in"
//   instead: what lets them send more, like "sign in to send more"
function guestWaitMessage(waitSeconds, { without = 'Without signing in', instead = 'sign in to send more' } = {}) {
  return `${without}, one device can send ${GUEST_MAX} notes an hour, and this one has sent them all. ` +
    `Try again in ${howLong(waitSeconds)}, or ${instead}.`;
}

module.exports = { createBurstLimit, waitMessage, guestWaitMessage, MAX, WINDOW_MS, WAIT_MS, GUEST_MAX, GUEST_WINDOW_MS };
