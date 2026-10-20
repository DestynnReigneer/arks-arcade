'use strict';

// Snake: the page. The rules live in snake-engine.js; this draws the board,
// reads arrows, swipes and the on-screen pad, and plays the sounds.

(() => {
  const { $ } = ArcadeKit;
  const E = SnakeEngine;
  const COLS = 20, ROWS = 20;
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

  let mode = E.MODES[recall('snake.mode', '')] ? recall('snake.mode', '') : 'classic';
  let speed = E.SPEEDS[recall('snake.speed', '')] ? recall('snake.speed', '') : 'normal';
  let g = null;
  let state = 'ready';            // ready | playing | paused | over
  let acc = 0, last = performance.now();
  let particles = [], shake = 0, flash = 0, pulse = 0;

  const shell = GameShell.create({
    game: 'snake', boards: E.MODES, mount: $('stage'),
    onAgain: () => { reset(); start(); }
  });
  const view = GameShell.fitCanvas($('canvas'), { aspect: 1, maxHeight: () => Math.max(260, window.innerHeight * 0.56) });

  // ---- options -------------------------------------------------------------------------
  function seg(box, items, current, onPick) {
    box.innerHTML = '';
    for (const [id, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(id === current));
      b.onclick = () => onPick(id);
      box.appendChild(b);
    }
  }
  function paintOptions() {
    seg($('modeSeg'), Object.entries(E.MODES), mode, id => { mode = id; store('snake.mode', id); reset(); });
    seg($('speedSeg'), Object.entries(E.SPEEDS).map(([id, s]) => [id, `${s.label} ×${s.mult}`]), speed, id => { speed = id; store('snake.speed', id); reset(); });
  }

  // ---- game flow -------------------------------------------------------------------------
  function reset() {
    g = E.create({ cols: COLS, rows: ROWS, mode, speed });
    state = 'ready';
    particles = []; shake = 0; flash = 0;
    shell.hideOver();
    document.body.dataset.state = 'ready';
    paintOptions();
    $('options').classList.remove('hidden');
    message('Ready?', 'Swipe, tap a button, or press an arrow key to go.');
    hud();
  }
  function start() {
    if (state !== 'ready') return;
    Blip.unlock();
    state = 'playing';
    acc = 0; last = performance.now();
    $('options').classList.add('hidden');
    message(null);
    document.body.dataset.state = 'playing';
    if (window.ArcadeStats) ArcadeStats.play();
  }
  function pause(on = state === 'playing') {
    if (on && state === 'playing') { state = 'paused'; message('Paused', 'Tap the board or press P to keep going.'); }
    else if (!on && state === 'paused') { state = 'playing'; last = performance.now(); message(null); }
    $('pauseBtn').textContent = state === 'paused' ? '▶' : '⏸';
  }
  function end() {
    state = 'over';
    shake = 14; flash = 1;
    Blip.noise(0.25, 0.16);
    Blip.tone([320, 70], 0.45, { type: 'sawtooth', volume: 0.07 });
    const detail = `${g.apples} apple${g.apples === 1 ? '' : 's'}${g.golds ? ` + ${g.golds} golden` : ''} · ${E.MODES[mode]} · ${E.SPEEDS[speed].label}`;
    setTimeout(() => {
      shell.over({ score: g.score, board: mode, detail, title: g.won ? 'You filled the whole board! 🏆' : undefined });
      hud();
    }, 650);
  }
  function message(title, text) {
    $('stageMsg').classList.toggle('hidden', !title);
    if (title) { $('stageMsg').firstElementChild.textContent = title; $('stageMsg').lastElementChild.textContent = text || ''; }
  }
  function hud() {
    $('score').textContent = g.score.toLocaleString('en-US');
    $('apples').textContent = g.apples;
    $('best').textContent = shell.best(mode).toLocaleString('en-US');
  }

  function steer(dir) {
    if (state === 'over') return;
    if (state === 'paused') pause(false);
    if (state === 'ready') start();
    E.turn(g, dir);
  }

  // ---- the loop ----------------------------------------------------------------------------
  function tick() {
    E.step(g);
    const head = g.snake[0];
    for (const ev of g.events) {
      if (ev === 'eat') { Blip.tone([520, 880], 0.06, { type: 'square', volume: 0.05 }); burst(head, '#ff5e5e', 10); }
      if (ev === 'gold') { Blip.tune([[880, 0.06], [1175, 0.06], [1568, 0.12]], { type: 'square', volume: 0.05 }); burst(head, '#ffc72c', 22); }
      if (ev === 'gold-appears') Blip.tone([660, 990], 0.08, { type: 'triangle', volume: 0.05 });
    }
    hud();
    if (g.over) end();
  }

  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    pulse += dt / 1000;
    if (state === 'playing' && !help.isOpen) {
      acc += dt;
      let guard = 0;
      while (acc >= E.interval(g) && state === 'playing' && guard++ < 5) {
        acc -= E.interval(g);
        tick();
      }
    }
    for (const p of particles) { p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += 260 * dt / 1000; p.life -= dt / 1000; }
    particles = particles.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt / 25);
    flash = Math.max(0, flash - dt / 500);
    draw();
    requestAnimationFrame(frame);
  }

  function burst(cell, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 120;
      particles.push({ x: cell.x + 0.5, y: cell.y + 0.5, vx: Math.cos(a) * s / 20, vy: Math.sin(a) * s / 20 - 3, life: 0.5 + Math.random() * 0.3, color });
    }
  }

  // ---- drawing -------------------------------------------------------------------------------
  const lerp = (a, b, t) => a + (b - a) * t;
  function shade(t) {
    const r = Math.round(lerp(92, 24, t)), gg = Math.round(lerp(245, 128, t)), b = Math.round(lerp(154, 76, t));
    return `rgb(${r},${gg},${b})`;
  }

  function draw() {
    const { ctx, size } = view;
    const w = size.w, h = size.h, c = w / COLS;
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.fillStyle = '#0d0c16';
    ctx.fillRect(-20, -20, w + 40, h + 40);
    ctx.fillStyle = '#13121f';
    for (let y = 0; y < ROWS; y++) for (let x = (y % 2); x < COLS; x += 2) ctx.fillRect(x * c, y * c, c, c);
    if (mode === 'wrap') {
      ctx.strokeStyle = 'rgba(46,155,255,0.35)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.setLineDash([]);
    }

    // Food
    if (g.food) {
      const fx = (g.food.x + 0.5) * c, fy = (g.food.y + 0.5) * c, r = c * 0.36 * (1 + Math.sin(pulse * 6) * 0.05);
      ctx.fillStyle = '#ff4d5e';
      ctx.beginPath(); ctx.arc(fx, fy + c * 0.04, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(fx - r * 0.35, fy - r * 0.2, r * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3ddc84';
      ctx.beginPath(); ctx.ellipse(fx + r * 0.35, fy - r * 0.95, r * 0.42, r * 0.2, -0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (g.gold) {
      const gx = (g.gold.x + 0.5) * c, gy = (g.gold.y + 0.5) * c;
      const left = g.gold.ttl / E.GOLD_TICKS;
      ctx.save();
      ctx.shadowColor = '#ffc72c';
      ctx.shadowBlur = 10 + Math.sin(pulse * 8) * 4;
      star(ctx, gx, gy, c * 0.42, c * 0.18, '#ffd23f');
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,210,63,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, c * 0.55, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke();
    }

    // Body: a thick line through the segment centers, broken where it wraps.
    const s = g.snake;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = c * 0.74;
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i], b = s[i - 1];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
      ctx.strokeStyle = shade(i / Math.max(1, s.length - 1));
      ctx.beginPath();
      ctx.moveTo((a.x + 0.5) * c, (a.y + 0.5) * c);
      ctx.lineTo((b.x + 0.5) * c, (b.y + 0.5) * c);
      ctx.stroke();
    }
    for (let i = s.length - 1; i >= 1; i--) {
      ctx.fillStyle = shade(i / Math.max(1, s.length - 1));
      ctx.beginPath(); ctx.arc((s[i].x + 0.5) * c, (s[i].y + 0.5) * c, c * 0.37, 0, Math.PI * 2); ctx.fill();
    }
    // Head with eyes looking where it's going
    const hx = (s[0].x + 0.5) * c, hy = (s[0].y + 0.5) * c;
    ctx.fillStyle = state === 'over' && flash > 0 ? '#ff5e5e' : '#6dffab';
    ctx.beginPath(); ctx.arc(hx, hy, c * 0.45, 0, Math.PI * 2); ctx.fill();
    const [dx, dy] = E.DIRS[g.dir];
    const px = -dy, py = dx;
    for (const side of [-1, 1]) {
      const ex = hx + dx * c * 0.14 + px * side * c * 0.2, ey = hy + dy * c * 0.14 + py * side * c * 0.2;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, c * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(ex + dx * c * 0.04, ey + dy * c * 0.04, c * 0.06, 0, Math.PI * 2); ctx.fill();
    }
    if (state === 'playing' && Math.sin(pulse * 3) > 0.9) {
      ctx.strokeStyle = '#ff5e7a';
      ctx.lineWidth = Math.max(1.5, c * 0.07);
      ctx.beginPath();
      ctx.moveTo(hx + dx * c * 0.42, hy + dy * c * 0.42);
      ctx.lineTo(hx + dx * c * 0.7, hy + dy * c * 0.7);
      ctx.stroke();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * c - 2, p.y * c - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    if (flash) { ctx.fillStyle = `rgba(255,60,60,${flash * 0.35})`; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  }

  function star(ctx, x, y, outer, inner, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? inner : outer, a = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---- controls -------------------------------------------------------------------------------
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select') || help.isOpen) return;
    if (KEYS[e.key]) { e.preventDefault(); steer(KEYS[e.key]); return; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); pause(); return; }
    if (e.key === ' ') {
      e.preventDefault();
      if (state === 'ready') start(); else if (state === 'playing' || state === 'paused') pause();
    }
  });
  GameShell.swipes($('stage'), {
    min: 18,
    onSwipe: dir => steer(dir),
    onTap: () => { if (state === 'ready') start(); else if (state === 'paused') pause(false); }
  });
  for (const b of document.querySelectorAll('#pad .pad-btn')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); steer(b.dataset.dir); });
  }
  $('pauseBtn').addEventListener('click', () => (state === 'ready' ? start() : pause()));
  $('scoresBtn').addEventListener('click', () => shell.openScores(mode));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  Blip.muteButton($('muteBtn'));

  // ---- how to play ------------------------------------------------------------------------------
  const help = Tutorial.create('snake', [
    {
      emoji: '🐍', title: 'Eat, grow, don\'t crash',
      html: `<p>Steer the snake to the 🍎 apples. Every apple makes you longer and a little faster.</p>
        <p>Run into a wall or your own tail and it's game over.</p>`
    },
    {
      emoji: '🕹️', title: 'Steering',
      html: `<table>
          <tr><td>📱 Phone</td><td>Swipe on the board, or use the arrow buttons under it.</td></tr>
          <tr><td>⌨️ Keyboard</td><td><b>Arrow keys</b> or <b>WASD</b>. <b>P</b> pauses.</td></tr>
        </table>
        <div class="tut-tip">Quick double turns work: tap ▼ then ◀ fast to U-turn.</div>`
    },
    {
      emoji: '⭐', title: 'Bonus points',
      html: `<p>Every 5th apple brings a <b>golden star</b> worth 5 apples. Grab it before its ring runs out!</p>
        <p><b>Wrap-around</b> mode lets you go through walls. <b>Faster speeds</b> score double or triple.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  reset();
  requestAnimationFrame(frame);
  help.autoOpen();
})();
