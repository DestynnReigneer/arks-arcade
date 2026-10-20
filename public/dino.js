'use strict';

// Dino Dash: an endless runner. Jump the cactuses, duck the birds, and the
// world speeds up the farther you get. All the art is drawn here from little
// text bitmaps, and every sound is synthesized.

(() => {
  const { $, toast } = ArcadeKit;

  // ---- the world, in game units (the canvas scales to fit) ------------------
  // The world is 600 wide on a big screen; on a phone it's narrower, which
  // zooms in so the dino isn't tiny. Height never changes.
  let W = 600;
  const H = 180, GROUND = 150, PX = 2;   // PX: size of one sprite pixel
  const GRAVITY = 2400, JUMP_V = -720, SHORT_HOP_V = -320;
  const START_SPEED = 330, MAX_SPEED = 780;
  const DINO_X = 40;

  // ---- sprites: '#' is a pixel, anything else is see-through ----------------
  const LEGS = {
    stand: ['....##.##...........', '....#...#...........', '....##..##..........'],
    runA: ['....##.##...........', '....#...##..........', '....##..............'],
    runB: ['....##.##...........', '....##..#...........', '........##..........']
  };
  const BODY = [
    '..........########..',
    '.........##.########',
    '.........##########.',
    '.........##########.',
    '.........#####......',
    '.........########...',
    '#.......#####.......',
    '#......######.......',
    '##....##########....',
    '###..########.#.....',
    '##########..........',
    '.#########..........',
    '..########..........',
    '...#######..........',
    '....######..........'
  ];
  const DUCK = {
    a: [
      '..................#######.',
      '#.................##.#####',
      '##......##################',
      '###...###################.',
      '.###################......',
      '..################.##.....',
      '...###############........',
      '....############..........',
      '.....##..##...............',
      '.....#....##..............',
      '.....##...................'
    ],
    b: [
      '..................#######.',
      '#.................##.#####',
      '##......##################',
      '###...###################.',
      '.###################......',
      '..################.##.....',
      '...###############........',
      '....############..........',
      '.....##..##...............',
      '.....##...#...............',
      '..........##..............'
    ]
  };
  const CACTUS = [
    '....##....',
    '...####...',
    '...####...',
    '...####.#.',
    '#..####.##',
    '##.####.##',
    '##.####.##',
    '##.####.##',
    '##.######.',
    '##.#####..',
    '.######...',
    '..#####...',
    '...####...',
    '...####...',
    '...####...',
    '...####...',
    '...####...',
    '...####...'
  ];
  const BIRD = {
    up: [
      '......#...........',
      '......##..........',
      '......###.........',
      '...#..####........',
      '..##..#####.......',
      '.################.',
      '....##############',
      '......#########...'
    ],
    down: [
      '...#..............',
      '..##..............',
      '.################.',
      '....##############',
      '......######......',
      '......####........',
      '......###.........',
      '......##..........'
    ]
  };
  const CLOUD = [
    '.......####.......',
    '....###....##.....',
    '..##.........###..',
    '.#..............#.',
    '##################'
  ];

  // Draws a bitmap once into its own little canvas, per color, then reuses it.
  const spriteCache = new Map();
  function sprite(rows, color, scale = PX) {
    const key = rows.join('|') + color + scale;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const c = document.createElement('canvas');
    c.width = rows[0].length * scale;
    c.height = rows.length * scale;
    const g = c.getContext('2d');
    g.fillStyle = color;
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') g.fillRect(x * scale, y * scale, scale, scale); }));
    spriteCache.set(key, c);
    return c;
  }
  const dinoRows = (legs, dead) => {
    const body = BODY.slice();
    if (dead) body[1] = '.........#.#########';   // a wide-open eye
    return [...body, ...LEGS[legs]];
  };

  // ---- canvas ---------------------------------------------------------------------
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = canvas.parentElement.clientWidth;
    W = width < 520 ? 400 : 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(width * dpr * H / W);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', fit);
  fit();

  // ---- state ------------------------------------------------------------------------
  const S = {
    mode: 'ready',       // ready | running | over
    y: 0, vy: 0, ducking: false, jumpHeld: false,
    dist: 0, speed: START_SPEED, obstacles: [], clouds: [], stars: [], nextGap: 300,
    groundShift: 0, time: 0, night: 0, flash: 0, lastMilestone: 0,
    hi: (() => { try { return Number(localStorage.getItem('dino.hi')) || 0; } catch { return 0; } })()
  };
  const score = () => Math.floor(S.dist / 12);
  const onGround = () => S.y >= 0;

  function reset() {
    if (window.ArcadeStats) ArcadeStats.play();
    Object.assign(S, {
      mode: 'running', y: 0, vy: 0, ducking: false, dist: 0, speed: START_SPEED,
      obstacles: [], nextGap: 380, groundShift: 0, time: 0, night: 0, flash: 0, lastMilestone: 0
    });
    S.clouds = [{ x: 420, y: 40 }, { x: 160, y: 66 }];
    S.stars = Array.from({ length: 14 }, () => ({ x: Math.random() * W, y: 10 + Math.random() * 80 }));
    $('overPanel').classList.add('hidden');
    document.body.dataset.state = 'running';
  }

  // ---- input ------------------------------------------------------------------------
  function jump() {
    Blip.unlock();
    if (S.mode !== 'running') {
      // A beat after crashing, so a panicked tap doesn't skip the score.
      if (S.mode === 'ready' || performance.now() - S.crashedAt > 700) reset();
      return;
    }
    S.jumpHeld = true;
    if (onGround() && !S.ducking) {
      S.vy = JUMP_V;
      S.y = -0.01;
      Blip.tone([420, 760], 0.09, { type: 'square', volume: 0.06 });
    }
  }
  function releaseJump() {
    S.jumpHeld = false;
    // Let go early for a short hop.
    if (S.vy < SHORT_HOP_V) S.vy = SHORT_HOP_V;
  }
  function duck(on) {
    if (S.mode !== 'running') return;
    S.ducking = on;
  }

  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  document.addEventListener('keydown', e => {
    if (typing() || help.isOpen) return;
    if ([' ', 'ArrowUp', 'w', 'W'].includes(e.key)) { e.preventDefault(); if (!e.repeat) jump(); }
    if (['ArrowDown', 's', 'S'].includes(e.key)) { e.preventDefault(); duck(true); }
  });
  document.addEventListener('keyup', e => {
    if ([' ', 'ArrowUp', 'w', 'W'].includes(e.key)) releaseJump();
    if (['ArrowDown', 's', 'S'].includes(e.key)) duck(false);
  });

  // Tap the game to jump; swipe down on it to duck.
  let touchY = null;
  canvas.addEventListener('pointerdown', e => { touchY = e.clientY; jump(); });
  canvas.addEventListener('pointermove', e => { if (touchY != null && e.clientY - touchY > 24) duck(true); });
  const endTouch = () => { touchY = null; releaseJump(); duck(false); };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  function holdButton(btn, down, up) {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.classList.add('held'); down(); });
    const off = () => { btn.classList.remove('held'); up(); };
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  }
  holdButton($('jumpBtn'), jump, releaseJump);
  holdButton($('duckBtn'), () => duck(true), () => duck(false));

  // ---- the world ticking along -------------------------------------------------------
  function spawn() {
    const s = score();
    const birdsAllowed = s > 250;
    if (birdsAllowed && Math.random() < 0.28) {
      // Low birds must be jumped, middle ones ducked, high ones run under.
      const heights = [GROUND - 30, GROUND - 52, GROUND - 76];
      S.obstacles.push({ kind: 'bird', x: W + 10, y: heights[Math.floor(Math.random() * 3)], w: 36, h: 16 });
      return;
    }
    const big = Math.random() < Math.min(0.5, s / 1200);
    const scale = big ? 3 : 2;
    const count = 1 + Math.floor(Math.random() * Math.min(3, 1 + s / 300));
    const w = 10 * scale, h = 18 * scale;
    for (let i = 0; i < count; i++) {
      S.obstacles.push({ kind: 'cactus', scale, x: W + 10 + i * (w + 2), y: GROUND - h, w, h });
    }
  }

  // Boxes a little smaller than the art, so near misses feel fair.
  function dinoBoxes() {
    const top = GROUND + S.y;
    if (S.ducking && onGround()) return [{ x: DINO_X + 2, y: top - 20, w: 48, h: 16 }];
    const h = (BODY.length + 3) * PX;
    return [
      { x: DINO_X + 20, y: top - h + 2, w: 18, h: 14 },
      { x: DINO_X + 4, y: top - h + 14, w: 24, h: h - 18 }
    ];
  }
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function update(dt) {
    S.time += dt;
    S.speed = Math.min(MAX_SPEED, START_SPEED + S.dist * 0.012);
    const move = S.speed * dt;
    S.dist += move;
    S.groundShift = (S.groundShift + move) % 24;

    // Jumping, and dropping fast if you duck in the air.
    if (!onGround() || S.vy < 0) {
      S.vy += GRAVITY * (S.ducking ? 3 : 1) * dt;
      S.y += S.vy * dt;
      if (S.y >= 0) { S.y = 0; S.vy = 0; }
    }

    for (const o of S.obstacles) o.x -= move * (o.kind === 'bird' ? 1.12 : 1);
    S.obstacles = S.obstacles.filter(o => o.x + o.w > -10);
    S.nextGap -= move;
    if (S.nextGap <= 0) {
      spawn();
      const min = S.speed * 0.62 + 140;
      S.nextGap = min + Math.random() * min * 0.9;
    }
    for (const c of S.clouds) c.x -= move * 0.2;
    if (S.clouds.length < 3 && Math.random() < dt * 0.4) S.clouds.push({ x: W + 20, y: 24 + Math.random() * 60 });
    S.clouds = S.clouds.filter(c => c.x > -50);

    // Every 100 points: a chime and a flash of the score.
    const s = score();
    if (Math.floor(s / 100) > S.lastMilestone) {
      S.lastMilestone = Math.floor(s / 100);
      S.flash = 1;
      Blip.tune([[880, 0.06], [1320, 0.12]], { type: 'square', volume: 0.05 });
    }
    S.flash = Math.max(0, S.flash - dt * 0.8);
    // Night falls at 700 and lifts at 1400, and so on.
    const wantNight = Math.floor(s / 700) % 2 === 1;
    S.night += ((wantNight ? 1 : 0) - S.night) * Math.min(1, dt * 1.5);

    const boxes = dinoBoxes();
    for (const o of S.obstacles) {
      const box = { x: o.x + 3, y: o.y + 3, w: o.w - 6, h: o.h - 4 };
      if (boxes.some(b => hit(b, box))) return crash();
    }
  }

  function crash() {
    S.mode = 'over';
    S.crashedAt = performance.now();
    Blip.noise(0.25, 0.18);
    Blip.tone([300, 80], 0.4, { type: 'sawtooth', volume: 0.08 });
    const s = score();
    const best = s > S.hi;
    if (best) { S.hi = s; try { localStorage.setItem('dino.hi', String(s)); } catch { /* unavailable */ } }
    document.body.dataset.state = 'over';
    document.body.dataset.score = String(s);
    $('overTitle').textContent = best && s > 0 ? 'New personal best! 🎉' : 'Game over';
    $('overScore').textContent = s.toLocaleString('en-US');
    $('savePart').classList.toggle('hidden', s < 1);
    $('saveScoreBtn').disabled = false;
    $('scoreMsg').textContent = '';
    $('overPanel').classList.remove('hidden');
  }

  // ---- drawing -----------------------------------------------------------------------------
  const mix = (a, b, t) => {
    const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
    const [ra, ga, ba] = p(a), [rb, gb, bb] = p(b);
    const h = v => Math.round(v).toString(16).padStart(2, '0');
    return '#' + h(ra + (rb - ra) * t) + h(ga + (gb - ga) * t) + h(ba + (bb - ba) * t);
  };

  function draw() {
    const n = S.night;
    const sky = mix('#171623', '#090612', n);
    // Sprite colors snap between day and night so the sprite cache stays small.
    const ink = n > 0.5 ? '#c9a8dd' : '#f4ecd0';
    const dim = n > 0.5 ? '#5d4a78' : '#8f8367';
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    if (n > 0.05) {
      ctx.globalAlpha = n;
      ctx.fillStyle = '#fff6d6';
      for (const s of S.stars) ctx.fillRect((s.x - S.dist * 0.02 % W + W) % W, s.y, 2, 2);
      ctx.beginPath();
      ctx.arc(W - 100, 34, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sky;
      ctx.beginPath();
      ctx.arc(W - 94, 30, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const c of S.clouds) ctx.drawImage(sprite(CLOUD, dim), c.x, c.y);

    // The ground: a line with pebbles rolling past.
    ctx.fillStyle = dim;
    ctx.fillRect(0, GROUND - 1, W, 2);
    for (let x = -S.groundShift; x < W; x += 24) {
      ctx.fillRect(x + 4, GROUND + 6, 3, 2);
      ctx.fillRect(x + 15, GROUND + 12, 5, 2);
    }

    for (const o of S.obstacles) {
      if (o.kind === 'cactus') ctx.drawImage(sprite(CACTUS, ink, o.scale), o.x, o.y);
      else ctx.drawImage(sprite(Math.floor(S.time * 6) % 2 ? BIRD.up : BIRD.down, ink), o.x, o.y);
    }

    // The dino.
    const step = Math.floor(S.time * 12) % 2;
    let rows;
    if (S.mode === 'over') rows = dinoRows('stand', true);
    else if (S.ducking && onGround()) rows = step ? DUCK.a : DUCK.b;
    else if (!onGround() || S.mode === 'ready') rows = dinoRows('stand');
    else rows = dinoRows(step ? 'runA' : 'runB');
    const img = sprite(rows, ink);
    ctx.drawImage(img, DINO_X, GROUND + S.y - img.height + 1);

    // Score, top right, arcade style.
    ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const pad = v => String(v).padStart(5, '0');
    ctx.fillStyle = dim;
    ctx.fillText(`HI ${pad(S.hi)}`, W - 82, 10);
    const blink = S.flash > 0 && Math.floor(S.flash * 8) % 2 === 0;
    ctx.fillStyle = ink;
    if (!blink) ctx.fillText(pad(score()), W - 12, 10);

    ctx.textAlign = 'center';
    if (S.mode === 'ready') {
      ctx.fillStyle = ink;
      ctx.fillText('TAP OR PRESS SPACE TO RUN', W / 2, 70);
    } else if (S.mode === 'over') {
      ctx.fillStyle = ink;
      ctx.font = 'bold 20px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('G A M E   O V E R', W / 2, 54);
      ctx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = dim;
      ctx.fillText('TAP TO RUN AGAIN', W / 2, 84);
    }
  }

  // ---- the loop ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    // Cap the step so a hiccup (or a background tab) can't teleport you into a cactus.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (S.mode === 'running' && !help.isOpen) update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  // ---- scores -----------------------------------------------------------------------------
  let initials = null;
  async function saveScore() {
    const who = initials.value();
    if (!who) { $('scoreMsg').textContent = 'Type your initials first.'; return; }
    $('saveScoreBtn').disabled = true;
    try {
      const r = await ArcadeKit.saveScore('dino', { initials: who, score: score(), board: 'run', detail: '' });
      initials.remember(who);
      $('savePart').classList.add('hidden');
      openScores(r.id);
      toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
    } catch (e) {
      $('scoreMsg').textContent = e.message;
      $('saveScoreBtn').disabled = false;
    }
  }
  function openScores(highlightId) {
    ArcadeKit.loadScores('dino', 'run', $('scoreList'), highlightId);
    $('scoresView').classList.remove('hidden');
  }

  // ---- how to play --------------------------------------------------------------------------
  const help = Tutorial.create('dino', [
    {
      emoji: '🦖', title: 'Run!',
      html: `<p>Your dino runs on its own. Don't hit anything. The farther you get, the higher your score, and the faster it goes.</p>`
    },
    {
      emoji: '⬆️', title: 'Jump and duck',
      html: `<table>
          <tr><td>⬆ Jump</td><td>Tap the game or the <b>Jump</b> button, or press <b>Space</b> / <b>↑</b>. Tap quickly for a little hop, hold for a big jump.</td></tr>
          <tr><td>⬇ Duck</td><td>Hold <b>Duck</b>, press <b>↓</b>, or swipe down on the game. Ducking in the air drops you fast.</td></tr>
        </table>`
    },
    {
      emoji: '🌵', title: 'What\'s coming',
      html: `<p><b>Cactuses</b>: jump them. Big clumps need a full jump.</p>
        <p><b>Birds</b> show up after 250: jump the low ones, duck the middle ones, and just keep running under the high ones.</p>
        <p>Night falls at 700. Then you'll be glad you practiced.</p>
        <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
    }
  ]);

  $('againBtn').addEventListener('click', reset);
  $('saveScoreBtn').addEventListener('click', saveScore);
  $('scoresBtn').addEventListener('click', () => openScores());
  $('scoresClose').addEventListener('click', () => $('scoresView').classList.add('hidden'));
  $('helpBtn').addEventListener('click', () => help.open());
  Blip.muteButton($('muteBtn'));
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overPanel .ini')], saveScore);

  document.body.dataset.state = 'ready';
  S.clouds = [{ x: 420, y: 40 }, { x: 160, y: 66 }];
  requestAnimationFrame(frame);
  help.autoOpen();
})();
