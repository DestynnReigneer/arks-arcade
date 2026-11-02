'use strict';

// Moonshot: the page. The server (moonshot/routes.js) starts each run with a
// random seed and decides every score; this page draws the batting cage and
// the pitches from the same seed (moonshot-engine.js), takes the taps, keys
// and controller buttons, and sends the server only the moment of each swing.

(() => {
  const { $, toast, api } = ArcadeKit;
  const E = MoonshotEngine;
  // On a TV the arcade is signed in as the TV, not as whoever has the
  // remote, so a run there is a guest's and goes on the board under the
  // initials picked on the screen.
  const token = () => (typeof ArcadeProfile !== 'undefined' && !TvPlay.on ? ArcadeProfile.token() : null);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = n => Number(n).toLocaleString('en-US');

  // The picture is drawn in stage units: 1000 wide by 1250 tall.
  const W = 1000, H = 1250;
  const FENCE_Y = 430;                 // the outfield wall, where the field meets the sky
  const MACHINE = { x: 500, y: 585 };  // where the ball leaves the pitching machine
  const ZONE = { x: 500, y: 1000, r: 64 };  // the glowing ring over the plate: swing when the ball is in it
  const PLATE_Y = 1130;
  const HANDS = { x: 735, y: 1070 };   // the batter's hands, where the bat turns
  const BAT_LEN = 330;
  const MOON = { x: 790, y: 150, r: 66 };
  const SWING_MS = 190;

  const COLORS = {
    homer: '#ffd23f', triple: '#7cf5ff', double: '#7cf5ff', single: '#4dd0ff',
    grounder: '#c9b98a', foul: '#ff9f2c', whiff: '#ff4f7b', taken: '#ff4f7b'
  };
  const SHOUT = {
    homer: 'HOME RUN!', triple: 'TRIPLE!', double: 'DOUBLE!', single: 'SINGLE!',
    grounder: 'GROUNDER', foul: 'FOUL BALL', whiff: 'STRIKE!', taken: 'STRIKE!'
  };

  // idle -> playing (<-> paused -> resuming) -> ending -> over
  let mode = 'idle';
  let run = null;            // { runId, seed, saved } from the server
  let plan = null;           // what the seed decides (E.plan)
  let times = [];            // swing times sent so far
  let outcome = [];          // for each pitch: { result, server, t, at, flight }
  let total = 0;             // the server's total so far
  let pending = 0;           // swings sent and not answered yet
  let clientStart = 0, pausedTotal = 0, pausedAt = 0, resumeAt = 0;
  let pausedForHelp = false;
  let bat = null;            // the swing being drawn: { at } (performance.now)
  let pops = [];             // words and numbers floating on the stage
  let sparks = [];           // fireworks over the moon after a home run
  let banner = null;         // FASTER! for a moment
  let busy = false;
  let overSince = 0;

  const now = () => performance.now();
  // The run's clock: whole ms since the run arrived, not counting pauses.
  function clock() {
    if (!run) return 0;
    const at = mode === 'paused' || mode === 'resuming' ? pausedAt : now();
    return Math.round(at - clientStart - pausedTotal);
  }
  // So the browser test can line up a swing; it reveals nothing the page doesn't already know.
  window.MoonshotClock = { elapsed: () => (run ? clock() : -1), runId: () => (run ? run.runId : null), mode: () => mode };

  // ---- the canvas ----------------------------------------------------------------------
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  let scale = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = canvas.width / W;
  }
  addEventListener('resize', resize);
  resize();

  // A fixed sky of stars, the same every time.
  const STARS = (() => {
    const rand = E.rng(2024);
    return Array.from({ length: 70 }, () => ({ x: rand() * W, y: rand() * (FENCE_Y - 60), r: 1 + rand() * 2.2, ph: rand() * 6 }));
  })();

  function drawSky(ms) {
    const g = ctx.createLinearGradient(0, 0, 0, FENCE_Y);
    g.addColorStop(0, '#05031a');
    g.addColorStop(1, '#251052');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, FENCE_Y);
    for (const s of STARS) {
      ctx.globalAlpha = reduced ? 0.7 : 0.45 + 0.4 * Math.sin(ms / 700 + s.ph);
      ctx.fillStyle = '#f5eaff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    // The moon, where home runs go.
    ctx.shadowColor = '#fff3b0'; ctx.shadowBlur = 40;
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath(); ctx.arc(MOON.x, MOON.y, MOON.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(200,180,120,0.45)';
    for (const [dx, dy, r] of [[-22, -14, 13], [18, 10, 17], [-8, 28, 8], [26, -26, 7]]) {
      ctx.beginPath(); ctx.arc(MOON.x + dx, MOON.y + dy, r, 0, Math.PI * 2); ctx.fill();
    }
    // Stadium lights on two towers.
    for (const x of [90, 910]) {
      ctx.fillStyle = '#1b1240';
      ctx.fillRect(x - 6, 120, 12, FENCE_Y - 120);
      ctx.fillStyle = '#2b1d5e';
      ctx.fillRect(x - 46, 92, 92, 40);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#fff8d8';
        ctx.shadowColor = '#fff8d8'; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(x - 33 + i * 22, 112, 7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }

  function drawField(ms) {
    // Turf, darker far away.
    const g = ctx.createLinearGradient(0, FENCE_Y, 0, H);
    g.addColorStop(0, '#062b22');
    g.addColorStop(1, '#0b4a37');
    ctx.fillStyle = g;
    ctx.fillRect(0, FENCE_Y, W, H - FENCE_Y);
    // Neon grid lines running away toward the wall.
    ctx.strokeStyle = 'rgba(124,245,255,0.13)';
    ctx.lineWidth = 2;
    for (let i = -6; i <= 16; i++) {
      ctx.beginPath(); ctx.moveTo(500 + (i * 100 - 500) * 0.25, FENCE_Y); ctx.lineTo(i * 100, H); ctx.stroke();
    }
    for (let i = 1; i < 9; i++) {
      const y = FENCE_Y + (H - FENCE_Y) * Math.pow(i / 9, 1.8);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // The infield dirt and the mound.
    ctx.fillStyle = 'rgba(160,95,60,0.45)';
    ctx.beginPath();
    ctx.moveTo(500, 540); ctx.lineTo(760, 760); ctx.lineTo(500, 1180); ctx.lineTo(240, 760);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(190,120,80,0.55)';
    ctx.beginPath(); ctx.ellipse(500, 620, 70, 20, 0, 0, Math.PI * 2); ctx.fill();
    // The outfield wall, with chasing lights like a cabinet's marquee.
    ctx.fillStyle = '#12082e';
    ctx.fillRect(0, FENCE_Y - 26, W, 30);
    ctx.fillStyle = '#ff2ec4';
    ctx.shadowColor = '#ff2ec4'; ctx.shadowBlur = 14;
    ctx.fillRect(0, FENCE_Y - 28, W, 4);
    ctx.shadowBlur = 0;
    const lit = reduced ? -1 : Math.floor(ms / 130) % 3;
    for (let i = 0; i < 34; i++) {
      ctx.fillStyle = i % 3 === lit ? '#ffd23f' : 'rgba(255,210,63,0.3)';
      ctx.beginPath(); ctx.arc(15 + i * 30, FENCE_Y - 11, 5, 0, Math.PI * 2); ctx.fill();
    }
    // The cage netting down both sides.
    ctx.strokeStyle = 'rgba(255,46,196,0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 6; i++) {
      const f = i / 6;
      ctx.beginPath(); ctx.moveTo(0, FENCE_Y + 40 + f * 600); ctx.lineTo(210, FENCE_Y + 40 + f * 270); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W, FENCE_Y + 40 + f * 600); ctx.lineTo(W - 210, FENCE_Y + 40 + f * 270); ctx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const x = i * 42;
      ctx.beginPath(); ctx.moveTo(x, FENCE_Y + 40 + (x / 210) * 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W - x, FENCE_Y + 40); ctx.lineTo(W - x, H); ctx.stroke();
    }
    // Home plate.
    ctx.fillStyle = '#f5f2ff';
    ctx.beginPath();
    ctx.moveTo(430, PLATE_Y - 22); ctx.lineTo(570, PLATE_Y - 22); ctx.lineTo(570, PLATE_Y + 6);
    ctx.lineTo(500, PLATE_Y + 34); ctx.lineTo(430, PLATE_Y + 6);
    ctx.closePath(); ctx.fill();
  }

  // The pitching machine on the mound. Its ring of lights fills during the
  // windup, so you can see the pitch coming.
  function drawMachine(a, t) {
    const { x, y } = MACHINE;
    ctx.fillStyle = '#1b1240';
    ctx.strokeStyle = '#7cf5ff';
    ctx.lineWidth = 4;
    roundRect(x - 62, y - 14, 124, 60, 12);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b1d5e';
    ctx.beginPath(); ctx.arc(x, y - 12, 34, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();
    let fill = 0;
    if (a && a.phase === 'windup') fill = (t - a.pitch.start) / (a.pitch.release - a.pitch.start);
    else if (a && (a.phase === 'flight' || a.phase === 'past')) fill = 1;
    const lights = 12;
    for (let i = 0; i < lights; i++) {
      const ang = -Math.PI / 2 + (i / lights) * Math.PI * 2;
      ctx.fillStyle = i / lights < fill ? '#ffd23f' : 'rgba(255,210,63,0.2)';
      ctx.beginPath(); ctx.arc(x + Math.cos(ang) * 46, y - 12 + Math.sin(ang) * 46, 5, 0, Math.PI * 2); ctx.fill();
    }
    // The mouth the ball comes out of.
    ctx.fillStyle = '#05031a';
    ctx.beginPath(); ctx.arc(x, y - 12, 14, 0, Math.PI * 2); ctx.fill();
  }

  // The sign at the top: what's coming and how fast.
  function drawSign(a, t) {
    if (!a || !run) return;
    const ph = a.pitch;
    let line1 = '', line2 = '';
    if (a.phase === 'ready') { line1 = 'GET READY'; line2 = `${E.PITCHES} PITCHES`; }
    else if (a.phase === 'after' || a.phase === 'windup') { line1 = `PITCH ${ph.n}`; line2 = a.phase === 'windup' ? 'HERE IT COMES' : ''; }
    else if (a.phase === 'flight' || a.phase === 'past') { line1 = ph.label.toUpperCase(); line2 = `${ph.mph} MPH`; }
    else return;
    ctx.fillStyle = 'rgba(5,3,26,0.82)';
    ctx.strokeStyle = '#7cf5ff';
    ctx.lineWidth = 3;
    roundRect(30, 26, 320, 92, 14);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7cf5ff';
    ctx.font = '900 38px system-ui, sans-serif';
    ctx.fillText(line1, 50, 56);
    ctx.fillStyle = '#ffd23f';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(line2, 50, 94);
    // The home-run streak, when there is one.
    const streak = currentStreak();
    if (streak >= 2) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd23f';
      ctx.font = '900 30px system-ui, sans-serif';
      ctx.fillText(`🔥 ${streak} IN A ROW`, 960, 300);
    }
    void t;
  }
  function currentStreak() {
    let n = 0;
    for (let k = outcome.length - 1; k >= 0; k--) {
      const o = outcome[k];
      if (!o) continue;
      if (o.result.homer) n++; else break;
    }
    return n;
  }

  // The ring over the plate. It glows brighter as the ball gets close.
  function drawZone(a, t) {
    let glow = 0.25;
    if (a && (a.phase === 'flight' || a.phase === 'past') && !outcome[a.k]) {
      const d = Math.abs(t - a.pitch.plate);
      glow = d < 250 ? 1 - d / 250 * 0.75 : 0.25;
    }
    ctx.strokeStyle = `rgba(124,245,255,${0.35 + 0.65 * glow})`;
    ctx.lineWidth = 6;
    ctx.shadowColor = '#7cf5ff'; ctx.shadowBlur = 10 + 30 * glow;
    ctx.beginPath(); ctx.arc(ZONE.x, ZONE.y, ZONE.r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,210,63,${0.3 + 0.5 * glow})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ZONE.x, ZONE.y, 14, 0, Math.PI * 2); ctx.stroke();
  }

  // Where a pitch is p of the way (0 at the machine, 1 at the ring). It
  // speeds up as it comes toward you, and a curveball bows out to one side and
  // bends back over the plate.
  function pitchPos(ph, p) {
    const f = 0.3 * p + 0.7 * p * p;
    const bow = ph.bend ? ph.bend * 150 * Math.sin(Math.PI * Math.min(1, p)) : 0;
    // Past the ring it drops away toward the catcher.
    const drop = p > 1 ? (p - 1) * 500 : 0;
    return { x: MACHINE.x + bow, y: MACHINE.y + (ZONE.y - MACHINE.y) * Math.min(1, f) + drop, r: 9 + 31 * Math.min(1.4, p) * Math.min(1.4, p) };
  }

  function drawBall(x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#f1ecdf');
    g.addColorStop(1, '#a89f8a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (r > 12) {
      // The red stitches.
      ctx.strokeStyle = '#ff4f7b';
      ctx.lineWidth = Math.max(1.5, r / 12);
      ctx.beginPath(); ctx.arc(x - r * 0.9, y, r * 0.6, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + r * 0.9, y, r * 0.6, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    }
  }

  function drawPitch(a, t) {
    if (!a || !(a.phase === 'flight' || a.phase === 'past')) return;
    const ph = a.pitch;
    if (outcome[ph.k]) return;   // swung at: drawFlights or drawMissed has it
    const p = (t - ph.release) / ph.travel;
    // A faint trail behind a curveball, so you can see it bend.
    if (ph.bend) {
      ctx.fillStyle = 'rgba(255,46,196,0.25)';
      for (let i = 1; i <= 6; i++) {
        const q = p - i * 0.05;
        if (q <= 0) break;
        const b = pitchPos(ph, q);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    const b = pitchPos(ph, p);
    // Its shadow on the ground.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(b.x, 640 + (PLATE_Y - 640) * Math.min(1, p), b.r, b.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    drawBall(b.x, b.y, b.r);
  }

  // Where each kind of hit goes, early (pulled to the left) or late (to the right).
  function flightOf(r, at) {
    const side = r.early ? -1 : 1;
    const base = { from: { x: ZONE.x, y: ZONE.y }, at };
    switch (r.kind) {
      case 'homer': return { ...base, to: { x: MOON.x, y: MOON.y }, ms: 1500, arc: 260, endR: 6 };
      case 'triple': return { ...base, to: { x: 500 + side * 330, y: FENCE_Y + 30 }, ms: 1300, arc: 330, endR: 7 };
      case 'double': return { ...base, to: { x: 500 + side * 230, y: FENCE_Y + 80 }, ms: 1150, arc: 260, endR: 8 };
      case 'single': return { ...base, to: { x: 500 + side * 140, y: 700 }, ms: 950, arc: 160, endR: 10 };
      case 'grounder': return { ...base, to: { x: 500 + side * 90, y: 740 }, ms: 800, arc: 0, endR: 11 };
      case 'foul': return { ...base, to: { x: 500 + side * 700, y: 640 }, ms: 900, arc: 220, endR: 10 };
      default: return null;
    }
  }

  function drawFlights(ms) {
    for (const o of outcome) {
      if (!o || !o.flight) continue;
      const f = o.flight;
      const k = (ms - f.at) / f.ms;
      if (k < 0 || k > 1.15) continue;
      const e = Math.min(1, 1 - Math.pow(1 - Math.min(1, k), 2));
      const x = f.from.x + (f.to.x - f.from.x) * e;
      const y = f.from.y + (f.to.y - f.from.y) * e - f.arc * Math.sin(Math.PI * Math.min(1, k));
      const r = 32 + (f.endR - 32) * e;
      if (o.result.homer) {
        ctx.strokeStyle = 'rgba(255,210,63,0.4)';
        ctx.lineWidth = r * 0.8;
        ctx.lineCap = 'round';
        const k2 = Math.max(0, Math.min(1, k) - 0.08);
        const e2 = 1 - Math.pow(1 - k2, 2);
        ctx.beginPath();
        ctx.moveTo(f.from.x + (f.to.x - f.from.x) * e2, f.from.y + (f.to.y - f.from.y) * e2 - f.arc * Math.sin(Math.PI * k2));
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      if (k <= 1) drawBall(x, y, Math.max(3, r));
    }
  }

  // A swing that missed, or a pitch let go by: the ball carries on past you.
  function drawMissed(ms, t) {
    for (const o of outcome) {
      if (!o || o.flight || !o.pitch) continue;
      const ph = o.pitch;
      const p = (t - ph.release) / ph.travel;
      if (p > 1.35 || p < 0) continue;
      const b = pitchPos(ph, p);
      drawBall(b.x, b.y, b.r);
    }
    void ms;
  }

  // The bat. It rests up over the batter's shoulder and sweeps across the
  // ring when you swing.
  function drawBat(ms) {
    let ang = -2.1;
    if (bat) {
      const k = Math.min(1, (ms - bat.at) / SWING_MS);
      const e = 1 - Math.pow(1 - k, 3);
      ang = -2.1 - 2.4 * e;
      if (ms - bat.at > SWING_MS + 260) bat = null;
    }
    const tipX = HANDS.x + Math.cos(ang) * BAT_LEN, tipY = HANDS.y + Math.sin(ang) * BAT_LEN;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ff2ec4';
    ctx.shadowColor = '#ff2ec4'; ctx.shadowBlur = 18;
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(HANDS.x + Math.cos(ang) * 120, HANDS.y + Math.sin(ang) * 120);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 15;
    ctx.strokeStyle = '#ffc2ef';
    ctx.beginPath(); ctx.moveTo(HANDS.x, HANDS.y); ctx.lineTo(HANDS.x + Math.cos(ang) * 140, HANDS.y + Math.sin(ang) * 140); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#7cf5ff';
    ctx.beginPath(); ctx.arc(HANDS.x, HANDS.y, 22, 0, Math.PI * 2); ctx.fill();
  }

  function drawPops(ms) {
    pops = pops.filter(p => ms - p.at < p.ms);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of pops) {
      const k = (ms - p.at) / p.ms;
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) * 4;
      ctx.fillStyle = p.color;
      ctx.font = `900 ${p.size}px system-ui, sans-serif`;
      ctx.shadowColor = p.color; ctx.shadowBlur = p.glow ? 22 : 0;
      ctx.fillText(p.text, p.x, p.y - (reduced ? 0 : 60 * k));
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    // Fireworks over the moon.
    sparks = sparks.filter(s => ms - s.at < s.ms);
    for (const s of sparks) {
      const k = (ms - s.at) / s.ms;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x + s.vx * k, s.y + s.vy * k + 60 * k * k, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (banner && ms - banner.at < 1500) {
      const k = (ms - banner.at) / 1500;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = banner.color;
      ctx.font = '900 62px system-ui, sans-serif';
      ctx.shadowColor = banner.color; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, W / 2, 330);
      ctx.font = '800 32px system-ui, sans-serif';
      ctx.fillText(banner.sub, W / 2, 385);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function drawCountdown(ms) {
    if (mode !== 'resuming') return;
    const left = Math.max(0, resumeAt - ms);
    ctx.fillStyle = 'rgba(5,3,26,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7cf5ff';
    ctx.font = '900 180px system-ui, sans-serif';
    ctx.fillText(String(Math.ceil(left / 1000)), W / 2, H / 2 - 40);
    ctx.font = '800 40px system-ui, sans-serif';
    ctx.fillText('Get ready…', W / 2, H / 2 + 90);
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

  // ---- the loop ------------------------------------------------------------------------
  function frame(ms) {
    requestAnimationFrame(frame);
    pollPad();
    if (mode === 'resuming' && ms >= resumeAt) {
      pausedTotal += resumeAt - pausedAt;
      mode = 'playing';
      if (run) api(`/api/moonshot/run/${run.runId}/resume`, {}).catch(() => {});
    }
    const t = clock();
    const a = plan && mode !== 'idle' ? E.at(plan, t) : null;
    if (mode === 'playing') tick(a, t);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawSky(ms);
    drawField(ms);
    drawMachine(a, t);
    drawZone(a, t);
    drawMissed(ms, t);
    drawPitch(a, t);
    drawFlights(ms);
    drawBat(ms);
    drawSign(a, t);
    drawPops(ms);
    drawCountdown(ms);
    const ready = mode === 'playing' && a && (a.phase === 'flight' || a.phase === 'past') && !outcome[a.k];
    if ($('swingBtn').disabled === !!ready) $('swingBtn').disabled = !ready;
    Blip.musicPlaying(mode === 'playing' || mode === 'resuming');
  }

  // Things that happen as the clock passes them: a pitch let go by is a
  // strike, a new level is announced, and the run ends after the last pitch.
  let announced = 0;
  function tick(a, t) {
    for (const ph of plan.pitches) {
      if (ph.close >= t) break;
      if (!outcome[ph.k]) {
        const r = { n: ph.n, kind: 'taken', label: 'Strike', points: 0, homer: false, swing: null };
        outcome[ph.k] = { result: r, pitch: ph, flight: null };
        pops.push({ text: 'STRIKE!', x: W / 2, y: 820, color: COLORS.taken, size: 64, at: now(), ms: 1000 });
        $('live').textContent = `Strike. You let pitch ${ph.n} go by.`;
        Blip.tone([300, 180], 0.2, { type: 'sawtooth', volume: 0.04 });
        paintHud();
      }
    }
    if (a && a.phase === 'windup' && a.pitch.level > 1 && a.pitch.k % E.PER_LEVEL === 0 && announced < a.pitch.level) {
      announced = a.pitch.level;
      banner = { text: 'FASTER!', sub: `Points ×${a.pitch.level} from here`, color: '#ff2ec4', at: now() };
      Blip.tune([[440, 0.05], [554, 0.05], [659, 0.05], [880, 0.1]], { type: 'square', volume: 0.04 });
      paintHud();
    }
    if (a && a.phase === 'windup' && a.pitch.release - t < 140 && !a.pitch.cued) {
      a.pitch.cued = true;
      Blip.tone(180, 0.06, { type: 'triangle', volume: 0.05 });
    }
    if (a && a.phase === 'done') finishRun();
  }

  // ---- a run ---------------------------------------------------------------------------
  async function begin() {
    if (busy) return;
    busy = true;
    try {
      const r = await api('/api/moonshot/start', { profileToken: token() });
      run = { runId: r.runId, seed: r.seed, saved: false };
      plan = E.plan(r.seed);
      clientStart = now();
      pausedTotal = 0;
      times = [];
      outcome = [];
      total = 0;
      pending = 0;
      announced = 1;
      pops = [];
      sparks = [];
      banner = null;
      mode = 'playing';
      document.body.dataset.state = 'playing';
      $('cover').classList.add('hidden');
      $('pauseCover').classList.add('hidden');
      $('over').classList.add('hidden');
      paintHud();
      Blip.unlock();
      if (window.ArcadeStats) ArcadeStats.play();
    } catch (e) {
      toast(e.message, 4000);
    } finally { busy = false; }
  }

  function swing() {
    Blip.unlock();
    if (mode === 'idle') { begin(); return; }
    if (mode === 'paused') { resume(); return; }
    if (mode !== 'playing' || !plan) return;
    const ms = now();
    if (bat && ms - bat.at < SWING_MS) return;
    const t = clock();
    const a = E.at(plan, t);
    bat = { at: ms };
    // With no ball on its way, it's only a practice swing: nothing is sent.
    if (!(a.phase === 'flight' || a.phase === 'past') || outcome[a.k]) {
      Blip.tone(140, 0.08, { type: 'triangle', volume: 0.03 });
      return;
    }
    times.push(t);
    const r = E.replay(run.seed, times, t, plan).results[a.k];
    const o = { result: r, pitch: a.pitch, server: null, flight: flightOf(r, ms) };
    outcome[a.k] = o;
    if (r.kind === 'whiff') Blip.tone([220, 120], 0.18, { type: 'sawtooth', volume: 0.04 });
    else Blip.noise(0.05, r.homer ? 0.22 : 0.14);
    send(run.runId, t, o);
  }

  async function send(runId, t, o) {
    pending++;
    try {
      const r = await api(`/api/moonshot/run/${runId}/swing`, { t });
      if (!run || run.runId !== runId) return;
      o.server = r.result;
      total = r.total;
      showHit(o);
      paintHud();
    } catch (e) {
      if (!run || run.runId !== runId || mode === 'over') return;
      endRun(null, `The arcade couldn't count that swing: ${e.message}`);
    } finally { pending--; }
  }

  // The server has said what the swing did: show it and celebrate it.
  function showHit(o) {
    const r = o.server;
    const ms = now();
    const color = COLORS[r.kind];
    const timing = r.homer ? 'PERFECT!' : r.offset === 0 ? '' : `${Math.abs(r.offset)} ms ${r.early ? 'early' : 'late'}`;
    pops.push({ text: SHOUT[r.kind], x: W / 2, y: 760, color, size: r.homer ? 86 : 64, at: ms, ms: 1300, glow: r.homer });
    if (r.points) pops.push({ text: `+${fmt(r.points)}`, x: W / 2, y: 850, color: '#ffffff', size: 50, at: ms, ms: 1300 });
    if (timing) pops.push({ text: timing, x: W / 2, y: 915, color: '#f5eaff', size: 30, at: ms, ms: 1300 });
    $('live').textContent = `${r.label}${r.points ? `, ${r.points} points` : ''}.${timing && !r.homer ? ` That swing was ${timing}.` : ''}`;
    if (r.homer) {
      Blip.tune([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.14], [784, 0.08], [1047, 0.3]], { type: 'square', volume: 0.06 });
      if (window.Fx) {
        Fx.banner('HOME RUN!', r.streak > 1 ? `${r.streak} in a row! +${fmt(r.points)}` : `+${fmt(r.points)} points`, { ms: 1500 });
        Fx.burst({ count: r.streak > 1 ? 170 : 110, coins: Math.min(45, 15 + 8 * r.streak) });
        Fx.flash('rgba(255,210,63,.3)');
      }
      if (!reduced) {
        for (let i = 0; i < 40; i++) {
          const ang = (i / 40) * Math.PI * 2;
          const sp = 90 + (i % 5) * 30;
          sparks.push({ x: MOON.x, y: MOON.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, at: ms + 1300, ms: 1100,
            color: ['#ffd23f', '#7cf5ff', '#ff2ec4'][i % 3] });
        }
      }
    } else if (r.kind === 'triple' || r.kind === 'double') {
      Blip.tune([[659, 0.07], [880, 0.12]], { type: 'triangle', volume: 0.06 });
      const rect = canvas.getBoundingClientRect();
      if (window.Fx) Fx.burst({ count: 40, coins: r.kind === 'triple' ? 8 : 4, origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.5 } });
    } else if (r.points >= 25) {
      Blip.tone(660, 0.12, { type: 'triangle', volume: 0.06 });
    }
    // "So close" only when it really was: the server measured the swing
    // within a hair of the home-run window.
    if (r.near) {
      setTimeout(() => toast(`So close! That swing was ${r.missedBy} ms off a home run.`, 2600), 400);
    }
  }

  function paintHud() {
    $('score').textContent = fmt(total);
    const done = outcome.filter(Boolean).length;
    $('pitch').textContent = `${Math.min(E.PITCHES, done + 1)} of ${E.PITCHES}`;
    const level = plan ? E.levelOf(Math.min(done, E.PITCHES - 1)) : 1;
    $('mult').textContent = `×${level}`;
    $('mult').classList.toggle('up', level > 1);
  }

  // ---- pausing -------------------------------------------------------------------------
  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    pausedAt = now();
    $('pauseCover').classList.remove('hidden');
    if (run) api(`/api/moonshot/run/${run.runId}/pause`, {}).catch(() => {});
  }
  function resume() {
    if (mode !== 'paused') return;
    $('pauseCover').classList.add('hidden');
    mode = 'resuming';
    resumeAt = now() + (reduced ? 2000 : 3000);
  }

  // ---- the end of a run ---------------------------------------------------------------------
  let finishing = false;
  async function finishRun() {
    if (finishing || mode !== 'playing') return;
    finishing = true;
    mode = 'ending';
    const runId = run.runId;
    // Let the last hit land and the last answer arrive.
    await new Promise(r => setTimeout(r, 1300));
    for (let i = 0; i < 40 && pending > 0; i++) await new Promise(r => setTimeout(r, 100));
    let view = null, problem = null;
    for (let i = 0; i < 6; i++) {
      try {
        view = await api(`/api/moonshot/run/${runId}`);
        if (view.finished) break;
      } catch (e) { problem = e.message; break; }
      await new Promise(r => setTimeout(r, 400));
    }
    finishing = false;
    if (!run || run.runId !== runId || mode === 'over') return;
    endRun(view, problem);
  }

  const iniBoxes = [...document.querySelectorAll('#iniRow .ini')];
  const initials = ArcadeKit.wireInitials(iniBoxes, () => saveScore(), { guest: TvPlay.on });
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }
  function endRun(view, problem) {
    mode = 'over';
    overSince = now();
    document.body.dataset.state = 'over';
    $('pauseCover').classList.add('hidden');
    Blip.musicPlaying(false);
    const results = view ? view.results : outcome.filter(Boolean).map(o => o.server || o.result);
    if (view) total = view.total;
    const homers = results.filter(r => r.homer).length;
    const hits = results.filter(r => ['homer', 'triple', 'double', 'single'].includes(r.kind)).length;
    let best = 0, run1 = 0;
    for (const r of results) { run1 = r.homer ? run1 + 1 : 0; best = Math.max(best, run1); }
    $('overTitle').textContent = problem ? 'That run stopped early'
      : homers ? `${homers} home run${homers === 1 ? '' : 's'}! What a night! ⚾` : 'That\'s the last pitch! ⚾';
    $('overScore').textContent = fmt(total);
    $('overChips').replaceChildren(...results.map(r => {
      const s = document.createElement('span');
      s.className = r.homer ? 'homer' : ['triple', 'double', 'single'].includes(r.kind) ? 'hit' : r.points ? '' : 'strike';
      s.textContent = r.homer ? `★ ${fmt(r.points)}` : r.points ? `${r.label} ${fmt(r.points)}` : r.label;
      return s;
    }));
    $('overDetail').textContent = problem || `You got a hit on ${hits} of ${E.PITCHES} pitches${best >= 2 ? `, with ${best} home runs in a row` : ''}.`;
    const p = profile();
    const canSave = !problem && view && view.finished;
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
    if (!run || mode !== 'over' || run.saved) return;
    const p = profile();
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      // Only the run id and who you are: the server already knows the score.
      const r = await api(`/api/moonshot/run/${run.runId}/save`, { initials: ini, profileToken: token() });
      if (!p) initials.remember(ini);
      run.saved = true;
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = r.allRank === 1 ? 'That\'s the best Moonshot run ever! 🏆'
        : r.dayRank === 1 ? `That's the best score today! You're #${r.allRank} of all time.`
          : `You're #${r.dayRank} today${r.nextUp != null ? `, ${fmt(r.nextUp)} point${r.nextUp === 1 ? '' : 's'} behind #${r.dayRank - 1}` : ''}, and #${r.allRank} of all time.`;
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
    pause();
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
      const rows = await api(`/api/moonshot/board?scope=${scope}&limit=20`);
      ArcadeKit.renderScores(list, rows.map(r => ({
        ...r, detail: [r.homers ? `${r.homers} home run${r.homers === 1 ? '' : 's'}` : '', scope === 'all' ? niceDay(r.day) : ''].filter(Boolean).join(' · ')
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
  $('resumeBtn').addEventListener('click', e => { e.stopPropagation(); resume(); });
  $('stage').addEventListener('pointerdown', e => {
    if (e.target.closest('.ms-cover')) return;
    if (e.button > 0) return;
    e.preventDefault();
    swing();
  });
  // The button acts on the press, not the release, so the timing is yours.
  $('swingBtn').addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); swing(); });
  $('swingBtn').addEventListener('click', e => e.preventDefault());
  const blocked = () => help.isOpen || !$('scores').classList.contains('hidden');
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (!$('scores').classList.contains('hidden')) { if (e.key === 'Escape') closeScores(); return; }
    if (help.isOpen) return;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (mode === 'playing') pause(); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    // On the end screen, Space and Enter work its buttons instead.
    if (mode === 'over' || mode === 'ending') return;
    e.preventDefault();
    if (e.repeat) return;
    swing();
  });

  // A game controller (the Gamepad API): A swings (and starts a run), Start
  // pauses and carries on. Checked every frame, acting on the press, not the hold.
  const padWas = new Map();
  function pollPad() {
    if (!navigator.getGamepads) return;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return; }
    for (const gp of pads) {
      if (!gp || !gp.buttons) continue;
      const a = !!(gp.buttons[0] && gp.buttons[0].pressed), st = !!(gp.buttons[9] && gp.buttons[9].pressed);
      const was = padWas.get(gp.index) || {};
      if (a && !was.a) padPress('a');
      if (st && !was.st) padPress('start');
      padWas.set(gp.index, { a, st });
    }
  }
  function padPress(button) {
    if (blocked()) { if (!$('scores').classList.contains('hidden')) closeScores(); return; }
    if (mode === 'over') {
      // A short wait, so a swing at the end doesn't start the next run.
      if (now() - overSince > 1200) begin();
      return;
    }
    if (button === 'start') {
      if (mode === 'playing') pause();
      else if (mode === 'paused') resume();
      else if (mode === 'idle') begin();
      return;
    }
    swing();
  }

  // Leaving the page pauses the run.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);

  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('moonshot');

  // ---- how to play -------------------------------------------------------------------------------
  const pts = k => E.KINDS[k].points;
  const help = Tutorial.create('moonshot', [
    {
      emoji: '⚾', title: 'Swing at the right moment',
      html: `<p>You're at the plate in a neon batting cage, and a pitching machine throws balls at you. <b>Tap anywhere on the cage</b> (or the big SWING button) to swing. The lights around the machine fill up just before it throws, so you can see each pitch coming.</p>
        <p>Swing just as the ball reaches the <b>glowing ring over the plate</b>. The closer your timing, the bigger the hit. Swing too early and the ball goes off to the left; too late and it goes off to the right.</p>
        <table>
          <tr><td>⌨️ Keyboard</td><td><b>Space</b> or <b>Enter</b> swings, and <b>P</b> or <b>Esc</b> pauses.</td></tr>
          <tr><td>🎮 Controller</td><td>The <b>A</b> button swings (so do <b>X</b>, <b>R1</b> and the right trigger), and <b>Start</b> pauses.</td></tr>
          <tr><td>📺 TV</td><td>The remote's <b>OK</b> button swings.</td></tr>
        </table>`
    },
    {
      emoji: '🌙', title: 'What a swing is worth',
      html: `<table>
          <tr><td>🌙 Home run</td><td>A perfect swing, within ${E.HOMER_MS} thousandths of a second (milliseconds, or ms) of the ball reaching the ring. It flies to the moon: <b>${pts('homer')} points</b>.</td></tr>
          <tr><td>🏃 Triple</td><td>Within ${E.BANDS[1][0]} ms: <b>${pts('triple')} points</b>.</td></tr>
          <tr><td>🏃 Double</td><td>Within ${E.BANDS[2][0]} ms: <b>${pts('double')} points</b>.</td></tr>
          <tr><td>🏃 Single</td><td>Within ${E.BANDS[3][0]} ms: <b>${pts('single')} points</b>.</td></tr>
          <tr><td>⚾ Grounder</td><td>Within ${E.BANDS[4][0]} ms: <b>${pts('grounder')} points</b>.</td></tr>
          <tr><td>↗️ Foul ball</td><td>Within ${E.BANDS[5][0]} ms: <b>${pts('foul')} points</b>.</td></tr>
          <tr><td>❌ Strike</td><td>A swing further off than that, or no swing at all, scores nothing.</td></tr>
        </table>
        <div class="tut-tip">After each swing the cage tells you how many milliseconds early or late you were, so you can fix your timing on the next one.</div>`
    },
    {
      emoji: '🔥', title: 'Twelve pitches, and they speed up',
      html: `<p>Every run has <b>${E.PITCHES} pitches</b>, and it takes about a minute.</p>
        <table>
          <tr><td>💨 Fastball</td><td>Quick and straight.</td></tr>
          <tr><td>🐢 Changeup</td><td>Looks the same leaving the machine, but it's slower, so wait for it.</td></tr>
          <tr><td>🌀 Curveball</td><td>Swings out to one side and bends back over the plate.</td></tr>
          <tr><td>⏩ Faster</td><td>Pitches ${E.PER_LEVEL + 1} to ${E.PER_LEVEL * 2} come faster and score double, and pitches ${E.PER_LEVEL * 2 + 1} to ${E.PITCHES} are faster still and score triple.</td></tr>
          <tr><td>🔥 Streak</td><td>Home runs in a row earn a bonus: ${E.STREAK_BONUS} more points for each one in the streak before it, up to ${E.STREAK_BONUS * E.STREAK_CAP} extra (before the double and triple points).</td></tr>
        </table>`
    },
    {
      emoji: '🏆', title: 'The high scores',
      html: `<p>After the last pitch, save your score with your initials (or your profile, if you picked one) to put it on <b>today's board</b> and the <b>all-time board</b>. Every run you save counts.</p>
        <p>The arcade works out every hit itself from the moments you swung, so a score can't be typed in or made up. Opening How to play or leaving the page pauses the run, and you get a short countdown when you come back.</p>`
    }
  ], { onClose: () => { if (pausedForHelp) { pausedForHelp = false; resume(); } } });
  $('helpBtn').addEventListener('click', () => {
    if (mode === 'playing') { pausedForHelp = true; pause(); }
    help.open();
  });

  // ---- start ---------------------------------------------------------------------------------
  document.body.dataset.state = 'ready';
  paintHud();

  // ---- on the TV ----------------------------------------------------------------------------
  // The batting cage on the right, big, with its own Start and Keep playing
  // buttons. OK swings; a controller's X, R1 and right trigger swing too (A
  // and Start are above).
  TvPlay.setup({
    stage: $('stage'),
    steering: () => mode === 'playing' || mode === 'resuming' || mode === 'ending',
    active: () => mode === 'playing' || mode === 'resuming',
    start: () => [$('resumeBtn'), $('coverBtn')].find(b => !b.closest('.hidden')) || null,
    buttons: { 2: ' ', 5: ' ', 7: ' ' },
    hint: 'Press OK to swing just as the ball reaches the glowing ring over the plate. On a game controller, A, X, R1 or the right trigger swings too, and Start pauses.'
  });
  if (TvPlay.on) {
    $('coverText').textContent = 'Twelve pitches are coming. Press OK to swing just as each ball reaches the glowing ring over the plate. Get it exactly right and it\'s a home run.';
    $('pauseText').textContent = 'The pitching machine is waiting for you. Press OK on Keep playing when you\'re ready, and you\'ll get a short countdown before the next ball.';
  }

  requestAnimationFrame(frame);
  help.autoOpen();
})();
