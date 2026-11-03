'use strict';

// Disco Drop: the page. The server (discodrop/routes.js) starts each run with
// a random seed and decides every score; this page draws the cabinet from the
// same seed (discodrop-engine.js), takes the taps, keys and controller
// buttons, and sends the server only the moment each ball was dropped.

(() => {
  const { $, toast, api } = ArcadeKit;
  const E = DiscoDropEngine;
  // On a TV the arcade is signed in as the TV, not as whoever has the
  // remote, so a run there is a guest's and goes on the board under the
  // initials picked on the screen.
  const token = () => (typeof ArcadeProfile !== 'undefined' && !TvPlay.on ? ArcadeProfile.token() : null);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The picture is drawn in stage units: 1000 wide by 1250 tall.
  const H = 1250;
  const RAIL_Y = 120, BALL_Y = 250, BALL_R = 34, CUP_TOP = 1010, CUP_BOTTOM = 1180;
  const COLORS = {
    bust: ['#3a2340', '#8f8367'], c10: ['#00bfa6', '#00ffc2'], c25: ['#1f6fd6', '#4dd0ff'],
    c50: ['#7a3cff', '#c86bff'], c100: ['#d4148f', '#ff5cf0'], jackpot: ['#c99400', '#ffd23f']
  };

  let run = null;          // { runId, seed } from the server
  let plan = null;         // what the seed decides (E.plan)
  let times = [];          // drop times sent so far
  let next = null;         // where the motion stands now (E.replay().next)
  let clientStart = 0;     // performance.now() when the run arrived
  let falling = null;      // the ball in the air: { t, x, land, before, server }
  let results = [];        // the server's word on every ball so far
  let total = 0;
  let state = 'ready';     // ready | playing | over
  let pops = [];           // "+50" and glows on the stage
  let flashText = null;    // SHUFFLE! / FASTER! for a moment
  let busy = false;
  let doubleShown = false;

  const elapsed = () => Math.round(performance.now() - clientStart);
  // So the browser test can line up a drop; it reveals nothing the page doesn't already know.
  window.DiscoDropClock = { elapsed: () => (run ? elapsed() : -1), runId: () => (run ? run.runId : null) };

  // ---- the canvas ----------------------------------------------------------------------
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  let scale = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = canvas.width / E.W;
  }
  addEventListener('resize', resize);
  resize();

  // The motion at time t. While a ball is in the air the belt keeps the
  // phase it had when the ball let go; the new phase begins when it lands.
  function motionAt(t) {
    if (!plan) return null;
    const from = falling && t < falling.land ? falling.before : next;
    return E.at(plan, from, t);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackdrop(now) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#12001f');
    g.addColorStop(0.6, '#1d0636');
    g.addColorStop(1, '#2b0a3d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, E.W, H);
    // Two spotlights sweeping the dance floor (still when motion is reduced).
    const sweep = reduced ? 0.3 : Math.sin(now / 1400) * 0.35;
    for (const [x0, col, dir] of [[180, 'rgba(255,92,240,0.10)', 1], [820, 'rgba(0,255,194,0.08)', -1]]) {
      ctx.save();
      ctx.translate(x0, 0);
      ctx.rotate(sweep * dir);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(220, H); ctx.lineTo(-220, H);
      ctx.fill();
      ctx.restore();
    }
    // A glowing dance floor under the cups.
    ctx.strokeStyle = 'rgba(255,92,240,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath(); ctx.moveTo(i * 100, CUP_BOTTOM); ctx.lineTo(500 + (i * 100 - 500) * 1.6, H); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,92,240,0.12)';
    ctx.fillRect(0, CUP_BOTTOM, E.W, H - CUP_BOTTOM);
    // Marquee bulbs along the top, chasing like a cabinet's.
    const lit = reduced ? -1 : Math.floor(now / 140) % 3;
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = i % 3 === lit ? '#ffd23f' : 'rgba(255,210,63,0.28)';
      ctx.beginPath(); ctx.arc(20 + i * 40, 26, 8, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawCups(m) {
    const layout = m.phase.layout;
    const dbl = m.phase.double;
    for (const cup of layout) {
      for (const shift of [-E.BELT, 0, E.BELT]) {
        const x = cup.from - m.belt + shift;
        if (x > E.W || x + cup.width < 0) continue;
        const [dark, light] = COLORS[cup.kind];
        const inset = 6;
        // The cup: a wide mouth at the top, a narrower base.
        ctx.beginPath();
        ctx.moveTo(x + inset, CUP_TOP);
        ctx.lineTo(x + cup.width - inset, CUP_TOP);
        ctx.lineTo(x + cup.width - inset - 10, CUP_BOTTOM);
        ctx.lineTo(x + inset + 10, CUP_BOTTOM);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, CUP_TOP, 0, CUP_BOTTOM);
        g.addColorStop(0, light);
        g.addColorStop(1, dark);
        ctx.fillStyle = cup.kind === 'bust' ? '#24122c' : g;
        ctx.globalAlpha = cup.kind === 'bust' ? 1 : 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 5;
        ctx.strokeStyle = light;
        if (cup.kind === 'jackpot') { ctx.shadowColor = light; ctx.shadowBlur = 24; }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // The rim, so the edges between cups are easy to see.
        ctx.fillStyle = '#f5eaff';
        ctx.fillRect(x + inset - 3, CUP_TOP - 4, 6, 10);
        ctx.fillRect(x + cup.width - inset - 3, CUP_TOP - 4, 6, 10);
        // What it's worth, in words as well as color.
        const cx = x + cup.width / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (cup.kind === 'jackpot') {
          ctx.fillStyle = '#ffd23f';
          ctx.font = '900 30px system-ui, sans-serif';
          ctx.fillText('★', cx, CUP_TOP - 34);
          ctx.fillStyle = '#2a1a00';
          ctx.font = '900 26px system-ui, sans-serif';
          ctx.save();
          ctx.translate(cx, (CUP_TOP + CUP_BOTTOM) / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(`JACKPOT ${cup.value * (dbl ? 2 : 1)}`, 0, 0);
          ctx.restore();
        } else if (cup.kind === 'bust') {
          ctx.fillStyle = '#c9b98a';
          ctx.font = '800 30px system-ui, sans-serif';
          ctx.fillText('✕', cx, CUP_TOP + 60);
          ctx.font = '800 24px system-ui, sans-serif';
          ctx.fillText('BUST', cx, CUP_TOP + 110);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.font = `900 ${cup.width > 150 ? 46 : 38}px system-ui, sans-serif`;
          ctx.fillText(String(cup.value * (dbl ? 2 : 1)), cx, CUP_TOP + 80);
          if (dbl) {
            ctx.font = '800 22px system-ui, sans-serif';
            ctx.fillStyle = '#ffd23f';
            ctx.fillText('×2', cx, CUP_TOP + 130);
          }
        }
      }
    }
  }

  function drawBall(x, y, now, size = 1) {
    const r = BALL_R * size;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#d9d4f0');
    g.addColorStop(1, '#6d6390');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // The mirror tiles, turning slowly.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(40,20,70,0.45)';
    ctx.lineWidth = 2;
    const turn = reduced ? 0 : (now / 90) % 12;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(x - r, y + i * 11 * size); ctx.lineTo(x + r, y + i * 11 * size); ctx.stroke();
    }
    for (let i = -4; i <= 4; i++) {
      const off = (i * 12 + turn) * size;
      ctx.beginPath(); ctx.ellipse(x, y, Math.abs(off) + 0.1, r, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    // A glint that flickers.
    const glint = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(now / 180);
    ctx.fillStyle = `rgba(255,255,255,${glint})`;
    ctx.beginPath(); ctx.arc(x - r * 0.4, y - r * 0.4, 5 * size, 0, Math.PI * 2); ctx.fill();
  }

  function drawArm(m, now) {
    // The rail and the trolley that carries the ball.
    ctx.strokeStyle = '#ff5cf0';
    ctx.lineWidth = 8;
    ctx.shadowColor = '#ff5cf0'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(E.ARM_LEFT - 60, RAIL_Y); ctx.lineTo(E.ARM_RIGHT + 60, RAIL_Y); ctx.stroke();
    ctx.shadowBlur = 0;
    const x = m.armX;
    ctx.fillStyle = '#2b0a3d';
    ctx.strokeStyle = '#00ffc2';
    ctx.lineWidth = 4;
    roundRect(x - 40, RAIL_Y - 22, 80, 44, 10);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#c9b98a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, RAIL_Y + 22); ctx.lineTo(x, BALL_Y - BALL_R - 6); ctx.stroke();
    // The claw.
    ctx.strokeStyle = '#00ffc2';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 26, BALL_Y - BALL_R + 8); ctx.lineTo(x - 18, BALL_Y - BALL_R - 8); ctx.lineTo(x + 18, BALL_Y - BALL_R - 8); ctx.lineTo(x + 26, BALL_Y - BALL_R + 8);
    ctx.stroke();
    if (state === 'playing' && !falling && m.ready) {
      // A dotted line straight down, to help aim (where the cups will be is up to you).
      ctx.setLineDash([6, 14]);
      ctx.strokeStyle = 'rgba(245,234,255,0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, BALL_Y + BALL_R + 8); ctx.lineTo(x, CUP_TOP - 12); ctx.stroke();
      ctx.setLineDash([]);
      drawBall(x, BALL_Y, now);
    } else if (state === 'playing' && !falling && next && next.k < E.DROPS) {
      // The next ball growing back onto the arm.
      const t = elapsed();
      const k = Math.max(0, Math.min(1, (t - next.start) / E.RELOAD_MS));
      drawBall(x, BALL_Y, now, k);
    } else if (state === 'ready') {
      drawBall(x, BALL_Y, now);
    }
  }

  function drawFalling(now, t) {
    if (!falling) return;
    const k = Math.max(0, Math.min(1, (t - falling.t) / E.FALL_MS));
    const y = BALL_Y + (CUP_TOP + 40 - BALL_Y) * k * k;     // speeding up as it falls
    drawBall(falling.x, y, now, k > 0.92 ? 1 - (k - 0.92) * 4 : 1);
  }

  function drawPops(now) {
    pops = pops.filter(p => now - p.at < p.ms);
    for (const p of pops) {
      const k = (now - p.at) / p.ms;
      ctx.globalAlpha = 1 - k;
      if (p.glow) {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, CUP_TOP + 40, 40 + 120 * k, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.font = `900 ${p.size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, CUP_TOP - 70 - (reduced ? 0 : 120 * k));
      }
      ctx.globalAlpha = 1;
    }
    if (flashText && now - flashText.at < 1100) {
      const k = (now - flashText.at) / 1100;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = flashText.color;
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = flashText.color; ctx.shadowBlur = 20;
      ctx.fillText(flashText.text, E.W / 2, 560);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    pollPad();
    const t = run ? elapsed() : 0;
    if (falling && t >= falling.land && falling.server) land();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackdrop(now);
    const m = motionAt(t) || idle(now);
    drawCups(m);
    drawArm(m, now);
    drawFalling(now, t);
    drawPops(now);
    const ready = state === 'playing' && !falling && !!m.ready;
    if ($('dropBtn').disabled === ready) $('dropBtn').disabled = !ready;
    requestAnimationFrame(frame);
  }
  // Before the first run, the cabinet idles with its cups drifting by.
  const idlePlan = E.plan(7);
  function idle(now) {
    return E.at(idlePlan, { k: 0, start: 0, belt: idlePlan.belt0, arm: 350 }, reduced ? 0 : Math.round(now));
  }

  // ---- a run ---------------------------------------------------------------------------
  async function begin() {
    if (busy) return;
    busy = true;
    try {
      const r = await api('/api/discodrop/start', { profileToken: token() });
      run = { runId: r.runId, seed: r.seed };
      plan = E.plan(r.seed);
      clientStart = performance.now();
      times = [];
      results = [];
      total = 0;
      falling = null;
      doubleShown = false;
      next = E.replay(r.seed, []).next;
      state = 'playing';
      document.body.dataset.state = 'playing';
      $('cover').classList.add('hidden');
      $('over').classList.add('hidden');
      paintHud();
      Blip.unlock();
      Blip.musicPlaying(true);
      if (window.ArcadeStats) ArcadeStats.play();
    } catch (e) {
      toast(e.message, 4000);
    } finally { busy = false; }
  }

  function tryDrop() {
    if (state !== 'playing' || falling || !plan) return;
    const t = elapsed();
    const m = motionAt(t);
    if (!m.ready) return;
    Blip.unlock();
    const before = next;
    const local = E.replay(run.seed, [...times, t], plan);
    falling = { t, x: m.armX, land: t + E.FALL_MS, before, server: null, local: local.results[local.results.length - 1] };
    times.push(t);
    next = local.next;
    Blip.tone([900, 300], 0.4, { type: 'sine', volume: 0.06 });
    send(run.runId, t);
  }

  async function send(runId, t) {
    const mine = falling;
    try {
      const r = await api(`/api/discodrop/run/${runId}/drop`, { t });
      if (falling === mine) mine.server = r;
    } catch (e) {
      if (falling !== mine) return;
      falling = null;
      endRun(`The arcade couldn't count that ball: ${e.message}`);
    }
  }

  // The ball reached the cups: show what the server decided.
  function land() {
    const f = falling;
    falling = null;
    const r = f.server.result;
    results.push(r);
    total = f.server.total;
    const now = performance.now();
    const [, light] = COLORS[r.kind];
    pops.push({ glow: true, x: f.x, color: light, at: now, ms: 500 });
    pops.push({ text: r.jackpot ? `+${r.points} JACKPOT!` : r.points ? `+${r.points}` : 'BUST', x: Math.max(160, Math.min(840, f.x)),
      color: r.jackpot ? '#ffd23f' : r.points ? '#ffffff' : '#c9b98a', size: r.jackpot ? 64 : 56, at: now, ms: 1100 });
    $('live').textContent = r.jackpot ? `Jackpot! ${r.points} points.` : r.points ? `${r.points} points.` : 'Bust, no points.';
    if (r.jackpot) {
      Blip.tune([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.12], [784, 0.08], [1047, 0.3]], { type: 'square', volume: 0.06 });
      if (window.Fx) { Fx.banner('JACKPOT!', `+${r.points} points`, { ms: 1600 }); Fx.burst({ count: 170, coins: 40 }); Fx.flash('rgba(255,210,63,.35)'); }
    } else if (r.kind === 'c100') {
      Blip.tune([[784, 0.07], [1047, 0.14]], { type: 'triangle', volume: 0.06 });
      const rect = canvas.getBoundingClientRect();
      if (window.Fx) Fx.burst({ count: 50, coins: 6, origin: { x: rect.left + f.x * rect.width / E.W, y: rect.top + CUP_TOP * rect.height / H } });
    } else if (r.points) {
      Blip.tone(520 + r.value * 3, 0.12, { type: 'triangle', volume: 0.06 });
    } else {
      Blip.tone([220, 110], 0.35, { type: 'sawtooth', volume: 0.05 });
    }
    // "So close" only when it really was: the server measured how near the
    // ball came to the jackpot cup's edge.
    if (r.near) setTimeout(() => toast('So close! That ball landed right next to the jackpot cup.', 2600), 300);
    paintHud();
    if (f.server.finished) {
      setTimeout(() => { if (state === 'playing') endRun(); }, r.jackpot ? 1700 : 900);
      return;
    }
    // What changes for the next ball.
    const ph = plan.phases[results.length];
    if (ph.shuffled) {
      flashText = { text: 'SHUFFLE!', color: '#00ffc2', at: now };
      Blip.tune([[440, 0.05], [554, 0.05], [659, 0.05]], { type: 'square', volume: 0.04 });
    } else if (ph.armSpeed && !plan.phases[results.length - 1].armSpeed) {
      flashText = { text: 'IT MOVES!', color: '#ff5cf0', at: now };
    }
    if (ph.double && !doubleShown) {
      doubleShown = true;
      setTimeout(() => { if (window.Fx) Fx.banner('DOUBLE POINTS', `The last ${E.DROPS - E.BONUS_FROM + 1} balls score double`, { ms: 1500, tone: 'pink' }); }, r.jackpot ? 1700 : 250);
    }
  }

  function paintHud() {
    $('score').textContent = total.toLocaleString('en-US');
    const n = Math.min(E.DROPS, results.length + (falling ? 0 : 1));
    $('ball').textContent = `${n} of ${E.DROPS}`;
    const dbl = plan && plan.phases[Math.min(results.length, E.DROPS - 1)].double;
    $('mult').textContent = dbl ? 'Double!' : 'Normal';
    $('mult').classList.toggle('double', !!dbl);
  }

  // ---- the end of a run ---------------------------------------------------------------------
  const iniBoxes = [...document.querySelectorAll('#iniRow .ini')];
  const initials = ArcadeKit.wireInitials(iniBoxes, () => saveScore(), { guest: TvPlay.on });
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }
  function endRun(problem) {
    state = 'over';
    document.body.dataset.state = 'over';
    Blip.musicPlaying(false);
    const jackpots = results.filter(r => r.jackpot).length;
    $('overTitle').textContent = problem ? 'That run stopped early' : jackpots ? `${jackpots} jackpot${jackpots === 1 ? '' : 's'}! What a run! 🪩` : 'That\'s the last ball! 🪩';
    $('overScore').textContent = total.toLocaleString('en-US');
    $('overChips').replaceChildren(...results.map(r => {
      const s = document.createElement('span');
      s.className = r.jackpot ? 'jackpot' : r.points ? '' : 'bust';
      s.textContent = r.jackpot ? `★ ${r.points}` : r.points ? String(r.points) : 'bust';
      return s;
    }));
    $('overDetail').textContent = problem || (results.some(r => r.double)
      ? 'The last three balls counted double.' : '');
    const p = profile();
    const canSave = !problem && results.length === E.DROPS;
    $('savePart').classList.toggle('hidden', !canSave);
    $('iniRow').classList.toggle('hidden', !!p);
    $('saveHint').textContent = p ? `Saving as ${p.name}.` : 'Type your initials to put your score on the board and see where you stack up.';
    $('saveMsg').textContent = '';
    $('saveBtn').disabled = false;
    $('rankLine').textContent = '';
    if (canSave && !p) initials.reset();
    $('over').classList.remove('hidden');
    if (!problem && window.Fx && total > 0) Fx.burst({ count: 90, coins: Math.min(30, Math.round(total / 100)) });
    setTimeout(() => $('over').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }

  async function saveScore() {
    if (!run || state !== 'over' || run.saved) return;
    const p = profile();
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      // Only the run id and who you are: the server already knows the score.
      const r = await api(`/api/discodrop/run/${run.runId}/save`, { initials: ini, profileToken: token() });
      if (!p) initials.remember(ini);
      run.saved = true;
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = r.allRank === 1 ? 'That\'s the best Disco Drop run ever! 🏆'
        : r.dayRank === 1 ? `That's the best score today! You're #${r.allRank} of all time.`
          : `You're #${r.dayRank} today${r.nextUp != null ? `, ${r.nextUp.toLocaleString('en-US')} point${r.nextUp === 1 ? '' : 's'} behind #${r.dayRank - 1}` : ''}, and #${r.allRank} of all time.`;
      toast(r.dayRank === 1 ? '🏆 Best today!' : `Saved: #${r.dayRank} today`);
      openScores('day', r.id);
    } catch (e) {
      $('saveMsg').textContent = e.message;
      $('saveBtn').disabled = false;
    }
  }
  $('saveBtn').addEventListener('click', saveScore);
  $('againBtn').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); begin(); });

  // ---- high scores ---------------------------------------------------------------------------
  let boardScope = 'day';
  async function openScores(scope = boardScope, highlightId) {
    boardScope = scope;
    const box = $('scoreScope');
    box.innerHTML = '';
    for (const [id, label] of [['day', 'Today'], ['all', 'All time']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(id === scope));
      b.onclick = () => openScores(id);
      box.appendChild(b);
    }
    $('scoreNote').textContent = scope === 'day'
      ? 'Every run you save counts, and today\'s board starts fresh at midnight.'
      : 'The best runs from every day so far.';
    $('scores').classList.remove('hidden');
    const list = $('scoreList');
    list.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const rows = await api(`/api/discodrop/board?scope=${scope}&limit=20`);
      ArcadeKit.renderScores(list, rows.map(r => ({
        ...r, detail: [r.jackpots ? `${r.jackpots} jackpot${r.jackpots === 1 ? '' : 's'}` : '', scope === 'all' ? niceDay(r.day) : ''].filter(Boolean).join(' · ')
      })), highlightId);
      if (!rows.length) list.firstChild.textContent = scope === 'day' ? 'Nobody has saved a score today. Be the first!' : 'No scores yet. Be the first!';
    } catch (e) {
      list.innerHTML = '<li class="empty"></li>';
      list.firstChild.textContent = e.message;
    }
  }
  const niceDay = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const closeScores = () => $('scores').classList.add('hidden');
  $('scoresBtn').addEventListener('click', () => openScores('day'));
  $('overScoresBtn').addEventListener('click', () => openScores('day'));
  $('scoresClose').addEventListener('click', closeScores);
  $('scores').addEventListener('click', e => { if (e.target === $('scores')) closeScores(); });

  // ---- controls ------------------------------------------------------------------------------
  $('coverBtn').addEventListener('click', e => { e.stopPropagation(); begin(); });
  $('stage').addEventListener('pointerdown', e => {
    if (e.target.closest('#cover')) return;
    e.preventDefault();
    tryDrop();
  });
  $('dropBtn').addEventListener('click', tryDrop);
  const blocked = () => help.isOpen || !$('scores').classList.contains('hidden');
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (!$('scores').classList.contains('hidden')) { if (e.key === 'Escape') closeScores(); return; }
    if (help.isOpen) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    // Enter on a focused button already clicks it.
    if (e.key === 'Enter' && e.target.closest && e.target.closest('button, a')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (state === 'playing') tryDrop();
    else if (state === 'ready') begin();
  });

  // A game controller (the Gamepad API): A drops, and starts a run from the
  // start screen. Checked every frame, acting on the press, not the hold.
  let padWas = false;
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let down = false;
    for (const p of pads) if (p && p.buttons && p.buttons[0] && p.buttons[0].pressed) down = true;
    if (down && !padWas && !blocked()) {
      if (state === 'playing') tryDrop();
      else if (state === 'ready') begin();
      else if (state === 'over' && run && run.saved) begin();
    }
    padWas = down;
  }

  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('discodrop');

  // ---- how to play -------------------------------------------------------------------------------
  const help = Tutorial.create('discodrop', [
    {
      emoji: '🪩', title: 'Drop the disco ball',
      html: `<p>A disco ball hangs from an arm at the top of the cabinet, and a row of cups slides past underneath it. <b>Tap anywhere on the cabinet</b> (or the big DROP button) to let go, and the ball falls straight down into whichever cup is under it when it gets there.</p>
        <p>The ball takes a moment to fall, so let go a little before the cup you want arrives.</p>
        <table>
          <tr><td>⌨️ Keyboard</td><td><b>Space</b> or <b>Enter</b> drops the ball.</td></tr>
          <tr><td>🎮 Controller</td><td>The <b>A</b> button drops it (so do <b>X</b>, <b>R1</b> and the right trigger), and starts a new run from the start screen.</td></tr>
          <tr><td>📺 TV</td><td>The remote's <b>OK</b> button drops it.</td></tr>
        </table>`
    },
    {
      emoji: '🥤', title: 'What the cups are worth',
      html: `<table>
          <tr><td>⭐ Jackpot</td><td>The tiny gold cup: <b>500 points</b>, with a big celebration. There's one on the belt, so watch for it.</td></tr>
          <tr><td>💗 100</td><td>A narrow pink cup.</td></tr>
          <tr><td>💜 50, 💙 25, 💚 10</td><td>The wider the cup, the easier it is to land in, and the fewer points it gives.</td></tr>
          <tr><td>✕ Bust</td><td>The dark cups marked BUST give nothing.</td></tr>
        </table>
        <div class="tut-tip">The number on each cup is what it will give you right now, so it's always the truth.</div>`
    },
    {
      emoji: '🔟', title: 'Ten balls a run',
      html: `<p>Every run has <b>10 balls</b>, and it gets harder as you go:</p>
        <table>
          <tr><td>🏃 Faster</td><td>The cups speed up after every ball, and from the fourth ball they can change direction.</td></tr>
          <tr><td>↔️ It moves</td><td>From the fourth ball the arm slides back and forth too.</td></tr>
          <tr><td>🔀 Shuffle</td><td>After balls ${E.SHUFFLE_AFTER.slice(0, -1).join(', ')} and ${E.SHUFFLE_AFTER[E.SHUFFLE_AFTER.length - 1]} the cups swap places.</td></tr>
          <tr><td>✖️2 Double points</td><td>The last three balls score double, so the jackpot is worth 1,000 there.</td></tr>
        </table>`
    },
    {
      emoji: '🏆', title: 'The high scores',
      html: `<p>When your tenth ball lands, save your score with your initials (or your profile, if you picked one) to put it on <b>today's board</b> and the <b>all-time board</b>. Every run you save counts.</p>
        <p>The arcade works out every score itself from the moments you let go, so a score can't be typed in or made up. The cups keep moving while you read this, but nothing drops until you tap.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  // ---- on the TV ----------------------------------------------------------------------------
  // The cabinet on the right, big, with its own Start button. OK drops; a
  // controller's X, R1 and right trigger drop too (A is above).
  TvPlay.setup({
    stage: $('stage'),
    steering: () => state === 'playing',
    start: () => (!$('cover').classList.contains('hidden') ? $('coverBtn') : null),
    buttons: { 2: ' ', 5: ' ', 7: ' ' },
    hint: 'Press OK to let the disco ball go. On a game controller, A, X, R1 or the right trigger drops it too.'
  });
  if (TvPlay.on) $('coverText').textContent = 'You get 10 disco balls. Press OK to let each one go and land it in the best cup you can. The tiny gold cup is the jackpot.';

  // Back: a run (or its results) goes back to the cabinet's Start cover,
  // asking first while balls are left, and from there to the arcade.
  ArcadeBack.setup({
    atMenu: () => state === 'ready',
    back: () => {
      state = 'ready';
      run = null; plan = null; falling = null; next = null; results = []; total = 0;
      document.body.dataset.state = 'ready';
      $('over').classList.add('hidden');
      $('cover').classList.remove('hidden');
      Blip.musicPlaying(false);
      paintHud();
    },
    busy: () => state === 'playing'
  });

  // ---- start ---------------------------------------------------------------------------------
  document.body.dataset.state = 'ready';
  paintHud();
  requestAnimationFrame(frame);
  help.autoOpen();
})();
