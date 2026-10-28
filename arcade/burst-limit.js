'use strict';

// The feedback limit (Destynn, 2026-10-27). Admins have none at all: they use
// the feedback card to log their own bugs while building. Anyone else can send
// 30 in 3 minutes, and the 31st starts a 3-minute wait. The same file is in
// every app that has the feedback card.

const MAX = 30;
const WINDOW_MS = 3 * 60 * 1000;
const WAIT_MS = 3 * 60 * 1000;

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

module.exports = { createBurstLimit, waitMessage, MAX, WINDOW_MS, WAIT_MS };
