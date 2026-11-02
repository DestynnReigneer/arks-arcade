'use strict';

// Disco Drop: the rules and the motion, shared word for word by the page and
// the server (discodrop/routes.js requires this same file).
//
// Everything that moves comes from the run's seed and the times of the drops
// made so far, and nothing else: no physics engine, no Math.random, and only
// whole numbers, so the browser and the server always get exactly the same
// answer. The page uses it to draw the cups and the ball; the server replays
// the drop times the page sent to decide where each ball landed and the score.
//
// Units: the stage is 1000 units wide. Times are whole milliseconds since the
// run started. Speeds are units per second.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscoDropEngine = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const W = 1000;              // stage width
  const DROPS = 10;            // balls in a run
  const FALL_MS = 650;         // from letting go to landing in a cup
  const RELOAD_MS = 350;       // a new ball hangs ready this long after the last one lands
  const MIN_GAP_MS = FALL_MS + RELOAD_MS;
  const BONUS_FROM = 8;        // drops 8, 9 and 10 score double
  const NEAR = 18;             // a ball this close to the jackpot cup's edge "just missed" it

  // The dropper (the arm holding the ball) stays in the middle for the first
  // three balls, then slides between these two points.
  const ARM_LEFT = 150, ARM_RIGHT = 850, ARM_SPAN = ARM_RIGHT - ARM_LEFT;
  const ARM_START = ARM_SPAN / 2;          // the middle

  // The cups. A narrower cup is harder to land in and worth more.
  const KINDS = {
    bust: { value: 0, width: 120, label: 'BUST' },
    c10: { value: 10, width: 200, label: '10' },
    c25: { value: 25, width: 170, label: '25' },
    c50: { value: 50, width: 140, label: '50' },
    c100: { value: 100, width: 110, label: '100' },
    jackpot: { value: 500, width: 80, label: 'JACKPOT' }
  };
  // One lap of the belt: twelve cups, the jackpot among them once.
  const BELT_CUPS = ['c10', 'c25', 'bust', 'c50', 'c10', 'c100', 'c25', 'bust', 'c10', 'c50', 'jackpot', 'c25'];
  const BELT = BELT_CUPS.reduce((n, k) => n + KINDS[k].width, 0);
  // After these drops land, the cups are shuffled into a new order.
  const SHUFFLE_AFTER = [2, 5, 7];
  const MAX_SCORE = (BONUS_FROM - 1) * KINDS.jackpot.value + (DROPS - BONUS_FROM + 1) * KINDS.jackpot.value * 2;

  // mulberry32: the same small seeded random numbers the arcade uses for
  // its daily boards. Stable on every browser and Node version.
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
  const mod = (a, n) => ((a % n) + n) % n;

  function shuffled(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function layoutOf(kinds) {
    let at = 0;
    return kinds.map(kind => {
      const cup = { kind, value: KINDS[kind].value, width: KINDS[kind].width, label: KINDS[kind].label, from: at };
      at += cup.width;
      return cup;
    });
  }

  // Everything about a run that the seed decides: for each of the ten balls,
  // how fast and which way the belt of cups runs, how fast the arm slides,
  // and the order of the cups. Ball k (0 to 9) is played in phase k.
  function plan(seed) {
    const rand = rng(seed);
    const belt0 = Math.floor(rand() * BELT);
    let dir = rand() < 0.5 ? 1 : -1;
    let kinds = shuffled(BELT_CUPS, rand);
    const phases = [];
    for (let k = 0; k < DROPS; k++) {
      if (k > 0 && SHUFFLE_AFTER.includes(k)) kinds = shuffled(kinds, rand);
      // From the fourth ball on, the belt sometimes turns around.
      if (k >= 3 && rand() < 0.35) dir = -dir;
      const speed = dir * (280 + 32 * k + Math.floor(rand() * 25));
      const armSpeed = k < 3 ? 0 : 110 + 35 * (k - 3) + Math.floor(rand() * 20);
      phases.push({
        k, speed, armSpeed, layout: layoutOf(kinds),
        shuffled: k > 0 && SHUFFLE_AFTER.includes(k),
        double: k + 1 >= BONUS_FROM
      });
    }
    return { seed: seed >>> 0, belt0, phases };
  }

  // Where the arm is, from its distance traveled (a back-and-forth path).
  function armX(p) {
    const q = mod(p, 2 * ARM_SPAN);
    return ARM_LEFT + (q <= ARM_SPAN ? q : 2 * ARM_SPAN - q);
  }

  // The cup under a spot on the belt.
  function cupAt(layout, c) {
    for (const cup of layout) if (c >= cup.from && c < cup.from + cup.width) return cup;
    return layout[layout.length - 1];
  }

  // How far a spot on the belt is from the jackpot cup (0 when inside it).
  function jackpotGap(layout, c) {
    const jp = layout.find(cup => cup.kind === 'jackpot');
    if (!jp) return Infinity;
    const lo = jp.from, hi = jp.from + jp.width;
    if (c >= lo && c < hi) return 0;
    return Math.min(mod(lo - c, BELT), mod(c - (hi - 1), BELT));
  }

  // Plays a run's drop times from the start, in order. Returns every ball's
  // result and the motion as it stands after the last one, so the page can
  // keep drawing from there. Throws { code } for a time that couldn't have
  // happened.
  function replay(seed, times, p = plan(seed)) {
    let start = 0, belt = p.belt0, arm = ARM_START;
    const results = [];
    let total = 0;
    for (let k = 0; k < times.length; k++) {
      const t = times[k];
      if (k >= DROPS) throw err('done', 'This run has used all its balls.');
      if (!Number.isInteger(t) || t < 0) throw err('bad', 'That drop time does not look right.');
      const ready = start + RELOAD_MS;
      if (t < ready) throw err('soon', 'That drop came before the ball was back on the arm.');
      const ph = p.phases[k];
      const x = armX(arm + Math.floor(ph.armSpeed * (t - start) / 1000));
      const land = t + FALL_MS;
      const b = mod(belt + Math.floor(ph.speed * (land - start) / 1000), BELT);
      const c = mod(x + b, BELT);
      const cup = cupAt(ph.layout, c);
      const points = cup.value * (ph.double ? 2 : 1);
      const gap = cup.kind === 'jackpot' ? 0 : jackpotGap(ph.layout, c);
      total += points;
      results.push({
        n: k + 1, t, x, land, kind: cup.kind, label: cup.label, value: cup.value, points,
        double: ph.double, jackpot: cup.kind === 'jackpot', near: cup.kind !== 'jackpot' && gap <= NEAR
      });
      arm = arm + Math.floor(ph.armSpeed * (land - start) / 1000);
      belt = b;
      start = land;
    }
    return { results, total, next: { k: times.length, start, belt, arm }, finished: times.length >= DROPS };
  }
  function err(code, message) { return Object.assign(new Error(message), { code }); }

  // The picture at time t, given where the motion stood at the start of the
  // current phase (replay().next). For drawing; scoring never uses it.
  function at(p, next, t) {
    const ph = p.phases[Math.min(next.k, DROPS - 1)];
    const dt = Math.max(0, t - next.start);
    return {
      phase: ph,
      belt: mod(next.belt + Math.floor(ph.speed * dt / 1000), BELT),
      armX: armX(next.arm + Math.floor(ph.armSpeed * dt / 1000)),
      ready: next.k < DROPS && t >= next.start + RELOAD_MS
    };
  }

  // Every window of drop times (from `after`, up to `within` ms later) that
  // would land in the jackpot, for the browser test's hook on the server.
  function jackpotWindows(seed, times, after, within = 30000, p = plan(seed)) {
    const { next } = replay(seed, times, p);
    const out = [];
    let open = null;
    const first = Math.max(after, next.start + RELOAD_MS);
    for (let t = first; t <= first + within; t++) {
      const hit = replay(seed, [...times, t], p).results[times.length].jackpot;
      if (hit && open === null) open = t;
      if (!hit && open !== null) { out.push([open, t - 1]); open = null; }
    }
    if (open !== null) out.push([open, first + within]);
    return out;
  }

  return {
    W, DROPS, FALL_MS, RELOAD_MS, MIN_GAP_MS, BONUS_FROM, NEAR, KINDS, BELT, BELT_CUPS, SHUFFLE_AFTER,
    ARM_LEFT, ARM_RIGHT, MAX_SCORE, plan, replay, at, armX, cupAt, jackpotWindows, rng
  };
}));
