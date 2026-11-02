'use strict';

// Roll Royale: the page. It plays the run live with the same simulation the
// server uses (royale-engine.js), draws the lane and the target board at the
// screen's frame rate, and takes a press and hold on the lane or the ROLL
// button, Space or Enter held down, and a game controller's A button or right
// trigger. When the 9 balls are done it sends only when each ball was
// pressed and let go; the server replays them and its score is the one
// shown and saved (royale/routes.js).

(() => {
  const { $, toast, api } = ArcadeKit;
  const E = RoyaleEngine;
  const R = E.RULES;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const token = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const fmt = n => Number(n || 0).toLocaleString('en-US');

  // idle -> starting -> playing (<-> paused -> resuming) -> finishing -> over
  let mode = 'idle';
  let run = null;          // what /start said: runId, seed
  let sim = null;          // the live simulation
  let t0 = 0;              // performance.now() when the run's clock started
  let pausedTotal = 0, pausedAt = 0, resumeAt = 0;
  let pausedForHelp = false;
  let overSince = 0;
  let result = null;       // the server's verdict
  let pressAt = null;      // game time the current ball was pressed (the aim is locked)
  let holdSource = null;   // what's holding it: 'pointer', 'key' or 'pad'
  let landed = 0;          // how many balls have dropped into the board so far
  let tipUntil = 0;        // a short "hold it down" tip after a too-quick tap
  const effects = [];      // points and messages drawn on the board

  const now = () => performance.now();
  function gameTime() {
    if (mode === 'paused' || mode === 'resuming') return pausedAt - t0 - pausedTotal;
    return now() - t0 - pausedTotal;
  }

  // ---- the canvas ------------------------------------------------------------------------
  const canvas = $('lane');
  const ctx = canvas.getContext('2d');
  let W = 300, H = 360;
  const C = {};
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(200, Math.round($('stage').clientWidth));
    H = Math.max(240, Math.round($('stage').clientHeight));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(C, {
      accent: css('--accent', '#2effb4'), gold: css('--gold', '#ffd23f'), miss: css('--miss', '#ff5e5e'),
      text: css('--text', '#f5eaff'), dim: css('--dim', '#9483ae'),
      rings: [css('--ring50', '#ff3df2'), css('--ring40', '#ffd23f'), css('--ring30', '#3ddc84'), css('--ring20', '#2de2e6'), css('--ring10', '#3d8bff')]
    });
  }
  new ResizeObserver(resize).observe($('stage'));
  resize();

  // Lane units to the screen. The view is from behind and above the lane: the
  // target board takes the top half, tilted away (so its rings are flatter
  // than they are wide), and the lane narrows toward you at the bottom.
  const BOARD_NEAR = 0.76, BOARD_FAR = 1.33, HOP_Y = 0.55;
  function geometry() {
    const sx = Math.min(W * 1.45, H * 1.2);         // pixels per lane unit across, at the rings
    const v = sx * 0.6;                              // and up the board (tilted, so less)
    const farY = H * 0.12;                           // y = BOARD_FAR on the screen
    const nearY = farY + (BOARD_FAR - BOARD_NEAR) * v;
    const bottom = H * 0.95;
    return { sx, v, farY, nearY, bottom };
  }
  let G = geometry();
  function P(x, y) {
    const sy = y >= BOARD_NEAR ? G.farY + (BOARD_FAR - y) * G.v
      : G.nearY + (BOARD_NEAR - y) / BOARD_NEAR * (G.bottom - G.nearY);
    const scale = G.sx * (1 + 0.35 * Math.max(0, 1 - y));
    return [W / 2 + x * scale, sy, scale];
  }
  // A ring on the board: a circle in lane units, drawn as the shape it makes on screen.
  function ringPath(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI * 2;
      const [x, y] = P(cx + r * Math.cos(a), cy + r * Math.sin(a));
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  const glow = (color, blur) => { if (!reduced) { ctx.shadowColor = color; ctx.shadowBlur = blur; } };
  const ease = k => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

  // Where a rolled ball is at time t: up the lane, a hop off the lip, and down
  // into the board where the rules say it lands.
  function ballAt(l, release, t) {
    const k = Math.min(1, Math.max(0, (t - release) / R.FLIGHT_MS));
    const ramp = 0.42;
    let y, lift = 0;
    if (k < ramp) y = HOP_Y * (k / ramp);
    else {
      const q = (k - ramp) / (1 - ramp);
      y = HOP_Y + (l.y - HOP_Y) * q;
      lift = 4 * q * (1 - q) * (0.05 + 0.1 * (l.y - HOP_Y));
    }
    return { x: l.aim * R.SPREAD * y, y, lift, k };
  }

  function draw() {
    G = geometry();
    const t = sim ? gameTime() : 0;
    ctx.clearRect(0, 0, W, H);

    // Scanlines, for the cabinet glass.
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    const ball = sim ? Math.min(sim.ball, R.BALLS - 1) : 0;
    const flying = sim && sim.ball > landed;               // the last ball rolled hasn't landed yet
    const bonus = sim ? E.isBonus(flying ? sim.ball - 1 : ball) : false;

    // The lane: narrow at your end, opening up into the board.
    const laneW = y => 0.07 + 0.23 * (y / BOARD_NEAR);
    ctx.save();
    ctx.beginPath();
    let [x, y] = P(-laneW(0), 0); ctx.moveTo(x, y);
    [x, y] = P(-laneW(BOARD_NEAR), BOARD_NEAR); ctx.lineTo(x, y);
    [x, y] = P(laneW(BOARD_NEAR), BOARD_NEAR); ctx.lineTo(x, y);
    [x, y] = P(laneW(0), 0); ctx.lineTo(x, y);
    ctx.closePath();
    const lg = ctx.createLinearGradient(0, G.bottom, 0, G.nearY);
    lg.addColorStop(0, '#1d0d33');
    lg.addColorStop(1, '#2c1048');
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    glow(C.accent, 12);
    ctx.stroke();
    ctx.restore();
    // Rows of little lights down the lane, and the lip the ball hops off.
    for (let i = 1; i < 8; i++) {
      const yy = i * HOP_Y / 8;
      for (const side of [-1, 1]) {
        const [px, py] = P(side * (laneW(yy) - 0.02), yy);
        const lit = !reduced && sim && Math.floor(now() / 140 + i) % 8 === 0;
        ctx.fillStyle = lit ? C.gold : 'rgba(46,255,180,0.35)';
        ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 4, 4);
      }
    }
    {
      const [ax, ay] = P(-laneW(HOP_Y), HOP_Y), [bx, by] = P(laneW(HOP_Y), HOP_Y);
      ctx.save();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 3;
      glow(C.gold, 10);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
    }

    // The target board.
    ctx.save();
    ctx.beginPath();
    [x, y] = P(-0.31, BOARD_NEAR); ctx.moveTo(x, y);
    [x, y] = P(-0.31, BOARD_FAR); ctx.lineTo(x, y);
    [x, y] = P(0.31, BOARD_FAR); ctx.lineTo(x, y);
    [x, y] = P(0.31, BOARD_NEAR); ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = '#120722';
    ctx.fill();
    ctx.strokeStyle = bonus ? C.gold : C.accent;
    ctx.lineWidth = 2;
    glow(ctx.strokeStyle, 14);
    ctx.stroke();
    ctx.restore();

    // The rings, biggest first, each a neon band with its points on it.
    const rings = R.RINGS;
    for (let i = rings.length - 1; i >= 0; i--) {
      const [r, pts] = rings[i];
      ctx.save();
      ringPath(0, R.BOARD_Y, r);
      ctx.fillStyle = i % 2 ? '#1b0b30' : '#240f3c';
      ctx.fill();
      ctx.strokeStyle = C.rings[i];
      ctx.lineWidth = 2.5;
      glow(C.rings[i], 10);
      ctx.stroke();
      ctx.restore();
      const inner = i ? rings[i - 1][0] : 0;
      // The points sit on the band, out to the side where the rings are widest
      // (left and right in turn, so they have room).
      const [lx, ly] = P(i ? (i % 2 ? -1 : 1) * (r + inner) / 2 : 0, R.BOARD_Y);
      ctx.save();
      ctx.fillStyle = C.rings[i];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.max(9, Math.round(G.sx * 0.03))}px Orbitron, system-ui, sans-serif`;
      ctx.fillText(String(pts), lx, ly);
      ctx.restore();
    }

    // The jackpot cup. On the bonus balls it slides from side to side.
    const cupBall = flying ? sim.ball - 1 : ball;
    const cupX = sim ? E.cupXAt(sim, cupBall, t) : 0;
    ctx.save();
    ringPath(cupX, R.CUP_Y, R.CUP_R);
    ctx.fillStyle = '#05010c';
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    glow(C.gold, 16);
    ctx.stroke();
    const [kx, ky] = P(cupX + R.CUP_R + 0.05, R.CUP_Y);
    ctx.fillStyle = C.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.max(10, Math.round(G.sx * 0.034))}px Orbitron, system-ui, sans-serif`;
    ctx.fillText(E.isBonus(cupBall) ? '200' : '100', kx, ky);
    ctx.restore();

    // Where the last ball landed stays marked until the next one is rolled.
    if (sim && landed && !flying) {
      const l = sim.landings[landed - 1];
      const [px, py, sc] = P(l.x, l.y);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = l.points ? C.text : C.miss;
      ctx.beginPath();
      ctx.ellipse(px, py, sc * 0.014, sc * 0.009, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // The aiming arrow: it sways until you press, then stays put. The dashed
    // line is the ball's real path across the board.
    const ready = sim && !sim.over && !flying && t >= sim.readyAt;
    if (!sim || ready) {
      const aim = sim ? E.aimAt(sim, pressAt != null ? pressAt : t) : 0;
      const end = 1.32;
      const [x0, y0] = P(0, 0.03), [x1, y1] = P(aim * R.SPREAD * end, end);
      ctx.save();
      ctx.strokeStyle = pressAt != null ? C.gold : C.text;
      ctx.globalAlpha = sim ? 0.9 : 0.4;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 7]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.setLineDash([]);
      // The arrowhead near your end.
      const [hx, hy] = P(aim * R.SPREAD * 0.4, 0.4);
      const ang = Math.atan2(hy - y0, hx - x0);
      ctx.fillStyle = ctx.strokeStyle;
      glow(ctx.strokeStyle, 10);
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(ang) * 14, hy + Math.sin(ang) * 14);
      ctx.lineTo(hx + Math.cos(ang + 2.5) * 12, hy + Math.sin(ang + 2.5) * 12);
      ctx.lineTo(hx + Math.cos(ang - 2.5) * 12, hy + Math.sin(ang - 2.5) * 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // The ball: waiting at your end, or rolling up the lane and into the board.
    let bx = 0, by = 0.03, lift = 0, gone = false;
    if (flying) {
      const i = sim.ball - 1;
      const b = ballAt(sim.landings[i], sim.balls[i][1], t);
      ({ x: bx, y: by, lift } = b);
      gone = b.k >= 1;
    } else if (sim && (sim.over || t < sim.readyAt - 600)) gone = true;
    if (!gone) {
      const [px, py, sc] = P(bx, by);
      const rad = Math.max(5, sc * 0.022 * (by > BOARD_NEAR ? 0.85 : 1));
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(px, py + rad * 0.5, rad, rad * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      const cy = py - lift * G.v * 1.6;
      const grad = ctx.createRadialGradient(px - rad * 0.35, cy - rad * 0.4, rad * 0.1, px, cy, rad);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#c9fff0');
      grad.addColorStop(1, '#0e8a64');
      ctx.fillStyle = grad;
      glow(C.accent, 14);
      ctx.beginPath();
      ctx.arc(px, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // The power meter on the right. The pink band sends the ball to the
    // middle ring and the gold band to the jackpot cup's row.
    {
      const mx = W - 24, top = G.nearY + 6, bot = G.bottom - 4, mw = 14, h = bot - top;
      const pTo = d => (d - R.D_MIN) / R.D_RANGE;
      const band = (d0, d1, color) => {
        const a = bot - h * pTo(d1), b = bot - h * pTo(d0);
        ctx.fillStyle = color;
        ctx.fillRect(mx - 3, a, mw + 6, b - a);
      };
      ctx.save();
      ctx.fillStyle = '#0b0518';
      ctx.fillRect(mx, top, mw, h);
      ctx.globalAlpha = 0.55;
      band(R.BOARD_Y - R.RINGS[0][0], R.BOARD_Y + R.RINGS[0][0], C.rings[0]);
      band(R.CUP_Y - R.CUP_R, R.CUP_Y + R.CUP_R, C.gold);
      ctx.globalAlpha = 1;
      const p = pressAt != null ? E.powerOf(t - pressAt) : flying ? sim.landings[sim.ball - 1].power : 0;
      const fh = h * p;
      const fg = ctx.createLinearGradient(0, bot, 0, top);
      fg.addColorStop(0, '#3d8bff');
      fg.addColorStop(0.55, C.accent);
      fg.addColorStop(1, C.gold);
      ctx.fillStyle = fg;
      glow(C.accent, 10);
      ctx.fillRect(mx + 2, bot - fh, mw - 4, fh);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = C.dim;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mx, top, mw, h);
      ctx.fillStyle = C.dim;
      ctx.font = '700 9px Orbitron, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('POWER', W - 4, H - 3);
      ctx.restore();
    }

    // The 9 balls along the top: what each one scored, and which is next.
    {
      const n = R.BALLS, gap = Math.min(30, (W - 24) / n), y0 = H * 0.055, x0 = W / 2 - gap * (n - 1) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const cx = x0 + i * gap, done = sim && i < landed, current = sim && !sim.over && i === sim.ball && !flying;
        const pts = done ? sim.rings[i] : null;
        ctx.beginPath();
        ctx.arc(cx, y0, gap * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = done ? (pts ? '#2c1048' : '#1a0d24') : '#0e0619';
        ctx.fill();
        ctx.lineWidth = current ? 2.5 : 1.2;
        ctx.strokeStyle = current ? C.text : E.isBonus(i) ? C.gold : 'rgba(46,255,180,0.5)';
        ctx.stroke();
        ctx.fillStyle = done ? (pts >= 100 ? C.gold : pts ? C.text : C.miss) : C.dim;
        ctx.font = `800 ${Math.round(gap * (pts >= 100 ? 0.3 : 0.36))}px Orbitron, system-ui, sans-serif`;
        ctx.fillText(done ? String(pts) : E.isBonus(i) ? '★' : String(i + 1), cx, y0 + 1);
      }
      ctx.restore();
    }

    // Big words in the middle of the lane: ready, bonus ball, hold it.
    if (sim && !sim.over) {
      let big = '', small = '';
      if (t < R.LEAD_MS) { big = 'READY'; small = 'BALL 1 OF 9'; }
      else if (!flying && t < sim.readyAt) {
        big = E.isBonus(sim.ball) ? 'BONUS BALL' : `BALL ${sim.ball + 1}`;
        small = E.isBonus(sim.ball) ? 'THE CUP IS WORTH 200' : `OF ${R.BALLS}`;
      } else if (now() < tipUntil) { big = 'HOLD IT'; small = 'PRESS, HOLD, LET GO'; }
      if (big) {
        const [, my] = P(0, HOP_Y * 0.5);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = big.startsWith('BONUS') ? C.gold : C.text;
        glow(C.accent, 14);
        ctx.font = `900 ${Math.round(Math.min(W * 0.075, 30))}px Orbitron, system-ui, sans-serif`;
        ctx.fillText(big, W / 2, my - 10);
        ctx.shadowBlur = 0;
        ctx.fillStyle = C.dim;
        ctx.font = `700 ${Math.round(Math.min(W * 0.034, 13))}px Orbitron, system-ui, sans-serif`;
        ctx.fillText(small, W / 2, my + 16);
        ctx.restore();
      }
    } else if (!sim) {
      const [, my] = P(0, HOP_Y * 0.5);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = C.dim;
      ctx.font = `700 ${Math.round(Math.min(W * 0.034, 13))}px Orbitron, system-ui, sans-serif`;
      ctx.fillText('PRESS TO PLAY', W / 2, my);
      ctx.restore();
    }

    // Points popping up where a ball landed.
    const real = now();
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      const k = (real - f.born) / f.ms;
      if (k >= 1) { effects.splice(i, 1); continue; }
      const [px, py] = P(f.x, f.y);
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      if (!reduced) {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(px, py, 8 + ease(k) * 40, 5 + ease(k) * 24, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = f.color;
      ctx.textAlign = 'center';
      glow(f.color, 12);
      ctx.font = `900 ${f.size}px Orbitron, system-ui, sans-serif`;
      ctx.fillText(f.text, Math.min(W - 50, Math.max(50, px)), Math.max(40, py - 18 - (reduced ? 0 : ease(k) * 20)));
      ctx.restore();
    }
  }

  // ---- the loop -----------------------------------------------------------------------------
  let shown = {};
  function hud() {
    const v = sim
      ? { ball: Math.min(sim.ball + 1, R.BALLS), score: 0, last: landed ? sim.rings[landed - 1] : 0, jackpots: 0 }
      : { ball: 1, score: 0, last: 0, jackpots: 0 };
    if (sim) for (let i = 0; i < landed; i++) { v.score += sim.rings[i]; if (sim.landings[i].kind === 'cup') v.jackpots++; }
    if (result) v.score = result.score;
    for (const [id, key] of [['hudBall', 'ball'], ['hudScore', 'score'], ['hudLast', 'last'], ['hudJackpots', 'jackpots']]) {
      if (shown[key] !== v[key]) { shown[key] = v[key]; $(id).textContent = fmt(v[key]); }
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    pollPads();
    if (mode === 'resuming') {
      const left = resumeAt - now();
      if (left <= 0) {
        pausedTotal += resumeAt - pausedAt;
        mode = 'playing';
        msg(null);
      } else msg(String(Math.ceil(left / 1000)), 'Get ready…');
    }
    if (mode === 'playing') {
      const t = gameTime();
      // Hold too long and the ball rolls by itself.
      if (pressAt != null && t - pressAt >= R.MAX_HOLD_MS) letGo(pressAt + R.MAX_HOLD_MS);
      while (landed < sim.ball && t >= sim.landings[landed].landAt) landedBall(sim.landings[landed++]);
      if (sim.over && landed >= R.BALLS && t >= sim.endedAt + 700) gameOver();
    }
    Blip.musicPlaying(mode === 'playing' || mode === 'resuming');
    hud();
    draw();
  }

  function msg(title, text = '') {
    if (title === null) { $('msg').classList.add('hidden'); return; }
    $('msgTitle').textContent = title;
    $('msgText').textContent = text;
    $('msg').classList.remove('hidden');
  }
  const say = text => { $('say').textContent = text; };

  // ---- playing ------------------------------------------------------------------------------
  async function begin() {
    if (mode === 'starting') return;
    mode = 'starting';
    msg('Get ready', 'Setting up the lane…');
    try {
      run = await api('/api/royale/start', { profileToken: token() });
    } catch (e) {
      mode = 'idle';
      msg('Press to play', e.message);
      return;
    }
    sim = E.create(run.seed);
    t0 = now();
    pausedTotal = 0;
    result = null;
    pressAt = null;
    holdSource = null;
    landed = 0;
    effects.length = 0;
    shown = {};
    mode = 'playing';
    msg(null);
    $('over').classList.add('hidden');
    document.body.dataset.state = 'playing';
    say('Ball 1 of 9. Press when the arrow points where you want, hold, and let go to roll.');
    if (window.ArcadeStats) ArcadeStats.play();
    Blip.tone(660, 0.08, { type: 'square', volume: 0.05 });
    // Only the test suites get this (the server says so): when to press and
    // how long to hold to land a ball where you want, so a browser test can
    // roll a real ball.
    if (run.testHook) {
      window.RoyaleTest = {
        msToReady: () => (sim && !sim.over ? sim.readyAt - gameTime() : null),
        plan: (target = 'bull') => {
          const [press, release] = E.plan(sim, target, Math.ceil(gameTime()) + 120);
          return { pressIn: press - gameTime(), pressAt: press, holdMs: release - press };
        },
        gameTime: () => gameTime(),
        state: () => ({ mode, ball: sim.ball, landed, holding: pressAt != null, rings: sim.rings.slice(0, landed) })
      };
    }
  }

  // A press: on the lane, the ROLL button, Space or Enter, or a controller.
  function down(source) {
    Blip.unlock();
    if (mode === 'idle') { begin(); return; }
    if (mode === 'paused') { resume(); return; }
    if (mode !== 'playing' || pressAt != null) return;
    const t = Math.round(gameTime());
    if (sim.over || sim.ball > landed || t < sim.readyAt) return;   // the next ball isn't ready yet
    pressAt = t;
    holdSource = source;
    Blip.tone(520, 0.05, { type: 'square', volume: 0.04 });
    if (source === 'pointer') $('rollBtn').classList.add('down');
  }

  // Letting go: the ball rolls with the power the meter shows right now.
  function up(source) {
    $('rollBtn').classList.remove('down');
    if (pressAt == null || source !== holdSource || mode !== 'playing') return;
    const t = Math.round(gameTime());
    if (t - pressAt < R.MIN_HOLD_MS) {
      // A quick tap isn't a roll: the ball needs some power.
      pressAt = null;
      holdSource = null;
      tipUntil = now() + 1600;
      return;
    }
    // If the screen fell behind (a busy phone, a tab in the background), the
    // ball still rolls the moment the meter ran out, as it would have.
    letGo(Math.min(t, pressAt + R.MAX_HOLD_MS));
  }

  function letGo(t) {
    let r;
    try { r = E.roll(sim, pressAt, t); } catch { pressAt = null; return; }
    pressAt = null;
    holdSource = null;
    $('rollBtn').classList.remove('down');
    Blip.noise(0.35, 0.05);
    Blip.tone(180 + r.power * 300, 0.25, { type: 'triangle', volume: 0.05 });
  }

  // A ball drops into the board: show what it scored, and celebrate the big ones.
  function landedBall(l) {
    const box = $('stage').getBoundingClientRect();
    const [px, py] = P(l.x, l.y);
    const origin = { x: box.left + px, y: box.top + py };
    const ringColor = l.kind === 'ring' ? C.rings[R.RINGS.findIndex(([, p]) => p === l.points)] : l.kind === 'cup' ? C.gold : C.miss;
    const words = { cup: 'JACKPOT!', short: 'TOO SOFT', wall: 'TOO HARD', miss: 'MISSED' };
    effects.push({ x: l.x, y: l.y, born: now(), ms: 1100, color: ringColor,
      text: l.points ? `+${l.points}` : words[l.kind], size: l.points >= 50 ? 22 : 17 });
    if (l.kind === 'cup') {
      Blip.tune([[784, 0.07], [988, 0.07], [1175, 0.07], [1568, 0.25]], { type: 'square', volume: 0.06 });
      if (window.Fx) {
        Fx.burst({ count: 90, coins: l.bonus ? 50 : 30, origin });
        Fx.banner('JACKPOT!', `+${l.points} points`, { ms: 1400 });
      }
      say(`Jackpot! ${l.points} points.`);
    } else if (l.points === 50) {
      Blip.tune([[659, 0.07], [880, 0.07], [1319, 0.18]], { type: 'square', volume: 0.06 });
      if (window.Fx) Fx.burst({ count: 45, coins: 10, origin });
      say('50, the middle ring!');
    } else if (l.points) {
      Blip.tone(330 + l.points * 12, 0.12, { type: 'square', volume: 0.05 });
      say(`${l.points} points.`);
    } else {
      Blip.womp();
      if (!reduced) {
        $('stage').classList.remove('shake');
        void $('stage').offsetWidth;
        $('stage').classList.add('shake');
      }
      say(l.kind === 'short' ? 'Too soft. It didn\'t reach the rings.' : l.kind === 'wall' ? 'Too hard. It hit the back wall.' : 'Missed the rings.');
    }
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    pausedAt = now();
    // A ball that was being held is put back: it rolls only when you let go.
    pressAt = null;
    holdSource = null;
    $('rollBtn').classList.remove('down');
    msg('Paused', 'Tap the lane when you\'re ready. You\'ll get a short countdown before it starts again.');
  }
  function resume() {
    if (mode !== 'paused') return;
    mode = 'resuming';
    resumeAt = now() + (reduced ? 2000 : 3000);
  }

  // ---- the end of a run ---------------------------------------------------------------------
  async function gameOver() {
    if (mode === 'finishing' || mode === 'over') return;
    mode = 'finishing';
    document.body.dataset.state = 'over';
    let error = '';
    try {
      result = await api(`/api/royale/run/${run.runId}/finish`, { balls: sim.balls });
    } catch (e) {
      error = e.message;
      result = null;
    }
    showOver(error);
  }

  const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }

  function showOver(error) {
    mode = 'over';
    overSince = now();
    const local = E.summary(sim);
    const r = result || local;
    $('overTitle').textContent = r.jackpots ? `${plural(r.jackpots, 'jackpot')}! That's all 9 balls.` : 'That\'s all 9 balls!';
    $('overScore').textContent = '0';
    if (window.Fx) Fx.countUp($('overScore'), 0, r.score, 900); else $('overScore').textContent = fmt(r.score);
    const rings = r.rings || local.rings;
    const scored = rings.filter(p => p > 0).length;
    $('overDetail').textContent = `${scored === 9 ? 'Every ball' : `${scored} of your 9 balls`} landed in a ring or the cup` +
      (r.bulls ? `, with ${plural(r.bulls, 'ball')} in the middle 50.` : '.');
    const tally = $('tally');
    tally.innerHTML = '';
    rings.forEach(p => {
      const li = document.createElement('li');
      li.textContent = String(p);
      if (!p) li.className = 'zero';
      else if (p >= 100) li.className = 'cup';
      tally.appendChild(li);
    });
    $('chaseLine').textContent = '';
    $('rankLine').textContent = '';
    $('saveMsg').textContent = '';
    $('saveBtn').disabled = false;
    const p = profile();
    if (error || !result) {
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = `The arcade couldn't check this run, so it can't go on the board. (${error || 'No answer.'})`;
    } else if (!result.score) {
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = 'Land at least one ball in a ring to get a score on the board. Watch the power meter: the pink band is the middle ring.';
    } else {
      $('savePart').classList.remove('hidden');
      $('iniRow').classList.toggle('hidden', !!p);
      $('saveHint').textContent = p ? `Saving as ${p.name}.` : 'Type your initials to put your score on today\'s board and the all-time board.';
      if (!p) initials.reset();
      chase(result.score);
      if (window.Fx && result.score >= 400) {
        Fx.banner(result.score >= 800 ? 'HIGH ROLLER!' : 'HOT HAND!', `${fmt(result.score)} points`, { ms: 1800 });
        Fx.burst({ count: 160, coins: 30 });
      }
    }
    $('over').classList.remove('hidden');
    msg(null);
    setTimeout(() => $('over').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' }), 60);
    say(`That's all 9 balls. You scored ${fmt(r.score)}.`);
  }

  // How far this score is from the next one up on today's board. Every number
  // here is a real score on the real board, never a made-up near miss.
  async function chase(score) {
    try {
      const rows = await api('/api/royale/board?scope=day&limit=100');
      if (mode !== 'over' || !result || result.score !== score) return;
      const above = rows.filter(r => r.score >= score);
      let text;
      if (!rows.length) text = 'Nobody has a score on today\'s board yet, so saving this one puts you at #1.';
      else if (!above.length) text = 'That beats every score on today\'s board. Save it to take #1!';
      else {
        const next = above[above.length - 1];
        const gap = next.score - score + 1;
        const who = next.profileName || next.initials;
        text = `${gap <= 20 ? 'Just ' : ''}${plural(gap, 'more point')} would have passed ${who} for #${above.length} on today's board.`;
      }
      $('chaseLine').textContent = text;
    } catch { /* the line is a bonus */ }
  }

  const initials = ArcadeKit.wireInitials([...document.querySelectorAll('#iniRow .ini')], () => saveScore());
  async function saveScore() {
    if (!result || !result.finished || result.saved) return;
    const p = profile();
    // A profile sends its initials too, in case its sign-in has run out on
    // the server; then the score goes on the board under the initials.
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      const r = await api(`/api/royale/run/${result.runId}/save`, { initials: ini, profileToken: token() });
      if (!p) initials.remember(ini);
      result.saved = true;
      $('savePart').classList.add('hidden');
      $('chaseLine').textContent = '';
      $('rankLine').textContent = r.allRank === 1 ? 'That\'s the best Roll Royale score ever! 🏆'
        : `You're #${r.dayRank} on today's board, and #${r.allRank} of all time.`;
      if (window.Fx && (r.dayRank === 1 || r.allRank === 1)) {
        Fx.banner(r.allRank === 1 ? 'BEST SCORE EVER' : 'TOP OF TODAY', `${fmt(r.score)} points`, { ms: 2400 });
        Fx.burst({ count: 200, coins: 40 });
        Blip.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.1], [1319, 0.3]], { type: 'square', volume: 0.06 });
      } else toast(`Saved: #${r.dayRank} today`);
      openScores('day', r.id);
    } catch (e) {
      $('saveMsg').textContent = e.message;
      $('saveBtn').disabled = false;
    }
  }
  $('saveBtn').addEventListener('click', saveScore);
  $('againBtn').addEventListener('click', () => { Blip.unlock(); begin(); window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); });

  // ---- high scores -------------------------------------------------------------------------
  let scope = 'day';
  async function openScores(which = scope, highlightId) {
    scope = which;
    const box = $('scoreScope');
    box.innerHTML = '';
    for (const [id, label] of [['day', 'Today'], ['all', 'All time']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(id === which));
      b.onclick = () => openScores(id);
      box.appendChild(b);
    }
    $('scoreNote').textContent = which === 'day'
      ? 'Today\'s best runs. A fresh board starts every night at midnight, and every run you save counts.'
      : 'The best runs from every day so far.';
    $('scores').classList.remove('hidden');
    const list = $('scoreList');
    list.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const rows = await api(`/api/royale/board?scope=${which}&limit=20`);
      ArcadeKit.renderScores(list, rows.map(r => ({ ...r, detail: r.jackpots ? plural(r.jackpots, 'jackpot') : '' })), highlightId);
      if (!rows.length) list.firstChild.textContent = which === 'day' ? 'Nobody has saved a score today. Be the first!' : 'No scores yet. Be the first!';
    } catch (e) {
      list.innerHTML = '<li class="empty"></li>';
      list.firstChild.textContent = e.message;
    }
  }
  const closeScores = () => $('scores').classList.add('hidden');
  $('scoresBtn').addEventListener('click', () => { pause(); openScores('day'); });
  $('overScoresBtn').addEventListener('click', () => openScores('day'));
  $('scoresClose').addEventListener('click', closeScores);
  $('scores').addEventListener('click', e => { if (e.target === $('scores')) closeScores(); });

  // ---- controls ----------------------------------------------------------------------------
  for (const id of ['stage', 'rollBtn']) {
    $(id).addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      down('pointer');
    });
  }
  // Letting go anywhere counts, so a finger can slide off the button (or
  // flick up the lane) as it lets go.
  window.addEventListener('pointerup', () => up('pointer'));
  window.addEventListener('pointercancel', () => up('pointer'));
  $('rollBtn').addEventListener('click', e => e.preventDefault());
  $('rollBtn').addEventListener('contextmenu', e => e.preventDefault());
  $('stage').addEventListener('contextmenu', e => e.preventDefault());
  const busyElsewhere = () => help.isOpen || !$('scores').classList.contains('hidden');
  const isRollKey = e => e.key === ' ' || e.key === 'Enter';
  window.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || busyElsewhere()) {
      if (e.key === 'Escape' && !$('scores').classList.contains('hidden')) closeScores();
      return;
    }
    if (!isRollKey(e)) return;
    // On the game-over panel, Space and Enter work its buttons instead.
    if (mode === 'over' || mode === 'finishing') return;
    e.preventDefault();
    if (e.repeat) return;
    down('key');
  });
  window.addEventListener('keyup', e => {
    if (!isRollKey(e)) return;
    if (mode === 'playing') e.preventDefault();
    up('key');
  });

  // Game controllers: A or the right trigger is the press (hold, then let go),
  // Start pauses, or starts a new run when one is over.
  const padWas = new Map();
  function pollPads() {
    if (!navigator.getGamepads) return;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return; }
    for (const gp of pads) {
      if (!gp) continue;
      const trig = gp.buttons[7] ? gp.buttons[7].value > 0.4 || gp.buttons[7].pressed : false;
      const a = !!(gp.buttons[0] && gp.buttons[0].pressed) || trig;
      const st = !!(gp.buttons[9] && gp.buttons[9].pressed);
      const was = padWas.get(gp.index) || {};
      if (a && !was.a) padPress('a');
      if (!a && was.a) up('pad');
      if (st && !was.st) padPress('start');
      padWas.set(gp.index, { a, st });
    }
  }
  function padPress(button) {
    if (busyElsewhere()) { if (!$('scores').classList.contains('hidden')) closeScores(); return; }
    if (mode === 'over') {
      // A short wait, so a press meant for the last ball doesn't start the next run.
      if (now() - overSince > 1200) begin();
      return;
    }
    if (button === 'start') {
      if (mode === 'playing') pause();
      else if (mode === 'paused' || mode === 'idle') down('pad');
      return;
    }
    down('pad');
  }

  // Leaving the page pauses the run.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('royale');

  // ---- how to play -------------------------------------------------------------------------
  const help = Tutorial.create('royale', [
    {
      emoji: '🎳', title: 'Roll it up the lane',
      html: `<p>You get <b>9 balls</b>. Each one rolls up the lane, hops off the gold lip and drops into the board of rings at the top.</p>
        <p>The rings in the middle are worth the most: <b>10, 20, 30, 40</b> from the outside in, and <b>50</b> for the little one in the middle. A ball that misses every ring scores nothing.</p>`
    },
    {
      emoji: '🎯', title: 'Aim, then power',
      html: `<p>Before you roll, an arrow sways left and right. The dashed line shows exactly where the ball will go across the board. <b>Press</b> when it points where you want, and the aim stays put.</p>
        <p>Keep holding and the <b>power meter</b> on the right climbs, then comes back down if you hold too long. <b>Let go</b> to roll. The pink band on the meter is the power that reaches the middle ring, and the gold band reaches the jackpot cup.</p>`
    },
    {
      emoji: '👆', title: 'How to press',
      html: `<table>
          <tr><td>📱 Phone</td><td>Press and hold anywhere on the lane or the big <b>HOLD · ROLL</b> button, then let go (a flick up the lane works too).</td></tr>
          <tr><td>⌨️ Keyboard</td><td>Hold <b>Space</b> or <b>Enter</b>, then let go.</td></tr>
          <tr><td>🎮 Controller</td><td>Hold the <b>A</b> button or the right trigger, then let go. <b>Start</b> pauses, and starts a new run after the last ball.</td></tr>
        </table>
        <p>A quick tap doesn't roll the ball, because it needs some power. If you hold for 4 seconds it rolls by itself.</p>`
    },
    {
      emoji: '💰', title: 'The jackpot cup',
      html: `<p>Above the rings sits a small gold cup worth <b>${R.CUP_POINTS}</b> points. It takes more power to reach, and it's a small target.</p>
        <p>The last three balls are <b>bonus balls</b> (marked with a star along the top): the cup slides from side to side and is worth <b>${R.BONUS_CUP_POINTS}</b>. The arrow sways a little faster on later balls too. A perfect run is ${fmt(6 * R.CUP_POINTS + 3 * R.BONUS_CUP_POINTS)} points.</p>`
    },
    {
      emoji: '🏆', title: 'The high scores',
      html: `<p>After the ninth ball, the arcade checks the run by rolling your balls again through the same lane, using only when you pressed and let go, and works out the score itself. That's the score that counts, so nobody can fake one.</p>
        <p>Save it with your initials (or your profile) to go on today's board and the all-time board. Today's board starts fresh every night at midnight.</p>
        <div class="tut-tip">Opening How to play or leaving the page pauses the run. A ball you were holding goes back, and you get a short countdown before you carry on.</div>`
    }
  ], { onClose: () => { if (pausedForHelp) { pausedForHelp = false; resume(); } } });
  // Reading How to play mid-run pauses it, and closing it carries on.
  $('helpBtn').addEventListener('click', () => {
    if (mode === 'playing') { pausedForHelp = true; pause(); }
    help.open();
  });

  // ---- start ---------------------------------------------------------------------------------
  requestAnimationFrame(frame);
  help.autoOpen();
})();
