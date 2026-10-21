'use strict';

// Brick Breaker: the page. Rules and physics are in bricks-engine.js; this
// moves the paddle with a finger, mouse or keys, draws, and makes noise.

(() => {
  const { $ } = ArcadeKit;
  const E = BricksEngine;
  const ROW_COLORS = ['#ff5e5e', '#ff9f2c', '#ffc72c', '#3ddc84', '#2de2e6', '#2e9bff', '#c86bff', '#ff4fa3'];

  let g = null;
  let state = 'ready';     // ready (serving) | playing | paused | cleared | over
  let pointerX = null;     // where a finger or mouse wants the paddle (world units)
  let keys = { left: false, right: false };
  let launchQueued = false;
  let counted = false;     // this game has been counted in the stats
  let last = performance.now(), particles = [], flash = 0, shake = 0;
  const trails = new WeakMap();

  const shell = GameShell.create({ game: 'bricks', boards: { classic: 'Classic' }, mount: $('stage'), onAgain: () => newGame() });
  const view = GameShell.fitCanvas($('canvas'), { aspect: E.W / E.H, maxHeight: () => Math.max(320, window.innerHeight * 0.68) });
  const scale = () => view.size.w / E.W;

  function newGame() {
    g = E.create();
    state = 'ready';
    counted = false;
    particles = []; flash = 0;
    document.body.dataset.state = 'ready';
    message(`Level 1: ${E.levelName(0)}`, 'Tap to launch');
    hud();
  }

  function message(title, text) {
    $('stageMsg').classList.toggle('hidden', !title);
    if (title) { $('stageMsg').firstElementChild.textContent = title; $('stageMsg').lastElementChild.textContent = text || ''; }
  }
  function hud() {
    $('score').textContent = g.score.toLocaleString('en-US');
    $('level').textContent = g.level + 1;
    $('lives').textContent = g.lives > 4 ? `♥×${g.lives}` : '♥'.repeat(Math.max(0, g.lives)) || '–';
    $('best').textContent = shell.best('classic').toLocaleString('en-US');
  }

  function wantLaunch() {
    if (state === 'paused') { pause(false); return; }
    if (state === 'over' || state === 'cleared') return;
    Blip.unlock();
    if (g.phase === 'serve') {
      if (!counted && window.ArcadeStats) { counted = true; ArcadeStats.play(); }
      launchQueued = true;
    }
  }
  function pause(on = state === 'playing' || state === 'ready') {
    if (on && (state === 'playing' || state === 'ready')) { state = 'paused'; message('Paused', 'Tap or press P to keep going.'); }
    else if (!on && state === 'paused') { state = g.phase === 'serve' ? 'ready' : 'playing'; message(g.phase === 'serve' ? 'Ready' : null, 'Tap to launch'); last = performance.now(); }
    $('pauseBtn').textContent = state === 'paused' ? '▶' : '⏸';
  }

  // ---- loop -------------------------------------------------------------------------------
  function frame(now) {
    Blip.musicPlaying(state === 'playing' || state === 'ready');
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((state === 'ready' || state === 'playing') && !help.isOpen) {
      const input = { launch: launchQueued };
      launchQueued = false;
      if (pointerX != null) input.x = pointerX;
      else input.move = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      // Two half steps per frame keep a 30 fps phone smooth.
      E.step(g, dt / 2, input);
      react();
      if (g.phase === 'play' || g.phase === 'serve') { E.step(g, dt / 2, { ...input, launch: false }); react(); }
      if (g.phase === 'play' && state === 'ready') { state = 'playing'; message(null); document.body.dataset.state = 'playing'; }
    }
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    flash = Math.max(0, flash - dt * 2);
    shake = Math.max(0, shake - dt * 40);
    draw();
    requestAnimationFrame(frame);
  }

  function react() {
    for (const ev of g.events) {
      if (ev === 'paddle') Blip.tone(330, 0.05, { type: 'square', volume: 0.05 });
      else if (ev === 'wall') Blip.tone(220, 0.03, { type: 'square', volume: 0.03 });
      else if (ev === 'steel') Blip.tone(1200, 0.04, { type: 'triangle', volume: 0.04 });
      else if (ev === 'crack') Blip.tone(520, 0.04, { type: 'square', volume: 0.04 });
      else if (ev === 'break') {
        const b = g.lastBroken;
        Blip.tone(660 + (b ? (8 - b.row) * 40 : 0), 0.05, { type: 'square', volume: 0.05 });
        if (b) burst(b.x, b.y, ROW_COLORS[b.row % ROW_COLORS.length], b.power ? 22 : 12);
      } else if (ev.startsWith('power:')) {
        const type = ev.slice(6);
        Blip.tune([[660, 0.05], [880, 0.05], [1320, 0.1]], { type: 'square', volume: 0.05 });
        ArcadeKit.toast(`${E.POWERS[type].emoji} ${E.POWERS[type].label}!`, 1400);
      } else if (ev === 'lost') {
        flash = 1; shake = 10;
        Blip.tone([400, 120], 0.35, { type: 'sawtooth', volume: 0.07 });
        if (g.phase === 'serve') { state = 'ready'; message('Oops!', 'Tap to launch'); }
      } else if (ev === 'over') {
        state = 'over';
        Blip.noise(0.3, 0.15);
        setTimeout(() => shell.over({ score: g.score, board: 'classic', detail: `Reached level ${g.level + 1} (${E.levelName(g.level)}) · ${g.cleared} cleared` }), 600);
      } else if (ev === 'cleared') {
        state = 'cleared';
        Blip.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]], { type: 'square', volume: 0.06 });
        message(`Level ${g.level + 1} cleared! 🎉`, `+${g.lastBonus} bonus`);
        setTimeout(() => {
          E.nextLevel(g);
          state = 'ready';
          message(`Level ${g.level + 1}: ${E.levelName(g.level)}`, 'Tap to launch');
          hud();
        }, 1800);
      }
    }
    if (g.events.length) hud();
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.4 + Math.random() * 0.4, color });
    }
  }

  // ---- drawing -----------------------------------------------------------------------------
  function shadeHex(hex, f) {
    const n = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${n.map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)).join(',')})`;
  }
  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Stars in the background, the same every time.
  const STARS = (() => {
    let s = 7;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    return Array.from({ length: 70 }, () => ({ x: r() * E.W, y: E.CEILING + r() * (E.H - E.CEILING), r: 0.4 + r() * 1.1, tw: r() * 6 }));
  })();
  const LEVEL_TINTS = ['#1b1440', '#0f2340', '#2a1236', '#0f2e2a', '#2e1a10', '#301028', '#10243a', '#22202e'];

  function draw() {
    const { ctx } = view;
    const k = scale();
    const now = performance.now() / 1000;
    ctx.save();
    ctx.scale(k, k);
    if (shake) ctx.translate((Math.random() - 0.5) * shake / k, (Math.random() - 0.5) * shake / k);
    const bg = ctx.createLinearGradient(0, 0, 0, E.H);
    bg.addColorStop(0, LEVEL_TINTS[g.level % LEVEL_TINTS.length]); bg.addColorStop(1, '#07060d');
    ctx.fillStyle = bg;
    ctx.fillRect(-10, -10, E.W + 20, E.H + 20);
    for (const s of STARS) {
      ctx.globalAlpha = 0.35 + Math.sin(now * 1.5 + s.tw) * 0.25;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // top bar: level name and active power-ups
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, E.W, E.CEILING);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(`${g.level + 1}. ${E.levelName(g.level)}`, 12, 14);
    let ex = E.W - 12;
    ctx.textAlign = 'right';
    for (const [type, t] of Object.entries(g.effects)) {
      if (t <= 0) continue;
      const label = `${E.POWERS[type].emoji} ${Math.ceil(t)}`;
      ctx.fillStyle = E.POWERS[type].color;
      ctx.fillText(label, ex, 14);
      ex -= ctx.measureText(label).width + 12;
    }
    ctx.textAlign = 'left';

    // The walls: metal rails on three sides with a glowing inside edge, so
    // you can see exactly where the ball bounces. The bottom is open.
    const S = E.SIDE, C = E.CEILING;
    const rail = (x, y, w, h, horizontal) => {
      const gr = horizontal ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, '#9aa3b8'); gr.addColorStop(0.5, '#e6ebf5'); gr.addColorStop(1, '#5d6478');
      ctx.fillStyle = gr;
      ctx.fillRect(x, y, w, h);
    };
    rail(0, C - S, E.W, S, true);
    rail(0, C - S, S, E.H - C + S, false);
    rail(E.W - S, C - S, S, E.H - C + S, false);
    // rivets
    ctx.fillStyle = 'rgba(60,66,84,0.8)';
    for (let y = C + 20; y < E.H; y += 40) { ctx.fillRect(S / 2 - 1, y, 2, 2); ctx.fillRect(E.W - S / 2 - 1, y, 2, 2); }
    for (let x = 20; x < E.W; x += 40) ctx.fillRect(x, C - S / 2 - 1, 2, 2);
    ctx.save();
    ctx.shadowColor = '#2de2e6'; ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(45,226,230,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(S + 0.75, E.H); ctx.lineTo(S + 0.75, C + 0.75); ctx.lineTo(E.W - S - 0.75, C + 0.75); ctx.lineTo(E.W - S - 0.75, E.H);
    ctx.stroke();
    ctx.restore();
    // the open bottom: a faint red glow where balls are lost
    const pit = ctx.createLinearGradient(0, E.H - 26, 0, E.H);
    pit.addColorStop(0, 'rgba(255,60,90,0)'); pit.addColorStop(1, 'rgba(255,60,90,0.28)');
    ctx.fillStyle = pit;
    ctx.fillRect(S, E.H - 26, E.W - S * 2, 26);

    // bricks
    for (const b of g.bricks) {
      let color;
      if (b.steel) color = '#d4a92a';
      else if (b.max >= 3) color = '#9fb2c6';
      else color = ROW_COLORS[b.row % ROW_COLORS.length];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      rounded(ctx, b.x + 1.5, b.y + 2, b.w, b.h, 3);
      ctx.fill();
      const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, shadeHex(color, 0.35));
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, shadeHex(color, -0.35));
      ctx.fillStyle = grad;
      rounded(ctx, b.x, b.y, b.w, b.h, 3);
      ctx.fill();
      // shine across the top
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      rounded(ctx, b.x + 2, b.y + 1.5, b.w - 4, b.h * 0.3, 2);
      ctx.fill();
      ctx.strokeStyle = shadeHex(color, -0.5);
      ctx.lineWidth = 1;
      rounded(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 3);
      ctx.stroke();
      if (b.steel) {
        // a moving glint on gold
        const gx = b.x + ((now * 40 + b.col * 13) % (b.w + 30)) - 15;
        ctx.save();
        rounded(ctx, b.x, b.y, b.w, b.h, 3); ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.moveTo(gx, b.y); ctx.lineTo(gx + 6, b.y); ctx.lineTo(gx, b.y + b.h); ctx.lineTo(gx - 6, b.y + b.h); ctx.fill();
        ctx.restore();
      } else if (b.max >= 2 && b.hits >= 2) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.2;
        rounded(ctx, b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 2);
        ctx.stroke();
      }
      if (b.hits < b.max && !b.steel) {
        // cracks
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x + b.w * 0.3, b.y); ctx.lineTo(b.x + b.w * 0.45, b.y + b.h * 0.5); ctx.lineTo(b.x + b.w * 0.35, b.y + b.h);
        if (b.max - b.hits > 1) { ctx.moveTo(b.x + b.w * 0.7, b.y); ctx.lineTo(b.x + b.w * 0.6, b.y + b.h * 0.6); ctx.lineTo(b.x + b.w * 0.75, b.y + b.h); }
        ctx.stroke();
      }
      if (b.power) {
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.6 + Math.sin(now * 6.7) * 0.4;
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('★', b.x + b.w / 2, b.y + b.h / 2 + 1);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    }

    // power-up capsules
    for (const d of g.drops) {
      const p = E.POWERS[d.type];
      ctx.save();
      ctx.shadowColor = p.color; ctx.shadowBlur = 10;
      const cg = ctx.createLinearGradient(0, d.y - 8, 0, d.y + 8);
      cg.addColorStop(0, shadeHex(p.color, 0.4)); cg.addColorStop(1, shadeHex(p.color, -0.3));
      ctx.fillStyle = cg;
      rounded(ctx, d.x - 16, d.y - 8, 32, 16, 8);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.emoji, d.x, d.y + 1);
      ctx.textAlign = 'left';
    }

    // paddle: a chrome capsule with glowing ends
    const pd = g.paddle;
    const px = pd.x - pd.w / 2, py = pd.y - pd.h / 2;
    ctx.save();
    ctx.shadowColor = g.effects.fire > 0 ? '#ff7a2c' : '#2de2e6';
    ctx.shadowBlur = 16;
    const pg = ctx.createLinearGradient(0, py, 0, py + pd.h);
    pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.45, '#b9c3d6'); pg.addColorStop(1, '#5a6378');
    ctx.fillStyle = pg;
    rounded(ctx, px, py, pd.w, pd.h, pd.h / 2);
    ctx.fill();
    ctx.restore();
    const endColor = g.effects.fire > 0 ? '#ff7a2c' : '#ff4f7a';
    ctx.fillStyle = endColor;
    rounded(ctx, px, py, 12, pd.h, pd.h / 2); ctx.fill();
    rounded(ctx, px + pd.w - 12, py, 12, pd.h, pd.h / 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(px + 8, py + 2, pd.w - 16, 2);

    // balls with a short trail
    for (const b of g.balls) {
      let t = trails.get(b);
      if (!t) { t = []; trails.set(b, t); }
      t.push({ x: b.x, y: b.y });
      if (t.length > 10) t.shift();
      const fire = g.effects.fire > 0;
      t.forEach((p, i) => {
        ctx.globalAlpha = (i / t.length) * 0.4;
        ctx.fillStyle = fire ? '#ff7a2c' : '#9ff6ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, b.r * (0.4 + i / t.length / 2), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.shadowColor = fire ? '#ff5a00' : '#9ff6ff';
      ctx.shadowBlur = fire ? 16 : 10;
      const bgr = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, 0.5, b.x, b.y, b.r);
      bgr.addColorStop(0, '#ffffff'); bgr.addColorStop(1, fire ? '#ff9a3c' : '#c9d6ea');
      ctx.fillStyle = bgr;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    if (flash) { ctx.fillStyle = `rgba(255,60,60,${flash * 0.3})`; ctx.fillRect(0, 0, E.W, E.H); }
    ctx.restore();
  }

  // ---- controls -------------------------------------------------------------------------------
  const stage = $('stage');
  function toWorld(e) {
    const r = $('canvas').getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * E.W;
  }
  let downAt = null;
  stage.addEventListener('pointerdown', e => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    pointerX = toWorld(e);
    try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ }
  });
  stage.addEventListener('pointermove', e => {
    // A mouse steers just by moving; a finger only while touching.
    if (e.pointerType === 'mouse' || downAt) pointerX = toWorld(e);
  });
  stage.addEventListener('pointerup', e => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 14 && performance.now() - downAt.t < 350) wantLaunch();
    else if (g.phase === 'serve' && downAt) wantLaunch();   // drag and let go also serves
    downAt = null;
  });
  stage.addEventListener('pointercancel', () => { downAt = null; });
  stage.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') pointerX = null; });

  window.addEventListener('keydown', e => {
    if (help.isOpen) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = true; pointerX = null; e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = true; pointerX = null; e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); wantLaunch(); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); pause(); }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });
  $('pauseBtn').addEventListener('click', () => pause());
  $('scoresBtn').addEventListener('click', () => shell.openScores('classic'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('bricks');

  const help = Tutorial.create('bricks', [
    {
      emoji: '🧱', title: 'Break every brick',
      html: `<p>Bounce the ball off your paddle to smash the bricks. Clear them all to go to the next level.</p>
        <p>Don't let the ball fall past your paddle! You have 3 lives.</p>`
    },
    {
      emoji: '👆', title: 'Moving',
      html: `<table>
          <tr><td>📱 Phone</td><td>Slide your finger anywhere on the game. Tap to launch the ball.</td></tr>
          <tr><td>🖱️ Computer</td><td>Move the mouse, click to launch. Or <b>← →</b> and <b>Space</b>.</td></tr>
        </table>
        <div class="tut-tip">Where the ball hits the paddle matters: the ends send it off at a steep angle.</div>`
    },
    {
      emoji: '⭐', title: 'Bricks and power-ups',
      html: `<p>Plain bricks break in one hit. Outlined ones take two, gray metal takes three, and <b>gold</b> never breaks.</p>
        <p>Bricks with a ★ (and sometimes others) drop a power-up. Catch it with the paddle:</p>
        <table>
          <tr><td>↔ Wide</td><td>A bigger paddle</td></tr>
          <tr><td>⁂ Three balls</td><td>Every ball splits in three</td></tr>
          <tr><td>🐢 Slow</td><td>The ball slows down</td></tr>
          <tr><td>🔥 Fireball</td><td>Smashes straight through bricks</td></tr>
          <tr><td>♥ Life</td><td>One more try</td></tr>
        </table>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  newGame();
  requestAnimationFrame(frame);
  help.autoOpen();
})();
