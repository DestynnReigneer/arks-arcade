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

  function draw() {
    const { ctx } = view;
    const k = scale();
    ctx.save();
    ctx.scale(k, k);
    if (shake) ctx.translate((Math.random() - 0.5) * shake / k, (Math.random() - 0.5) * shake / k);
    const bg = ctx.createLinearGradient(0, 0, 0, E.H);
    bg.addColorStop(0, '#120f22'); bg.addColorStop(1, '#0a0912');
    ctx.fillStyle = bg;
    ctx.fillRect(-10, -10, E.W + 20, E.H + 20);
    // faint grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < E.W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, E.H); ctx.stroke(); }

    // top bar: level name and active power-ups
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, E.W, 30);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c9b98a';
    ctx.fillText(`${g.level + 1}. ${E.levelName(g.level)}`, 10, 15);
    let ex = E.W - 10;
    ctx.textAlign = 'right';
    for (const [type, t] of Object.entries(g.effects)) {
      if (t <= 0) continue;
      const label = `${E.POWERS[type].emoji} ${Math.ceil(t)}`;
      ctx.fillStyle = E.POWERS[type].color;
      ctx.fillText(label, ex, 15);
      ex -= ctx.measureText(label).width + 12;
    }
    ctx.textAlign = 'left';

    // bricks
    for (const b of g.bricks) {
      let color;
      if (b.steel) color = '#c9a227';
      else if (b.max >= 3) color = '#8fa3b8';
      else color = ROW_COLORS[b.row % ROW_COLORS.length];
      const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, shadeHex(color, 0.28));
      grad.addColorStop(1, shadeHex(color, -0.25));
      ctx.fillStyle = grad;
      rounded(ctx, b.x, b.y, b.w, b.h, 3);
      ctx.fill();
      if (b.max === 2 && b.hits === 2 || b.max >= 3 && !b.steel) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.2;
        rounded(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 2);
        ctx.stroke();
      }
      if (b.hits < b.max && !b.steel) {
        // cracks
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x + b.w * 0.3, b.y); ctx.lineTo(b.x + b.w * 0.45, b.y + b.h * 0.5); ctx.lineTo(b.x + b.w * 0.35, b.y + b.h);
        if (b.max - b.hits > 1) { ctx.moveTo(b.x + b.w * 0.7, b.y); ctx.lineTo(b.x + b.w * 0.6, b.y + b.h * 0.6); ctx.lineTo(b.x + b.w * 0.75, b.y + b.h); }
        ctx.stroke();
      }
      if (b.power) {
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 150) * 0.4;
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
      ctx.fillStyle = p.color;
      rounded(ctx, d.x - 15, d.y - 7, 30, 14, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.emoji, d.x, d.y + 1);
      ctx.textAlign = 'left';
    }

    // paddle
    const pd = g.paddle;
    ctx.save();
    ctx.shadowColor = g.effects.fire > 0 ? '#ff7a2c' : '#ff9f2c';
    ctx.shadowBlur = 14;
    const pg = ctx.createLinearGradient(0, pd.y - pd.h / 2, 0, pd.y + pd.h / 2);
    pg.addColorStop(0, '#ffe2a8'); pg.addColorStop(1, '#ff8a1c');
    ctx.fillStyle = pg;
    rounded(ctx, pd.x - pd.w / 2, pd.y - pd.h / 2, pd.w, pd.h, pd.h / 2);
    ctx.fill();
    ctx.restore();

    // balls with a short trail
    for (const b of g.balls) {
      let t = trails.get(b);
      if (!t) { t = []; trails.set(b, t); }
      t.push({ x: b.x, y: b.y });
      if (t.length > 8) t.shift();
      const fire = g.effects.fire > 0;
      t.forEach((p, i) => {
        ctx.globalAlpha = (i / t.length) * 0.35;
        ctx.fillStyle = fire ? '#ff7a2c' : '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, b.r * (0.5 + i / t.length / 2), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.shadowColor = fire ? '#ff5a00' : '#ffffff';
      ctx.shadowBlur = fire ? 14 : 8;
      ctx.fillStyle = fire ? '#ffd27a' : '#ffffff';
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
