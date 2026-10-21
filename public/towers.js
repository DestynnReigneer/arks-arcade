'use strict';

// Tower Defense: the page. Rules are in towers-engine.js; this draws the
// map, handles tapping squares and towers, and shows what you can do with
// whatever is picked.

(() => {
  const { $, toast } = ArcadeKit;
  const E = TowersEngine;
  const TYPES = Object.keys(E.TOWERS);
  const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

  // Colors and scenery for each kind of map.
  const THEMES = {
    grass: { ground: ['#3f7a3a', '#3b7337'], speck: ['#529a49', '#2f6230'], road: '#c9a46a', edge: '#8a6b3f', pebble: '#a88552', water: '#3a8fd0', T: '🌳', R: '🪨', flowers: ['#ffd23f', '#ff8fc2', '#ffffff'] },
    snow: { ground: ['#e3ecf4', '#dbe6ef'], speck: ['#ffffff', '#c3d2e0'], road: '#a7b6c6', edge: '#7c8ea2', pebble: '#8fa0b3', water: '#9fd6f2', T: '🌲', R: '🪨', ice: true },
    desert: { ground: ['#d6b072', '#cfa968'], speck: ['#e4c48a', '#b8925a'], road: '#b5864f', edge: '#8a5f34', pebble: '#9a7044', water: '#3aa0c8', T: '🌵', R: '🪨' },
    swamp: { ground: ['#4b5d34', '#465730'], speck: ['#5f7642', '#36452a'], road: '#7a6544', edge: '#4c3c27', pebble: '#665336', water: '#3a5a45', T: '🌳', R: '🪨', lilies: true },
    stone: { ground: ['#56713f', '#506a3b'], speck: ['#668549', '#425a33'], road: '#a19d93', edge: '#6b675f', pebble: '#86827a', water: '#2f6fa8', T: '🌲', R: '🪨', cobbles: true },
    lava: { ground: ['#3b302e', '#362b29'], speck: ['#4b3c38', '#2a201f'], road: '#6e5c52', edge: '#231a18', pebble: '#57473f', water: '#ff6a1f', T: '🔥', R: '🪨', lava: true }
  };

  let mapId = E.MAPS[recall('towers.map', '')] ? recall('towers.map', '') : 'meadow';
  let g = null;
  let state = 'ready';        // ready (no wave yet) | playing | over
  let paused = false;
  let speed = 1;
  let picked = null;          // { x, y } square
  let banner = null;          // { text, sub, t }
  let last = performance.now();
  let infoKey = '', btnKey = '', nextKey = '';
  let lastTick = null;        // last countdown second we beeped on
  let particles = [], castleHurt = 0;
  let ground = null, groundKey = '';

  const shell = GameShell.create({ game: 'towers', boards: Object.fromEntries(Object.entries(E.MAPS).map(([id, m]) => [id, m.label])), mount: $('info'), onAgain: () => reset() });
  let view = null;

  function paintOptions() {
    const box = $('mapSeg');
    box.innerHTML = '';
    for (const [id, m] of Object.entries(E.MAPS)) {
      const b = document.createElement('button');
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = m.label;
      b.lastChild.textContent = m.level;
      b.lastChild.className = `lvl-${m.level.toLowerCase()}`;
      b.title = m.blurb;
      b.setAttribute('aria-pressed', String(id === mapId));
      b.onclick = () => { mapId = id; store('towers.map', id); reset(); };
      box.appendChild(b);
    }
  }

  function reset() {
    g = E.create({ map: mapId });
    if (!view) view = GameShell.fitCanvas($('canvas'), { aspect: g.map.cols / g.map.rows, maxHeight: () => Math.max(320, window.innerHeight * 0.6) });
    state = 'ready';
    paused = false;
    $('pauseBtn').textContent = '⏸';
    message(null);
    picked = null;
    particles = [];
    lastTick = null;
    const m = E.MAPS[mapId];
    banner = { text: m.label, sub: g.map.paths.length > 1 ? 'Two roads! Build, then the waves come.' : 'Build a tower and the waves will come.', t: 3 };
    shell.hideOver();
    document.body.dataset.state = 'ready';
    paintOptions();
    $('options').classList.remove('hidden');
    btnKey = nextKey = '';
    hud();
    renderInfo(true);
  }

  // The wave button: call the next wave now, with its clock and bonus.
  function hud() {
    $('gold').textContent = g.gold;
    $('lives').textContent = g.lives;
    $('wave').textContent = `${g.wave}/${E.WAVES}`;
    $('score').textContent = g.score.toLocaleString('en-US');
    const cd = g.countdown;
    let title, sub = '', frac = 0, disabled = false;
    if (state === 'over') { title = g.phase === 'won' ? 'Victory!' : 'Game over'; disabled = true; }
    else if (g.wave >= E.WAVES) { title = 'Last wave!'; sub = 'Hold them off!'; disabled = true; }
    else if (!E.canCall(g)) { title = `Wave ${g.wave} is coming…`; sub = `${g.spawnQueue.length} more on the way`; disabled = true; }
    else if (g.wave === 0 && cd == null) { title = '▶ Start wave 1'; sub = `Or build a tower: wave 1 comes ${E.FIRST_BREAK}s later`; }
    else {
      const bonus = E.earlyBonus(g);
      title = `▶ Call wave ${g.wave + 1} now`;
      if (cd != null) {
        sub = `Comes by itself in ${Math.ceil(cd)}s${bonus ? ` · +${bonus} 🪙 bonus` : ''}`;
        frac = cd / (g.wave === 0 ? E.FIRST_BREAK : E.BREAK);
      } else sub = `+${bonus} 🪙 for calling it early`;
    }
    const key = [title, sub, disabled].join('|');
    if (key !== btnKey) {
      btnKey = key;
      const b = $('waveBtn');
      b.disabled = disabled;
      b.querySelector('b').textContent = title;
      b.querySelector('small').textContent = sub;
    }
    $('waveBtn').querySelector('.timer').style.width = `${Math.round(frac * 100)}%`;

    // What's in the next wave.
    const n = g.wave + 1;
    const nk = state === 'over' || n > E.WAVES ? '' : String(n);
    if (nk !== nextKey) {
      nextKey = nk;
      const box = $('nextUp');
      box.innerHTML = '';
      if (nk) {
        const counts = {};
        for (const t of E.waveList(n)) counts[t] = (counts[t] || 0) + 1;
        box.append(`Wave ${n}:`);
        for (const [t, k] of Object.entries(counts)) {
          const s = document.createElement('span');
          s.textContent = `${E.ENEMIES[t].emoji} ${E.ENEMIES[t].label}${k > 1 ? ` ×${k}` : ''}`;
          box.appendChild(s);
        }
      }
    }
  }

  function callWave() {
    if (paused) pause(false);
    if (state === 'over') return;
    if (!E.startWave(g)) return;
    Blip.unlock();
    react();
  }

  // The first wave starting turns "ready" into "playing".
  function waveStarted() {
    if (state === 'ready') {
      state = 'playing';
      $('options').classList.add('hidden');
      document.body.dataset.state = 'playing';
      if (window.ArcadeStats) ArcadeStats.play();
    }
    const list = E.waveList(g.wave);
    const boss = list.includes('ogre');
    banner = { text: `Wave ${g.wave}`, sub: boss ? '👹 Boss wave!' : `${list.length} monsters coming`, t: 1.8 };
    Blip.tune(boss ? [[220, 0.15], [196, 0.15], [165, 0.3]] : [[440, 0.08], [660, 0.12]], { type: 'square', volume: 0.05 });
  }

  function pause(on = !paused) {
    if (state === 'over') return;
    paused = on;
    if (on) message('Paused', 'Tap or press P to keep going.');
    else { last = performance.now(); message(null); }
    $('pauseBtn').textContent = paused ? '▶' : '⏸';
  }
  function message(title, text) {
    $('stageMsg').classList.toggle('hidden', !title);
    if (title) { $('stageMsg').firstElementChild.textContent = title; $('stageMsg').lastElementChild.textContent = text || ''; }
  }

  // ---- the info panel under the map ------------------------------------------------------------
  function renderInfo(force) {
    const tower = picked && E.towerAt(g, picked.x, picked.y);
    const key = JSON.stringify([picked, tower && tower.level, g.gold, state]);
    if (!force && key === infoKey) return;
    infoKey = key;
    const box = $('info');
    box.innerHTML = '';
    if (state === 'over') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (tower) {
      const def = E.TOWERS[tower.type], s = E.stats(tower), up = E.upgradeCost(tower);
      const head = document.createElement('div');
      head.className = 'tower-head';
      head.innerHTML = '<span class="em"></span><div><b></b><small></small></div>';
      head.querySelector('.em').textContent = def.emoji;
      head.querySelector('b').textContent = `${def.label} · level ${tower.level + 1} of ${def.levels.length}`;
      head.querySelector('small').textContent = `${def.blurb} ${tower.kills} defeated.`;
      const st = document.createElement('div');
      st.className = 'tower-stats';
      const bits = [`Damage ${s.damage}`, `Range ${s.range}`, `${s.rate}/sec`];
      if (s.splash) bits.push(`Blast ${s.splash}`);
      if (s.slow) bits.push(`Slows ${Math.round(s.slow * 100)}%`);
      if (s.chain) bits.push(`Jumps ×${s.chain}`);
      st.textContent = bits.join(' · ');
      const actions = document.createElement('div');
      actions.className = 'tower-actions';
      const upBtn = document.createElement('button');
      upBtn.textContent = up == null ? 'Fully upgraded' : `⬆ Upgrade (${up})`;
      upBtn.disabled = up == null || g.gold < up;
      upBtn.onclick = () => doUpgrade();
      const sellBtn = document.createElement('button');
      sellBtn.textContent = `💰 Sell (+${E.sellValue(tower)})`;
      sellBtn.onclick = () => doSell();
      actions.append(upBtn, sellBtn);
      box.append(head, st, actions);
      return;
    }
    if (picked && E.canBuild(g, picked.x, picked.y)) {
      const grid = document.createElement('div');
      grid.className = 'build-grid';
      TYPES.forEach((type, i) => {
        const def = E.TOWERS[type];
        const cost = def.levels[0].cost;
        const b = document.createElement('button');
        b.innerHTML = '<span class="em"></span><span><b></b><small></small></span><span class="cost"></span>';
        b.querySelector('.em').textContent = def.emoji;
        b.querySelector('b').textContent = `${def.label}`;
        b.querySelector('small').textContent = def.blurb;
        b.querySelector('.cost').textContent = `${cost} 🪙`;
        b.disabled = g.gold < cost;
        b.title = `Build ${def.label} (${i + 1})`;
        b.onclick = () => doBuild(type);
        grid.appendChild(b);
      });
      box.appendChild(grid);
      return;
    }
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = state === 'ready'
      ? 'Tap an empty square to build a tower. Once you build, wave 1 comes in 30 seconds, and after each wave you get a short break to build more.'
      : 'Tap an empty square to build a tower. Tap a tower to upgrade or sell it. Monsters walk the road to your castle: don\'t let them in!';
    box.appendChild(p);
  }

  function attempt(fn) {
    try { fn(); react(); renderInfo(true); hud(); }
    catch (e) { toast(e.message); Blip.tone(140, 0.08, { type: 'square', volume: 0.04 }); }
  }
  function doBuild(type) { if (picked) attempt(() => { Blip.unlock(); E.build(g, type, picked.x, picked.y); }); }
  function doUpgrade() { const t = picked && E.towerAt(g, picked.x, picked.y); if (t) attempt(() => E.upgrade(g, t.id)); }
  function doSell() {
    const t = picked && E.towerAt(g, picked.x, picked.y);
    if (t) attempt(() => { E.sell(g, t.id); });
  }

  // ---- loop -------------------------------------------------------------------------------------------
  function react() {
    for (const ev of g.events) {
      if (ev === 'build' || ev === 'upgrade') Blip.tune([[523, 0.05], [784, 0.08]], { type: 'square', volume: 0.04 });
      else if (ev === 'sell') Blip.tone([660, 330], 0.1, { type: 'triangle', volume: 0.04 });
      else if (ev === 'wave') waveStarted();
      else if (ev === 'arrow') Blip.tone(900, 0.015, { type: 'triangle', volume: 0.012 });
      else if (ev === 'boom') Blip.noise(0.08, 0.05);
      else if (ev === 'zap') Blip.tone([1400, 500], 0.06, { type: 'sawtooth', volume: 0.02 });
      else if (ev === 'kill') Blip.tone(1100, 0.025, { type: 'square', volume: 0.015 });
      else if (ev === 'boss-down') { Blip.tune([[392, 0.1], [523, 0.1], [659, 0.2]], { type: 'square', volume: 0.06 }); banner = { text: 'Ogre down! 👹', sub: '+80 gold', t: 1.5 }; }
      else if (ev === 'leak') { castleHurt = 0.5; Blip.tone([300, 150], 0.18, { type: 'sawtooth', volume: 0.05 }); }
      else if (ev.startsWith('wave-clear:')) {
        if (g.phase !== 'won') banner = { text: `Wave ${g.wave} cleared!`, sub: `+${ev.split(':')[1]} gold · next wave in ${E.BREAK}s`, t: 1.8 };
        Blip.tune([[659, 0.08], [880, 0.12]], { type: 'triangle', volume: 0.05 });
      } else if (ev.startsWith('early:')) toast(`Brave! +${ev.split(':')[1]} gold`);
      else if (ev === 'lost' || ev === 'won') end(ev === 'won');
    }
  }

  function end(won) {
    state = 'over';
    picked = null;
    renderInfo(true);
    hud();
    if (won) Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]], { type: 'square', volume: 0.06 });
    else { Blip.noise(0.4, 0.12); Blip.tone([260, 60], 0.6, { type: 'sawtooth', volume: 0.07 }); }
    const m = E.MAPS[mapId].label;
    setTimeout(() => shell.over({
      score: g.score, board: mapId,
      title: won ? 'Victory! The castle is safe! 🏰' : undefined,
      detail: won ? `All ${E.WAVES} waves on ${m} with ${g.lives} lives left` : `Held out to wave ${g.wave} on ${m} · ${g.kills} monsters defeated`
    }), 700);
  }

  function frame(now) {
    Blip.musicPlaying(state !== 'over' && !paused && !help.isOpen);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state !== 'over' && !paused && !help.isOpen) {
      let left = dt * speed;
      while (left > 0) { const h = Math.min(left, 1 / 30); E.step(g, h); react(); left -= h; if (state === 'over') break; }
      // A beep for the last three seconds before a wave.
      const sec = g.countdown != null ? Math.ceil(g.countdown) : null;
      if (sec !== lastTick) { if (sec != null && sec <= 3 && sec > 0) Blip.tone(sec === 1 ? 880 : 660, 0.05, { type: 'triangle', volume: 0.04 }); lastTick = sec; }
      hud();
    }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 3 * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    castleHurt = Math.max(0, castleHurt - dt);
    renderInfo(false);
    draw(now / 1000, dt);
    requestAnimationFrame(frame);
  }

  // ---- drawing --------------------------------------------------------------------------------------------
  function emoji(ctx, ch, x, y, size) {
    ctx.fillStyle = '#000';     // emoji take the fill's transparency, so make it solid
    ctx.font = `${Math.round(size)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + size * 0.05);
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
  function ellipse(ctx, x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The same scenery every time a map is drawn.
  function seeded(text) {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  const isWater = (x, y) => E.tileAt(g, x, y) === '~';

  // Everything that doesn't move (ground, water, roads, trees) is drawn once
  // into a picture and copied each frame.
  function paintGround(w, h, c) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const th = THEMES[g.map.theme] || THEMES.grass;
    const rnd = seeded(mapId);
    const P = v => v * c;

    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) {
      ctx.fillStyle = th.ground[(x + y) % 2];
      ctx.fillRect(P(x), P(y), c + 0.5, c + 0.5);
    }
    // grass tufts, sand ripples, snow sparkles...
    for (let i = 0; i < g.map.cols * g.map.rows * 7; i++) {
      const x = rnd() * w, y = rnd() * h;
      ctx.fillStyle = th.speck[i % th.speck.length];
      ctx.globalAlpha = 0.5 + rnd() * 0.4;
      if (g.map.theme === 'grass' || g.map.theme === 'swamp' || g.map.theme === 'stone') ctx.fillRect(x, y, Math.max(1, c * 0.04), Math.max(2, c * 0.1));
      else { ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, c * (0.02 + rnd() * 0.025)), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (th.flowers) for (let i = 0; i < g.map.cols * g.map.rows * 0.5; i++) {
      const x = rnd() * w, y = rnd() * h;
      ctx.fillStyle = th.flowers[i % th.flowers.length];
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, c * 0.045), 0, Math.PI * 2); ctx.fill();
    }

    // water / ice / lava, with a shore where it meets land
    // Each square is rounded off at the corners where it meets land, so
    // ponds and lava pools have soft shores.
    const blob = (x, y, inset, round) => {
      const l = isWater(x - 1, y) ? 0 : inset, r = isWater(x + 1, y) ? 0 : inset, t = isWater(x, y - 1) ? 0 : inset, b = isWater(x, y + 1) ? 0 : inset;
      const x0 = P(x) + l, y0 = P(y) + t, x1 = P(x + 1) - r, y1 = P(y + 1) - b;
      const k = (a, bb) => (a && bb ? round : 0);
      const tl = k(l, t), tr = k(r, t), br = k(r, b), bl = k(l, b);
      ctx.beginPath();
      ctx.moveTo(x0 + tl, y0);
      ctx.lineTo(x1 - tr, y0); if (tr) ctx.arcTo(x1, y0, x1, y0 + tr, tr);
      ctx.lineTo(x1, y1 - br); if (br) ctx.arcTo(x1, y1, x1 - br, y1, br);
      ctx.lineTo(x0 + bl, y1); if (bl) ctx.arcTo(x0, y1, x0, y1 - bl, bl);
      ctx.lineTo(x0, y0 + tl); if (tl) ctx.arcTo(x0, y0, x0 + tl, y0, tl);
      ctx.closePath();
    };
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) {
      if (!isWater(x, y)) continue;
      ctx.fillStyle = th.lava ? '#1c1210' : th.ice ? '#b9cfe0' : 'rgba(0,0,0,0.28)';
      blob(x, y, c * 0.04, c * 0.42);
      ctx.fill();
      if (th.lava) {
        const lg = ctx.createRadialGradient(P(x + 0.5), P(y + 0.5), c * 0.05, P(x + 0.5), P(y + 0.5), c * 0.8);
        lg.addColorStop(0, '#ffd04a'); lg.addColorStop(0.5, '#ff7a1f'); lg.addColorStop(1, '#c2300f');
        ctx.fillStyle = lg;
      } else ctx.fillStyle = th.water;
      blob(x, y, c * 0.13, c * 0.34);
      ctx.fill();
      if (th.lava) {
        ctx.strokeStyle = 'rgba(90,20,10,0.55)';
        ctx.lineWidth = Math.max(1, c * 0.04);
        ctx.beginPath(); ctx.moveTo(P(x) + c * rnd(), P(y) + c * 0.2); ctx.quadraticCurveTo(P(x + 0.5), P(y) + c * rnd(), P(x) + c * rnd(), P(y) + c * 0.8); ctx.stroke();
      }
      if (th.ice) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(P(x) + c * (0.2 + rnd() * 0.6), P(y) + (isWater(x, y - 1) ? 0 : c * 0.15)); ctx.lineTo(P(x) + c * (0.2 + rnd() * 0.6), P(y + 1) - (isWater(x, y + 1) ? 0 : c * 0.15)); ctx.stroke();
      }
      if (th.lilies && rnd() < 0.6) {
        const lx = P(x) + c * (0.3 + rnd() * 0.4), ly = P(y) + c * (0.3 + rnd() * 0.4), lr = c * 0.13;
        ctx.fillStyle = '#5f9a4a';
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, lr, 0.4, Math.PI * 2 - 0.2); ctx.closePath(); ctx.fill();
      }
    }

    // roads: a dark edge, the road itself, then pebbles or cobbles
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const trace = path => { ctx.beginPath(); path.forEach(([x, y], i) => (i ? ctx.lineTo(P(x + 0.5), P(y + 0.5)) : ctx.moveTo(P(x + 0.5), P(y + 0.5)))); };
    for (const path of g.map.paths) { trace(path); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = c * 0.92; ctx.stroke(); }
    for (const path of g.map.paths) { trace(path); ctx.strokeStyle = th.edge; ctx.lineWidth = c * 0.84; ctx.stroke(); }
    for (const path of g.map.paths) { trace(path); ctx.strokeStyle = th.road; ctx.lineWidth = c * 0.68; ctx.stroke(); }
    for (const key of g.map.pathSet) {
      const [x, y] = key.split(',').map(Number);
      for (let i = 0; i < (th.cobbles ? 5 : 3); i++) {
        const px = P(x + 0.22 + rnd() * 0.56), py = P(y + 0.22 + rnd() * 0.56);
        ctx.fillStyle = th.pebble;
        if (th.cobbles) { rounded(ctx, px - c * 0.08, py - c * 0.06, c * 0.16, c * 0.12, c * 0.04); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(px, py, Math.max(1, c * 0.035), 0, Math.PI * 2); ctx.fill(); }
      }
    }

    // trees and rocks
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) {
      const tile = E.tileAt(g, x, y);
      if (tile !== 'T' && tile !== 'R') continue;
      const cx = P(x + 0.5), cy = P(y + 0.5);
      ellipse(ctx, cx, cy + c * 0.3, c * 0.32, c * 0.1, 'rgba(0,0,0,0.25)');
      emoji(ctx, tile === 'T' ? th.T : th.R, cx, cy, c * (tile === 'T' ? 0.82 : 0.6));
    }
    // a faint outline on squares you can build on
    ctx.strokeStyle = th.ice ? 'rgba(40,70,100,0.08)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) if (E.tileAt(g, x, y) === '.') ctx.strokeRect(P(x) + 1.5, P(y) + 1.5, c - 3, c - 3);
    return cv;
  }

  function drawTower(ctx, tw, x, y, c, t) {
    const def = E.TOWERS[tw.type];
    const lv = tw.level;
    ellipse(ctx, x, y + c * 0.33, c * 0.4, c * 0.12, 'rgba(0,0,0,0.3)');
    // stone base, trimmed silver and then gold as it levels up
    const bw = c * 0.8, by = y - bw / 2 + c * 0.05;
    const base = ctx.createLinearGradient(0, by, 0, by + bw);
    base.addColorStop(0, '#9aa0ad'); base.addColorStop(1, '#5a5f6d');
    ctx.fillStyle = base;
    rounded(ctx, x - bw / 2, by, bw, bw * 0.9, c * 0.18);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, c * 0.06);
    ctx.strokeStyle = lv === 2 ? '#ffc72c' : lv === 1 ? '#e4e8ef' : '#3d404b';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rounded(ctx, x - bw / 2 + 2, by + 2, bw - 4, bw * 0.22, c * 0.1);
    ctx.fill();
    const recoil = Math.max(0, tw.cooldown * E.stats(tw).rate - 0.8) * 5 * c * 0.06;

    if (tw.type === 'archer') {
      ctx.fillStyle = '#8b5a2b';
      ctx.beginPath(); ctx.arc(x, y, c * 0.27, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5e3b1a'; ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x - c * 0.25, y + i * c * 0.09); ctx.lineTo(x + c * 0.25, y + i * c * 0.09); ctx.stroke(); }
      ctx.save();
      ctx.translate(x, y); ctx.rotate(tw.aim);
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = Math.max(2, c * 0.07);
      ctx.beginPath(); ctx.arc(-c * 0.02, 0, c * 0.2, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#f4ecd0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c * 0.05, -c * 0.19); ctx.lineTo(-c * 0.08 - recoil, 0); ctx.lineTo(c * 0.05, c * 0.19); ctx.stroke();
      ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = Math.max(1.5, c * 0.04);
      ctx.beginPath(); ctx.moveTo(-c * 0.08 - recoil, 0); ctx.lineTo(c * 0.28, 0); ctx.stroke();
      ctx.restore();
    } else if (tw.type === 'cannon') {
      ctx.fillStyle = '#3a3d48';
      ctx.beginPath(); ctx.arc(x, y, c * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(x, y); ctx.rotate(tw.aim);
      const bwid = c * (0.17 + lv * 0.025);
      const barrel = ctx.createLinearGradient(0, -bwid / 2, 0, bwid / 2);
      barrel.addColorStop(0, '#5b5f6e'); barrel.addColorStop(0.5, '#2a2c34'); barrel.addColorStop(1, '#16171c');
      ctx.fillStyle = barrel;
      rounded(ctx, -c * 0.05 - recoil, -bwid / 2, c * 0.44, bwid, bwid * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ff9f2c';
      ctx.fillRect(c * 0.34 - recoil, -bwid / 2, c * 0.05, bwid);
      ctx.restore();
      ctx.fillStyle = '#4d5160';
      ctx.beginPath(); ctx.arc(x, y, c * 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (tw.type === 'frost') {
      const pulse = 1 + Math.sin(t * 3 + tw.id) * 0.06;
      ctx.save();
      ctx.shadowColor = '#2de2e6'; ctx.shadowBlur = c * 0.35;
      const s = c * 0.3 * pulse;
      const crystal = ctx.createLinearGradient(x, y - s, x, y + s);
      crystal.addColorStop(0, '#ffffff'); crystal.addColorStop(1, '#2de2e6');
      ctx.fillStyle = crystal;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.15); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x, y + s * 0.9); ctx.lineTo(x - s * 0.6, y); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.15); ctx.lineTo(x, y + s * 0.9); ctx.stroke();
    } else if (tw.type === 'tesla') {
      ctx.strokeStyle = '#c47a3a'; ctx.lineWidth = Math.max(1.5, c * 0.05);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(x, y + c * 0.14 - i * c * 0.1, c * 0.2 - i * c * 0.03, c * 0.06, 0, 0, Math.PI * 2); ctx.stroke(); }
      const flicker = 0.75 + Math.random() * 0.25;
      ctx.save();
      ctx.shadowColor = '#c86bff'; ctx.shadowBlur = c * 0.4 * flicker;
      const orb = ctx.createRadialGradient(x - c * 0.04, y - c * 0.2, 1, x, y - c * 0.16, c * 0.16);
      orb.addColorStop(0, '#ffffff'); orb.addColorStop(1, '#a24dff');
      ctx.fillStyle = orb;
      ctx.beginPath(); ctx.arc(x, y - c * 0.16, c * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (Math.random() < 0.15) {
        ctx.strokeStyle = 'rgba(230,200,255,0.9)'; ctx.lineWidth = 1;
        const a = Math.random() * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(x, y - c * 0.16); ctx.lineTo(x + Math.cos(a) * c * 0.3, y - c * 0.16 + Math.sin(a) * c * 0.3); ctx.stroke();
      }
    }
    // level stars
    for (let i = 0; i <= lv; i++) {
      ctx.fillStyle = '#ffc72c';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x - c * 0.14 + i * c * 0.14, y + c * 0.37, Math.max(2, c * 0.055), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    void def;
  }

  function draw(t, dt) {
    const { ctx, size } = view;
    const c = size.w / g.map.cols;
    const P = v => v * c;
    const th = THEMES[g.map.theme] || THEMES.grass;
    const key = `${mapId}|${size.w}|${size.h}|${window.devicePixelRatio || 1}`;
    if (key !== groundKey) { ground = paintGround(size.w, size.h, c); groundKey = key; }
    ctx.save();
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(ground, 0, 0, size.w, size.h);

    // moving water, glowing lava
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) {
      if (!isWater(x, y)) continue;
      if (th.lava) {
        ctx.fillStyle = `rgba(255,210,80,${0.15 + 0.15 * Math.sin(t * 2 + x * 1.3 + y)})`;
        ctx.beginPath(); ctx.arc(P(x + 0.5), P(y + 0.5), c * 0.32, 0, Math.PI * 2); ctx.fill();
        if (Math.sin(t * 1.7 + x * 3 + y * 5) > 0.97) particles.push({ x: x + 0.3 + Math.random() * 0.4, y: y + 0.5, vx: 0, vy: -0.6, life: 0.6, color: '#ffb13b', size: 0.05 });
      } else if (!th.ice) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        const wy = P(y) + c * (0.35 + 0.25 * ((t * 0.3 + x * 0.17) % 1));
        ctx.beginPath(); ctx.moveTo(P(x) + c * 0.25, wy); ctx.quadraticCurveTo(P(x) + c * 0.5, wy - c * 0.06, P(x) + c * 0.75, wy); ctx.stroke();
      }
    }

    // portals and the castle
    for (const path of g.map.paths) {
      const [sx, sy] = path[0];
      const cx = P(sx + 0.5), cy = P(sy + 0.5);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(200,107,255,${0.8 - i * 0.22})`;
        ctx.lineWidth = Math.max(1.5, c * 0.06);
        ctx.beginPath(); ctx.arc(cx, cy, c * (0.36 - i * 0.1), t * (2 + i) + i, t * (2 + i) + i + Math.PI * 1.3); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,10,60,0.6)';
      ctx.beginPath(); ctx.arc(cx, cy, c * 0.12, 0, Math.PI * 2); ctx.fill();
    }
    const [ex, ey] = g.map.path[g.map.path.length - 1];
    ellipse(ctx, P(ex + 0.5), P(ey + 0.85), c * 0.45, c * 0.12, 'rgba(0,0,0,0.3)');
    const wob = castleHurt ? Math.sin(t * 60) * c * 0.04 : 0;
    emoji(ctx, '🏰', P(ex + 0.5) + wob, P(ey + 0.45), c * 1.05);
    if (castleHurt) { ctx.fillStyle = `rgba(255,60,60,${castleHurt * 0.6})`; ctx.beginPath(); ctx.arc(P(ex + 0.5), P(ey + 0.5), c * 0.6, 0, Math.PI * 2); ctx.fill(); }

    // the picked square / tower range
    if (picked) {
      const tower = E.towerAt(g, picked.x, picked.y);
      ctx.strokeStyle = '#ffc72c';
      ctx.lineWidth = 2;
      rounded(ctx, P(picked.x) + 1.5, P(picked.y) + 1.5, c - 3, c - 3, c * 0.15);
      ctx.stroke();
      if (tower) {
        ctx.fillStyle = 'rgba(255,199,44,0.12)';
        ctx.strokeStyle = 'rgba(255,199,44,0.7)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(P(tower.x + 0.5), P(tower.y + 0.5), P(E.stats(tower).range), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // monsters, back to front
    const enemies = g.enemies.slice().sort((a, b) => a.y - b.y);
    for (const e of enemies) {
      const def = E.ENEMIES[e.type];
      const r = P(def.size);
      const hop = def.flying ? Math.sin(t * 8 + e.id) * c * 0.08 - c * 0.15 : -Math.abs(Math.sin(t * 9 * def.speed + e.id)) * c * 0.06;
      const x = P(e.x), y = P(e.y) + hop;
      ellipse(ctx, x, P(e.y) + r * 0.85, r * (def.flying ? 0.55 : 0.8), r * 0.22, 'rgba(0,0,0,0.3)');
      if (def.boss) { ctx.save(); ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = c * 0.4; }
      ctx.save();
      ctx.translate(x, y);
      if (e.face > 0) ctx.scale(-1, 1);   // most emoji face left
      emoji(ctx, def.emoji, 0, 0, r * 2.1);
      ctx.restore();
      if (def.boss) ctx.restore();
      if (e.hurt > 0) { ctx.fillStyle = `rgba(255,255,255,${e.hurt * 3})`; ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.fill(); }
      if (e.slow > 0) {
        ctx.strokeStyle = 'rgba(160,240,255,0.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.stroke();
      }
      if (e.hp < e.maxHp) {
        const w = Math.max(r * 2, c * 0.6), frac = Math.max(0, e.hp / e.maxHp), bh = Math.max(3, c * 0.09);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        rounded(ctx, x - w / 2 - 1, y - r - bh - 5, w + 2, bh + 2, bh / 2); ctx.fill();
        ctx.fillStyle = frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffc72c' : '#ff5e5e';
        rounded(ctx, x - w / 2, y - r - bh - 4, Math.max(bh, w * frac), bh, bh / 2); ctx.fill();
      }
    }

    // towers draw over the monsters behind them
    for (const tw of g.towers) drawTower(ctx, tw, P(tw.x + 0.5), P(tw.y + 0.5), c, t);

    // shots
    for (const s of g.shots) {
      if (s.kind === 'arrow') {
        const target = g.enemies.find(e => e.id === s.target);
        const a = target ? Math.atan2(target.y - s.y, target.x - s.x) : 0;
        ctx.save();
        ctx.translate(P(s.x), P(s.y)); ctx.rotate(a);
        ctx.strokeStyle = '#f4ecd0'; ctx.lineWidth = Math.max(1.5, c * 0.045);
        ctx.beginPath(); ctx.moveTo(-c * 0.24, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = '#d9d2bd';
        ctx.beginPath(); ctx.moveTo(c * 0.06, 0); ctx.lineTo(-c * 0.03, -c * 0.04); ctx.lineTo(-c * 0.03, c * 0.04); ctx.fill();
        ctx.fillStyle = '#3ddc84';
        ctx.fillRect(-c * 0.26, -c * 0.035, c * 0.06, c * 0.07);
        ctx.restore();
      } else {
        // cannonballs fly in an arc
        const done = Math.hypot(s.x - s.from.x, s.y - s.from.y), left = Math.hypot(s.tx - s.x, s.ty - s.y);
        const k = done / Math.max(0.01, done + left);
        const lift = Math.sin(Math.PI * k) * c * 0.5;
        ellipse(ctx, P(s.x), P(s.y), c * 0.08, c * 0.04, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = '#1b1a24';
        ctx.beginPath(); ctx.arc(P(s.x), P(s.y) - lift, c * 0.11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(P(s.x) - c * 0.035, P(s.y) - lift - c * 0.035, c * 0.03, 0, Math.PI * 2); ctx.fill();
      }
    }

    // effects
    for (const f of g.fx) {
      if (f.kind === 'frost') {
        const k = 1 - f.t / 0.5;
        ctx.strokeStyle = `rgba(160,240,255,${0.7 * (1 - k)})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(P(f.x), P(f.y), P(f.r * (0.3 + k * 0.7)), 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'boom') {
        const k = 1 - f.t / 0.35;
        const grad = ctx.createRadialGradient(P(f.x), P(f.y), 0, P(f.x), P(f.y), P(f.r * (0.4 + k * 0.6)));
        grad.addColorStop(0, `rgba(255,240,180,${0.9 * (1 - k)})`);
        grad.addColorStop(0.5, `rgba(255,140,40,${0.7 * (1 - k)})`);
        grad.addColorStop(1, 'rgba(120,60,30,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(P(f.x), P(f.y), P(f.r * (0.4 + k * 0.6)), 0, Math.PI * 2); ctx.fill();
      } else if (f.kind === 'zap') {
        ctx.save();
        ctx.shadowColor = '#c86bff'; ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(240,220,255,${Math.min(1, f.t / 0.1)})`;
        ctx.lineWidth = Math.max(1.5, c * 0.05);
        ctx.beginPath();
        f.points.forEach((p, i) => {
          if (!i) { ctx.moveTo(P(p.x), P(p.y - 0.16)); return; }
          const q = f.points[i - 1];
          for (let j = 1; j <= 3; j++) {
            const k = j / 3;
            const jx = j < 3 ? (Math.random() - 0.5) * c * 0.3 : 0, jy = j < 3 ? (Math.random() - 0.5) * c * 0.3 : 0;
            ctx.lineTo(P(q.x + (p.x - q.x) * k) + jx, P(q.y + (p.y - q.y) * k) + jy);
          }
        });
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'pop') {
        if (!f.seen) {
          f.seen = true;
          for (let i = 0; i < 9; i++) {
            const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.2;
            particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life: 0.45, color: i % 2 ? '#ffffff' : '#ffd23f', size: 0.05 });
          }
        }
        ctx.globalAlpha = Math.min(1, f.t / 0.3);
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.font = `800 ${Math.round(c * 0.32)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const py = P(f.y) - (0.5 - f.t) * c * 1.2 - c * 0.3;
        ctx.strokeText(`+${f.reward}`, P(f.x), py);
        ctx.fillText(`+${f.reward}`, P(f.x), py);
        ctx.globalAlpha = 1;
      }
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(P(p.x), P(p.y), Math.max(1.2, P(p.size)), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // the break's clock, top-left
    if (g.countdown != null && state !== 'over') {
      const total = g.wave === 0 ? E.FIRST_BREAK : E.BREAK;
      const cx = c * 0.55, cy = c * 0.55, rr = c * 0.36;
      ctx.fillStyle = 'rgba(8,8,15,0.7)';
      ctx.beginPath(); ctx.arc(cx, cy, rr + 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = g.countdown <= 3 ? '#ff5e5e' : '#ffc72c';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + (g.countdown / total) * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(c * 0.34)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.ceil(g.countdown)), cx, cy + 1);
    }

    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      const bw = Math.min(size.w - 20, c * 8), bh = c * 1.6, bx = (size.w - bw) / 2, by = size.h * 0.4 - bh / 2;
      ctx.fillStyle = 'rgba(8,8,15,0.75)';
      rounded(ctx, bx, by, bw, bh, c * 0.4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,199,44,0.6)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffc72c';
      ctx.font = `800 ${Math.round(c * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(banner.text, size.w / 2, by + bh * 0.36);
      ctx.fillStyle = '#f4ecd0';
      ctx.font = `600 ${Math.round(c * 0.32)}px system-ui, sans-serif`;
      ctx.fillText(banner.sub, size.w / 2, by + bh * 0.74);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    void dt;
  }

  // ---- input ----------------------------------------------------------------------------------------
  $('stage').addEventListener('pointerdown', e => {
    if (paused) { pause(false); return; }
    if (state === 'over') return;
    const r = $('canvas').getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * g.map.cols);
    const y = Math.floor(((e.clientY - r.top) / r.height) * g.map.rows);
    if (x < 0 || y < 0 || x >= g.map.cols || y >= g.map.rows) return;
    const tile = E.tileAt(g, x, y);
    if (E.towerAt(g, x, y) || tile === '.') {
      picked = picked && picked.x === x && picked.y === y ? null : { x, y };
      Blip.tone(500, 0.02, { type: 'square', volume: 0.02 });
    } else {
      picked = null;
      const why = { T: 'Trees here.', R: 'A big rock here.', '~': g.map.theme === 'lava' ? 'That\'s lava!' : g.map.theme === 'snow' ? 'That\'s thin ice!' : 'That\'s water!' }[tile];
      toast(why ? `${why} Pick an empty square.` : 'That\'s the road! Build next to it.', 1500);
    }
    renderInfo(true);
  });
  $('waveBtn').addEventListener('click', callWave);
  const SPEEDS = [1, 2, 3];
  function setSpeed(s) {
    speed = Math.max(SPEEDS[0], Math.min(SPEEDS[SPEEDS.length - 1], s));
    $('speedVal').textContent = `${speed}×`;
    $('slowerBtn').disabled = speed === SPEEDS[0];
    $('fasterBtn').disabled = speed === SPEEDS[SPEEDS.length - 1];
  }
  $('slowerBtn').addEventListener('click', () => setSpeed(speed - 1));
  $('fasterBtn').addEventListener('click', () => setSpeed(speed + 1));
  setSpeed(1);
  window.addEventListener('keydown', e => {
    if (help.isOpen) return;
    const k = e.key;
    if (k >= '1' && k <= '4') { doBuild(TYPES[Number(k) - 1]); return; }
    if (k === 'u' || k === 'U') doUpgrade();
    else if (k === 's' || k === 'S') doSell();
    else if (k === ' ') { e.preventDefault(); callWave(); }
    else if (k === '+' || k === '=' || k === 'f' || k === 'F') setSpeed(speed + 1);
    else if (k === '-' || k === '_') setSpeed(speed - 1);
    else if (k === 'p' || k === 'P') pause();
    else if (k === 'Escape') { picked = null; renderInfo(true); }
  });
  $('pauseBtn').addEventListener('click', () => pause());
  $('scoresBtn').addEventListener('click', () => shell.openScores(mapId));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state !== 'over') pause(true); });
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('towers');

  const help = Tutorial.create('towers', [
    {
      emoji: '🏰', title: 'Guard the castle',
      html: `<p>Monsters come out of the 🌀 portal and walk the road to your 🏰 castle. Every one that gets in costs a life (an ogre costs 5).</p>
        <p>Build towers next to the road to stop them. Survive all ${E.WAVES} waves to win! Some maps have <b>two roads</b>.</p>`
    },
    {
      emoji: '🏹', title: 'Towers',
      html: `<table>
          <tr><td>🏹 Archer</td><td>Cheap and quick. Hits flyers.</td></tr>
          <tr><td>💣 Cannon</td><td>Blasts a whole group, but can't hit 🦇 bats.</td></tr>
          <tr><td>❄️ Frost</td><td>Slows everything nearby. Great next to a bend.</td></tr>
          <tr><td>⚡ Tesla</td><td>Lightning that jumps from monster to monster.</td></tr>
        </table>
        <p>Tap an empty square, then pick a tower. Tap a tower to <b>upgrade</b> it (twice) or <b>sell</b> it.</p>`
    },
    {
      emoji: '⏱️', title: 'Waves come on their own',
      html: `<p>Wave 1 comes ${E.FIRST_BREAK} seconds after your first tower. After each wave you get a ${E.BREAK}-second break to build, then the next one starts by itself.</p>
        <p>Ready sooner? <b>Call the next wave now</b> for bonus gold: the earlier, the more. <b>+</b> speeds things up, and you can see what's coming next under the button.</p>
        <div class="tut-tip">Watch out for <b>🛡️ knights</b> (tough armor: big hits work best) and the <b>👹 ogre</b> every 5th wave.</div>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  reset();
  requestAnimationFrame(frame);
  help.autoOpen();
})();
