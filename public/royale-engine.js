'use strict';

// Roll Royale: the rules, as one small simulation that the page and the
// server both run. The page plays it live; the server replays it from the
// press and release times the page sends at the end, and the score the
// server gets is the only one that counts.
//
// A run is 9 balls. For each ball an aiming arrow sways left and right, and
// the moment you press locks it in. While you hold, the power meter climbs
// (and comes back down if you hold too long), and the moment you let go
// sets how far the ball goes. Where it lands on the target board decides
// the points.
//
// Everything is decided by the run's seed and those times (whole
// milliseconds since the run started), so the same seed and the same times
// always give the same result on any device. It only uses adding,
// multiplying and rounding down (no sine or cosine), which every browser
// and the server work out exactly the same way.
//
// Distances are in "lane units": the ball starts at y = 0, the middle of the
// rings is at y = 1, and x is how far left (negative) or right it is.
//
//   const s = RoyaleEngine.create(seed);
//   RoyaleEngine.aimAt(s, t)                 -> -1 (far left) .. 1 (far right)
//   RoyaleEngine.powerOf(holdMs)             -> 0 .. 1
//   RoyaleEngine.roll(s, press, release)     -> where the ball lands and its points
//   RoyaleEngine.replay(seed, balls)         the server's check (throws on impossible input)

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoyaleEngine = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const RULES = {
    BALLS: 9,
    LEAD_MS: 1500,        // "Ready" before the first ball can be rolled
    FLIGHT_MS: 950,       // from letting go to the ball dropping into the board
    NEXT_MS: 2200,        // from letting go to the next ball being ready
    MIN_HOLD_MS: 80,      // a press shorter than this isn't a roll (the page ignores it)
    MAX_HOLD_MS: 4000,    // hold this long and the ball rolls by itself
    POWER_MS: 1000,       // the meter takes this long to fill, then the same to empty
    D_MIN: 0.6,           // how far the softest roll goes...
    D_RANGE: 0.75,        // ...plus this much at full power (so 0.6 to 1.35)
    SPREAD: 0.22,         // how far sideways the arrow at full tilt sends the ball, per lane unit
    BOARD_Y: 1,           // the middle of the rings
    RINGS: [[0.035, 50], [0.075, 40], [0.115, 30], [0.155, 20], [0.2, 10]],   // radius, points
    CUP_Y: 1.24,          // the small jackpot cup above the rings
    CUP_R: 0.032,
    CUP_POINTS: 100,
    BONUS_FROM: 7,        // balls 7, 8 and 9 are bonus balls: the cup slides...
    BONUS_CUP_POINTS: 200,   // ...and is worth this much
    CUP_SWING: 0.12,      // how far the cup slides either way
    CUP_MS: 2600,         // and how long one trip there and back takes
    // How long the arrow takes to sway there and back: slower on the first
    // three balls, faster on the last three.
    AIM_MS: [2600, 2600, 2600, 2100, 2100, 2100, 1700, 1700, 1700],
    BACK_WALL_Y: 1.3
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

  // A triangle wave: 0 at u = 0, up to 1 at u = 0.5, back to 0 at u = 1.
  function tri(u) {
    const f = u - Math.floor(u);
    return f < 0.5 ? 2 * f : 2 - 2 * f;
  }

  function create(seed) {
    const rand = rng(seed);
    const aimPhase = [];
    for (let i = 0; i < RULES.BALLS; i++) aimPhase.push(rand());
    return {
      seed: seed >>> 0, aimPhase, cupPhase: rand(),
      ball: 0, readyAt: RULES.LEAD_MS, score: 0, jackpots: 0, bulls: 0,
      rings: [], landings: [], balls: [], over: false, endedAt: null
    };
  }

  const isBonus = ball => ball + 1 >= RULES.BONUS_FROM;
  // The aiming arrow for the current ball at time t, from -1 to 1.
  function aimAt(s, t) {
    const since = Math.max(0, t - s.readyAt);
    return 2 * tri(since / RULES.AIM_MS[s.ball] + s.aimPhase[s.ball]) - 1;
  }
  // The power meter after holding for holdMs, from 0 to 1 (and back down).
  const powerOf = holdMs => tri(Math.max(0, holdMs) / (2 * RULES.POWER_MS));
  // Where the jackpot cup is at time t on ball `ball` (it only slides on bonus balls).
  function cupXAt(s, ball, t) {
    if (!isBonus(ball)) return 0;
    return RULES.CUP_SWING * (2 * tri(t / RULES.CUP_MS + s.cupPhase) - 1);
  }
  const distanceOf = power => RULES.D_MIN + power * RULES.D_RANGE;

  // Where the current ball lands for a press and release, and what it scores.
  // It doesn't change anything (the page uses it to draw the ball's path).
  function landing(s, press, release) {
    const ball = s.ball;
    const aim = aimAt(s, press);
    const power = powerOf(release - press);
    const y = distanceOf(power);
    const x = aim * RULES.SPREAD * y;
    const landAt = release + RULES.FLIGHT_MS;
    const cupX = cupXAt(s, ball, landAt);
    let points = 0, kind;
    const cx = x - cupX, cy = y - RULES.CUP_Y;
    if (cx * cx + cy * cy <= RULES.CUP_R * RULES.CUP_R) {
      kind = 'cup';
      points = isBonus(ball) ? RULES.BONUS_CUP_POINTS : RULES.CUP_POINTS;
    } else {
      const dy = y - RULES.BOARD_Y, d2 = x * x + dy * dy;
      const ring = RULES.RINGS.find(([r]) => d2 <= r * r);
      if (ring) { kind = 'ring'; points = ring[1]; }
      else kind = y < RULES.BOARD_Y - RULES.RINGS[RULES.RINGS.length - 1][0] ? 'short' : y > RULES.BACK_WALL_Y ? 'wall' : 'miss';
    }
    return { ball, aim, power, x, y, landAt, cupX, kind, points, bonus: isBonus(ball) };
  }

  function fail(message) {
    return Object.assign(new Error(message), { status: 400 });
  }

  // One ball rolled: pressed at `press` (locking the aim) and let go at
  // `release` (setting the power). Throws if those times couldn't happen.
  function roll(s, press, release) {
    if (s.over) throw fail('That run already has all its balls.');
    if (!Number.isInteger(press) || !Number.isInteger(release) || press < 0) throw fail('The rolls did not come through right.');
    if (press < s.readyAt) throw fail('A ball was rolled before it was ready.');
    const hold = release - press;
    if (hold < RULES.MIN_HOLD_MS) throw fail('A ball was let go quicker than anyone can press and let go.');
    if (hold > RULES.MAX_HOLD_MS) throw fail('A ball was held longer than the meter lets you.');
    const r = landing(s, press, release);
    s.balls.push([press, release]);
    s.landings.push(r);
    s.rings.push(r.points);
    s.score += r.points;
    if (r.kind === 'cup') s.jackpots++;
    if (r.kind === 'ring' && r.points === RULES.RINGS[0][1]) s.bulls++;
    s.ball++;
    s.readyAt = release + RULES.NEXT_MS;
    if (s.ball >= RULES.BALLS) { s.over = true; s.endedAt = r.landAt; }
    return r;
  }

  // The server's replay. `balls` is what the page sent: one [press, release]
  // pair per ball. `maxMs` is how long the run has really been going by the
  // server's clock (plus a little slack).
  function replay(seed, balls, { maxMs = Infinity } = {}) {
    if (!Array.isArray(balls) || balls.length !== RULES.BALLS) throw fail(`A run is exactly ${RULES.BALLS} balls.`);
    const s = create(seed);
    for (const pair of balls) {
      if (!Array.isArray(pair) || pair.length !== 2) throw fail('The rolls did not come through right.');
      const [press, release] = pair;
      roll(s, press, release);
      if (release > maxMs) throw fail('Those rolls go on longer than the run did.');
    }
    return summary(s);
  }

  function summary(s) {
    return {
      score: s.score, rings: s.rings.slice(), jackpots: s.jackpots, bulls: s.bulls,
      balls: s.ball, endedAt: s.endedAt == null ? null : Math.round(s.endedAt)
    };
  }

  // The press and release (whole ms) that land the current ball closest to
  // the middle of the rings ('bull') or the jackpot cup ('cup'), pressing no
  // sooner than `earliest`. The tests use it, and so does the page's test
  // helper under the test suites.
  function plan(s, target = 'bull', earliest = s.readyAt) {
    const ty = target === 'cup' ? RULES.CUP_Y : RULES.BOARD_Y;
    const hold = Math.round((ty - RULES.D_MIN) / RULES.D_RANGE * RULES.POWER_MS);
    const from = Math.max(s.readyAt, Math.ceil(earliest));
    let best = null;
    for (let press = from; press < from + 2 * RULES.AIM_MS[s.ball]; press++) {
      const r = landing(s, press, press + hold);
      const tx = target === 'cup' ? r.cupX : 0;
      const d = (r.x - tx) * (r.x - tx) + (r.y - ty) * (r.y - ty);
      if (!best || d < best.d) best = { d, press };
    }
    return [best.press, best.press + hold];
  }

  // A whole run aimed at one target (the tests use it).
  function perfectBalls(seed, target = 'bull') {
    const s = create(seed);
    const balls = [];
    while (!s.over) {
      const [press, release] = plan(s, target);
      balls.push([press, release]);
      roll(s, press, release);
    }
    return balls;
  }

  return {
    RULES, create, tri, aimAt, powerOf, cupXAt, distanceOf, isBonus, landing, roll, replay, summary, plan, perfectBalls
  };
});
