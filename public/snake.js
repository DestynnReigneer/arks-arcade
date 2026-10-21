'use strict';

// Snake: the page. The rules live in snake-engine.js; this draws the board,
// reads arrows, swipes and the on-screen pad, and plays the sounds.

(() => {
  const { $ } = ArcadeKit;
  const E = SnakeEngine;
  const COLS = 24, ROWS = 24;
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

  let mode = E.MODES[recall('snake.mode', '')] ? recall('snake.mode', '') : 'classic';
  let speed = E.SPEEDS[recall('snake.speed', '')] ? recall('snake.speed', '') : 'normal';
  let g = null;
  let state = 'ready';            // ready | playing | paused | over
  let acc = 0, last = performance.now();
  let particles = [], shake = 0, flash = 0, pulse = 0;
  let before = null;              // where the snake was last tick, so it can glide between squares

  const shell = GameShell.create({
    game: 'snake', boards: E.MODES, mount: $('stage'),
    onAgain: () => { reset(); start(); }
  });
  const view = GameShell.fitCanvas($('canvas'), { aspect: 1, maxHeight: () => Math.max(280, window.innerHeight * 0.66) });

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
    before = null;
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
    before = g.snake.map(p => ({ ...p }));
    E.step(g);
    if (g.over) before = null;
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
    Blip.musicPlaying(state === 'playing');
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
  function shade(t, light = 0) {
    const r = Math.round(lerp(96, 22, t)), gg = Math.round(lerp(240, 140, t)), b = Math.round(lerp(150, 70, t));
    const up = v => Math.round(v + (255 - v) * light);
    return `rgb(${up(r)},${up(gg)},${up(b)})`;
  }

  // Where each piece of the snake is right now, part way between squares.
  function bodyPoints() {
    const s = g.snake;
    const k = state === 'playing' && before ? Math.min(1, acc / E.interval(g)) : 1;
    return s.map((p, i) => {
      const from = before ? (before[i] || before[before.length - 1]) : p;
      // Coming through a wall: jump instead of sliding across the board.
      if (Math.abs(from.x - p.x) + Math.abs(from.y - p.y) > 1) return { x: p.x, y: p.y, jump: true };
      return { x: lerp(from.x, p.x, k), y: lerp(from.y, p.y, k) };
    });
  }

  let boardArt = null, boardKey = '';
  function paintBoard(w, h, c) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const bg = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.75);
    bg.addColorStop(0, '#1a2a22'); bg.addColorStop(1, '#0c1410');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if ((x + y) % 2) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(x * c, y * c, c, c);
    }
    ctx.fillStyle = 'rgba(61,220,132,0.08)';
    for (let y = 1; y < ROWS; y++) for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.arc(x * c, y * c, Math.max(0.8, c * 0.05), 0, Math.PI * 2); ctx.fill(); }
    return cv;
  }

  function draw() {
    const { ctx, size } = view;
    const w = size.w, h = size.h, c = w / COLS;
    const key = `${w}|${h}|${window.devicePixelRatio || 1}`;
    if (key !== boardKey) { boardArt = paintBoard(w, h, c); boardKey = key; }
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.fillStyle = '#0c1410';
    ctx.fillRect(-20, -20, w + 40, h + 40);
    ctx.drawImage(boardArt, 0, 0, w, h);
    // The edge of the board: solid walls in Classic, a dashed portal in Wrap.
    ctx.lineWidth = 3;
    if (mode === 'wrap') {
      ctx.strokeStyle = `rgba(46,155,255,${0.45 + Math.sin(pulse * 3) * 0.15})`;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(61,220,132,0.55)';
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    }

    // Food: a shiny apple that bobs a little
    if (g.food) {
      const fx = (g.food.x + 0.5) * c, fy = (g.food.y + 0.5) * c + Math.sin(pulse * 4) * c * 0.04, r = c * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(fx, (g.food.y + 0.9) * c, r * 0.7, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = '#ff4d5e'; ctx.shadowBlur = c * 0.5;
      const ap = ctx.createRadialGradient(fx - r * 0.3, fy - r * 0.3, r * 0.1, fx, fy, r);
      ap.addColorStop(0, '#ff8a8a'); ap.addColorStop(1, '#d81e3a');
      ctx.fillStyle = ap;
      ctx.beginPath(); ctx.arc(fx, fy + c * 0.03, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(fx - r * 0.38, fy - r * 0.25, r * 0.18, r * 0.28, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6b3d1f'; ctx.lineWidth = Math.max(1.5, c * 0.07);
      ctx.beginPath(); ctx.moveTo(fx, fy - r * 0.8); ctx.lineTo(fx + r * 0.1, fy - r * 1.15); ctx.stroke();
      ctx.fillStyle = '#3ddc84';
      ctx.beginPath(); ctx.ellipse(fx + r * 0.4, fy - r * 1.0, r * 0.38, r * 0.17, -0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (g.gold) {
      const gx = (g.gold.x + 0.5) * c, gy = (g.gold.y + 0.5) * c;
      const left = g.gold.ttl / E.GOLD_TICKS;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(Math.sin(pulse * 2) * 0.25);
      ctx.shadowColor = '#ffc72c';
      ctx.shadowBlur = 12 + Math.sin(pulse * 8) * 5;
      star(ctx, 0, 0, c * 0.48, c * 0.21, '#ffd23f');
      ctx.restore();
      ctx.strokeStyle = left < 0.3 ? 'rgba(255,94,94,0.9)' : 'rgba(255,210,63,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(gx, gy, c * 0.62, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke();
    }

    // Body: a smooth tube through the pieces, with an outline, a shine and
    // a pattern, broken where it goes through a wall.
    const pts = bodyPoints();
    const n = pts.length;
    const at = p => [(p.x + 0.5) * c, (p.y + 0.5) * c];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const tube = (width, color, offset = 0) => {
      for (let i = n - 1; i > 0; i--) {
        const a = pts[i], b = pts[i - 1];
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1.5) continue;
        const [ax, ay] = at(a), [bx, by] = at(b);
        ctx.strokeStyle = typeof color === 'function' ? color(i / Math.max(1, n - 1)) : color;
        ctx.lineWidth = width * (1 - (i / n) * 0.25);
        ctx.beginPath(); ctx.moveTo(ax, ay + offset); ctx.lineTo(bx, by + offset); ctx.stroke();
      }
    };
    tube(c * 0.86, 'rgba(0,0,0,0.3)', c * 0.12);          // shadow
    tube(c * 0.86, '#0d3b22');                            // outline
    tube(c * 0.72, t => shade(t));                        // body
    tube(c * 0.26, t => shade(t, 0.35), -c * 0.14);       // shine along the back
    // little spots every other piece
    for (let i = 2; i < n; i += 2) {
      if (pts[i].jump) continue;
      const [x, y] = at(pts[i]);
      ctx.fillStyle = 'rgba(10,60,30,0.35)';
      ctx.beginPath(); ctx.arc(x, y + c * 0.08, c * 0.11 * (1 - (i / n) * 0.3), 0, Math.PI * 2); ctx.fill();
    }

    // Head with eyes looking where it's going
    const [hx, hy] = at(pts[0]);
    const dead = state === 'over' && flash > 0;
    ctx.fillStyle = '#0d3b22';
    ctx.beginPath(); ctx.arc(hx, hy, c * 0.5, 0, Math.PI * 2); ctx.fill();
    const hg = ctx.createRadialGradient(hx - c * 0.12, hy - c * 0.15, c * 0.05, hx, hy, c * 0.48);
    hg.addColorStop(0, dead ? '#ffb0b0' : '#b6ffd2'); hg.addColorStop(1, dead ? '#ff5e5e' : '#4fe892');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(hx, hy, c * 0.44, 0, Math.PI * 2); ctx.fill();
    const [dx, dy] = E.DIRS[g.dir];
    const px = -dy, py = dx;
    for (const side of [-1, 1]) {
      const ex = hx + dx * c * 0.12 + px * side * c * 0.21, ey = hy + dy * c * 0.12 + py * side * c * 0.21;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, c * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      if (dead) {
        ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.2, c * 0.05);
        ctx.beginPath(); ctx.moveTo(ex - c * 0.07, ey - c * 0.07); ctx.lineTo(ex + c * 0.07, ey + c * 0.07); ctx.moveTo(ex + c * 0.07, ey - c * 0.07); ctx.lineTo(ex - c * 0.07, ey + c * 0.07); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(ex + dx * c * 0.05, ey + dy * c * 0.05, c * 0.07, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex + dx * c * 0.05 - c * 0.025, ey + dy * c * 0.05 - c * 0.025, c * 0.025, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (state === 'playing' && Math.sin(pulse * 3) > 0.85) {
      ctx.strokeStyle = '#ff5e7a';
      ctx.lineWidth = Math.max(1.5, c * 0.07);
      const tx = hx + dx * c * 0.75, ty = hy + dy * c * 0.75;
      ctx.beginPath();
      ctx.moveTo(hx + dx * c * 0.45, hy + dy * c * 0.45);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx + (dx + px) * c * 0.12, ty + (dy + py) * c * 0.12);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + (dx - px) * c * 0.12, ty + (dy - py) * c * 0.12);
      ctx.stroke();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 1.6);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x * c, p.y * c, Math.max(1.5, c * 0.1), 0, Math.PI * 2); ctx.fill();
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
  Blip.musicButton($('musicBtn'));
  Blip.music('snake');

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
