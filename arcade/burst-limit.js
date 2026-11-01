'use strict';

// The feedback limit (Destynn, 2026-10-27). Admins have none at all: they use
// the feedback card to log their own bugs while building. Anyone with a
// profile can send 30 in 3 minutes, and the 31st starts a 3-minute wait. The
// same file is in every app that has the feedback card.
//
// Since 2026-11-01, people without a profile get 5 an hour per device (its
// address, since a guest has nothing else that can't be faked). That
// one is a rolling hour (waitMs: 0): the 6th waits until the oldest of the
// five is an hour old, rather than a fixed wait.

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
      keys = keys.filter(Boolean);
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

// The message for someone who hit the limit.
function waitMessage(waitSeconds) {
  const m = Math.max(1, Math.ceil(waitSeconds / 60));
  return `That's a lot of feedback in a few minutes. Try again in ${m === 1 ? 'a minute' : m + ' minutes'}.`;
}

// The message for someone without a profile who sent 5 this hour.
function guestWaitMessage(waitSeconds) {
  const m = Math.max(1, Math.ceil(waitSeconds / 60));
  return `Without a profile, one device can send ${GUEST_MAX} notes an hour, and you've sent them all. ` +
    `Try again in ${m === 1 ? 'a minute' : m + ' minutes'}, or pick your profile first, which lets you send more.`;
}

module.exports = { createBurstLimit, waitMessage, guestWaitMessage, MAX, WINDOW_MS, WAIT_MS, GUEST_MAX, GUEST_WINDOW_MS };
