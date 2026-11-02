'use strict';

// Moonshot: the rules and the pitches, shared word for word by the page and
// the server (moonshot/routes.js requires this same file).
//
// Every pitch comes from the run's seed and nothing else: what kind it is,
// when it leaves the machine and how long it takes to reach the plate. There
// is no Math.random and only whole numbers, so the browser and the server
// always agree. The page uses this file to draw the pitches; the server
// replays the swing times the page sent to decide every hit and the score.
//
// Times are whole milliseconds since the run started. A swing's timing is how
// far it was from the moment the ball crossed the plate: negative is early,
// positive is late.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoonshotEngine = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const PITCHES = 12;          // pitches in a run
  const PER_LEVEL = 4;         // pitches 1-4 are level 1, 5-8 level 2, 9-12 level 3
  const READY_MS = 1800;       // before the first windup starts
  const LATE_MS = 220;         // a swing this long after the ball crossed the plate still counts (late)
  const AFTER_MS = 1600;       // after a pitch is done, before the next windup starts
  const NEAR_MS = 15;          // a hit this close to the home-run window "just missed" it

  // How far from perfect a swing can be (either way) for each result. Closer
  // is better; anything further out is a swing and a miss.
  const BANDS = [[25, 'homer'], [50, 'triple'], [80, 'double'], [120, 'single'], [160, 'grounder'], [210, 'foul']];
  const HOMER_MS = BANDS[0][0];
  const KINDS = {
    homer: { points: 100, label: 'Home run', short: 'HR' },
    triple: { points: 60, label: 'Triple', short: '3B' },
    double: { points: 40, label: 'Double', short: '2B' },
    single: { points: 25, label: 'Single', short: '1B' },
    grounder: { points: 5, label: 'Grounder', short: 'GO' },
    foul: { points: 2, label: 'Foul ball', short: 'F' },
    whiff: { points: 0, label: 'Swing and a miss', short: 'K' },
    taken: { points: 0, label: 'Strike', short: 'K' }
  };
  // Each home run in a row after the first adds this many points, up to STREAK_CAP times.
  const STREAK_BONUS = 50, STREAK_CAP = 4;

  // The three pitches. Travel is how long the ball takes from the machine to
  // the plate at each level, before a little seeded wobble (±60 ms).
  const TYPES = {
    fastball: { label: 'Fastball', travel: [1250, 1020, 840] },
    changeup: { label: 'Changeup', travel: [1700, 1450, 1250] },
    curve: { label: 'Curveball', travel: [1500, 1280, 1100] }
  };
  // How likely each pitch is at each level, out of 100: fastball, changeup, curve.
  const MIX = [[55, 30, 15], [40, 30, 30], [34, 30, 36]];
  const WINDUP = [[900, 500], [750, 500], [600, 500]];   // shortest, plus up to this much more

  const levelOf = k => 1 + Math.floor(k / PER_LEVEL);

  // The most a perfect run can score: twelve home runs in a row.
  const MAX_SCORE = (() => {
    let n = 0;
    for (let k = 0; k < PITCHES; k++) n += (KINDS.homer.points + STREAK_BONUS * Math.min(k, STREAK_CAP)) * levelOf(k);
    return n;
  })();

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

  // Everything the seed decides: for each pitch, its kind, when the windup
  // starts, when the ball leaves the machine (release), when it crosses the
  // plate, and when its chance to swing closes. The schedule doesn't depend
  // on the swings, so the run always takes the same time.
  function plan(seed) {
    const rand = rng(seed);
    const pitches = [];
    let start = READY_MS;
    for (let k = 0; k < PITCHES; k++) {
      const level = levelOf(k);
      // Four numbers per pitch, always, so one pitch never shifts the next.
      const rType = rand(), rWind = rand(), rTravel = rand(), rBend = rand();
      const mix = MIX[level - 1];
      const roll = Math.floor(rType * 100);
      const type = k === 0 ? 'fastball' : roll < mix[0] ? 'fastball' : roll < mix[0] + mix[1] ? 'changeup' : 'curve';
      const [w0, wSpan] = WINDUP[level - 1];
      const release = start + w0 + Math.floor(rWind * wSpan);
      const travel = TYPES[type].travel[level - 1] + Math.floor(rTravel * 121) - 60;
      const plate = release + travel;
      const close = plate + LATE_MS;
      pitches.push({
        k, n: k + 1, level, type, label: TYPES[type].label, start, release, travel, plate, close,
        // A curve bends out to one side and back over the plate.
        bend: type === 'curve' ? (rBend < 0.5 ? -1 : 1) : 0,
        // A speed for the sign on the stage. Arcade miles per hour, not science.
        mph: 30 + Math.floor(72000 / travel)
      });
      start = close + AFTER_MS;
    }
    return { seed: seed >>> 0, pitches, end: pitches[PITCHES - 1].close };
  }

  // What a swing `offset` ms from perfect does.
  function kindOf(offset) {
    const off = Math.abs(offset);
    for (const [ms, kind] of BANDS) if (off <= ms) return kind;
    return 'whiff';
  }

  // Plays a run's swing times from the start, in order. Each swing belongs to
  // the pitch it was made during (from the release to LATE_MS after the
  // plate); a pitch with no swing is a strike. Pitches whose chance to swing
  // hasn't closed by `through` (and that have no swing) aren't counted yet.
  // Throws { code } for a swing that couldn't have happened.
  function replay(seed, times, through = Infinity, p = plan(seed)) {
    const results = [];
    let i = 0, streak = 0, total = 0, homers = 0, bestStreak = 0;
    for (const ph of p.pitches) {
      const t = times[i];
      let swing = null;
      if (t !== undefined) {
        if (!Number.isInteger(t) || t < 0) throw err('bad', 'That swing time does not look right.');
        if (t < ph.release) throw err('between', 'That swing came between pitches, when there was no ball to hit.');
        if (t <= ph.close) { swing = t; i++; }
      } else if (ph.close > through) break;
      const offset = swing === null ? null : swing - ph.plate;
      const kind = swing === null ? 'taken' : kindOf(offset);
      const homer = kind === 'homer';
      streak = homer ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
      const bonus = homer ? STREAK_BONUS * Math.min(streak - 1, STREAK_CAP) : 0;
      const points = (KINDS[kind].points + bonus) * ph.level;
      total += points;
      if (homer) homers++;
      // "So close" is only ever said for a real near miss: a hit that came
      // within NEAR_MS of the home-run window.
      const missedBy = swing === null || homer ? null : Math.abs(offset) - HOMER_MS;
      results.push({
        n: ph.n, type: ph.type, level: ph.level, swing, offset, kind, label: KINDS[kind].label,
        points, bonus: bonus * ph.level, streak, homer,
        early: offset !== null && offset < 0,
        near: missedBy !== null && missedBy <= NEAR_MS, missedBy
      });
    }
    if (i < times.length) {
      const t = times[i];
      if (!Number.isInteger(t) || t < 0) throw err('bad', 'That swing time does not look right.');
      throw err('done', 'That swing came after the last pitch of the run.');
    }
    return { results, total, homers, bestStreak, finished: results.length === PITCHES };
  }
  function err(code, message) { return Object.assign(new Error(message), { code }); }

  // Which pitch is in play at time t, and what it's doing. For drawing; the
  // score never uses it.
  //   phase: 'ready' (before the first windup), 'windup', 'flight' (ball on
  //   its way), 'past' (crossed the plate, a swing still counts), 'after'
  //   (between pitches) or 'done'.
  function at(p, t) {
    for (const ph of p.pitches) {
      if (t < ph.start) return { k: ph.k, pitch: ph, phase: ph.k === 0 ? 'ready' : 'after' };
      if (t < ph.release) return { k: ph.k, pitch: ph, phase: 'windup' };
      if (t < ph.plate) return { k: ph.k, pitch: ph, phase: 'flight' };
      if (t <= ph.close) return { k: ph.k, pitch: ph, phase: 'past' };
    }
    return { k: PITCHES, pitch: p.pitches[PITCHES - 1], phase: 'done' };
  }

  return {
    PITCHES, PER_LEVEL, READY_MS, LATE_MS, AFTER_MS, NEAR_MS, BANDS, HOMER_MS, KINDS, TYPES,
    STREAK_BONUS, STREAK_CAP, MAX_SCORE, levelOf, plan, kindOf, replay, at, rng
  };
}));
