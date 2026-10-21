'use strict';

// Block Drop: the page. Rules are in blocks-engine.js; this handles keys,
// buttons that repeat while held, touch gestures on the well, drawing and
// sound.

(() => {
  const { $ } = ArcadeKit;
  const E = BlocksEngine;
  const VISIBLE = E.ROWS - E.HIDDEN;
  const DAS = 0.17, ARR = 0.045;          // hold-to-repeat: first delay, then every
  // Down: a press nudges the piece down and speeds it up; holding it a bit
  // longer than a press sends it all the way down.
  const HOLD_TO_DROP = 0.35;
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

  let mode = E.MODES[recall('blocks.mode', '')] ? recall('blocks.mode', '') : 'marathon';
  let g = null;
  let state = 'ready';                    // ready | playing | paused | over
  let last = performance.now();
  let held = null;                        // { dir, t, fired } for left/right
  let down = null;                        // { src, t, dropped } while down is held
  let flashes = [], popups = [], sparks = [], shake = 0;

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
    flashes = []; popups = []; sparks = []; held = null; down = null;
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
    if (on && state === 'playing') { state = 'paused'; held = null; down = null; message('Paused', 'Tap or press P to keep going.'); }
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

  function downStart(src) {
    if (state === 'ready') { start(); return; }
    if (state === 'paused') { pause(false); return; }
    if (state !== 'playing' || down) return;
    down = { src, t: 0, dropped: false };
    if (E.softStep(g)) react();
  }
  function downEnd(src) { if (down && down.src === src) down = null; }

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
        flashes.push(...g.cleared.map(y => ({ y, t: 0.3 })));
        burstRows(g.cleared);
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
  // Sparks fly out of cleared rows.
  function burstRows(rows) {
    const c = view.size.w / W_CELLS, wx = c * 4.3, wy = c * 0.3;
    for (const y of rows) for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 180;
      sparks.push({ x: wx + Math.random() * c * E.COLS, y: wy + (y - E.HIDDEN + 0.5) * c, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.5 + Math.random() * 0.3, color: ['#ffffff', '#ffd23f', '#c86bff', '#2de2e6'][i % 4] });
    }
  }
  function pop(text, color, slot = 0) { popups.push({ text, color, t: 1.2, slot }); }

  function end() {
    state = 'over';
    held = null; down = null;
    if (g.timeUp) Blip.tune([[784, 0.1], [659, 0.1], [523, 0.25]], { type: 'square', volume: 0.05 });
    else { Blip.noise(0.3, 0.14); Blip.tone([300, 60], 0.5, { type: 'sawtooth', volume: 0.07 }); }
    const detail = `${g.lines} line${g.lines === 1 ? '' : 's'} · level ${g.level}${g.tetrises ? ` · ${g.tetrises}× four lines` : ''}`;
    setTimeout(() => shell.over({ score: g.score, board: mode, detail, title: g.timeUp ? 'Time\'s up!' : undefined }), 500);
  }

  // ---- loop -------------------------------------------------------------------------------------
  function frame(now) {
    Blip.musicPlaying(state === 'playing');
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing' && !help.isOpen) {
      if (held) {
        held.t += dt;
        if (!held.fired && held.t >= DAS) { held.fired = true; held.t -= DAS; act(held.dir); }
        while (held && held.fired && held.t >= ARR) { held.t -= ARR; if (!E.move(g, held.dir === 'left' ? -1 : 1)) break; }
      }
      if (down) {
        down.t += dt;
        // Held past a press: all the way down (once, until it's let go).
        if (!down.dropped && down.t >= HOLD_TO_DROP) { down.dropped = true; act('drop'); }
      }
      if (state === 'playing') {
        E.update(g, dt, { soft: !!down && !down.dropped });
        react();
      }
    }
    for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt; }
    sparks = sparks.filter(p => p.life > 0);
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
  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // A shiny, slightly rounded square with a bevel.
  function block(ctx, x, y, s, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    const r = Math.max(1.5, s * 0.16);
    ctx.fillStyle = shadeHex(color, -0.45);
    rounded(ctx, x + 0.5, y + 0.5, s - 1, s - 1, r);
    ctx.fill();
    const grad = ctx.createLinearGradient(x, y, x + s, y + s);
    grad.addColorStop(0, shadeHex(color, 0.3));
    grad.addColorStop(1, shadeHex(color, -0.15));
    ctx.fillStyle = grad;
    rounded(ctx, x + 1.5, y + 1.5, s - 3, s - 3.5, r * 0.8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    rounded(ctx, x + s * 0.18, y + s * 0.14, s * 0.64, s * 0.2, s * 0.1);
    ctx.fill();
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
    const now = performance.now() / 1000;
    ctx.save();
    if (shake) ctx.translate(0, shake);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#171230'); bg.addColorStop(1, '#0a0912');
    ctx.fillStyle = bg;
    ctx.fillRect(0, -10, w, h + 20);

    // well, with a glow that gets warmer as the stack gets high
    let topRow = E.ROWS;
    for (let y = 0; y < E.ROWS; y++) if (g.board[y].some(Boolean)) { topRow = y; break; }
    const danger = Math.max(0, Math.min(1, (8 - (topRow - E.HIDDEN)) / 6));
    const well = ctx.createLinearGradient(0, wy, 0, wy + c * VISIBLE);
    well.addColorStop(0, '#0c0b18'); well.addColorStop(1, '#151330');
    ctx.fillStyle = well;
    ctx.fillRect(wx, wy, c * E.COLS, c * VISIBLE);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let x = 1; x < E.COLS; x++) { ctx.beginPath(); ctx.moveTo(wx + x * c, wy); ctx.lineTo(wx + x * c, wy + c * VISIBLE); ctx.stroke(); }
    for (let y = 1; y < VISIBLE; y++) { ctx.beginPath(); ctx.moveTo(wx, wy + y * c); ctx.lineTo(wx + c * E.COLS, wy + y * c); ctx.stroke(); }
    ctx.save();
    const edge = danger > 0 ? `rgba(255,${Math.round(110 - danger * 60)},${Math.round(120 - danger * 60)},${0.6 + Math.sin(now * 6) * 0.2 * danger})` : 'rgba(200,107,255,0.7)';
    ctx.shadowColor = danger > 0 ? '#ff5e5e' : '#c86bff';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(wx - 1, wy - 1, c * E.COLS + 2, c * VISIBLE + 2);
    ctx.restore();

    const cellY = y => wy + (y - E.HIDDEN) * c;
    for (let y = E.HIDDEN; y < E.ROWS; y++) for (let x = 0; x < E.COLS; x++) {
      const t = g.board[y][x];
      if (t) block(ctx, wx + x * c, cellY(y), c, state === 'over' ? '#55506a' : E.COLORS[t]);
    }
    for (const f of flashes) {
      if (f.y < E.HIDDEN) continue;
      const k = f.t / 0.3;
      ctx.fillStyle = `rgba(255,255,255,${k * 0.85})`;
      ctx.fillRect(wx - (1 - k) * c, cellY(f.y) + (1 - k) * c * 0.4, c * E.COLS + (1 - k) * c * 2, c * (0.2 + k * 0.8));
    }

    if (g.piece && state !== 'over') {
      // ghost: brighter while down is held, filling up as it gets close to dropping
      const gy = E.ghostY(g);
      const color = E.COLORS[g.piece.type];
      const charge = down && !down.dropped ? Math.min(1, down.t / HOLD_TO_DROP) : 0;
      for (const [x, y] of E.cellsOf({ ...g.piece, y: gy })) {
        if (y < E.HIDDEN) continue;
        ctx.globalAlpha = 0.18 + charge * 0.35;
        ctx.fillStyle = color;
        rounded(ctx, wx + x * c + 2, cellY(y) + 2, c - 4, c - 4, c * 0.12); ctx.fill();
        ctx.globalAlpha = 0.6 + charge * 0.4;
        ctx.strokeStyle = shadeHex(color, 0.2);
        ctx.lineWidth = 1.5;
        rounded(ctx, wx + x * c + 2, cellY(y) + 2, c - 4, c - 4, c * 0.12); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = c * 0.5;
      for (const [x, y] of E.cellsOf(g.piece)) if (y >= E.HIDDEN) block(ctx, wx + x * c, cellY(y), c, color);
      ctx.restore();
    }

    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // side boxes
    const box = (x, y, bw, bh) => {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      rounded(ctx, x, y, bw, bh, c * 0.3); ctx.fill();
      ctx.strokeStyle = 'rgba(200,107,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    };
    ctx.fillStyle = '#d9c8ff';
    ctx.font = `800 ${Math.max(9, c * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HOLD', c * 2.1, wy + c * 0.75);
    ctx.fillText('NEXT', wx + c * E.COLS + c * 2.15, wy + c * 0.75);
    box(c * 0.3, wy + c * 1.1, c * 3.6, c * 3);
    box(wx + c * E.COLS + c * 0.35, wy + c * 1.1, c * 3.6, c * 9);
    if (g.hold) mini(ctx, g.hold, c * 2.1, wy + c * 2.6, c * 0.75, !g.canHold);
    g.queue.slice(0, 3).forEach((t, i) => mini(ctx, t, wx + c * E.COLS + c * 2.15, wy + c * 2.6 + i * c * 2.9, c * (i ? 0.62 : 0.75)));

    // popups float up from the middle of the well
    ctx.textAlign = 'center';
    for (const p of popups) {
      const rise = (1.2 - p.t) * c * 1.2;
      ctx.globalAlpha = Math.min(1, p.t * 2);
      ctx.font = `900 ${c * (p.slot ? 0.7 : 0.95)}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, c * 0.12);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(p.text, wx + c * E.COLS / 2, wy + c * (7 + p.slot * 1.3) - rise);
      ctx.fillStyle = p.color;
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
    else if (k === 'ArrowDown') downStart('key');
    else if (k === 'ArrowUp' || k === 'x' || k === 'X') act('cw');
    else if (k === 'z' || k === 'Z') act('ccw');
    else if (k === ' ') act('drop');
    else if (k === 'c' || k === 'C' || k === 'Shift') act('hold');
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft') release('left');
    if (e.key === 'ArrowRight') release('right');
    if (e.key === 'ArrowDown') downEnd('key');
  });

  // ---- buttons -------------------------------------------------------------------------------------
  for (const b of document.querySelectorAll('#pad .pad-btn')) {
    const name = b.dataset.act;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* fine */ }
      b.classList.add('held');
      if (name === 'left' || name === 'right') press(name);
      else if (name === 'soft') downStart('pad');
      else act(name);
    });
    const up = () => {
      b.classList.remove('held');
      if (name === 'left' || name === 'right') release(name);
      if (name === 'soft') downEnd('pad');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }

  // ---- gestures on the well: tap turns, drag moves, pull down (and hold) drops, swipe up holds ----
  (() => {
    const stage = $('stage');
    let t = null;
    stage.addEventListener('pointerdown', e => {
      if (state === 'ready') { start(); return; }
      if (state === 'paused') { pause(false); return; }
      t = { x: e.clientX, y: e.clientY, lastX: e.clientX, start: performance.now(), moved: false, pulling: false };
      try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ }
    });
    stage.addEventListener('pointermove', e => {
      if (!t || state !== 'playing') return;
      const cell = view.size.w / W_CELLS;
      while (e.clientX - t.lastX > cell) { E.move(g, 1); t.lastX += cell; t.moved = true; }
      while (t.lastX - e.clientX > cell) { E.move(g, -1); t.lastX -= cell; t.moved = true; }
      // Pulling down speeds the piece up; keep holding and it drops the rest
      // of the way. Sliding back up lets go.
      const dx = e.clientX - t.x, dy = e.clientY - t.y;
      if (!t.pulling && dy > cell * 0.9 && dy > Math.abs(dx)) { t.pulling = true; t.moved = true; downStart('touch'); }
      else if (t.pulling && dy < cell * 0.4) { t.pulling = false; downEnd('touch'); }
      react();
    });
    stage.addEventListener('pointerup', e => {
      downEnd('touch');
      if (!t || state !== 'playing') { t = null; return; }
      const dx = e.clientX - t.x, dy = e.clientY - t.y, ms = performance.now() - t.start;
      const cell = view.size.w / W_CELLS;
      if (-dy > cell * 2.5 && ms < 400 && Math.abs(dy) > Math.abs(dx) * 1.5) act('hold');
      else if (!t.moved && Math.hypot(dx, dy) < 10 && ms < 300) {
        // Tap the left third to turn back, anywhere else to turn forward.
        const r = $('canvas').getBoundingClientRect();
        act(e.clientX - r.left < r.width * 0.3 ? 'ccw' : 'cw');
      }
      t = null;
    });
    stage.addEventListener('pointercancel', () => { downEnd('touch'); t = null; });
  })();

  $('pauseBtn').addEventListener('click', () => (state === 'ready' ? start() : pause()));
  $('scoresBtn').addEventListener('click', () => shell.openScores(mode));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('blocks');

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
          <tr><td>Drag</td><td>Move left and right</td></tr>
          <tr><td>Pull down</td><td>Speeds it up. Keep holding a moment and it drops all the way</td></tr>
          <tr><td>Swipe up</td><td>Hold: save the piece for later</td></tr>
        </table>
        <p>The buttons under the well do the same. Keyboard: <b>← →</b> move, <b>↑</b> turn, <b>↓</b> down (hold to drop), <b>Space</b> drop, <b>C</b> hold.</p>`
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
