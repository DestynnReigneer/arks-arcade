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

  let mapId = E.MAPS[recall('towers.map', '')] ? recall('towers.map', '') : 'meadow';
  let g = null;
  let state = 'ready';        // ready (not started) | playing | paused | over
  let speed = 1;
  let picked = null;          // { x, y } square
  let banner = null;          // { text, sub, t }
  let last = performance.now();
  let infoKey = '';

  const shell = GameShell.create({ game: 'towers', boards: Object.fromEntries(Object.entries(E.MAPS).map(([id, m]) => [id, m.label])), mount: $('info'), onAgain: () => reset() });
  let view = null;

  function paintOptions() {
    const box = $('mapSeg');
    box.innerHTML = '';
    for (const [id, m] of Object.entries(E.MAPS)) {
      const b = document.createElement('button');
      b.textContent = m.label;
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
    picked = null;
    banner = { text: E.MAPS[mapId].label, sub: 'Build some towers, then start the first wave.', t: 3 };
    shell.hideOver();
    document.body.dataset.state = 'ready';
    paintOptions();
    $('options').classList.remove('hidden');
    hud();
    renderInfo(true);
  }

  function hud() {
    $('gold').textContent = g.gold;
    $('lives').textContent = g.lives;
    $('wave').textContent = `${g.wave}/${E.WAVES}`;
    $('score').textContent = g.score.toLocaleString('en-US');
    const canCall = !g.spawnQueue.length && g.wave < E.WAVES && g.phase !== 'won' && g.phase !== 'lost';
    $('waveBtn').disabled = !canCall;
    const early = g.enemies.length > 0;
    $('waveBtn').textContent = g.wave >= E.WAVES ? 'Last wave!' : `▶ ${early ? 'Send' : 'Start'} wave ${g.wave + 1}${early ? ` (+${10 + g.wave} gold)` : ''}`;
  }

  function startWave() {
    if (state === 'paused') pause(false);
    if (state === 'over') return;
    if (!E.startWave(g)) return;
    if (state === 'ready') {
      state = 'playing';
      $('options').classList.add('hidden');
      document.body.dataset.state = 'playing';
      if (window.ArcadeStats) ArcadeStats.play();
    }
    Blip.unlock();
    react();
    const list = E.waveList(g.wave);
    const boss = list.includes('ogre');
    banner = { text: `Wave ${g.wave}`, sub: boss ? '👹 Boss wave!' : `${list.length} monsters coming`, t: 1.8 };
    Blip.tune(boss ? [[220, 0.15], [196, 0.15], [165, 0.3]] : [[440, 0.08], [660, 0.12]], { type: 'square', volume: 0.05 });
  }

  function pause(on = state === 'playing') {
    if (on && state === 'playing') { state = 'paused'; message('Paused', 'Tap or press P to keep going.'); }
    else if (!on && state === 'paused') { state = 'playing'; last = performance.now(); message(null); }
    $('pauseBtn').textContent = state === 'paused' ? '▶' : '⏸';
  }
  function message(title, text) {
    $('stageMsg').classList.toggle('hidden', !title);
    if (title) { $('stageMsg').firstElementChild.textContent = title; $('stageMsg').lastElementChild.textContent = text || ''; }
  }

  // ---- the info panel under the map ------------------------------------------------------------
  function renderInfo(force) {
    const tower = picked && E.towerAt(g, picked.x, picked.y);
    const key = JSON.stringify([picked, tower && tower.level, g.gold, state, g.phase]);
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
    p.textContent = 'Tap a grass square to build a tower. Tap a tower to upgrade or sell it. Monsters walk the dirt road to your castle: don\'t let them in!';
    box.appendChild(p);
  }

  function attempt(fn) {
    try { fn(); react(); renderInfo(true); hud(); }
    catch (e) { toast(e.message); Blip.tone(140, 0.08, { type: 'square', volume: 0.04 }); }
  }
  function doBuild(type) { if (picked) attempt(() => E.build(g, type, picked.x, picked.y)); }
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
      else if (ev === 'arrow') Blip.tone(900, 0.015, { type: 'triangle', volume: 0.012 });
      else if (ev === 'boom') Blip.noise(0.08, 0.05);
      else if (ev === 'zap') Blip.tone([1400, 500], 0.06, { type: 'sawtooth', volume: 0.02 });
      else if (ev === 'kill') Blip.tone(1100, 0.025, { type: 'square', volume: 0.015 });
      else if (ev === 'boss-down') { Blip.tune([[392, 0.1], [523, 0.1], [659, 0.2]], { type: 'square', volume: 0.06 }); banner = { text: 'Ogre down! 👹', sub: '+80 gold', t: 1.5 }; }
      else if (ev === 'leak') { Blip.tone([300, 150], 0.18, { type: 'sawtooth', volume: 0.05 }); }
      else if (ev.startsWith('wave-clear:')) {
        if (g.phase !== 'won') banner = { text: `Wave ${g.wave} cleared!`, sub: `+${ev.split(':')[1]} gold`, t: 1.6 };
        Blip.tune([[659, 0.08], [880, 0.12]], { type: 'triangle', volume: 0.05 });
      } else if (ev.startsWith('early:')) toast(`Brave! +${ev.split(':')[1]} gold`);
      else if (ev === 'lost' || ev === 'won') end(ev === 'won');
    }
  }

  function end(won) {
    state = 'over';
    picked = null;
    renderInfo(true);
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
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing' && !help.isOpen) {
      let left = dt * speed;
      while (left > 0) { const h = Math.min(left, 1 / 30); E.step(g, h); react(); left -= h; if (state !== 'playing') break; }
      hud();
    }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    renderInfo(false);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  // ---- drawing --------------------------------------------------------------------------------------------
  function emoji(ctx, ch, x, y, size) {
    ctx.font = `${Math.round(size)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + size * 0.05);
  }

  function draw(t) {
    const { ctx, size } = view;
    const c = size.w / g.map.cols;
    const P = v => v * c;
    ctx.save();
    ctx.clearRect(0, 0, size.w, size.h);
    // ground
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) {
      const tile = E.tileAt(g, x, y);
      if (tile === '#' || tile === 'S' || tile === 'E') {
        ctx.fillStyle = (x + y) % 2 ? '#6e5236' : '#735639';
      } else ctx.fillStyle = (x + y) % 2 ? '#1f3d25' : '#22432a';
      ctx.fillRect(P(x), P(y), c + 0.5, c + 0.5);
    }
    // road edges
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1, c * 0.06);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    g.map.path.forEach(([x, y], i) => (i ? ctx.lineTo(P(x + 0.5), P(y + 0.5)) : ctx.moveTo(P(x + 0.5), P(y + 0.5))));
    ctx.stroke();
    for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) {
      const tile = E.tileAt(g, x, y);
      if (tile === 'T') emoji(ctx, '🌲', P(x + 0.5), P(y + 0.5), c * 0.8);
    }
    const [sx, sy] = g.map.path[0], [ex, ey] = g.map.path[g.map.path.length - 1];
    emoji(ctx, '🌀', P(sx + 0.5), P(sy + 0.5), c * 0.75);
    emoji(ctx, '🏰', P(ex + 0.5), P(ey + 0.5), c * 0.9);

    // the picked square / tower range
    if (picked) {
      const tower = E.towerAt(g, picked.x, picked.y);
      ctx.strokeStyle = '#ffc72c';
      ctx.lineWidth = 2;
      ctx.strokeRect(P(picked.x) + 1, P(picked.y) + 1, c - 2, c - 2);
      if (tower) {
        ctx.fillStyle = 'rgba(255,199,44,0.10)';
        ctx.strokeStyle = 'rgba(255,199,44,0.6)';
        ctx.beginPath(); ctx.arc(P(tower.x + 0.5), P(tower.y + 0.5), P(E.stats(tower).range), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // towers
    for (const tw of g.towers) {
      const def = E.TOWERS[tw.type];
      const x = P(tw.x + 0.5), y = P(tw.y + 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(x, y + c * 0.06, c * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a2838';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = Math.max(1.5, c * 0.07);
      ctx.beginPath(); ctx.arc(x, y, c * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (tw.type === 'archer' || tw.type === 'cannon') {
        ctx.strokeStyle = '#d9d2bd';
        ctx.lineWidth = Math.max(2, c * (tw.type === 'cannon' ? 0.16 : 0.08));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(tw.aim) * c * 0.42, y + Math.sin(tw.aim) * c * 0.42); ctx.stroke();
      }
      emoji(ctx, def.emoji, x, y, c * 0.48);
      for (let i = 0; i <= tw.level; i++) {
        ctx.fillStyle = '#ffc72c';
        ctx.beginPath(); ctx.arc(x - c * 0.14 + i * c * 0.14, y + c * 0.36, Math.max(1.5, c * 0.05), 0, Math.PI * 2); ctx.fill();
      }
    }

    // monsters
    for (const e of g.enemies) {
      const def = E.ENEMIES[e.type];
      const x = P(e.x), bob = def.flying ? Math.sin(t * 8 + e.id) * c * 0.06 : 0, y = P(e.y) + bob;
      const r = P(def.size);
      if (def.flying) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, P(e.y) + r * 0.9, r * 0.6, r * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
      if (e.slow > 0) { ctx.fillStyle = 'rgba(45,226,230,0.35)'; ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.fill(); }
      emoji(ctx, def.emoji, x, y, r * 2);
      if (e.hp < e.maxHp) {
        const w = r * 2, frac = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - r - 6, w, 4);
        ctx.fillStyle = frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffc72c' : '#ff5e5e';
        ctx.fillRect(x - w / 2, y - r - 6, w * frac, 4);
      }
    }

    // shots
    for (const s of g.shots) {
      if (s.kind === 'arrow') {
        const target = g.enemies.find(e => e.id === s.target);
        const a = target ? Math.atan2(target.y - s.y, target.x - s.x) : 0;
        ctx.strokeStyle = '#f4ecd0';
        ctx.lineWidth = Math.max(1.5, c * 0.05);
        ctx.beginPath(); ctx.moveTo(P(s.x) - Math.cos(a) * c * 0.2, P(s.y) - Math.sin(a) * c * 0.2); ctx.lineTo(P(s.x), P(s.y)); ctx.stroke();
      } else {
        ctx.fillStyle = '#1b1a24';
        ctx.strokeStyle = '#ff9f2c';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(P(s.x), P(s.y), c * 0.11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // effects
    for (const f of g.fx) {
      if (f.kind === 'frost') {
        const k = 1 - f.t / 0.5;
        ctx.strokeStyle = `rgba(45,226,230,${0.6 * (1 - k)})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(P(f.x), P(f.y), P(f.r * (0.3 + k * 0.7)), 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'boom') {
        const k = 1 - f.t / 0.3;
        ctx.fillStyle = `rgba(255,159,44,${0.55 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(P(f.x), P(f.y), P(f.r * (0.4 + k * 0.6)), 0, Math.PI * 2); ctx.fill();
      } else if (f.kind === 'zap') {
        ctx.strokeStyle = `rgba(230,200,255,${Math.min(1, f.t / 0.1)})`;
        ctx.lineWidth = Math.max(1.5, c * 0.05);
        ctx.beginPath();
        f.points.forEach((p, i) => {
          if (!i) { ctx.moveTo(P(p.x), P(p.y)); return; }
          const q = f.points[i - 1];
          for (let j = 1; j <= 3; j++) {
            const k = j / 3;
            const jx = j < 3 ? (Math.random() - 0.5) * c * 0.3 : 0, jy = j < 3 ? (Math.random() - 0.5) * c * 0.3 : 0;
            ctx.lineTo(P(q.x + (p.x - q.x) * k) + jx, P(q.y + (p.y - q.y) * k) + jy);
          }
        });
        ctx.stroke();
      } else if (f.kind === 'pop') {
        ctx.globalAlpha = f.t / 0.4;
        emoji(ctx, '💥', P(f.x), P(f.y) - (0.4 - f.t) * c, c * 0.5);
        ctx.globalAlpha = 1;
      }
    }

    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      ctx.fillStyle = 'rgba(8,8,15,0.6)';
      ctx.fillRect(0, size.h * 0.4 - c * 0.9, size.w, c * 1.7);
      ctx.fillStyle = '#ffc72c';
      ctx.font = `800 ${Math.round(c * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(banner.text, size.w / 2, size.h * 0.4 - c * 0.25);
      ctx.fillStyle = '#f4ecd0';
      ctx.font = `600 ${Math.round(c * 0.36)}px system-ui, sans-serif`;
      ctx.fillText(banner.sub, size.w / 2, size.h * 0.4 + c * 0.38);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---- input ----------------------------------------------------------------------------------------
  $('stage').addEventListener('pointerdown', e => {
    if (state === 'paused') { pause(false); return; }
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
      toast(tile === 'T' ? 'Trees here. Pick a grass square.' : 'That\'s the road! Build on the grass next to it.', 1500);
    }
    renderInfo(true);
  });
  $('waveBtn').addEventListener('click', startWave);
  $('speedBtn').addEventListener('click', () => {
    speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
    $('speedBtn').textContent = `⏩ ${speed}×`;
  });
  window.addEventListener('keydown', e => {
    if (help.isOpen) return;
    const k = e.key;
    if (k >= '1' && k <= '4') { doBuild(TYPES[Number(k) - 1]); return; }
    if (k === 'u' || k === 'U') doUpgrade();
    else if (k === 's' || k === 'S') doSell();
    else if (k === ' ') { e.preventDefault(); startWave(); }
    else if (k === 'f' || k === 'F') $('speedBtn').click();
    else if (k === 'p' || k === 'P') pause();
    else if (k === 'Escape') { picked = null; renderInfo(true); }
  });
  $('pauseBtn').addEventListener('click', () => pause());
  $('scoresBtn').addEventListener('click', () => shell.openScores(mapId));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  Blip.muteButton($('muteBtn'));

  const help = Tutorial.create('towers', [
    {
      emoji: '🏰', title: 'Guard the castle',
      html: `<p>Monsters walk down the dirt road from the 🌀 portal to your 🏰 castle. Every one that gets in costs a life (an ogre costs 5).</p>
        <p>Build towers on the grass next to the road to stop them. Survive all ${E.WAVES} waves to win!</p>`
    },
    {
      emoji: '🏹', title: 'Towers',
      html: `<table>
          <tr><td>🏹 Archer</td><td>Cheap and quick. Hits flyers.</td></tr>
          <tr><td>💣 Cannon</td><td>Blasts a whole group, but can't hit 🦇 bats.</td></tr>
          <tr><td>❄️ Frost</td><td>Slows everything nearby. Great next to a bend.</td></tr>
          <tr><td>⚡ Tesla</td><td>Lightning that jumps from monster to monster.</td></tr>
        </table>
        <p>Tap a grass square, then pick a tower. Tap a tower to <b>upgrade</b> it (twice) or <b>sell</b> it.</p>`
    },
    {
      emoji: '🪙', title: 'Gold and waves',
      html: `<p>Every monster you stop gives gold, and so does every wave you clear. Spend it on more towers and upgrades.</p>
        <p>Press <b>Start wave</b> when you're ready. Sending the next wave early earns bonus gold. <b>⏩</b> speeds things up.</p>
        <div class="tut-tip">Watch out for <b>🛡️ knights</b> (tough armor: big hits work best) and the <b>👹 ogre</b> every 5th wave.</div>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  reset();
  requestAnimationFrame(frame);
  help.autoOpen();
})();
