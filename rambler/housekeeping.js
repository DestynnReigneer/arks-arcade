'use strict';

// Rambler's housekeeping, once a minute: end the season when its end has
// passed (and open the next one), then re-apply the dictionary overlay (the
// admin's word edits and the season's theme pack) if anything in it changed.
//
// This used to run inside /healthz on every call, which the container
// healthcheck hits every 30 seconds, and it forced a 200ms dictionary rebuild
// each time. Now /healthz only looks, and this timer does the work.
//
// Seasons end at a local midnight. Anything that reads or writes the boards
// (rambler/routes.js) still checks first, so a score posted a moment after
// midnight lands on the new board; this timer is for a quiet arcade, so the
// season still rolls over within a minute when nobody is playing.

const seasons = require('./seasons');
const packs = require('./packs');

const EVERY_MS = 60 * 1000;
// The test suite slows it right down, so its check that /healthz no longer
// rolls a season over can't be beaten to it by this timer.
const everyMs = () => (process.env.NODE_ENV === 'test' && Number(process.env.HOUSEKEEPING_MS)) || EVERY_MS;
let timer = null;

// One round of housekeeping. Returns what the season rollover did (null when
// nothing was due), which the tests use.
function tick() {
  let rolled = null;
  try { rolled = seasons.checkDue(); } catch (e) { console.error('season rollover failed:', e.message); }
  try { packs.refresh(); } catch (e) { console.error('theme pack refresh failed:', e.message); }
  return rolled;
}

function start({ every = everyMs() } = {}) {
  stop();
  timer = setInterval(tick, every);
  // Never hold the process open just for this.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { tick, start, stop, EVERY_MS };
