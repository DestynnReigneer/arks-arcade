'use strict';

// Spin & Solve: spin the wheel, call a consonant, buy vowels, solve the
// phrase. Solo plays for the high-score board; 2-4 players share a phone.

(() => {
  const { $, toast, api } = ArcadeKit;
  const VOWELS = 'AEIOU';
  const VOWEL_COST = 250;
  const SOLVE_MIN = 1000;     // solving always banks at least this much
  const MAX_STRIKES = 3;      // solo: three misses and the round is lost
  const COLS = 12;

  // 24 wedges, clockwise from the top.
  const WEDGES = [500, 900, 300, 650, 'BANKRUPT', 400, 700, 350, 550, 800, 'LOSE A TURN', 450,
    600, 1000, 300, 500, 750, 400, 850, 350, 500, 600, 450, 700];
  // Each wedge color is a gradient from a bright core to a deep edge.
  const WEDGE_COLORS = [
    ['#ff8fc8', '#ff2e8c', '#8a0f4a'], ['#ffe27a', '#ffb800', '#8a5a00'], ['#7cc4ff', '#1f7bff', '#0b2f7a'],
    ['#7dffc0', '#14d27a', '#06603a'], ['#c9a6ff', '#8a4dff', '#3b1680'], ['#ffb27a', '#ff6a1f', '#7a2a05']
  ];
  const LED_COUNT = 36;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, reducedMotion ? Math.min(ms, 60) : ms));
  const SLICE = 360 / WEDGES.length;

  const S = {
    names: ['', ''], rounds: 3, players: [], cur: 0, round: 0, puzzle: null,
    revealed: new Set(), used: new Set(), strikes: 0, wedge: null, busy: false,
    rotation: 0, usedPuzzles: new Set(),
    config: null, level: 'kids', pack: 'all', pool: [],
    pin: (() => { try { return sessionStorage.getItem('spin.adultPin') || ''; } catch { return ''; } })(),
    adultOk: (() => { try { return sessionStorage.getItem('spin.adultOk') === 'yes'; } catch { return false; } })()
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  const levelInfo = id => (S.config ? S.config.levels.find(l => l.id === id) : null) || { id: 'kids', label: 'Kids', adult: false, builtin: 0 };
  const isAdult = () => levelInfo(S.level).adult;
  const unlocked = () => (S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
  const solo = () => S.players.length === 1;
  const money = n => '$' + n.toLocaleString('en-US');
  const letters = s => s.replace(/[^A-Z]/g, '');

  // ---- setup --------------------------------------------------------------------

  function renderNames() {
    const list = $('nameList');
    list.innerHTML = '';
    S.names.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'name-row';
      row.innerHTML = `<input maxlength="12" placeholder="Player ${i + 1}"><button title="Remove">✕</button>`;
      const input = row.querySelector('input');
      input.value = n;
      input.addEventListener('input', () => { S.names[i] = input.value; });
      row.querySelector('button').addEventListener('click', () => {
        if (S.names.length > 1) { S.names.splice(i, 1); renderNames(); }
      });
      list.appendChild(row);
    });
    $('addPlayerBtn').classList.toggle('hidden', S.names.length >= 4);
  }

  async function loadConfig() {
    try {
      S.config = await api('/api/spinsolve/config', undefined, pinHeaders());
    } catch (e) { toast(e.message); return; }
    renderLevels();
    renderPacks();
  }

  function renderLevels() {
    const list = $('levelList');
    list.innerHTML = '';
    for (const l of S.config.levels) {
      const b = document.createElement('button');
      b.className = 'level';
      b.setAttribute('aria-pressed', String(l.id === S.level));
      b.innerHTML = '<div class="l-name"></div><div class="l-blurb"></div>';
      b.querySelector('.l-name').textContent = `${l.emoji} ${l.label}`;
      b.querySelector('.l-blurb').textContent = l.blurb;
      if (l.adult && !unlocked()) b.insertAdjacentHTML('beforeend', '<div class="l-lock">🔞 Adults only</div>');
      b.addEventListener('click', () => pickLevel(l.id));
      list.appendChild(b);
    }
    document.documentElement.classList.toggle('adult-mode', isAdult());
  }

  function renderPacks() {
    const select = $('packSelect');
    const packs = S.config.packs.filter(p => p.level === S.level);
    const total = levelInfo(S.level).builtin + packs.reduce((n, p) => n + p.count, 0);
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = `🎲 All ${levelInfo(S.level).label} puzzles (${total})`;
    select.appendChild(all);
    for (const p of packs) {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = `${p.emoji} ${p.label} (${p.count})`;
      select.appendChild(o);
    }
    if (![...select.options].some(o => o.value === S.pack)) S.pack = 'all';
    select.value = S.pack;
  }

  async function pickLevel(id) {
    if (levelInfo(id).adult && !unlocked() && !(await unlockAdult())) return;
    S.level = id;
    S.pack = 'all';
    // Unlocking may reveal adult packs, so ask again.
    await loadConfig();
  }

  // The adult PIN if one is set, otherwise a one-tap "I'm an adult".
  function unlockAdult() {
    if (!S.config.adultRequiresPin) {
      const ok = confirm('These puzzles are for adults only (18+). Continue?');
      if (ok) { S.adultOk = true; try { sessionStorage.setItem('spin.adultOk', 'yes'); } catch { /* unavailable */ } }
      return Promise.resolve(ok);
    }
    return new Promise(resolve => {
      $('pinInput').value = '';
      $('pinMsg').textContent = '';
      $('pinView').classList.remove('hidden');
      $('pinInput').focus();
      const done = ok => {
        $('pinView').classList.add('hidden');
        $('pinOk').onclick = $('pinCancel').onclick = $('pinInput').onkeydown = null;
        resolve(ok);
      };
      const tryPin = async () => {
        const pin = $('pinInput').value.trim();
        try {
          const r = await api('/api/spinsolve/unlock', { pin });
          if (!r.ok) { $('pinMsg').textContent = 'That PIN is not right.'; return; }
          S.pin = pin;
          try { sessionStorage.setItem('spin.adultPin', pin); } catch { /* unavailable */ }
          done(true);
        } catch (e) { $('pinMsg').textContent = e.message; }
      };
      $('pinOk').onclick = tryPin;
      $('pinInput').onkeydown = e => { if (e.key === 'Enter') tryPin(); };
      $('pinCancel').onclick = () => done(false);
    });
  }

  async function startGame() {
    Blip.unlock();
    try {
      const q = S.pack === 'all' ? `level=${S.level}` : `pack=${encodeURIComponent(S.pack)}`;
      S.pool = (await api(`/api/spinsolve/puzzles?${q}`, undefined, pinHeaders())).puzzles;
    } catch (e) { toast(e.message); return; }
    if (!S.pool.length) { toast('No puzzles here yet.'); return; }
    S.usedPuzzles.clear();
    S.players = S.names.map((n, i) => ({ name: n.trim() || `Player ${i + 1}`, round: 0, total: 0 }));
    S.round = 0;
    $('setup').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('overView').classList.add('hidden');
    nextRound();
  }

  function pickPuzzle() {
    let pool = S.pool.filter(p => !S.usedPuzzles.has(p.answer));
    if (!pool.length) { S.usedPuzzles.clear(); pool = S.pool; }
    const p = pool[Math.floor(Math.random() * pool.length)];
    S.usedPuzzles.add(p.answer);
    return p;
  }

  function nextRound() {
    $('roundView').classList.add('hidden');
    S.round++;
    if (S.round > S.rounds) return gameOver();
    S.puzzle = pickPuzzle();
    S.revealed = new Set();
    S.used = new Set();
    S.strikes = 0;
    S.wedge = null;
    S.players.forEach(p => { p.round = 0; });
    S.cur = (S.round - 1) % S.players.length;
    render();
    say(`${S.players[S.cur].name}, spin the wheel!`);
    requestAnimationFrame(() => {
      Host.home();
      const host = Host.rotate();
      Host.pose('wave', 1500);
      Host.talk(pick(host.intro), 2200);
    });
  }

  // ---- the board ------------------------------------------------------------------

  // Wraps the answer into lines of at most 12 tiles, without splitting words.
  function lines(answer) {
    const out = [];
    let line = '';
    for (const word of answer.split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= COLS) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out;
  }

  function renderBoard(flash) {
    const board = $('puzzleBoard');
    board.style.setProperty('--cols', COLS);
    board.innerHTML = '';
    const rows = lines(S.puzzle.answer);
    while (rows.length < 3) rows[rows.length % 2 ? 'push' : 'unshift']('');
    for (const line of rows) {
      const pad = Math.floor((COLS - line.length) / 2);
      for (let c = 0; c < COLS; c++) {
        const ch = line[c - pad];
        const tile = document.createElement('div');
        tile.style.setProperty('--i', board.children.length);
        if (ch === undefined || ch === ' ') tile.className = 'tile blank';
        else if (!/[A-Z]/.test(ch) || S.revealed.has(ch)) {
          tile.className = 'tile shown' + (flash === ch ? ' flip' : '');
          tile.textContent = ch;
        } else {
          tile.className = 'tile covered';
          tile.dataset.ch = ch;
        }
        board.appendChild(tile);
      }
    }
  }

  function renderPlayers() {
    const list = $('playerList');
    list.innerHTML = '';
    S.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = i === S.cur ? 'now' : '';
      li.innerHTML = '<div class="pn"></div><div class="pr"></div><div class="pt"></div>';
      li.querySelector('.pn').textContent = p.name;
      li.querySelector('.pr').textContent = money(p.round);
      li.querySelector('.pt').textContent = `Total ${money(p.total)}`;
      list.appendChild(li);
    });
  }

  function remaining(set) {
    return [...new Set(letters(S.puzzle.answer))].filter(ch => set.includes(ch) && !S.revealed.has(ch));
  }
  const consonantsLeft = () => remaining('BCDFGHJKLMNPQRSTVWXYZ');
  const vowelsLeft = () => remaining(VOWELS);

  function render(flash) {
    renderBoard(flash);
    $('categoryLabel').textContent = S.puzzle.category;
    $('roundLabel').textContent = `Round ${S.round} of ${S.rounds}` + (S.puzzle.pack ? ` · ${S.puzzle.pack}` : '');
    $('strikes').textContent = solo() ? '❌'.repeat(S.strikes) + '⬜'.repeat(MAX_STRIKES - S.strikes) : '';
    renderPlayers();
    const p = S.players[S.cur];
    $('spinBtn').disabled = S.busy || !consonantsLeft().length;
    $('vowelBtn').disabled = S.busy || p.round < VOWEL_COST || !vowelsLeft().length;
    $('solveBtn').disabled = S.busy;
    $('usedLetters').textContent = S.used.size ? 'Called: ' + [...S.used].sort().join(' ') : '';
  }

  function say(text) { $('turnLine').textContent = text; }

  // ---- the robot co-host -----------------------------------------------------------
  // A different robot from spin-hosts.js runs each round. It glides along under
  // the wall, touches each letter to light it up, and reacts to the wheel.
  // Poses are CSS (data-pose); this moves it, swaps it, and gives it a voice.
  const Host = (() => {
    const el = $('host');
    const bubble = $('hostSay');
    const lane = $('hostLane');
    let x = 0;
    let sayTimer = null;
    let poseTimer = null;
    let current = null;
    let HAND = 14;

    function setHost(id) {
      current = SPIN_HOSTS[id];
      HAND = current.hand;
      el.dataset.host = id;
      $('hostArt').innerHTML = current.svg;
      el.style.setProperty('--at', `translateX(${x}px)`);
      el.classList.remove('swap');
      void el.offsetWidth;
      el.classList.add('swap');
      Blip.tone([400, 1600], 0.25, { type: 'sine', volume: 0.05 });
    }
    // Each robot sounds different when it talks.
    function voice() {
      const v = current && current.voice;
      if (!v) return;
      if (v.beeps) {
        for (let i = 0; i < 5; i++) Blip.tone(900 + Math.random() * 1500, 0.05, { type: 'sine', volume: 0.06, delay: i * 0.06 });
      } else Blip.tune(v.notes, { type: v.type, volume: 0.05 });
    }
    // This robot's line for a moment, or the house line if it has none.
    function line(key, ...args) {
      const own = current && current.lines[key];
      const list = own ? (typeof own === 'function' ? own(...args) : own) : (typeof LINES[key] === 'function' ? LINES[key](...args) : LINES[key]);
      return pick(list);
    }

    function laneWidth() { return lane.clientWidth - el.offsetWidth; }
    function place(px) {
      x = Math.max(0, Math.min(laneWidth(), px));
      el.style.transform = `translateX(${x}px)`;
      el.style.setProperty('--at', `translateX(${x}px)`);
      bubble.classList.toggle('left', x > laneWidth() / 2);
    }
    // Walks so her raised hand is under a tile, and waits until she's there.
    async function walkTo(tile) {
      const laneBox = lane.getBoundingClientRect();
      const box = tile.getBoundingClientRect();
      const target = box.left + box.width / 2 - laneBox.left - el.offsetWidth / 2 - HAND;
      const distance = Math.abs(target - x);
      el.style.transitionDuration = `${Math.min(520, 140 + distance * 1.4)}ms`;
      place(target);
      await wait(Math.min(520, 140 + distance * 1.4));
    }
    function pose(name, ms) {
      clearTimeout(poseTimer);
      el.dataset.pose = name;
      if (ms) poseTimer = setTimeout(() => { el.dataset.pose = 'idle'; }, ms);
    }
    function talk(text, ms = 2000) {
      voice();
      bubble.textContent = text;
      bubble.classList.add('show');
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => bubble.classList.remove('show'), ms);
    }
    function home() {
      el.style.transitionDuration = '600ms';
      place(laneWidth());
    }
    window.addEventListener('resize', () => place(x));
    // A new robot each round, never the same one twice in a row.
    function rotate() {
      const ids = Object.keys(SPIN_HOSTS).filter(id => !current || SPIN_HOSTS[id] !== current);
      setHost(pick(ids));
      return current;
    }
    return { walkTo, pose, talk, home, rotate, line, setHost };
  })();

  const pick = list => list[Math.floor(Math.random() * list.length)];
  const LINES = {
    hello: ['Let\'s play!', 'Spin to win!', 'Big money, no whammies!', 'Good luck, have fun!'],
    hit: n => n > 2 ? ['Look at all those!', 'Jackpot of letters!', `${n} of them!`] : ['There it is!', 'Nice call!', 'Ooh, yes!'],
    miss: ['Sorry, not there.', 'Nope, none of those.', 'Ooh, so close.'],
    bankrupt: ['Ouch! Bankrupt!', 'Nooo, the money!', 'That hurts to watch.'],
    lose: ['Aww, lose a turn.', 'Skip-a-roo!'],
    spin: ['Round and round…', 'Come on, big money!', 'Spinning!'],
    solved: ['You got it! 🎉', 'Brilliant!', 'Puzzle solved!'],
    wrong: ['Ooh, not quite.', 'Close, but no.'],
    vowel: ['Vowels are on me!', 'One vowel, coming up!']
  };

  // Lights up every hidden copy of a letter, one at a time, with Vee touching each.
  async function revealLetter(ch) {
    const tiles = [...$('puzzleBoard').querySelectorAll(`.tile.covered[data-ch="${ch}"]`)];
    for (const tile of tiles) {
      await Host.walkTo(tile);
      Host.pose('touch');
      tile.classList.add('lit');
      Blip.tone(1046, 0.12, { type: 'triangle' });
      Blip.tone(1568, 0.08, { type: 'sine', volume: 0.06, delay: 0.05 });
      await wait(320);
      tile.classList.remove('covered', 'lit');
      tile.classList.add('shown', 'flip');
      tile.textContent = ch;
      await wait(180);
    }
    Host.pose('idle');
  }

  // The whole wall at once, in a quick sweep, when the puzzle is solved.
  async function revealAll() {
    const tiles = [...$('puzzleBoard').querySelectorAll('.tile.covered')];
    Host.pose('cheer', 2600);
    for (const tile of tiles) {
      tile.classList.add('lit');
      Blip.tone(880 + Math.random() * 600, 0.05, { type: 'triangle', volume: 0.05 });
      await wait(45);
      tile.classList.remove('covered', 'lit');
      tile.classList.add('shown', 'flip');
      tile.textContent = tile.dataset.ch;
    }
    for (const tile of $('puzzleBoard').querySelectorAll('.tile.shown')) tile.classList.add('win');
  }

  // ---- the wheel ------------------------------------------------------------------

  // A glossy wheel: gradient wedges, pegs, a chrome rim ringed with LEDs, a
  // glass highlight on top, and a glowing hub. Built once as SVG.
  function buildWheel() {
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs, parent) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (parent) parent.appendChild(n);
      return n;
    };
    const defs = $('wheelDefs');
    const gradient = (id, stops, attrs = {}) => {
      const g = make('radialGradient', { id, cx: '0', cy: '0', r: '100', gradientUnits: 'userSpaceOnUse', ...attrs }, defs);
      stops.forEach(([o, c, a]) => make('stop', { offset: o, 'stop-color': c, ...(a != null ? { 'stop-opacity': a } : {}) }, g));
    };
    WEDGE_COLORS.forEach(([hi, mid, lo], i) => gradient(`wg${i}`, [['0.25', hi], ['0.7', mid], ['1', lo]]));
    gradient('wg-bankrupt', [['0.3', '#3a3a46'], ['0.75', '#101016'], ['1', '#000']]);
    gradient('wg-lose', [['0.3', '#ffffff'], ['0.75', '#cfd8ea'], ['1', '#7d8aa6']]);
    gradient('wg-gold', [['0.25', '#fff3b0'], ['0.7', '#ffcc33'], ['1', '#9a6a00']]);
    gradient('hub-grad', [['0', '#3b2a7a'], ['0.8', '#120d2a'], ['1', '#000']], { r: '22' });
    const shine = make('linearGradient', { id: 'wheel-shine', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    make('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.38' }, shine);
    make('stop', { offset: '0.5', 'stop-color': '#fff', 'stop-opacity': '0' }, shine);
    const rim = make('linearGradient', { id: 'wheel-rim', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    [['0', '#f5f7ff'], ['0.35', '#8f97b8'], ['0.6', '#ffffff'], ['1', '#5b6283']].forEach(([o, c]) => make('stop', { offset: o, 'stop-color': c }, rim));
    const blur = make('filter', { id: 'wheel-blur', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    make('feGaussianBlur', { id: 'wheel-blur-amount', stdDeviation: '0' }, blur);

    const pt = (deg, r) => {
      const a = (deg - 90) * Math.PI / 180;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const spinG = $('wheelSpin');
    WEDGES.forEach((w, i) => {
      const [x1, y1] = pt(i * SLICE, 100);
      const [x2, y2] = pt((i + 1) * SLICE, 100);
      const fill = w === 'BANKRUPT' ? 'url(#wg-bankrupt)' : w === 'LOSE A TURN' ? 'url(#wg-lose)'
        : w >= 1000 ? 'url(#wg-gold)' : `url(#wg${i % WEDGE_COLORS.length})`;
      make('path', { d: `M0 0 L${x1} ${y1} A100 100 0 0 1 ${x2} ${y2} Z`, fill, stroke: 'rgba(255,255,255,0.35)', 'stroke-width': '0.6' }, spinG);
      // Characters stacked from the rim inward, game-show style, so every
      // label reads the same way up wherever it is on the wheel.
      const mid = i * SLICE + SLICE / 2;
      const label = typeof w === 'number' ? String(w) : w === 'LOSE A TURN' ? 'LOSE TURN' : w;
      const size = typeof w === 'number' ? 11 : 5.4;
      const step = typeof w === 'number' ? 11 : 5.6;
      const group = make('g', { transform: `rotate(${mid})` }, spinG);
      [...label].forEach((ch, k) => {
        if (ch === ' ') return;
        const t = make('text', {
          class: 'wheel-label', x: '0', y: String(-88 + k * step),
          'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': String(size)
        }, group);
        t.textContent = ch;
        if (w === 'LOSE A TURN') t.style.fill = '#1b1446';
      });
      // A peg at each wedge boundary
      const [px, py] = pt(i * SLICE, 95);
      make('circle', { cx: px, cy: py, r: '1.8', fill: '#fff', stroke: '#8f97b8', 'stroke-width': '0.6' }, spinG);
    });

    const still = $('wheelStatic');
    make('circle', { r: '100', fill: 'url(#wheel-shine)', 'pointer-events': 'none' }, still);
    make('circle', { r: '104', fill: 'none', stroke: 'url(#wheel-rim)', 'stroke-width': '8' }, still);
    for (let i = 0; i < LED_COUNT; i++) {
      const [lx, ly] = pt(i * 360 / LED_COUNT, 104);
      const led = make('circle', { cx: lx, cy: ly, r: '2.3', class: 'led' }, still);
      led.style.setProperty('--n', i % 2 ? i : i + LED_COUNT);
    }
    make('circle', { r: '20', fill: 'url(#hub-grad)', stroke: '#ffd23f', 'stroke-width': '2.5' }, still);
    make('circle', { r: '15', fill: 'none', stroke: '#2de2e6', 'stroke-width': '1', opacity: '0.8' }, still);
    const hub = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'wheel-label', 'font-size': '7' }, still);
    hub.textContent = 'SPIN';
    $('wheel').classList.add('idle');
  }

  function setLeds(on) {
    const leds = $('wheelStatic').querySelectorAll('.led');
    leds.forEach((led, i) => led.classList.toggle('on', on(i)));
  }

  const wedgeAt = rot => Math.floor((((360 - rot) % 360) + 360) % 360 / SLICE) % WEDGES.length;

  function spin() {
    if (S.busy) return;
    Blip.unlock();
    S.busy = true;
    $('landed').classList.add('hidden');
    render();
    Host.talk(Host.line('spin'), 1400);
    Host.pose('point', 900);
    const wheel = $('wheel');
    wheel.classList.remove('idle', 'won');
    const blurAmount = $('wheel-blur-amount');
    const flapper = $('flapper');
    let chase = 0;
    let lastRot = S.rotation;
    let lastT = performance.now();
    const target = Math.floor(Math.random() * WEDGES.length);
    const jitter = (Math.random() - 0.5) * SLICE * 0.7;
    const want = 360 - (target * SLICE + SLICE / 2) + jitter;
    const startRot = S.rotation;
    const endRot = startRot + 360 * 4 + ((want - startRot) % 360 + 360) % 360;
    const duration = 3600;
    const t0 = performance.now();
    let lastWedge = wedgeAt(startRot);
    const g = $('wheelSpin');
    const frame = now => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      S.rotation = startRot + (endRot - startRot) * eased;
      g.setAttribute('transform', `rotate(${S.rotation})`);
      // Motion blur and chasing lights, both following how fast it's going.
      const speed = Math.abs(S.rotation - lastRot) / Math.max(1, now - lastT);   // degrees per ms
      lastRot = S.rotation;
      lastT = now;
      if (!reducedMotion) blurAmount.setAttribute('stdDeviation', Math.min(2.4, speed * 1.1).toFixed(2));
      chase = (chase + Math.max(0.15, speed * 1.2)) % LED_COUNT;
      setLeds(i => (i + Math.floor(chase)) % 6 < 2);
      const w = wedgeAt(S.rotation);
      if (w !== lastWedge) {
        lastWedge = w;
        Blip.tone(1400, 0.015, { type: 'square', volume: 0.05 });
        flapper.classList.remove('kick');
        void flapper.offsetWidth;
        flapper.classList.add('kick');
      }
      if (t < 1) requestAnimationFrame(frame);
      else {
        blurAmount.setAttribute('stdDeviation', '0');
        setLeds(() => false);
        wheel.classList.add('won');
        setTimeout(() => { wheel.classList.remove('won'); wheel.classList.add('idle'); }, 1500);
        landed(WEDGES[wedgeAt(S.rotation)]);
      }
    };
    requestAnimationFrame(frame);
  }

  function showLanded(text, bad = false) {
    $('landed').innerHTML = '<span></span>';
    $('landed').firstChild.textContent = text;
    $('landed').classList.toggle('bad', bad);
    $('landed').classList.remove('hidden');
  }

  function landed(w) {
    const p = S.players[S.cur];
    if (w === 'BANKRUPT') {
      showLanded('💸 BANKRUPT', true);
      Host.pose('oops', 1800);
      Host.talk(Host.line('bankrupt'));
      Blip.tune([[300, 0.15], [200, 0.15], [120, 0.4]], { type: 'sawtooth', volume: 0.08 });
      p.round = 0;
      S.busy = false;
      return endTurn(`${p.name} went bankrupt!`);
    }
    if (w === 'LOSE A TURN') {
      showLanded('🙅 LOSE A TURN', true);
      Host.pose('oops', 1500);
      Host.talk(Host.line('lose'));
      Blip.tone([400, 200], 0.3, { type: 'square', volume: 0.08 });
      S.busy = false;
      return endTurn(`${p.name} loses a turn.`);
    }
    showLanded(money(w));
    Blip.tune([[880, 0.08], [1320, 0.14]], { type: 'triangle' });
    Host.talk(`${money(w)}! Pick a letter.`, 1600);
    S.wedge = w;
    setTimeout(() => { S.busy = false; openLetters('consonant'); }, 650);
  }

  // ---- letters ------------------------------------------------------------------------

  let letterMode = 'consonant';
  function openLetters(mode) {
    letterMode = mode;
    $('letterTitle').textContent = mode === 'vowel' ? 'Buy a vowel' : `Pick a consonant for ${money(S.wedge)}`;
    $('letterHint').textContent = mode === 'vowel'
      ? `Costs ${money(VOWEL_COST)} from this round.`
      : 'Every time it\'s in the puzzle, you earn the amount you spun.';
    $('letterCancel').classList.toggle('hidden', mode !== 'vowel');
    const grid = $('letterGrid');
    grid.innerHTML = '';
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const b = document.createElement('button');
      b.textContent = ch;
      b.disabled = S.used.has(ch) || (mode === 'vowel') !== VOWELS.includes(ch);
      b.addEventListener('click', () => { $('letterView').classList.add('hidden'); callLetter(ch); });
      grid.appendChild(b);
    }
    $('letterView').classList.remove('hidden');
  }

  async function callLetter(ch) {
    const p = S.players[S.cur];
    S.used.add(ch);
    const count = letters(S.puzzle.answer).split('').filter(c => c === ch).length;
    if (letterMode === 'vowel') { p.round -= VOWEL_COST; Host.talk(Host.line('vowel'), 1200); }
    $('landed').classList.add('hidden');
    if (!count) {
      Blip.tone([220, 140], 0.35, { type: 'sawtooth', volume: 0.08 });
      Host.pose('oops', 1500);
      Host.talk(`${Host.line('miss')} No ${ch}.`);
      return endTurn(`No ${ch}. ${solo() ? 'Strike!' : 'Next player.'}`);
    }
    if (letterMode === 'consonant') p.round += S.wedge * count;
    // Vee walks the wall lighting each one; the buttons wait until she's done.
    S.busy = true;
    render();
    say(`${count} ${ch}${count > 1 ? '\'s' : ''}!`);
    await revealLetter(ch);
    S.revealed.add(ch);
    S.busy = false;
    Host.pose('cheer', 900);
    Host.talk(Host.line('hit', count), 1500);
    render();
    say(`${count} ${ch}${count > 1 ? '\'s' : ''}! ${p.name}, go again: spin, buy a vowel, or solve.`);
    if (!consonantsLeft().length && !vowelsLeft().length) return solved();
    if (!consonantsLeft().length) say('No consonants left! Buy a vowel or solve.');
  }

  function endTurn(message) {
    if (solo()) {
      S.strikes++;
      render();
      if (S.strikes >= MAX_STRIKES) return roundLost();
      say(`${message} ${MAX_STRIKES - S.strikes} strike${MAX_STRIKES - S.strikes === 1 ? '' : 's'} left.`);
      return;
    }
    S.cur = (S.cur + 1) % S.players.length;
    render();
    say(`${message} ${S.players[S.cur].name}, your turn!`);
  }

  // ---- solving --------------------------------------------------------------------------

  function openSolve() {
    $('solveCategory').textContent = S.puzzle.category;
    $('solveInput').value = '';
    $('solveMsg').textContent = '';
    $('solveView').classList.remove('hidden');
    $('solveInput').focus();
  }

  function trySolve() {
    const guess = letters($('solveInput').value.toUpperCase());
    if (!guess) { $('solveMsg').textContent = 'Type your answer first.'; return; }
    $('solveView').classList.add('hidden');
    if (guess === letters(S.puzzle.answer)) return solved();
    Blip.tone([220, 140], 0.4, { type: 'sawtooth', volume: 0.08 });
    Host.pose('oops', 1500);
    Host.talk(Host.line('wrong'));
    endTurn('Not quite!');
  }

  async function solved() {
    const p = S.players[S.cur];
    const won = Math.max(p.round, SOLVE_MIN);
    p.total += won;
    S.players.forEach(x => { x.round = 0; });
    S.busy = true;
    renderPlayers();
    Host.talk(Host.line('solved'), 2600);
    Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]], { type: 'triangle' });
    await revealAll();
    for (const ch of letters(S.puzzle.answer)) S.revealed.add(ch);
    S.busy = false;
    showRound('🎉', `${p.name} solved it!`, `+${money(won)}`, 1400);
  }

  function roundLost() {
    for (const ch of letters(S.puzzle.answer)) S.revealed.add(ch);
    S.players.forEach(x => { x.round = 0; });
    render();
    Host.pose('oops', 2000);
    Host.talk('Three strikes! Here\'s the answer.');
    showRound('😵', 'Three strikes!', 'This round banks nothing.');
  }

  function showRound(emoji, title, hint, delay = 700) {
    $('roundEmoji').textContent = emoji;
    $('roundTitle').textContent = title;
    $('roundAnswer').textContent = S.puzzle.answer;
    $('roundHint').textContent = hint;
    $('nextRoundBtn').textContent = S.round >= S.rounds ? 'See the results' : 'Next round';
    setTimeout(() => $('roundView').classList.remove('hidden'), delay);
  }

  // ---- the end -----------------------------------------------------------------------------

  let initials = null;
  function gameOver() {
    const ranked = S.players.slice().sort((a, b) => b.total - a.total);
    $('overTitle').textContent = solo() ? `You banked ${money(ranked[0].total)}!` : `${ranked[0].name} wins!`;
    $('finalList').innerHTML = '';
    for (const p of ranked) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><span></span>';
      li.firstChild.textContent = p.name;
      li.lastChild.textContent = money(p.total);
      $('finalList').appendChild(li);
    }
    const canSave = solo() && ranked[0].total > 0;
    $('overScore').classList.toggle('hidden', !canSave);
    $('saveScoreBtn').disabled = false;
    $('scoreMsg').textContent = '';
    $('overView').classList.remove('hidden');
    if (canSave) setTimeout(() => initials.reset(), 50);
  }

  async function saveScore() {
    const who = initials.value();
    if (!who) { $('scoreMsg').textContent = 'Type your initials first.'; return; }
    $('saveScoreBtn').disabled = true;
    try {
      const packLabel = S.pack === 'all' ? '' : ` · ${$('packSelect').selectedOptions[0].textContent.replace(/ \(\d+\)$/, '')}`;
      const r = await ArcadeKit.saveScore('spinsolve', {
        initials: who, score: S.players[0].total, board: isAdult() ? 'adult' : 'solo',
        detail: `${S.rounds} rounds · ${levelInfo(S.level).label}${packLabel}`
      });
      initials.remember(who);
      $('overScore').classList.add('hidden');
      openScores(r.id);
      toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
    } catch (e) {
      $('scoreMsg').textContent = e.message;
      $('saveScoreBtn').disabled = false;
    }
  }

  function openScores(highlightId, board = isAdult() ? 'adult' : 'solo') {
    // The adult board only shows (and only loads) once adult play is unlocked.
    $('scoreBoardSeg').classList.toggle('hidden', !unlocked());
    for (const b of $('scoreBoardSeg').children) b.setAttribute('aria-pressed', String(b.dataset.board === board));
    ArcadeKit.loadScores('spinsolve', board, $('scoreList'), highlightId, pinHeaders());
    $('scoresView').classList.remove('hidden');
  }

  // ---- theme requests ------------------------------------------------------------------

  function openRequest() {
    for (const id of ['reqTopic', 'reqNote', 'reqBy']) $(id).value = '';
    $('reqMsg').textContent = '';
    $('requestForm').classList.remove('hidden');
    $('reqThanks').classList.add('hidden');
    $('requestView').classList.remove('hidden');
    $('reqTopic').focus();
  }

  async function sendRequest() {
    const topic = $('reqTopic').value.trim();
    if (!topic) { $('reqMsg').textContent = 'Type a theme idea first.'; return; }
    try {
      await api('/api/spinsolve/requests', { topic, note: $('reqNote').value.trim(), requestedBy: $('reqBy').value.trim() });
      $('requestForm').classList.add('hidden');
      $('reqThanks').classList.remove('hidden');
      setTimeout(() => $('requestView').classList.add('hidden'), 1800);
    } catch (e) { $('reqMsg').textContent = e.message; }
  }

  function backToSetup() {
    $('overView').classList.add('hidden');
    $('roundView').classList.add('hidden');
    $('game').classList.add('hidden');
    $('setup').classList.remove('hidden');
  }

  // ---- how to play ----------------------------------------------------------------------

  const help = Tutorial.create('spinsolve', [
    {
      emoji: '🎯', title: 'The goal',
      html: `<p>Figure out the hidden <b>phrase</b> on the board. The <b>category</b> under it tells you what kind of thing it is.</p>
        <p>A different <b>robot host</b> runs each round and lights up your letters. Meet Vee, Tinny, Bleep, Brass, Scrappy, Ova and Puffy!</p>
        <p>Bank the most money by the end of the last round to win.</p>`
    },
    {
      emoji: '🎡', title: 'Spin, then call a letter',
      html: `<p>Tap <b>Spin</b>. Where the wheel stops is what each letter is worth.</p>
        <p>Pick a <b>consonant</b> (not A E I O U). Every time it's in the puzzle, you earn that much, and you go again.</p>
        <p>If it isn't there, your turn ends.</p>`
    },
    {
      emoji: '💸', title: 'Watch out',
      html: `<table>
          <tr><td>💸 Bankrupt</td><td>You lose this round's money and your turn.</td></tr>
          <tr><td>🙅 Lose a turn</td><td>Your turn ends, but you keep your money.</td></tr>
        </table>`
    },
    {
      emoji: '🅰️', title: 'Vowels and solving',
      html: `<p><b>Buy a vowel</b> for $250 of this round's money. It shows every A, E, I, O or U you pick.</p>
        <p>Think you know it? Tap <b>Solve</b> and type the whole answer. Get it right and you bank this round's money (at least $1,000). Get it wrong and your turn ends.</p>`
    },
    {
      emoji: '🎮', title: 'Solo or together',
      html: `<p><b>Solo:</b> you get 3 strikes a round: a missing letter, a wrong answer, Bankrupt or Lose a Turn each cost one. Your total goes on the 🏆 board.</p>
        <p><b>2–4 players:</b> pass the phone. Only whoever solves keeps that round's money.</p>
        <p><b>Puzzles:</b> play everything, or pick one theme pack from the list. 💡 Suggest a theme to ask for a new one. Grown-ups can turn up the heat with Cheeky, Spicy or Filthy.</p>
        <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
    }
  ]);

  // ---- wiring ---------------------------------------------------------------------------

  $('addPlayerBtn').addEventListener('click', () => { if (S.names.length < 4) { S.names.push(''); renderNames(); } });
  for (const b of $('roundSeg').children) {
    b.addEventListener('click', () => {
      S.rounds = Number(b.dataset.rounds);
      for (const x of $('roundSeg').children) x.setAttribute('aria-pressed', String(x === b));
    });
  }
  $('goBtn').addEventListener('click', startGame);
  $('packSelect').addEventListener('change', () => { S.pack = $('packSelect').value; });
  $('suggestBtn').addEventListener('click', openRequest);
  $('reqSend').addEventListener('click', sendRequest);
  $('reqCancel').addEventListener('click', () => $('requestView').classList.add('hidden'));
  for (const b of $('scoreBoardSeg').children) b.addEventListener('click', () => openScores(null, b.dataset.board));
  $('spinBtn').addEventListener('click', spin);
  $('vowelBtn').addEventListener('click', () => openLetters('vowel'));
  $('solveBtn').addEventListener('click', openSolve);
  $('letterCancel').addEventListener('click', () => $('letterView').classList.add('hidden'));
  $('solveOk').addEventListener('click', trySolve);
  $('solveInput').addEventListener('keydown', e => { if (e.key === 'Enter') trySolve(); });
  $('solveCancel').addEventListener('click', () => $('solveView').classList.add('hidden'));
  $('nextRoundBtn').addEventListener('click', nextRound);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', backToSetup);
  $('quitBtn').addEventListener('click', () => { if (confirm('Leave this game?')) backToSetup(); });
  $('saveScoreBtn').addEventListener('click', saveScore);
  $('scoresBtn').addEventListener('click', () => openScores());
  $('scoresClose').addEventListener('click', () => $('scoresView').classList.add('hidden'));
  $('helpBtn').addEventListener('click', () => help.open());
  Blip.muteButton($('muteBtn'));
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overScore .ini')], saveScore);

  buildWheel();
  Host.setHost('vee');
  renderNames();
  loadConfig();
  help.autoOpen();
})();
