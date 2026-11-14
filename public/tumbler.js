'use strict';

// Tumbler Rumble: the page. It plays the run live with the same simulation
// the server uses (tumbler-engine.js), draws the lock at 60 frames a second,
// and takes taps, Space and Enter, and a game controller's A button. When the
// run ends it sends only the tap times; the server replays them and its score
// is the one shown and saved (tumbler/routes.js).

(() => {
  const { $, toast, api } = ArcadeKit;
  const E = TumblerEngine;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // On a TV the arcade is signed in as the TV, not as whoever has the
  // remote, so a run there is a guest's and goes on the board under the
  // initials picked on the screen.
  const token = () => (typeof ArcadeProfile !== 'undefined' && !TvPlay.on ? ArcadeProfile.token() : null);
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  // idle -> starting -> playing (<-> paused -> resuming) -> finishing -> over
  let mode = 'idle';
  let run = null;          // what /start said: runId, seed
  let sim = null;          // the live simulation
  let t0 = 0;              // performance.now() when the run's clock started
  let pausedTotal = 0, pausedAt = 0, resumeAt = 0;
  let pausedForHelp = false;
  let overSince = 0;
  let result = null;       // the server's verdict
  let lastCount = 0;       // the countdown number last shown (3, 2, 1, then 0 for Go)
  const effects = [];      // pops, bullseyes and the miss, drawn on the lock

  const now = () => performance.now();
  function gameTime() {
    if (mode === 'paused' || mode === 'resuming') return pausedAt - t0 - pausedTotal;
    return now() - t0 - pausedTotal;
  }

  // ---- the canvas ------------------------------------------------------------------------
  const canvas = $('lock');
  const ctx = canvas.getContext('2d');
  let W = 300;
  const COLORS = {};
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(200, Math.round($('stage').clientWidth));
    canvas.width = W * dpr;
    canvas.height = W * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(COLORS, {
      accent: css('--accent', '#3d8bff'), pin: css('--pin', '#ffd23f'), marker: css('--marker', '#e9fbff'),
      miss: css('--miss', '#ff5e5e'), text: css('--text', '#f5eaff'), dim: css('--dim', '#9483ae')
    });
  }
  new ResizeObserver(resize).observe($('stage'));
  resize();

  const rad = deg => (deg - 90) * Math.PI / 180;      // 0 degrees is the top
  const at = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
  const ease = k => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  const LEDS = 48;

  function draw() {
    const t = sim ? gameTime() : 0;
    const R = W * 0.32, cx = W / 2, cy = W * 0.57;
    ctx.clearRect(0, 0, W, W);

    // Scanlines, for the cabinet glass.
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < W; y += 4) ctx.fillRect(0, y, W, 1);

    const over = sim && sim.over;
    const ring = over ? COLORS.miss : COLORS.accent;
    const counting = sim && !over && t < E.RULES.LEAD_MS;

    // The shackle. This lock never opens: the run goes on until a miss.
    const legX = R * 0.55, legTop = cy - R * 1.05;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = R * 0.2;
    ctx.strokeStyle = '#2a2140';
    ctx.beginPath();
    ctx.moveTo(cx - legX, cy - R * 0.6);
    ctx.lineTo(cx - legX, legTop);
    ctx.arc(cx, legTop, legX, Math.PI, 0);
    ctx.lineTo(cx + legX, cy - R * 0.6);
    ctx.stroke();
    ctx.lineWidth = R * 0.06;
    ctx.strokeStyle = ring;
    if (!reduced) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12; }
    ctx.stroke();
    ctx.restore();

    // The lock's body.
    ctx.save();
    ctx.fillStyle = '#140b26';
    ctx.strokeStyle = ring;
    ctx.lineWidth = 3;
    if (!reduced) { ctx.shadowColor = ring; ctx.shadowBlur = 18; }
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // The ring of lights. The ones the marker just passed glow, fading out
    // behind it (just the nearest one with reduced motion).
    const marker = sim ? E.markerAt(sim, t) : 0;
    const dir = sim ? sim.dir : 1;
    for (let i = 0; i < LEDS; i++) {
      const a = i * 360 / LEDS;
      const behind = (((marker - a) * dir) % 360 + 360) % 360;
      const trail = reduced ? 360 / LEDS : 40;
      const glow = sim && !counting && behind < trail ? 1 - behind / trail : 0;
      const [x1, y1] = at(cx, cy, R - 9, a), [x2, y2] = at(cx, cy, R + 9, a);
      ctx.lineWidth = 4;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = '#2b2245';
      ctx.stroke();
      if (glow) {
        ctx.globalAlpha = 0.25 + glow * 0.75;
        ctx.strokeStyle = ring;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The pin: a glowing block on the ring, as wide as the part that counts
    // (wide at first, narrower as the waves get harder).
    if (sim) {
      const p = E.pinAngle(sim);
      const pulse = reduced || over ? 1 : 0.85 + 0.15 * Math.sin(now() / 120);
      ctx.save();
      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 20 * pulse;
      if (!reduced) { ctx.shadowColor = COLORS.pin; ctx.shadowBlur = 20; }
      ctx.beginPath();
      ctx.arc(cx, cy, R, rad(p - sim.half), rad(p + sim.half));
      ctx.stroke();
      // The bullseye in its middle.
      ctx.strokeStyle = '#fff6c9';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, R, rad(p - E.bullDeg(sim)), rad(p + E.bullDeg(sim)));
      ctx.stroke();
      ctx.restore();
    } else if (!sim) {
      ctx.save();
      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 20;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, R, rad(120 - E.RULES.WIDE_DEG), rad(120 + E.RULES.WIDE_DEG));
      ctx.stroke();
      ctx.restore();
    }

    // The marker: a bright bar across the ring. It's what has to be on the pin.
    {
      const [x1, y1] = at(cx, cy, R - 17, marker), [x2, y2] = at(cx, cy, R + 17, marker);
      ctx.save();
      ctx.strokeStyle = over ? COLORS.miss : COLORS.marker;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      if (!reduced) { ctx.shadowColor = over ? COLORS.miss : COLORS.accent; ctx.shadowBlur = 16; }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }

    // The middle: the 3, 2, 1 countdown, then how many pins you've popped.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let big = '', small = '';
    const count = sim ? countAt(t) : 0;
    if (!sim) { big = '🔒'; small = 'TAP TO PLAY'; }
    else if (over) { big = '✕'; small = sim.endedBy === 'slip' ? 'SLIPPED PAST' : 'MISSED'; }
    else if (count > 0) { big = String(count); small = 'GET READY'; }
    else if (t < E.RULES.LEAD_MS + 700) { big = 'GO!'; small = 'POP THE PIN'; }
    else { big = String(sim.pops); small = sim.pops === 1 ? 'POP' : 'POPS'; }
    ctx.fillStyle = over ? COLORS.miss : big === 'GO!' || count > 0 ? COLORS.pin : COLORS.text;
    ctx.font = `800 ${Math.round(R * (big.length > 2 ? 0.5 : 0.72))}px Orbitron, system-ui, sans-serif`;
    if (!reduced) { ctx.shadowColor = over ? COLORS.miss : COLORS.accent; ctx.shadowBlur = 14; }
    ctx.fillText(big, cx, cy - R * 0.08);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.dim;
    ctx.font = `700 ${Math.round(R * 0.15)}px Orbitron, system-ui, sans-serif`;
    ctx.fillText(small, cx, cy + R * 0.48);
    ctx.restore();

    // Pops, bullseyes and the miss.
    const real = now();
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      const k = (real - f.born) / f.ms;
      if (k >= 1) { effects.splice(i, 1); continue; }
      const [x, y] = at(cx, cy, R, f.angle);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      if (f.ring && !reduced) {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 10 + ease(k) * 34, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (f.text && f.top) {
        // Wave news goes in the opening of the shackle, above the lock.
        ctx.fillStyle = f.color;
        ctx.textAlign = 'center';
        ctx.font = `800 ${f.size || 15}px Orbitron, system-ui, sans-serif`;
        ctx.fillText(f.text, cx, cy - R * 0.8);
      } else if (f.text) {
        const [tx, ty] = at(cx, cy, R + 40, f.angle);
        ctx.fillStyle = f.color;
        ctx.textAlign = 'center';
        ctx.font = `800 ${f.size || 15}px Orbitron, system-ui, sans-serif`;
        ctx.fillText(f.text, Math.min(W - 40, Math.max(40, tx)), Math.min(W - 8, Math.max(18, ty - (reduced ? 0 : ease(k) * 18))));
      }
      ctx.restore();
    }
  }

  // ---- the loop -----------------------------------------------------------------------------
  // Where the 3, 2, 1 countdown is at game time t (0 once it's done).
  const countAt = t => (t < E.RULES.LEAD_MS ? Math.ceil((E.RULES.LEAD_MS - t) / E.RULES.COUNT_MS) : 0);

  let shown = {};
  function hud() {
    const live = sim && !sim.over && gameTime() >= E.RULES.LEAD_MS;
    const v = {
      pops: result ? result.score : sim ? sim.pops : 0,
      wave: sim ? E.waveOf(sim.pops) : 1,
      streak: sim ? sim.streak : 0,
      pace: !live ? '-' : E.easingAt(sim.pops) ? 'Easier' : 'Harder'
    };
    for (const [id, key] of [['hudPops', 'pops'], ['hudWave', 'wave'], ['hudStreak', 'streak'], ['hudPace', 'pace']]) {
      if (shown[key] === v[key]) continue;
      shown[key] = v[key];
      $(id).textContent = typeof v[key] === 'number' ? v[key].toLocaleString('en-US') : v[key];
      if (key === 'pace') $(id).parentElement.classList.toggle('easing', v.pace === 'Easier');
    }
  }

  // The POP button only lights up once the light is really moving. Before a
  // run it says Start; during the countdown it's dimmed, can't be pressed and
  // counts down along with the lock; after a miss it's dimmed until the next run.
  let btnShown = '';
  function popButton() {
    let label = 'START', state = 'start';
    if (mode === 'starting') { label = '…'; state = 'wait'; }
    else if (mode === 'paused') label = 'GO ON';
    else if (mode === 'resuming') { label = String(Math.max(1, Math.ceil((resumeAt - now()) / 1000))); state = 'wait'; }
    else if (mode === 'playing') {
      const c = countAt(gameTime());
      if (c > 0) { label = String(c); state = 'wait'; } else { label = 'POP!'; state = 'live'; }
    } else if (mode === 'finishing' || mode === 'over') { label = 'POP!'; state = 'wait'; }
    const key = `${label}|${state}`;
    if (key === btnShown) return;
    if (state === 'live' && btnShown.endsWith('|wait')) flash('go');
    btnShown = key;
    const b = $('popBtn');
    b.textContent = label;
    b.dataset.state = state;
    b.disabled = state === 'wait';
    b.setAttribute('aria-label', state === 'live' ? 'Pop' : state === 'wait' ? `Wait (${label})` : label === 'GO ON' ? 'Carry on' : 'Start');
  }

  // A quick glow around the lock, so every sound has something to see too.
  function flash(kind) {
    const st = $('stage');
    st.classList.remove('flash-pop', 'flash-bull', 'flash-miss', 'flash-go', 'flash-wave');
    void st.offsetWidth;
    st.classList.add('flash-' + kind);
  }

  // The 3, 2, 1 countdown: a beep for each number and a higher one for Go.
  // The big numbers on the lock and on the button show it with the sound off.
  function countdownTick() {
    if (mode !== 'playing' || !sim) return;
    const c = countAt(gameTime());
    if (c === lastCount) return;
    lastCount = c;
    if (c > 0) { Blip.tone(660, 0.1, { type: 'square', volume: 0.05 }); say(String(c)); }
    else { Blip.tone(990, 0.18, { type: 'square', volume: 0.06 }); say('Go!'); }
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
    countdownTick();
    if (mode === 'playing' && E.advance(sim, gameTime())) gameOver();
    Blip.musicPlaying(mode === 'playing' || mode === 'resuming');
    hud();
    popButton();
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
    msg('Get ready', 'Starting a new run…');
    try {
      run = await api('/api/tumbler/start', { profileToken: token() });
    } catch (e) {
      mode = 'idle';
      msg('Tap to play', e.message);
      return;
    }
    sim = E.create(run.seed);
    t0 = now();
    pausedTotal = 0;
    result = null;
    lastCount = 0;
    effects.length = 0;
    shown = {};
    mode = 'playing';
    msg(null);
    $('over').classList.add('hidden');
    document.body.dataset.state = 'playing';
    if (window.ArcadeStats) ArcadeStats.play();
    // Only the test suites get this (the server says so): when the next pin
    // is due, so a browser test can play a real run.
    if (run.testHook) {
      window.TumblerTest = {
        msToNextPin: () => (sim && !sim.over ? E.centerAt(sim) - gameTime() : null),
        state: () => ({ mode, pops: sim.pops, wave: E.waveOf(sim.pops), over: sim.over })
      };
    }
  }

  function tap(source) {
    Blip.unlock();
    if (mode === 'idle') { begin(); return; }
    if (mode === 'paused') { resume(); return; }
    if (mode !== 'playing') return;
    const t = Math.round(gameTime());
    // A press during the countdown does nothing (the button is dimmed then).
    if (t < E.RULES.LEAD_MS) return;
    const r = E.tap(sim, t);
    if (r.kind === 'pop') popped(r);
    else if (r.kind === 'miss' || r.kind === 'over') gameOver();
    if (source === 'button') {
      $('popBtn').classList.add('down');
      setTimeout(() => $('popBtn').classList.remove('down'), 90);
    }
  }

  // Every sound here has something to see as well: the ring and the words on
  // the lock, and a glow around it.
  function popped(r) {
    const color = r.bullseye ? COLORS.pin : COLORS.accent;
    effects.push({ angle: r.at, born: now(), ms: 650, ring: true, color, text: r.bullseye ? (r.streak > 1 ? `PERFECT ×${r.streak}` : 'PERFECT') : 'POP!', size: r.bullseye ? 14 : 16 });
    flash(r.bullseye ? 'bull' : 'pop');
    const step = sim.pops % 12;
    Blip.tone(440 * Math.pow(2, step / 12), 0.06, { type: 'square', volume: 0.06 });
    if (r.bullseye) Blip.tone(1320 + 60 * Math.min(r.streak, 5), 0.09, { type: 'sine', volume: 0.07, delay: 0.04 });
    if (r.newWave) {
      // A new wave: a little fanfare and the wave's number on the lock. The
      // confetti waits for the end of the run, so nothing covers the lock mid-game.
      Blip.tune([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.22]], { type: 'square', volume: 0.06 });
      flash('wave');
      effects.push({ angle: 0, born: now(), ms: 1500, color: COLORS.pin, text: `WAVE ${r.wave}`, size: 18, top: true });
      say(`${r.pops} pops. Wave ${r.wave}.`);
    } else if (r.easing && !E.easingAt(r.pops - 1)) {
      // The wave eases off for its last few pins.
      effects.push({ angle: 0, born: now(), ms: 1300, color: COLORS.accent, text: 'EASING OFF', size: 15, top: true });
    }
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    pausedAt = now();
    msg('Paused', `${TvPlay.on ? 'Press OK' : 'Tap the lock'} when you're ready. You'll get a short countdown before it turns again.`);
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
    const angle = E.markerAt(sim, sim.endedAt);
    effects.push({ angle, born: now(), ms: 900, ring: true, color: COLORS.miss, text: sim.endedBy === 'slip' ? 'TOO LATE' : 'MISS', size: 16 });
    Blip.noise(0.18, 0.12);
    Blip.womp();
    flash('miss');
    if (!reduced) {
      $('stage').classList.remove('shake');
      void $('stage').offsetWidth;
      $('stage').classList.add('shake');
    }
    let error = '';
    try {
      result = await api(`/api/tumbler/run/${run.runId}/finish`, { taps: sim.taps });
    } catch (e) {
      error = e.message;
      result = null;
    }
    // (Unless Back took the lock back to the start meanwhile.)
    setTimeout(() => { if (mode === 'finishing') showOver(error); }, reduced ? 200 : 700);
  }

  const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }

  async function showOver(error) {
    mode = 'over';
    overSince = now();
    const local = E.summary(sim);
    const r = result || local;
    $('overTitle').textContent = local.endedBy === 'slip' ? 'The light slipped past the pin!' : 'Missed! The light wasn\'t on the pin.';
    $('overScore').textContent = '0';
    if (window.Fx) Fx.countUp($('overScore'), 0, r.score, 900); else $('overScore').textContent = r.score.toLocaleString('en-US');
    $('overDetail').textContent = !r.score ? 'You didn\'t pop any locks this time.' : `You popped ${plural(r.score, 'lock')} in a row and made it to wave ${r.wave}, with ${plural(r.bullseyes, 'perfect pop')}` +
      (r.bestStreak > 1 ? ` and a best streak of ${r.bestStreak} perfect pops in a row.` : '.');
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
      $('rankLine').textContent = 'Pop at least one pin to get a score on the board. Wait until the light is on the gold pin, then tap, and give it another go!';
    } else {
      $('savePart').classList.remove('hidden');
      $('iniRow').classList.toggle('hidden', !!p);
      $('saveHint').textContent = p ? `Saving as ${p.name}.` : 'Type your initials to put your score on today\'s board and the all-time board.';
      if (!p) initials.reset();
      chase(result.score);
    }
    $('over').classList.remove('hidden');
    msg(null);
    // The run's celebration, saved for the end: more coins for every wave reached.
    if (window.Fx && r.score > 0) Fx.burst({ count: Math.min(200, 40 + 4 * r.score), coins: Math.min(40, 4 + 3 * r.wave) });
    // It pops up over the page (topbar.js), except on a TV, where it sits in the page.
    if (!$('over').classList.contains('end-pop')) setTimeout(() => $('over').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }), 60);
    say(`Game over. You popped ${plural(r.score, 'lock')} and reached wave ${r.wave}.`);
  }

  // How far this score is from the next one up on today's board. Every number
  // here is a real score on the real board, never a made-up near miss.
  async function chase(score) {
    try {
      const rows = await api('/api/tumbler/board?scope=day&limit=100');
      if (mode !== 'over' || !result || result.score !== score) return;
      const above = rows.filter(r => r.score >= score);
      let text;
      if (!rows.length) text = 'Nobody has a score on today\'s board yet, so saving this one puts you at #1.';
      else if (!above.length) text = 'That beats every score on today\'s board. Save it to take #1!';
      else {
        const next = above[above.length - 1];
        const gap = next.score - score + 1;
        const who = next.profileName || next.initials;
        text = `${gap <= Math.max(3, score * 0.25) ? 'Just ' : ''}${plural(gap, 'more lock')} would have passed ${who} for #${above.length} today.`;
      }
      $('chaseLine').textContent = text;
    } catch { /* the line is a bonus */ }
  }

  const initials = ArcadeKit.wireInitials([...document.querySelectorAll('#iniRow .ini')], () => saveScore(), { guest: TvPlay.on });
  async function saveScore() {
    if (!result || !result.finished || result.saved) return;
    const p = profile();
    // A profile sends its initials too, in case its sign-in has run out on
    // the server; then the score goes on the board under the initials.
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      const r = await api(`/api/tumbler/run/${result.runId}/save`, { initials: ini, profileToken: token() });
      if (!p) initials.remember(ini);
      result.saved = true;
      $('savePart').classList.add('hidden');
      $('chaseLine').textContent = '';
      $('rankLine').textContent = r.allRank === 1 ? 'That\'s the best Tumbler Rumble score ever! 🏆'
        : `You're #${r.dayRank} for today, and #${r.allRank} overall!`;
      if (window.Fx && (r.dayRank === 1 || r.allRank === 1)) {
        Fx.banner(r.allRank === 1 ? 'BEST SCORE EVER' : 'TOP OF TODAY', plural(r.score, 'pop'), { ms: 2400 });
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
      const rows = await api(`/api/tumbler/board?scope=${which}&limit=20`);
      ArcadeKit.renderScores(list, rows.map(r => ({ ...r, detail: `wave ${r.wave}` })), highlightId);
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
  $('stage').addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); tap('stage'); });
  $('popBtn').addEventListener('pointerdown', e => { if (e.button > 0 || $('popBtn').disabled) return; e.preventDefault(); tap('button'); });
  // Keyboard users who tab to the POP button press it with Space or Enter,
  // which the key handler below already counts.
  $('popBtn').addEventListener('click', e => e.preventDefault());
  const busyElsewhere = () => help.isOpen || !$('scores').classList.contains('hidden');
  window.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || busyElsewhere()) {
      if (e.key === 'Escape' && !$('scores').classList.contains('hidden')) closeScores();
      return;
    }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    // On the game-over panel, Space and Enter work its buttons instead.
    if (mode === 'over' || mode === 'finishing') return;
    e.preventDefault();
    if (e.repeat) return;
    tap('key');
  });

  // Game controllers: A pops (and starts), Start starts a new run when one is over.
  const padWas = new Map();
  function pollPads() {
    if (!navigator.getGamepads) return;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return; }
    for (const gp of pads) {
      if (!gp) continue;
      const a = !!(gp.buttons[0] && gp.buttons[0].pressed), st = !!(gp.buttons[9] && gp.buttons[9].pressed);
      const was = padWas.get(gp.index) || {};
      if ((a && !was.a) || (st && !was.st)) padPress(a && !was.a ? 'a' : 'start');
      padWas.set(gp.index, { a, st });
    }
  }
  function padPress(button) {
    if (busyElsewhere()) { if (!$('scores').classList.contains('hidden')) closeScores(); return; }
    if (mode === 'over') {
      // A short wait, so the tap that ended the run doesn't start the next one.
      if (now() - overSince > 1200) begin();
      return;
    }
    if (button === 'start' && mode === 'playing') { pause(); return; }
    tap('pad');
  }

  // Leaving the page pauses the run.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('tumbler');

  // ---- how to play -------------------------------------------------------------------------
  const help = Tutorial.create('tumbler', [
    {
      emoji: '🔓', title: 'Pop the locks',
      html: `<p>A bright light races around the dial, and one spot on it glows gold. That's a <b>lock</b>.</p>
        <p>Tap the moment the light is on the lock to pop it. The light turns around and a new lock lights up somewhere else on the dial, right away, so keep going.</p>
        <p>Your score is how many locks you pop in a row. The number in the middle of the dial counts them.</p>`
    },
    {
      emoji: '⏱️', title: 'Wait for Go',
      html: `<p>Every run starts with a countdown in the middle of the dial: <b>3</b>, <b>2</b>, <b>1</b>, then <b>Go!</b> The POP! button stays dimmed and counts down too, and it lights up when the light starts moving.</p>
        <p>Everything you can hear, you can also see, so the game plays the same with the sound off: pops and perfect pops flash on the dial, a miss turns it red, and each new wave shows its number at the top.</p>`
    },
    {
      emoji: '👆', title: 'How to tap',
      html: `<table>
          <tr><td>📱 Touch screen</td><td>Tap anywhere on the dial, or the big <b>POP!</b> button under it.</td></tr>
          <tr><td>⌨️ Keyboard</td><td><b>Space</b> or <b>Enter</b>.</td></tr>
          <tr><td>🎮 Controller</td><td>The <b>A</b> button pops, and so do <b>X</b>, <b>R1</b> and the right trigger. <b>Start</b> pauses, and starts a new run after a game over.</td></tr>
          <tr><td>📺 TV</td><td>The remote's <b>OK</b> button pops.</td></tr>
        </table>`
    },
    {
      emoji: '💥', title: 'One slip and it\'s over',
      html: `<p>The run ends if you tap when the light <b>isn't</b> on the lock, or if the light slides all the way past the lock without a tap.</p>
        <p>There's no last lock, so a run goes on until that first slip. See how many you can get!</p>`
    },
    {
      emoji: '🌊', title: 'Waves',
      html: `<p>The locks come in <b>waves</b> of ${E.RULES.WAVE}. The first locks are wide and the light moves slowly, so you can find the rhythm.</p>
        <p>In each wave the light speeds up and the lock gets narrower for ${E.RULES.CLIMB} locks, then it eases off for the last ${E.RULES.WAVE - E.RULES.CLIMB} so you can catch your breath. The next wave starts a little harder than the last one did, so it gets tougher, then easier, then tougher again, and keeps getting harder overall.</p>
        <p>The <b>Pace</b> box at the top says whether the wave is getting harder or easier right now.</p>`
    },
    {
      emoji: '✨', title: 'Perfect pops',
      html: `<p>Every lock has a white stripe in its middle. Popping it right on that stripe is a <b>perfect pop</b>, and perfect pops in a row build a streak. They don't change your score, which is always the number of locks popped, but your perfect pops and your best streak show at the end of the run.</p>`
    },
    {
      emoji: '🏆', title: 'The high scores',
      html: `<p>When a run ends, the arcade checks it by playing your taps back through the same game, and works out the score itself. That's the score that counts, so nobody can fake one.</p>
        <p>Save it with your initials (or your profile) to go on today's board and the all-time board. Today's board starts fresh every night at midnight.</p>
        <div class="tut-tip">Opening How to play or leaving the page pauses the run. When you come back you get a short countdown before the light moves again.</div>`
    }
  ], { onClose: () => { if (pausedForHelp) { pausedForHelp = false; resume(); } } });
  // Reading How to play mid-run pauses it, and closing it carries on.
  $('helpBtn').addEventListener('click', () => {
    if (mode === 'playing') { pausedForHelp = true; pause(); }
    help.open();
  });

  // Back: a run (or its results) goes back to the start, asking first while
  // the lock is turning, and from there to the arcade.
  ArcadeBack.setup({
    atMenu: () => mode === 'idle' || mode === 'starting',
    back: () => {
      mode = 'idle';
      sim = null; run = null; result = null;
      effects.length = 0;
      $('over').classList.add('hidden');
      document.body.dataset.state = 'ready';
      msg(TvPlay.on ? 'Ready?' : 'Tap to play', TvPlay.on ? 'Press OK on Play to start.' : 'Tap anywhere on the lock, or press Space, to start.');
    },
    busy: () => ['playing', 'paused', 'resuming', 'finishing'].includes(mode),
    pause: () => pause()
  });

  // ---- on the TV ----------------------------------------------------------------------------
  // The lock on the right, big. OK pops; the Play button starts. A
  // controller's X, R1 and right trigger pop too (A and Start are above).
  TvPlay.setup({
    stage: $('zone'),
    steering: () => mode !== 'idle' && mode !== 'over',
    active: () => mode === 'playing' || mode === 'resuming',
    begin: () => tap('key'),
    ready: () => mode === 'idle',
    buttons: { 2: ' ', 5: ' ', 7: ' ' },
    hint: 'Press OK the moment the light is on the gold pin. On a game controller, A, X, R1 or the right trigger pops it too, and Start pauses.'
  });
  if (TvPlay.on) { $('msgTitle').textContent = 'Ready?'; $('msgText').textContent = 'Press OK on Play to start.'; }

  // ---- start ---------------------------------------------------------------------------------
  requestAnimationFrame(frame);
  help.autoOpen();
})();
