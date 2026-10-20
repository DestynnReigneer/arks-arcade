'use strict';

// Block Drop: the page. Rules are in blocks-engine.js; this handles keys,
// buttons that repeat while held, touch gestures on the well, drawing and
// sound.

(() => {
  const { $ } = ArcadeKit;
  const E = BlocksEngine;
  const VISIBLE = E.ROWS - E.HIDDEN;
  const DAS = 0.17, ARR = 0.045;          // hold-to-repeat: first delay, then every
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

  let mode = E.MODES[recall('blocks.mode', '')] ? recall('blocks.mode', '') : 'marathon';
  let g = null;
  let state = 'ready';                    // ready | playing | paused | over
  let last = performance.now();
  let held = null;                        // { dir, t, fired } for left/right
  let soft = false;
  let flashes = [], popups = [], shake = 0;

  const shell = GameShell.create({ game: 'blocks', boards: E.MODES, mount: $('stage'), onAgain: () => { reset(); start(); } });
  // 4 cells for hold, 10 for the well, 4 for next, plus a little air.
  const W_CELLS = 18.6;
  const view = GameShell.fitCanvas($('canvas'), { aspect: W_CELLS / (VISIBLE + 0.6), maxHeight: () => Math.max(320, window.innerHeight * 0.6) });

  function paintOptions() {
    const box = $('modeSeg');
    box.innerHTML = '';
    for (const [id, label] of Object.entries(E.MODES)) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(id === mode));
      b.onclick = () => { mode = id; store('blocks.mode', id); reset(); };
      box.appendChild(b);
    }
  }

  function reset() {
    g = E.create({ mode });
    state = 'ready';
    flashes = []; popups = []; held = null; soft = false;
    shell.hideOver();
    document.body.dataset.state = 'ready';
    paintOptions();
    $('options').classList.remove('hidden');
    message('Ready?', mode === 'rush' ? 'Score as much as you can in two minutes. Tap to start.' : 'Tap the well or press any key to start.');
    hud();
  }
  function start() {
    if (state !== 'ready') return;
    Blip.unlock();
    state = 'playing';
    last = performance.now();
    $('options').classList.add('hidden');
    message(null);
    document.body.dataset.state = 'playing';
    if (window.ArcadeStats) ArcadeStats.play();
  }
  function pause(on = state === 'playing') {
    if (on && state === 'playing') { state = 'paused'; held = null; soft = false; message('Paused', 'Tap or press P to keep going.'); }
    else if (!on && state === 'paused') { state = 'playing'; last = performance.now(); message(null); }
    $('pauseBtn').textContent = state === 'paused' ? '▶' : '⏸';
  }
  function message(title, text) {
    $('stageMsg').classList.toggle('hidden', !title);
    if (title) { $('stageMsg').firstElementChild.textContent = title; $('stageMsg').lastElementChild.textContent = text || ''; }
  }
  function hud() {
    $('score').textContent = g.score.toLocaleString('en-US');
    $('lines').textContent = g.lines;
    if (mode === 'rush') {
      const left = Math.max(0, E.RUSH_SECONDS - g.time);
      $('levelLabel').textContent = 'Time';
      $('level').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    } else {
      $('levelLabel').textContent = 'Level';
      $('level').textContent = g.level;
    }
    $('best').textContent = shell.best(mode).toLocaleString('en-US');
  }

  // ---- actions --------------------------------------------------------------------------------
  function act(name) {
    if (state === 'ready') { start(); if (name !== 'left' && name !== 'right') return; }
    if (state === 'paused') { pause(false); return; }
    if (state !== 'playing') return;
    if (name === 'left') E.move(g, -1);
    else if (name === 'right') E.move(g, 1);
    else if (name === 'cw') E.rotate(g, 1);
    else if (name === 'ccw') E.rotate(g, -1);
    else if (name === 'drop') E.hardDrop(g);
    else if (name === 'hold') E.hold(g);
    react();
  }
  function press(dir) { if (state === 'ready') start(); if (state !== 'playing') return; act(dir); held = { dir, t: 0, fired: false }; }
  function release(dir) { if (held && held.dir === dir) held = null; }

  function react() {
    for (const ev of g.events) {
      if (ev === 'move') Blip.tone(180, 0.02, { type: 'square', volume: 0.025 });
      else if (ev === 'rotate') Blip.tone(300, 0.03, { type: 'square', volume: 0.03 });
      else if (ev === 'hold') Blip.tone([400, 600], 0.06, { type: 'triangle', volume: 0.04 });
      else if (ev === 'harddrop') { Blip.tone(110, 0.08, { type: 'square', volume: 0.06 }); shake = 4; }
      else if (ev === 'lock') Blip.tone(140, 0.04, { type: 'square', volume: 0.035 });
      else if (ev.startsWith('clear:')) {
        const n = Number(ev.slice(6));
        Blip.tune(n === 4 ? [[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.2]] : [[660 + n * 80, 0.06], [880 + n * 80, 0.1]], { type: 'square', volume: 0.05 });
        flashes.push(...g.cleared.map(y => ({ y, t: 0.25 })));
        if (n === 4) pop('FOUR LINES!', '#2de2e6');
        else if (n > 1 && !g.events.includes('tspin')) pop(['', '', 'Double', 'Triple'][n], '#fff');
      } else if (ev === 'tspin') pop('T-SPIN!', '#c86bff');
      else if (ev === 'b2b') pop('Back-to-back', '#ffc72c', 1);
      else if (ev === 'perfect') pop('PERFECT CLEAR!', '#3ddc84', 2);
      else if (ev === 'levelup') { pop(`Level ${g.level}`, '#ff9f2c', 1); Blip.tune([[784, 0.08], [1047, 0.15]], { type: 'triangle', volume: 0.05 }); }
      else if (ev === 'over') end();
    }
    if (g.combo > 1 && g.events.some(e => e.startsWith('clear:'))) pop(`Combo ×${g.combo}`, '#ff4fa3', 1);
    hud();
  }
  function pop(text, color, slot = 0) { popups.push({ text, color, t: 1.2, slot }); }

  function end() {
    state = 'over';
    held = null; soft = false;
    if (g.timeUp) Blip.tune([[784, 0.1], [659, 0.1], [523, 0.25]], { type: 'square', volume: 0.05 });
    else { Blip.noise(0.3, 0.14); Blip.tone([300, 60], 0.5, { type: 'sawtooth', volume: 0.07 }); }
    const detail = `${g.lines} line${g.lines === 1 ? '' : 's'} · level ${g.level}${g.tetrises ? ` · ${g.tetrises}× four lines` : ''}`;
    setTimeout(() => shell.over({ score: g.score, board: mode, detail, title: g.timeUp ? 'Time\'s up!' : undefined }), 500);
  }

  // ---- loop -------------------------------------------------------------------------------------
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing' && !help.isOpen) {
      if (held) {
        held.t += dt;
        if (!held.fired && held.t >= DAS) { held.fired = true; held.t -= DAS; act(held.dir); }
        while (held && held.fired && held.t >= ARR) { held.t -= ARR; if (!E.move(g, held.dir === 'left' ? -1 : 1)) break; }
      }
      E.update(g, dt, { soft });
      react();
    }
    for (const f of flashes) f.t -= dt;
    flashes = flashes.filter(f => f.t > 0);
    for (const p of popups) p.t -= dt;
    popups = popups.filter(p => p.t > 0);
    shake = Math.max(0, shake - dt * 30);
    draw();
    requestAnimationFrame(frame);
  }

  // ---- drawing ------------------------------------------------------------------------------------
  function shadeHex(hex, f) {
    const n = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${n.map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)).join(',')})`;
  }
  function block(ctx, x, y, s, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = shadeHex(color, -0.35);
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = shadeHex(color, 0.35);
    ctx.fillRect(x + 1, y + 1, s - 2, Math.max(2, s * 0.18));
    ctx.fillStyle = shadeHex(color, -0.15);
    ctx.fillRect(x + 1, y + s - 1 - Math.max(2, s * 0.14), s - 2, Math.max(2, s * 0.14));
    ctx.globalAlpha = 1;
  }
  function mini(ctx, type, cx, cy, s, dim) {
    const cells = E.ROTATIONS[type][0];
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
    for (const [x, y] of cells) block(ctx, cx + (x - Math.min(...xs) - w / 2) * s, cy + (y - Math.min(...ys) - h / 2) * s, s, E.COLORS[type], dim ? 0.35 : 1);
  }

  function draw() {
    const { ctx, size } = view;
    const w = size.w, h = size.h;
    const c = w / W_CELLS;
    const wx = c * 4.3, wy = c * 0.3;
    ctx.save();
    if (shake) ctx.translate(0, shake);
    ctx.fillStyle = '#0d0c16';
    ctx.fillRect(0, -10, w, h + 20);

    // well
    ctx.fillStyle = '#100f1c';
    ctx.fillRect(wx, wy, c * E.COLS, c * VISIBLE);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 1; x < E.COLS; x++) { ctx.beginPath(); ctx.moveTo(wx + x * c, wy); ctx.lineTo(wx + x * c, wy + c * VISIBLE); ctx.stroke(); }
    for (let y = 1; y < VISIBLE; y++) { ctx.beginPath(); ctx.moveTo(wx, wy + y * c); ctx.lineTo(wx + c * E.COLS, wy + y * c); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(200,107,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(wx - 1, wy - 1, c * E.COLS + 2, c * VISIBLE + 2);

    const cellY = y => wy + (y - E.HIDDEN) * c;
    for (let y = E.HIDDEN; y < E.ROWS; y++) for (let x = 0; x < E.COLS; x++) {
      const t = g.board[y][x];
      if (t) block(ctx, wx + x * c, cellY(y), c, state === 'over' ? '#55506a' : E.COLORS[t]);
    }
    for (const f of flashes) {
      if (f.y < E.HIDDEN) continue;
      ctx.fillStyle = `rgba(255,255,255,${(f.t / 0.25) * 0.8})`;
      ctx.fillRect(wx, cellY(f.y), c * E.COLS, c);
    }

    if (g.piece && state !== 'over') {
      // ghost
      const gy = E.ghostY(g);
      ctx.strokeStyle = shadeHex(E.COLORS[g.piece.type], 0.1);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      for (const [x, y] of E.cellsOf({ ...g.piece, y: gy })) if (y >= E.HIDDEN) ctx.strokeRect(wx + x * c + 2, cellY(y) + 2, c - 4, c - 4);
      ctx.globalAlpha = 1;
      for (const [x, y] of E.cellsOf(g.piece)) if (y >= E.HIDDEN) block(ctx, wx + x * c, cellY(y), c, E.COLORS[g.piece.type]);
    }

    // side boxes
    ctx.fillStyle = '#c9b98a';
    ctx.font = `700 ${Math.max(9, c * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HOLD', c * 2.1, wy + c * 0.75);
    ctx.fillText('NEXT', wx + c * E.COLS + c * 2.15, wy + c * 0.75);
    ctx.fillStyle = '#151424';
    ctx.fillRect(c * 0.3, wy + c * 1.1, c * 3.6, c * 3);
    ctx.fillRect(wx + c * E.COLS + c * 0.35, wy + c * 1.1, c * 3.6, c * 9);
    if (g.hold) mini(ctx, g.hold, c * 2.1, wy + c * 2.6, c * 0.75, !g.canHold);
    g.queue.slice(0, 3).forEach((t, i) => mini(ctx, t, wx + c * E.COLS + c * 2.15, wy + c * 2.6 + i * c * 2.9, c * (i ? 0.62 : 0.75)));

    // popups float up from the middle of the well
    ctx.textAlign = 'center';
    for (const p of popups) {
      const rise = (1.2 - p.t) * c * 1.2;
      ctx.globalAlpha = Math.min(1, p.t * 2);
      ctx.fillStyle = p.color;
      ctx.font = `800 ${c * (p.slot ? 0.7 : 0.95)}px system-ui, sans-serif`;
      ctx.fillText(p.text, wx + c * E.COLS / 2, wy + c * (7 + p.slot * 1.3) - rise);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- keyboard ----------------------------------------------------------------------------------
  window.addEventListener('keydown', e => {
    if (help.isOpen || e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key;
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'x', 'X', 'z', 'Z', 'c', 'C', 'Shift', 'p', 'P', 'Escape'];
    if (!handled.includes(k)) { if (state === 'ready' && k.length === 1) start(); return; }
    e.preventDefault();
    if (k === 'p' || k === 'P' || k === 'Escape') { pause(); return; }
    if (state === 'ready') { start(); return; }
    if (e.repeat) return;   // we do our own repeat for left/right
    if (k === 'ArrowLeft') press('left');
    else if (k === 'ArrowRight') press('right');
    else if (k === 'ArrowDown') soft = true;
    else if (k === 'ArrowUp' || k === 'x' || k === 'X') act('cw');
    else if (k === 'z' || k === 'Z') act('ccw');
    else if (k === ' ') act('drop');
    else if (k === 'c' || k === 'C' || k === 'Shift') act('hold');
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft') release('left');
    if (e.key === 'ArrowRight') release('right');
    if (e.key === 'ArrowDown') soft = false;
  });

  // ---- buttons -------------------------------------------------------------------------------------
  for (const b of document.querySelectorAll('#pad .pad-btn')) {
    const name = b.dataset.act;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* fine */ }
      b.classList.add('held');
      if (name === 'left' || name === 'right') press(name);
      else if (name === 'soft') { if (state === 'ready') start(); soft = state === 'playing'; }
      else act(name);
    });
    const up = () => {
      b.classList.remove('held');
      if (name === 'left' || name === 'right') release(name);
      if (name === 'soft') soft = false;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }

  // ---- gestures on the well: tap turns, drag moves, flick down drops, swipe up holds -------------
  (() => {
    const stage = $('stage');
    let t = null;
    stage.addEventListener('pointerdown', e => {
      if (state === 'ready') { start(); return; }
      if (state === 'paused') { pause(false); return; }
      t = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, start: performance.now(), moved: false, softRows: 0 };
      try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ }
    });
    stage.addEventListener('pointermove', e => {
      if (!t || state !== 'playing') return;
      const cell = view.size.w / W_CELLS;
      while (e.clientX - t.lastX > cell) { E.move(g, 1); t.lastX += cell; t.moved = true; }
      while (t.lastX - e.clientX > cell) { E.move(g, -1); t.lastX -= cell; t.moved = true; }
      // A slow drag down nudges the piece down a row at a time.
      while (e.clientY - t.lastY > cell * 1.2 && performance.now() - t.start > 160) {
        const before = g.piece.y;
        E.update(g, E.fallSeconds(g.level) + 0.0001);
        if (g.piece && g.piece.y > before) g.score += 1;
        t.lastY += cell * 1.2; t.moved = true;
      }
      react();
    });
    stage.addEventListener('pointerup', e => {
      if (!t || state !== 'playing') { t = null; return; }
      const dx = e.clientX - t.x, dy = e.clientY - t.y, ms = performance.now() - t.start;
      const cell = view.size.w / W_CELLS;
      if (dy > cell * 2.5 && ms < 260 && Math.abs(dy) > Math.abs(dx) * 1.5) act('drop');
      else if (-dy > cell * 2.5 && ms < 400 && Math.abs(dy) > Math.abs(dx) * 1.5) act('hold');
      else if (!t.moved && Math.hypot(dx, dy) < 10 && ms < 300) {
        // Tap the left third to turn back, anywhere else to turn forward.
        const r = $('canvas').getBoundingClientRect();
        act(e.clientX - r.left < r.width * 0.3 ? 'ccw' : 'cw');
      }
      t = null;
    });
    stage.addEventListener('pointercancel', () => { t = null; });
  })();

  $('pauseBtn').addEventListener('click', () => (state === 'ready' ? start() : pause()));
  $('scoresBtn').addEventListener('click', () => shell.openScores(mode));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  Blip.muteButton($('muteBtn'));

  const help = Tutorial.create('blocks', [
    {
      emoji: '🟪', title: 'Fill the rows',
      html: `<p>Pieces fall into the well. Move and turn them so they fit together. A row with no gaps disappears and scores points.</p>
        <p>If the pile reaches the top, it's game over.</p>`
    },
    {
      emoji: '👆', title: 'Controls',
      html: `<table>
          <tr><td>Tap the well</td><td>Turn (tap the left side to turn back)</td></tr>
          <tr><td>Drag</td><td>Move left and right; drag slowly down to lower it</td></tr>
          <tr><td>Flick down</td><td>Drop it all the way</td></tr>
          <tr><td>Swipe up</td><td>Hold: save the piece for later</td></tr>
        </table>
        <p>The buttons under the well do the same. Keyboard: <b>← →</b> move, <b>↑</b> turn, <b>↓</b> down, <b>Space</b> drop, <b>C</b> hold.</p>`
    },
    {
      emoji: '🏆', title: 'Big points',
      html: `<p>Clearing more rows at once is worth much more: 1 row 100, 2 rows 300, 3 rows 500, <b>4 rows 800</b>, times your level.</p>
        <p>Clear rows piece after piece for a <b>combo</b>. Every 10 rows the level goes up and pieces fall faster.</p>
        <div class="tut-tip"><b>2-Minute Rush</b>: score as much as you can before the clock runs out.</div>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  reset();
  requestAnimationFrame(frame);
  help.autoOpen();
})();
