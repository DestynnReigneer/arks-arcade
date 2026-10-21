'use strict';

// Brick Breaker's rules and physics, separate from the drawing so the tests
// can play it. The world is 360 x 540 units; the page scales it to fit.
//
// The ball moves in small steps (never more than a third of its size at a
// time), so even a fast ball can't slip through a brick between frames.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BricksEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 360, H = 540;
  const COLS = 12, BRICK_H = 15, TOP = 64, SIDE = 6, GAP = 2;
  const BRICK_W = (W - SIDE * 2) / COLS;
  const PADDLE_Y = H - 40, PADDLE_H = 12, PADDLE_W = 64;
  const BALL_R = 5;
  const CEILING = 30;      // the top wall, under the bar showing the level
  // The side walls are SIDE thick; the bottom is open.

  // Each level is rows of 12: '.' empty, 1-3 hits, '#' can't be broken,
  // '*' always drops a power-up. Levels loop, a little faster each time.
  const LEVELS = [
    { name: 'Warm-up', rows: ['............', '111111111111', '111111111111', '111111111111', '111111111111', '1111**111111'] },
    { name: 'Pyramid', rows: ['.....22.....', '....2112....', '...211112...', '..21111112..', '.2111**1112.', '211111111112'] },
    { name: 'Checkers', rows: ['2.2.2.2.2.2.', '.1.1.1.1.1.1', '2.2.2*2.2.2.', '.1.1.1.1.1.1', '2.2.2.2.2.2.', '.1*1.1.1.1*1'] },
    { name: 'Space visitors', rows: ['..1......1..', '...1....1...', '..22222222..', '.22.2222.22.', '222222222222', '2.22*22*22.2', '2.2......2.2', '...22..22...'] },
    { name: 'Gatekeeper', rows: ['############', '1111111111..', '#.........##', '..1111111111', '##.........#', '1111**111111', '3333333333..'] },
    { name: 'Heart', rows: ['..222..222..', '.22222222222', '.22222*22222', '..222222222.', '...2222222..', '....22222...', '.....222....', '......2.....'] },
    { name: 'Diamond', rows: ['.....33.....', '....3223....', '...321123...', '..321**123..', '...321123...', '....3223....', '.....33.....'] },
    { name: 'Fortress', rows: ['3.3.3..3.3.3', '333333333333', '3##2222##..3', '3..2**2..##3', '3##2222##..3', '333333333333', '111111111111'] }
  ];

  const POWERS = {
    wide: { label: 'Wide paddle', emoji: '↔', color: '#2e9bff', weight: 5 },
    multi: { label: 'Three balls', emoji: '⁂', color: '#c86bff', weight: 4 },
    slow: { label: 'Slow ball', emoji: '🐢', color: '#3ddc84', weight: 4 },
    fire: { label: 'Fireball', emoji: '🔥', color: '#ff7a2c', weight: 3 },
    life: { label: 'Extra life', emoji: '♥', color: '#ff4f7a', weight: 1 }
  };
  const EFFECT_SECONDS = { wide: 15, slow: 10, fire: 8 };

  function fail(message) { return Object.assign(new Error(message), { status: 400 }); }

  function bricksFor(levelIndex) {
    const def = LEVELS[levelIndex % LEVELS.length];
    const out = [];
    def.rows.forEach((row, r) => {
      if (row.length !== COLS) throw fail(`Level ${def.name} row ${r} is ${row.length} wide`);
      [...row].forEach((ch, c) => {
        if (ch === '.') return;
        const hits = ch === '#' ? Infinity : ch === '*' ? 1 : Number(ch);
        out.push({
          x: SIDE + c * BRICK_W + GAP / 2, y: TOP + r * (BRICK_H + GAP), w: BRICK_W - GAP, h: BRICK_H,
          row: r, col: c, hits, max: hits, steel: ch === '#', power: ch === '*'
        });
      });
    });
    return out;
  }

  function baseSpeed(g) {
    const lap = Math.floor(g.level / LEVELS.length);
    return Math.min(470, 255 + (g.level % LEVELS.length) * 10 + lap * 35);
  }

  function create({ rand = Math.random, level = 0 } = {}) {
    const g = {
      W, H, rand, level, lives: 3, score: 0, phase: 'serve',
      paddle: { x: W / 2, w: PADDLE_W, y: PADDLE_Y, h: PADDLE_H },
      balls: [], bricks: [], drops: [],
      effects: { wide: 0, slow: 0, fire: 0 },
      hitsThisLevel: 0, events: [], time: 0, cleared: 0
    };
    loadLevel(g, level);
    return g;
  }

  function loadLevel(g, level) {
    g.level = level;
    g.bricks = bricksFor(level);
    g.drops = [];
    g.effects = { wide: 0, slow: 0, fire: 0 };
    g.hitsThisLevel = 0;
    serve(g);
  }

  function serve(g) {
    g.phase = 'serve';
    g.paddle.w = PADDLE_W;
    g.balls = [{ x: g.paddle.x, y: g.paddle.y - g.paddle.h / 2 - BALL_R - 1, vx: 0, vy: 0, r: BALL_R, stuck: true }];
  }

  const breakable = g => g.bricks.filter(b => !b.steel).length;
  const levelName = level => LEVELS[level % LEVELS.length].name;

  function launch(g) {
    if (g.phase !== 'serve') return false;
    const s = baseSpeed(g);
    const angle = (g.rand() * 0.6 - 0.3);
    for (const b of g.balls) { b.stuck = false; b.vx = Math.sin(angle) * s; b.vy = -Math.cos(angle) * s; }
    g.phase = 'play';
    g.events.push('launch');
    return true;
  }

  function pickPower(g) {
    const list = Object.entries(POWERS);
    const total = list.reduce((a, [, p]) => a + p.weight, 0);
    let n = g.rand() * total;
    for (const [id, p] of list) { if ((n -= p.weight) < 0) return id; }
    return 'wide';
  }

  function hitBrick(g, brick, ball) {
    if (brick.steel) { g.events.push('steel'); return; }
    brick.hits--;
    g.hitsThisLevel++;
    g.events.push(brick.hits > 0 ? 'crack' : 'break');
    if (brick.hits > 0) { g.score += 5; return; }
    g.score += 10 * brick.max;
    g.bricks.splice(g.bricks.indexOf(brick), 1);
    g.lastBroken = { x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, row: brick.row, max: brick.max, power: brick.power };
    if (brick.power || g.rand() < 0.07) {
      g.drops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, type: pickPower(g), vy: 110 });
    }
    void ball;
  }

  function applyPower(g, type) {
    g.events.push('power:' + type);
    g.score += 25;
    if (type === 'life') { g.lives = Math.min(6, g.lives + 1); return; }
    if (type === 'multi') {
      const extra = [];
      for (const b of g.balls.slice(0, 4)) {
        const s = Math.hypot(b.vx, b.vy) || baseSpeed(g);
        for (const turn of [-0.45, 0.45]) {
          const a = Math.atan2(b.vx, -b.vy) + turn;
          extra.push({ ...b, stuck: false, vx: Math.sin(a) * s, vy: -Math.abs(Math.cos(a) * s) });
        }
      }
      if (g.phase === 'serve') launch(g);
      g.balls.push(...extra);
      return;
    }
    g.effects[type] = EFFECT_SECONDS[type];
  }

  // Bounce off the paddle at an angle that depends on where it hit: the
  // middle sends it straight up, the ends send it off at up to 62 degrees.
  function paddleBounce(g, ball) {
    const p = g.paddle;
    const off = Math.max(-1, Math.min(1, (ball.x - p.x) / (p.w / 2)));
    const a = off * 1.08;
    const s = Math.min(baseSpeed(g) * 1.35, Math.hypot(ball.vx, ball.vy) * 1.012);
    ball.vx = Math.sin(a) * s;
    ball.vy = -Math.cos(a) * s;
    ball.y = p.y - p.h / 2 - ball.r - 0.01;
    g.events.push('paddle');
  }

  function circleRect(ball, r) {
    const cx = Math.max(r.x, Math.min(ball.x, r.x + r.w));
    const cy = Math.max(r.y, Math.min(ball.y, r.y + r.h));
    const dx = ball.x - cx, dy = ball.y - cy;
    return dx * dx + dy * dy <= ball.r * ball.r;
  }

  function moveBall(g, ball, dt) {
    const slow = g.effects.slow > 0 ? 0.72 : 1;
    const dist = Math.hypot(ball.vx, ball.vy) * dt * slow;
    const steps = Math.max(1, Math.ceil(dist / (ball.r / 3)));
    const h = dt * slow / steps;
    for (let i = 0; i < steps; i++) {
      // Use the current speed every step: a bounce partway through counts at once.
      ball.x += ball.vx * h; ball.y += ball.vy * h;
      if (ball.x < SIDE + ball.r) { ball.x = SIDE + ball.r; ball.vx = Math.abs(ball.vx); g.events.push('wall'); }
      if (ball.x > W - SIDE - ball.r) { ball.x = W - SIDE - ball.r; ball.vx = -Math.abs(ball.vx); g.events.push('wall'); }
      if (ball.y < ball.r + CEILING) { ball.y = ball.r + CEILING; ball.vy = Math.abs(ball.vy); g.events.push('wall'); }
      const p = g.paddle;
      if (ball.vy > 0 && circleRect(ball, { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h })) paddleBounce(g, ball);
      if (ball.y > H + ball.r) { ball.lost = true; return; }
      for (const brick of g.bricks) {
        if (!circleRect(ball, brick)) continue;
        const fire = g.effects.fire > 0 && !brick.steel;
        hitBrick(g, brick, ball);
        if (!fire) {
          // Bounce off whichever side it came through.
          const bx = brick.x + brick.w / 2, by = brick.y + brick.h / 2;
          const ox = (ball.x - bx) / (brick.w / 2 + ball.r), oy = (ball.y - by) / (brick.h / 2 + ball.r);
          if (Math.abs(ox) > Math.abs(oy)) { ball.vx = Math.sign(ox || 1) * Math.abs(ball.vx); ball.x = bx + Math.sign(ox || 1) * (brick.w / 2 + ball.r + 0.01); }
          else { ball.vy = Math.sign(oy || 1) * Math.abs(ball.vy); ball.y = by + Math.sign(oy || 1) * (brick.h / 2 + ball.r + 0.01); }
          // Never let it get stuck going nearly sideways.
          const s = Math.hypot(ball.vx, ball.vy);
          if (Math.abs(ball.vy) < s * 0.25) { ball.vy = Math.sign(ball.vy || 1) * s * 0.25; ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(s * s - ball.vy * ball.vy); }
        }
        break;
      }
    }
  }

  // input: { x } to put the paddle's middle at x, or { move: -1 | 0 | 1 }
  // for keys; { launch: true } serves.
  function step(g, dt, input = {}) {
    g.events = [];
    if (g.phase === 'over' || g.phase === 'cleared') return g;
    g.time += dt;
    for (const k of Object.keys(g.effects)) g.effects[k] = Math.max(0, g.effects[k] - dt);
    const p = g.paddle;
    const targetW = g.effects.wide > 0 ? PADDLE_W * 1.55 : PADDLE_W;
    p.w += (targetW - p.w) * Math.min(1, dt * 8);
    if (typeof input.x === 'number') p.x = input.x;
    else if (input.move) p.x += input.move * 420 * dt;
    p.x = Math.max(SIDE + p.w / 2, Math.min(W - SIDE - p.w / 2, p.x));

    if (g.phase === 'serve') {
      for (const b of g.balls) { b.x = p.x; b.y = p.y - p.h / 2 - b.r - 1; }
      if (input.launch) launch(g);
      return g;
    }

    for (const ball of g.balls) moveBall(g, ball, dt);
    g.balls = g.balls.filter(b => !b.lost);

    for (const d of g.drops) {
      d.y += d.vy * dt;
      if (d.y > p.y - p.h && d.y < p.y + p.h && Math.abs(d.x - p.x) < p.w / 2 + 8) { d.caught = true; applyPower(g, d.type); }
      if (d.y > H + 20) d.gone = true;
    }
    g.drops = g.drops.filter(d => !d.caught && !d.gone);

    if (!breakable(g)) {
      const bonus = 500 + g.lives * 100;
      g.score += bonus;
      g.cleared++;
      g.phase = 'cleared';
      g.events.push('cleared');
      g.lastBonus = bonus;
      return g;
    }
    if (!g.balls.length) {
      g.lives--;
      g.events.push('lost');
      if (g.lives <= 0) { g.phase = 'over'; g.events.push('over'); }
      else { g.drops = []; g.effects = { wide: 0, slow: 0, fire: 0 }; serve(g); }
    }
    return g;
  }

  function nextLevel(g) {
    if (g.phase !== 'cleared') return false;
    loadLevel(g, g.level + 1);
    return true;
  }

  return { W, H, SIDE, CEILING, COLS, LEVELS, POWERS, BALL_R, create, step, launch, nextLevel, levelName, breakable, bricksFor, applyPower, baseSpeed };
});
