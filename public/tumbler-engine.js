'use strict';

// Tumbler Rumble: the rules, as one small simulation that the page and the
// server both run. The page plays it live; the server replays it from the
// list of tap times the page sends at the end, and the score the server gets
// is the only one that counts.
//
// Everything is decided by the run's seed and the tap times (whole
// milliseconds since the run started), so the same seed and the same taps
// always give the same result, on any device. Time is in milliseconds and
// angles are in degrees, 0 at the top and growing clockwise.
//
//   const s = TumblerEngine.create(seed);
//   TumblerEngine.tap(s, t)      -> { kind: 'pop' | 'miss' | 'ignored' | 'over', ... }
//   TumblerEngine.advance(s, t)  -> true once the marker has slipped past a target
//   TumblerEngine.replay(seed, taps)  the server's check (throws on impossible input)

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TumblerEngine = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const RULES = {
    LEAD_MS: 2200,        // "Ready... go!" before the first lock starts turning
    BREAK_MS: 1800,       // the pause after a lock pops open, before the next one
    HALF_DEG: 12,         // how far either side of a pin's middle still counts as a hit
    BULL_DEG: 4,          // this close to the middle is a bullseye
    MIN_GAP_DEG: 75,      // a new pin is at least this far ahead of the marker...
    MAX_GAP_DEG: 300,     // ...and at most this far
    MIN_TAP_GAP_MS: 60,   // two taps closer than this are one tap (a double tap counts once)
    MAX_TAPS: 4000
  };

  // Level 1 turns at 140 degrees a second, a bit faster every level, topping
  // out at 400 (more than a full turn a second) from level 20.
  const speedOf = level => Math.min(140 + 14 * (level - 1), 400) / 1000;   // degrees per ms
  // Pins to pop to open each lock: 3 on the first, one more every level, at most 20.
  const pinsFor = level => Math.min(level + 2, 20);

  // Points, in one place so How to play and the tests can quote them.
  const POINTS = {
    pin: level => 10 * level,                            // every pin popped
    bullseye: (level, streak) => 10 * level * Math.min(streak, 5),   // on top, for a bullseye
    lock: level => 50 * level                            // opening the lock
  };

  // The small seeded random numbers the arcade uses elsewhere (mulberry32).
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const norm = deg => ((deg % 360) + 360) % 360;

  function create(seed) {
    const s = {
      seed: seed >>> 0, rand: rng(seed),
      level: 1, pinsLeft: pinsFor(1), dir: 1,
      segStart: RULES.LEAD_MS, segAngle: 0, gap: 0, speed: speedOf(1),
      score: 0, pins: 0, locks: 0, streak: 0, bestStreak: 0, bullseyes: 0,
      lastTap: -Infinity, over: false, endedAt: null, endedBy: null, taps: []
    };
    placePin(s);
    return s;
  }

  // A new pin, somewhere ahead of the marker in the way it's going.
  function placePin(s) {
    s.gap = RULES.MIN_GAP_DEG + s.rand() * (RULES.MAX_GAP_DEG - RULES.MIN_GAP_DEG);
  }

  // Where things are at time t (for drawing).
  function markerAt(s, t) {
    const moved = t <= s.segStart ? 0 : s.speed * (Math.min(t, s.endedAt == null ? t : s.endedAt) - s.segStart);
    return norm(s.segAngle + s.dir * moved);
  }
  const pinAngle = s => norm(s.segAngle + s.dir * s.gap);
  // The moment the marker is dead center on the pin, and the moment it has
  // gone past the edge without a tap.
  const centerAt = s => s.segStart + s.gap / s.speed;
  const windowMs = s => RULES.HALF_DEG / s.speed;
  const slipAt = s => centerAt(s) + windowMs(s);

  function end(s, t, why) {
    s.over = true;
    s.endedAt = t;
    s.endedBy = why;
    s.streak = 0;
  }

  // Time moving on: has the marker slipped past the pin?
  function advance(s, t) {
    if (!s.over && t > slipAt(s)) end(s, slipAt(s), 'slip');
    return s.over;
  }

  // A tap at time t. Only a 'pop' or a 'miss' is a tap the page sends to the
  // server; 'ignored' ones (a double tap, or a tap while no lock is turning)
  // and taps after the run is over are left out.
  function tap(s, t) {
    if (advance(s, t)) return { kind: 'over' };
    if (t < s.segStart || t - s.lastTap < RULES.MIN_TAP_GAP_MS) return { kind: 'ignored' };
    s.lastTap = t;
    s.taps.push(t);
    const off = t - centerAt(s);
    if (Math.abs(off) > windowMs(s)) {
      end(s, t, 'miss');
      return { kind: 'miss', off };
    }
    const level = s.level;
    const bullseye = Math.abs(off) <= RULES.BULL_DEG / s.speed;
    s.streak = bullseye ? s.streak + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (bullseye) s.bullseyes++;
    let points = POINTS.pin(level) + (bullseye ? POINTS.bullseye(level, s.streak) : 0);
    s.pins++;
    s.pinsLeft--;
    const at = markerAt(s, t);
    let opened = false;
    if (s.pinsLeft === 0) {
      // The lock pops open. The next one starts after a short break, with the
      // marker back at the top going clockwise.
      opened = true;
      points += POINTS.lock(level);
      s.locks++;
      s.level++;
      s.pinsLeft = pinsFor(s.level);
      s.speed = speedOf(s.level);
      s.dir = 1;
      s.segAngle = 0;
      s.segStart = t + RULES.BREAK_MS;
    } else {
      // Every pin turns the marker around.
      s.dir = -s.dir;
      s.segAngle = at;
      s.segStart = t;
    }
    placePin(s);
    s.score += points;
    return { kind: 'pop', bullseye, streak: s.streak, points, opened, level, off, at };
  }

  function fail(message) {
    return Object.assign(new Error(message), { status: 400 });
  }

  // The server's replay. `taps` is what the page sent; `maxMs` is how long the
  // run has really been going by the server's clock (plus a little slack).
  // Anything a real player couldn't have sent is refused rather than scored.
  function replay(seed, taps, { maxMs = Infinity } = {}) {
    if (!Array.isArray(taps)) throw fail('The taps did not come through right.');
    if (taps.length > RULES.MAX_TAPS) throw fail('That is more taps than a run can have.');
    const s = create(seed);
    let prev = -Infinity;
    for (const t of taps) {
      if (!Number.isInteger(t) || t < 0) throw fail('The taps did not come through right.');
      if (t < prev + RULES.MIN_TAP_GAP_MS) throw fail('Those taps are closer together than anyone can tap.');
      if (t > maxMs) throw fail('Those taps go on longer than the run did.');
      prev = t;
      const r = tap(s, t);
      // The page only sends pops and misses, and nothing after the run ends.
      if (r.kind !== 'pop' && r.kind !== 'miss') throw fail('Those taps don\'t match a run that could have happened.');
    }
    // No final miss means the marker slipped past the pin it was heading for.
    if (!s.over) advance(s, Infinity);
    if (s.endedAt > maxMs) throw fail('That run ended later than it really did.');
    return summary(s);
  }

  function summary(s) {
    return {
      score: s.score, level: s.level, locks: s.locks, pins: s.pins,
      bullseyes: s.bullseyes, bestStreak: s.bestStreak, endedBy: s.endedBy, endedAt: Math.round(s.endedAt)
    };
  }

  // Perfect play: a tap dead center on every pin, for the first `locks` locks
  // (the tests use it).
  function perfectTaps(seed, locks = 1) {
    const s = create(seed);
    const taps = [];
    while (s.locks < locks) {
      const t = Math.round(centerAt(s));
      taps.push(t);
      tap(s, t);
    }
    return taps;
  }

  return {
    RULES, POINTS, speedOf, pinsFor, create, tap, advance, replay, summary, perfectTaps,
    markerAt, pinAngle, centerAt, windowMs, slipAt
  };
});
