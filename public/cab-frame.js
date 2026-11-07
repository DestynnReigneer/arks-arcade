// The frame every 3D cabinet game runs in: the Start and Pause buttons, the score row, the settings, the stage with
// its callouts and speech bubbles, the big buttons under it, the input (touch, keyboard, controller, the TV remote),
// the 3-2-1 countdown, and the loop. A game page calls it once:
//
//   CabFrame.run({
//     game: CAB.games[0],          // the game (cab-engine.js and the game's own file)
//     root: $('cab'),              // the frame builds everything inside this
//     muteBtn: $('muteBtn'), musicBtn: $('musicBtn'),   // the top bar's buttons, already wired by blip.js
//     onStart: () => {},           // a run started (stats, closing the game-over panel)
//     onOver: game => {},          // the run ended: game.final() has the score to save
//   });
//
// A game is an object with init, reset, update(dt, live), press and release (or steer for the driving game), hud,
// and over/result once a run ends. See the top of any cab-*.js game for the full list.
const CabFrame = (() => {
  'use strict';

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };

  function run({ game: g, root, muteBtn, musicBtn, onStart, onOver }) {
    const CAB = window.CAB, S = CAB.sound;

    // ---------- the page parts ----------
    const bar = el('div', 'cab-bar');
    const goBtn = el('button', 'cab-go primary'); goBtn.type = 'button'; goBtn.textContent = 'Start'; goBtn.dataset.tvStart = '';
    const pauseBtn = el('button', 'cab-pause ghost'); pauseBtn.type = 'button'; pauseBtn.textContent = 'Pause'; pauseBtn.hidden = true;
    const hudEl = el('div', 'cab-hud'); hudEl.setAttribute('aria-live', 'off');
    bar.append(goBtn, pauseBtn, hudEl);
    const optsEl = el('div', 'cab-opts');
    const wrap = el('div', 'cab-wrap');
    const stage = el('div', 'cab-stage'); stage.id = 'stage'; stage.setAttribute('role', 'application'); stage.setAttribute('aria-label', g.name);
    stage.innerHTML = `
      <div class="cab-over"><div><div class="cab-big"></div><div class="cab-msg">Press Start</div></div></div>
      <div class="cab-call" hidden></div>
      <div class="cab-toast" hidden></div>
      <div class="cab-smeter" hidden><span>POWER</span><div><i></i><em></em></div></div>
      <div class="cab-hint l" hidden>◀ HOLD</div>
      <div class="cab-hint r" hidden>HOLD ▶</div>
      <div class="cab-wheelbar" hidden><div class="track"><span class="dz"></span><i class="mid"></i><b class="wheel"><svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="none" stroke="#fff" stroke-width="4"/><circle cx="20" cy="20" r="4" fill="#fff"/><path d="M4 20h12M24 20h12M20 24v12" stroke="#fff" stroke-width="4"/></svg></b></div></div>`;
    // the bots' speech bubbles sit over the game but may reach past its edges, so they don't crowd it
    const bubblesEl = el('div', 'cab-bubbles');
    wrap.append(stage, bubblesEl);
    const padEl = el('div', 'cab-pad');
    root.append(bar, optsEl, wrap, padEl);
    const q = sel => stage.querySelector(sel);
    const bigEl = q('.cab-big'), msgEl = q('.cab-msg'), callEl = q('.cab-call'), toastEl = q('.cab-toast');
    const hintL = q('.cab-hint.l'), hintR = q('.cab-hint.r'), smeter = q('.cab-smeter'), wheelbar = q('.cab-wheelbar');

    // ---------- callouts, toasts and speech bubbles ----------
    let toastT = 0, callT = 0;
    CAB.toast = (text, bad) => { toastEl.textContent = text; toastEl.className = 'cab-toast' + (bad ? ' bad' : ''); toastEl.hidden = false; toastT = 1.3; };
    // Take a banner down right away (Big Swing does this when a pitch starts, so nothing covers the ball).
    CAB.clearCall = () => { if (callT > 0) callT = 0.001; };
    CAB.call = (text, kind, sub, secs) => {
      callEl.className = 'cab-call ' + (kind || ''); callEl.innerHTML = '';
      const b = el('b'); b.textContent = text; callEl.appendChild(b);
      if (sub) { const s = el('small'); s.textContent = sub; callEl.appendChild(s); }
      callEl.hidden = false; void callEl.offsetWidth; callEl.classList.add('show'); callT = secs || 1.6;
    };
    let bubbles = {};
    CAB.say = (id, getPos, who, text, secs) => {
      let b = bubbles[id];
      if (!b) { const e = el('div', 'cab-bubble'); bubblesEl.appendChild(e); b = bubbles[id] = { el: e }; }
      b.el.innerHTML = ''; const w = el('b'); w.textContent = who; b.el.append(w, document.createTextNode(text));
      b.getPos = getPos; b.t = secs || 4.5; b.el.hidden = false;
    };
    const clearBubbles = () => { Object.keys(bubbles).forEach(k => bubbles[k].el.remove()); bubbles = {}; };
    const pv = new CAB.V3();
    function paintBubbles(dt) {
      const w = stage.clientWidth, h = stage.clientHeight;
      Object.keys(bubbles).forEach(k => {
        const b = bubbles[k]; b.t -= dt; if (b.t <= 0) { b.el.hidden = true; return; }
        pv.copy(b.getPos()).project(g.cam);
        // kept on the page, and allowed a little above the game
        const bw = b.el.offsetWidth, bh = b.el.offsetHeight, vw = document.documentElement.clientWidth, sx = stage.getBoundingClientRect().left;
        let bx = (pv.x * 0.5 + 0.5) * w, by = (-pv.y * 0.5 + 0.5) * h;
        bx = Math.max(bw / 2 + 4 - sx, Math.min(vw - sx - bw / 2 - 4, bx)); by = Math.max(bh + 4 - 70, by);
        b.el.style.left = Math.round(bx) + 'px'; b.el.style.top = Math.round(by) + 'px';
      });
    }

    // ---------- settings ----------
    g.opt = {};
    (g.options || []).forEach(o => { const v = store(`cab.${g.id}.${o.id}`); g.opt[o.id] = o.choices.some(c => c[0] === v) ? v : o.def; });
    function seg(o) {
      const box = el('div', 'cab-seg');
      const l = el('span'); l.textContent = o.label; box.appendChild(l);
      const pick = v => {
        g.opt[o.id] = v; store(`cab.${g.id}.${o.id}`, v);
        if (g.setOption) g.setOption(o.id, v);
        CAB.warm(g.scene, g.cam);
        if (phase !== 'idle' && phase !== 'over') stopGame('Settings changed. Press Start to play with them.'); else g.reset();
      };
      // a long list (like the Launcher's 20 levels) is a drop-down, so it doesn't run off the side of a phone
      if (o.choices.length > 6) {
        const sel = el('select', 'cab-pick'); sel.setAttribute('aria-label', o.label);
        o.choices.forEach(c => { const op = el('option'); op.value = c[0]; op.textContent = c[1]; op.selected = c[0] === g.opt[o.id]; sel.appendChild(op); });
        sel.addEventListener('change', () => pick(sel.value));
        box.appendChild(sel); return box;
      }
      const pills = el('div', 'cab-pills'); box.appendChild(pills);
      o.choices.forEach(c => {
        const b = el('button'); b.type = 'button'; b.textContent = c[1]; b.setAttribute('aria-pressed', c[0] === g.opt[o.id] ? 'true' : 'false');
        b.addEventListener('click', () => { Array.prototype.forEach.call(pills.children, x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); b.blur(); pick(c[0]); });
        pills.appendChild(b);
      });
      return box;
    }
    (g.options || []).forEach(o => optsEl.appendChild(seg(o)));
    optsEl.hidden = !(g.options || []).length;

    // the top bar's sound and music buttons (blip.js saves them; this follows along)
    const syncSound = () => { S.setSfx(!Blip.muted); S.setMusic(!Blip.muted && Blip.musicOn); };
    [muteBtn, musicBtn].forEach(b => b && b.addEventListener('click', () => setTimeout(syncSound, 0)));

    // ---------- the game ----------
    // A device or browser that can't draw 3D (WebGL turned off, or very old) gets a plain message instead of a broken page.
    try { CAB.attach(stage); } catch (e) {
      goBtn.disabled = true; padEl.hidden = true;
      msgEl.textContent = 'This game needs 3D graphics, and this browser has them turned off. Try another browser, or turn on hardware acceleration in this one\'s settings.';
      return { start() {}, stop() {}, pause() {}, resume() {}, phase: () => 'unsupported' };
    }
    g.init();
    const size = () => CAB.size([g.cam]);
    if (window.ResizeObserver) new ResizeObserver(size).observe(stage); else window.addEventListener('resize', size);
    g.reset(); size(); CAB.warm(g.scene, g.cam);
    CAB.renderer.shadowMap.enabled = !g.noShadow;
    g.pad.forEach(p => { const b = el('button'); b.type = 'button'; b.textContent = p[0]; b.dataset.act = p[1]; b.disabled = true; padEl.appendChild(b); });

    let phase = 'idle', count = 0, lastCount = 0, goFlash = 0, held = false, hintT = 0;
    const hintText = () => {
      if (g.drag) { const tap = g.opt.touch === 'tap'; hintL.textContent = tap ? '◀ TAP' : '◀ SLIDE'; hintR.textContent = tap ? 'TAP ▶' : 'SLIDE ▶'; }
    };
    hintText();

    // Blur the button so Space plays the game instead of pressing Start again.
    function start() {
      S.unlock(); Blip.unlock(); syncSound(); clearBubbles(); callEl.hidden = true;
      if (g.audio) g.audio('stop');
      hintText();
      g.reset(); phase = 'count'; count = 3; lastCount = 0; msgEl.textContent = ''; goBtn.textContent = 'Restart'; goBtn.blur();
      pauseBtn.hidden = false; pauseBtn.textContent = 'Pause'; hintT = g.steer ? 5 : 0;
      S.music(typeof g.track === 'function' ? g.track() : g.track);
      if (g.audio) g.audio('start');
      if (window.ArcadeStats) ArcadeStats.play();
      if (onStart) onStart();
    }
    function stopGame(text) {
      up(); if (g.steer) g.steer(null, false); if (g.audio) g.audio('stop'); S.stopMusic(0.3);
      phase = 'idle'; g.reset(); goBtn.textContent = 'Start'; pauseBtn.hidden = true; bigEl.textContent = ''; msgEl.textContent = text || 'Press Start';
    }
    function pause() {
      if (phase !== 'play' && phase !== 'count') return;
      up(); if (g.steer) g.steer(null, false);
      phase = 'paused'; bigEl.textContent = ''; msgEl.textContent = 'Paused. Press Resume when you\'re ready.'; pauseBtn.textContent = 'Resume';
      S.pauseMusic(); if (g.audio) g.audio('pause');
    }
    function resume() {
      if (phase !== 'paused') return;
      S.unlock(); phase = 'count'; count = 3; lastCount = 0; msgEl.textContent = ''; pauseBtn.textContent = 'Pause'; pauseBtn.blur();
      S.resumeMusic(); if (g.audio) g.audio('resume');
    }
    goBtn.addEventListener('click', start);
    pauseBtn.addEventListener('click', () => { if (phase === 'paused') resume(); else pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    window.addEventListener('pagehide', pause);

    // ---------- input ----------
    const canAct = () => phase === 'play';
    function down() { if (canAct()) { held = true; g.press(); } }
    function up() { if (held) { held = false; if (g.release) g.release(); } }

    // The Racer with Touch on Slide: a finger on the game slides left or right to steer, the further the harder, and
    // with the gas on Hold to go, touching is the gas. With Touch on Tap, the halves work like the arrow keys (below).
    const DRAG_PX = 110;
    stage.addEventListener('pointerdown', e => {
      S.unlock();
      if (g.drag && g.opt.touch !== 'tap') {
        if (!canAct()) return; stage._drag = { id: e.pointerId, x: e.clientX }; try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ }
        g.drag(0, true); return;
      }
      if (g.steer) {
        if (!canAct()) return; const r = stage.getBoundingClientRect(); const side = e.clientX - r.left < r.width / 2 ? 'left' : 'right';
        stage._side = side; g.steer(side, true, 'touch'); return;
      }
      down();
    });
    stage.addEventListener('pointermove', e => {
      const d = stage._drag; if (!d || d.id !== e.pointerId || !g.drag) return;
      g.drag(Math.max(-1, Math.min(1, (e.clientX - d.x) / DRAG_PX)), true);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => stage.addEventListener(ev, e => {
      if (stage._drag) { if (e.pointerId !== stage._drag.id) return; stage._drag = null; if (g.drag) g.drag(0, false); return; }
      if (g.steer) { if (stage._side) g.steer(stage._side, false); stage._side = null; return; }
      up();
    }));
    padEl.addEventListener('pointerdown', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return; e.preventDefault(); S.unlock();
      b.classList.add('held');
      const a = b.dataset.act; if (g.steer) g.steer(a, true); else down();
    });
    ['pointerup', 'pointercancel', 'pointerout'].forEach(ev => padEl.addEventListener(ev, e => {
      const b = e.target.closest('button'); if (!b) return; b.classList.remove('held');
      const a = b.dataset.act; if (g.steer) g.steer(a, false); else up();
    }));
    // driving keys: arrows or WASD steer, and Up is the gas (there's no brake: you let off the gas and coast)
    const DRIVE = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', w: 'gas', W: 'gas' };
    const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    document.addEventListener('keydown', e => {
      // the high scores or How to play are open: the keys belong to them
      if (typing(e) || document.querySelector('.overlay:not(.hidden), .tut-overlay:not([hidden])')) return;
      const k = e.key;
      if (k === 'p' || k === 'P' || k === 'Escape') { if (phase === 'paused') resume(); else if (phase === 'play' || phase === 'count') { pause(); e.preventDefault(); } return; }
      if (g.steer && DRIVE[k]) { if (canAct()) g.steer(DRIVE[k], true); e.preventDefault(); return; }
      if (k === ' ' || (k === 'Enter' && e.target === document.body)) {
        e.preventDefault(); if (e.repeat) return;
        if (phase === 'idle' || phase === 'over') { if (k === ' ') start(); return; }
        if (phase === 'paused') { resume(); return; }
        down();
      }
    });
    document.addEventListener('keyup', e => {
      const k = e.key;
      if (g.steer && DRIVE[k]) g.steer(DRIVE[k], false);
      if ((k === ' ' || k === 'Enter') && !typing(e)) up();
    });

    let hudKey = '';
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function paintHud() {
      let rows = g.hud(); const key = JSON.stringify(rows);
      if (key === hudKey) return; hudKey = key;
      // a meter marked 'side' stands up inside the game instead of sitting in the score row (the Launcher's)
      const side = rows.filter(r => r[1] === null && r[4] === 'side')[0];
      smeter.hidden = !side;
      if (side) { smeter.querySelector('i').style.height = Math.round(side[2] * 100) + '%'; const em = smeter.querySelector('em'); em.hidden = side[3] == null; em.style.bottom = 'calc(' + Math.round((side[3] || 0) * 100) + '% - 1px)'; }
      // the steering bar: a wheel slides along a bar at the bottom of the game and turns as you steer (the Racer's)
      const wr = rows.filter(r => r[1] === null && r[4] === 'wheel')[0];
      wheelbar.hidden = !wr;
      if (wr) { const wh = wheelbar.querySelector('.wheel'); wh.style.left = (50 + wr[2] * 50) + '%'; wh.style.transform = 'translate(-50%, -50%) rotate(' + Math.round(wr[2] * 120) + 'deg)'; wheelbar.querySelector('.dz').style.width = (wr[3] * 100) + '%'; }
      rows = rows.filter(r => r !== side && r !== wr);
      hudEl.innerHTML = rows.map(r => {
        if (r[1] === null) return '<div><span>' + esc(r[0]) + '</span><div class="cab-meter"><i style="width:' + Math.round(r[2] * 100) + '%"></i>' + (r[3] != null ? '<em style="left:' + Math.round(r[3] * 100) + '%"></em>' : '') + '</div></div>';
        return '<div><b>' + esc(r[1]) + '</b><span>' + esc(r[0]) + '</span></div>';
      }).join('');
    }

    // ---------- the loop ----------
    let last = performance.now(), manual = false;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!manual) tick(dt);
      requestAnimationFrame(frame);
    }
    // quiet: step the game without drawing it (the browser tests fast-forward this way)
    function tick(dt, quiet) {
      if (phase === 'paused') { if (!quiet) CAB.render(g.scene, g.cam, dt); return; }
      if (phase === 'count') {
        count -= dt; const c = Math.ceil(count); bigEl.textContent = c > 0 ? String(c) : '';
        if (c !== lastCount && c > 0) { lastCount = c; S.fx.count(false); }
        if (count <= 0) { phase = 'play'; goFlash = 0.7; S.fx.count(true); }
      }
      if (goFlash > 0) { goFlash -= dt; bigEl.textContent = goFlash > 0 ? 'GO!' : ''; }
      // The games move in small, even steps (at most 1/240 s), so a fast ball can't skip through a wall between frames
      // and the motion looks the same on any screen.
      const n = Math.max(1, Math.ceil(dt * 240 - 1e-6)), h = dt / n;
      for (let i = 0; i < n; i++) g.update(h, phase === 'play');
      if (g.frame) g.frame(dt);
      if (phase === 'play' && g.over) {
        phase = 'over'; held = false; bigEl.textContent = ''; msgEl.textContent = g.result; goBtn.textContent = 'Play again'; pauseBtn.hidden = true;
        if (g.steer) g.steer(null, false);
        S.stopMusic(2.5); if (g.audio) g.audio('stop');
        if (onOver) onOver(g);
      }
      const off = !canAct();
      Array.prototype.forEach.call(padEl.children, b => { if (b.disabled !== off) { b.disabled = off; if (off) b.classList.remove('held'); } });
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.hidden = true; }
      if (callT > 0) { callT -= dt; if (callT <= 0) { callEl.classList.remove('show'); callEl.classList.add('hide'); setTimeout(() => { if (callT <= 0) callEl.hidden = true; }, 380); } }
      const showHint = !!g.steer && (phase === 'count' || (phase === 'play' && hintT > 0));
      if (phase === 'play' && hintT > 0) hintT -= dt;
      if (hintL.hidden === showHint) { hintL.hidden = hintR.hidden = !showHint; }
      if (quiet) return;
      paintHud(); paintBubbles(dt);
      CAB.render(g.scene, g.cam, dt);
    }
    requestAnimationFrame(frame);

    // ---------- the arcade around it: Back, and the TV ----------
    if (window.ArcadeBack) {
      ArcadeBack.setup({
        atMenu: () => phase === 'idle' || phase === 'over',
        back: () => stopGame(),
        busy: () => phase === 'play' || phase === 'count' || phase === 'paused',
        pause,
        question: 'Leave this game? Your score won\'t be saved.'
      });
    }
    if (window.TvPlay) {
      TvPlay.setup({
        stage: wrap,
        steering: () => phase === 'play' || phase === 'count',
        active: () => phase === 'play' || phase === 'count',
        start: () => (phase === 'paused' ? pauseBtn : goBtn),
        enter: g.steer ? undefined : ' ',
        buttons: g.tvButtons || { 2: ' ', 5: ' ', 7: ' ', 9: 'p' },
        navButtons: { 9: 'p' },
        dirs: !!g.steer,
        hint: g.tvHint || 'Press OK to play. On a game controller, A, X, R1 or the right trigger works too, and Start pauses.'
      });
    }

    // Steps the game by hand, for the browser tests.
    window.CabTest = {
      tick: sec => { for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60, true); tick(0, false); },
      // the same without drawing at the end, for loops that step a little at a time
      step: sec => { for (let t = 0; t < sec; t += 1 / 240) tick(1 / 240, true); },
      // the test steps the game itself, so the page's own animation stops
      manual: on => { manual = !!on; },
      state: () => ({ phase, hud: g.hud(), over: !!g.over }),
      game: g
    };
    return { start, stop: stopGame, pause, resume, phase: () => phase };
  }

  return { run };
})();
window.CabFrame = CabFrame;
