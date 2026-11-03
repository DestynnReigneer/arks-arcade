'use strict';

// Tumbler Rumble: the rules, as one small simulation that the page and the
// server both run. The page plays it live; the server replays it from the
// list of tap times the page sends at the end, and the score the server gets
// is the only one that counts.
//
// A run is one long lock that never opens: the light keeps going round, every
// pop turns it around and lights a new pin, and the run goes on until the
// first miss. The score is how many pins you popped.
//
// Everything is decided by the run's seed and the tap times (whole
// milliseconds since the run started), so the same seed and the same taps
// always give the same result, on any device. Time is in milliseconds and
// angles are in degrees, 0 at the top and growing clockwise.
//
//   const s = TumblerEngine.create(seed);
//   TumblerEngine.tap(s, t)      -> { kind: 'pop' | 'miss' | 'ignored' | 'over', ... }
//   TumblerEngine.advance(s, t)  -> true once the marker has slipped past a pin
//   TumblerEngine.replay(seed, taps)  the server's check (throws on impossible input)

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TumblerEngine = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const RULES = {
    COUNT_MS: 1000,       // each number of the 3, 2, 1 countdown is up for this long...
    LEAD_MS: 3000,        // ...so the light starts turning ("Go!") 3 seconds into the run
    WAVE: 10,             // pins in a wave: it gets harder for 7, then eases off for 3
    CLIMB: 7,
    MIN_GAP_DEG: 75,      // a new pin is at least this far ahead of the marker...
    MAX_GAP_DEG: 300,     // ...and at most this far
    MIN_TAP_GAP_MS: 60,   // two taps closer than this are one tap (a double tap counts once)
    MAX_TAPS: 4000,
    // How hard a pin is, from 0 (the start) to 1 (as hard as it gets):
    SLOW_DEG_S: 130,      // the light's speed at 0, in degrees a second...
    FAST_DEG_S: 320,      // ...and at 1
    WIDE_DEG: 16,         // how far either side of a pin's middle still counts, at 0...
    NARROW_DEG: 9         // ...and at 1
  };

  // How hard the next pin is, from how many pins have been popped so far. It
  // comes in waves of 10: each wave gets harder for 7 pins, eases off a
  // little for the last 3, and starts the next wave a bit harder than the
  // last one started. After about 110 pins every wave peaks at the hardest
  // there is, and it still eases off and climbs back, wave after wave.
  const peakOf = wave => Math.min(1, 0.16 + 0.08 * wave);
  const lowOf = wave => (wave === 0 ? 0 : Math.max(0, peakOf(wave) - 0.2));
  function difficulty(pops) {
    const wave = Math.floor(pops / RULES.WAVE), k = pops % RULES.WAVE;
    const lo = lowOf(wave), hi = peakOf(wave), next = lowOf(wave + 1);
    if (k < RULES.CLIMB) return lo + (hi - lo) * (k / (RULES.CLIMB - 1));
    return hi + (next - hi) * ((k - RULES.CLIMB + 1) / (RULES.WAVE - RULES.CLIMB + 1));
  }
  const speedAt = d => (RULES.SLOW_DEG_S + (RULES.FAST_DEG_S - RULES.SLOW_DEG_S) * d) / 1000;   // degrees per ms
  const halfAt = d => RULES.WIDE_DEG - (RULES.WIDE_DEG - RULES.NARROW_DEG) * d;
  // Which wave a pin is in (1 for the first ten pins), and whether it's in the
  // part of the wave that eases off.
  const waveOf = pops => Math.floor(pops / RULES.WAVE) + 1;
  const easingAt = pops => pops % RULES.WAVE >= RULES.CLIMB;

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
      seed: seed >>> 0, rand: rng(seed), dir: 1,
      segStart: RULES.LEAD_MS, segAngle: 0, gap: 0, speed: 0, half: 0, hard: 0,
      pops: 0, streak: 0, bestStreak: 0, bullseyes: 0,
      lastTap: -Infinity, over: false, endedAt: null, endedBy: null, taps: []
    };
    placePin(s);
    return s;
  }

  // A new pin, somewhere ahead of the marker in the way it's going, with the
  // speed and width the wave says.
  function placePin(s) {
    s.hard = difficulty(s.pops);
    s.speed = speedAt(s.hard);
    s.half = halfAt(s.hard);
    s.gap = RULES.MIN_GAP_DEG + s.rand() * (RULES.MAX_GAP_DEG - RULES.MIN_GAP_DEG);
  }

  // Where things are at time t (for drawing).
  function markerAt(s, t) {
    const moved = t <= s.segStart ? 0 : s.speed * (Math.min(t, s.endedAt == null ? t : s.endedAt) - s.segStart);
    return norm(s.segAngle + s.dir * moved);
  }
  const pinAngle = s => norm(s.segAngle + s.dir * s.gap);
  // The moment the marker is dead center on the pin, and the moment it has
  // gone past the edge without a tap. A bullseye is the middle third.
  const centerAt = s => s.segStart + s.gap / s.speed;
  const windowMs = s => s.half / s.speed;
  const bullDeg = s => s.half / 3;
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
  // server; 'ignored' ones (a double tap, or a tap during the countdown) and
  // taps after the run is over are left out.
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
    const bullseye = Math.abs(off) <= bullDeg(s) / s.speed;
    s.streak = bullseye ? s.streak + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (bullseye) s.bullseyes++;
    s.pops++;
    const at = markerAt(s, t);
    // Every pin turns the marker around, and the next one lights up at once.
    s.dir = -s.dir;
    s.segAngle = at;
    s.segStart = t;
    const wasHard = s.hard;
    placePin(s);
    return {
      kind: 'pop', bullseye, streak: s.streak, pops: s.pops, off, at,
      wave: waveOf(s.pops), newWave: s.pops % RULES.WAVE === 0,
      easing: s.hard < wasHard
    };
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

  // score is the number of pins popped; wave is the wave the run ended in.
  function summary(s) {
    return {
      score: s.pops, pops: s.pops, wave: waveOf(s.pops),
      bullseyes: s.bullseyes, bestStreak: s.bestStreak, endedBy: s.endedBy, endedAt: Math.round(s.endedAt)
    };
  }

  // Perfect play: a tap dead center on each of the first `pops` pins (the
  // tests use it).
  function perfectTaps(seed, pops = 1) {
    const s = create(seed);
    const taps = [];
    while (s.pops < pops) {
      const t = Math.round(centerAt(s));
      taps.push(t);
      tap(s, t);
    }
    return taps;
  }

  return {
    RULES, difficulty, speedAt, halfAt, waveOf, easingAt, create, tap, advance, replay, summary, perfectTaps,
    markerAt, pinAngle, centerAt, windowMs, bullDeg, slipAt
  };
});
