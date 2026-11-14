'use strict';

// Spin & Solve: spin the wheel, call a consonant, buy vowels, solve the
// phrase. Solo plays for the high-score board; 2-4 players share a phone.
//
// The game runs on the server (spinsolve/game.js), which spins the wheel,
// keeps the answer and decides every score. This page draws what it says:
// hidden letters come as _ on the board until the round is over.
//
// On a TV (tv.js), the game shows big and the remote is passed around: the
// arrows move between Spin, Buy a vowel and Solve and across the letters, OK
// presses, and solving uses a keyboard on the screen. Adult puzzles need an
// adults' night, never a PIN on the TV.

(() => {
  const { $, toast, api } = ArcadeKit;
  const TV = !!(window.ArcadeTV && ArcadeTV.on);
  const VOWELS = 'AEIOU';
  const VOWEL_COST = 250;
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
    names: [typeof ArcadeProfile !== 'undefined' && !TV ? ArcadeProfile.name() : '', ''], rounds: 3, players: [], cur: 0, round: 0, puzzle: null,
    used: new Set(), strikes: 0, wedge: null, busy: false, rotation: 0, run: null, state: null,
    config: null, level: 'kids', pack: 'all', banter: null,
    turnSecs: 45, timeLeft: 0, clock: null, idleSince: 0, jokedThisTurn: false, heckledThisRound: false, heckling: false,
    pin: TV ? '' : (() => { try { return sessionStorage.getItem('spin.adultPin') || ''; } catch { return ''; } })(),
    adultOk: !TV && (() => { try { return sessionStorage.getItem('spin.adultOk') === 'yes'; } catch { return false; } })()
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  const levelInfo = id => (S.config ? S.config.levels.find(l => l.id === id) : null) || { id: 'kids', label: 'Kids', adult: false, builtin: 0 };
  const isAdult = () => levelInfo(S.level).adult;
  // On a TV, adult puzzles follow adults' night, with the TV's adult pass.
  const unlocked = () => (TV ? ArcadeTV.adult() && !!S.pin : S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
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

  // An adult's ARKS ID adult pass, through the PIN pad.
  async function unlockOnTv() {
    S.pin = await ArcadeTV.adultPass();
    return !!S.pin;
  }

  function unlockAdult() {
    if (TV) return unlockOnTv();
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
        $('pinCancel').onclick = null;
        resolve(ok);
      };
      const tryPin = async pin => {
        try {
          const r = await api('/api/spinsolve/unlock', { pin });
          if (!r.ok) { $('pinMsg').textContent = 'Adult levels need an adult signed in with ARKS ID.'; PinPad.clear($('pinInput')); return; }
          S.pin = pin;
          try { sessionStorage.setItem('spin.adultPin', pin); } catch { /* unavailable */ }
          done(true);
        } catch (e) { $('pinMsg').textContent = e.message; PinPad.clear($('pinInput')); }
      };
      PinPad.attach($('pinInput'), tryPin);
      $('pinCancel').onclick = () => done(false);
    });
  }

  // The scores are a profile's when someone's signed in (never on a TV, which plays as a guest).
  const profileHeaders = () => {
    const t = !TV && typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null;
    return t ? { 'X-Profile-Token': t } : {};
  };
  // Every move goes to the game on the server. If the server no longer has it
  // (nobody touched it for a day, or the arcade restarted), the page forgets it
  // and goes back to the setup screen once the move that found out is done.
  const runApi = async (path, body) => {
    try { return await api(`/api/spinsolve/run/${S.run}${path}`, body, pinHeaders()); } catch (e) {
      if (e.status === 404 && S.run) {
        forgetRun();
        setTimeout(() => { if (!$('game').classList.contains('hidden')) backToSetup(); }, 0);
      }
      throw e;
    }
  };

  // ---- picking a game back up --------------------------------------------------------
  // The game is on the server, so the page only has to remember which one it's
  // in: on this device, for the profile playing or for a guest. A reload (what
  // a browser does to a page that sat behind a locked screen) then lands back
  // in the same game instead of on the setup screen. A TV plays as itself and
  // always starts fresh.
  const runKey = () => {
    const p = typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.get() : null;
    return `spin.run.${p && p.id ? p.id : 'guest'}`;
  };
  let rememberedAs = null;   // the key this game is remembered under
  function rememberRun() {
    if (TV || !S.run) return;
    rememberedAs = runKey();
    try { localStorage.setItem(rememberedAs, JSON.stringify({ id: S.run, turnSecs: S.turnSecs, pack: S.pack })); } catch { /* storage is off */ }
  }
  function forgetRun() {
    if (TV) return;
    try { localStorage.removeItem(rememberedAs || runKey()); } catch { /* storage is off */ }
    rememberedAs = null;
  }
  function rememberedRun() {
    if (TV) return null;
    try {
      const r = JSON.parse(localStorage.getItem(runKey()) || 'null');
      return r && /^[0-9a-f]{32}$/.test(String(r.id)) ? r : null;
    } catch { return null; }
  }

  // Asked once, when the page loads. -> true when a game came back.
  async function pickUpGame() {
    const saved = rememberedRun();
    if (!saved || !S.config) return false;
    rememberedAs = runKey();
    const ask = () => api(`/api/spinsolve/run/${saved.id}`, undefined, pinHeaders());
    // The server has no such game anymore: say so. An adult who doesn't unlock it:
    // forget it quietly. Anything else (no network) can be tried on the next load.
    const gone = e => {
      // Someone tapped Play while the answer was on its way: the new game is the one to keep.
      const now = rememberedRun();
      if (S.run || (now && now.id !== saved.id)) return false;
      if (e.status === 404) { forgetRun(); toast(e.message); } else if (e.status === 403) forgetRun();
      return false;
    };
    let got;
    try { got = await ask(); } catch (e) {
      // An adult game shows again only once an adult has unlocked it on this device.
      if (e.status !== 403 || !(await unlockAdult())) return gone(e);
      try { got = await ask(); } catch (again) { return gone(again); }
    }
    const st = got.state;
    // Someone tapped Play while the answer was on its way: the new game wins.
    if (S.run) return false;
    if (st.phase === 'over' && !st.canSave) { forgetRun(); return false; }
    S.run = saved.id;
    S.level = got.level || 'kids';
    S.banter = got.banter || null;
    const timer = [...$('timerSeg').children].find(b => Number(b.dataset.secs) === Number(saved.turnSecs));
    if (timer) timer.click();
    apply(st);
    document.documentElement.classList.toggle('adult-mode', isAdult());
    $('setup').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('overView').classList.add('hidden');
    if (st.phase === 'over') gameOver();
    else resumeRound();
    toast('Welcome back, your game is right where you left it.', 4000);
    // The setup screen's lists follow the game's level, and unlocking may have
    // brought the adult packs along, so they're read again.
    loadConfig().then(() => {
      if (![...$('packSelect').options].some(o => o.value === String(saved.pack))) return;
      S.pack = String(saved.pack);
      $('packSelect').value = S.pack;
    });
    return true;
  }

  // The round as the server has it: mid-turn, owing a letter, or already over.
  function resumeRound() {
    const st = S.state;
    const p = S.players[S.cur];
    S.wedge = null;
    S.busy = false;
    S.heckledThisRound = false;
    render();
    requestAnimationFrame(() => Host.home());
    if (st.phase === 'roundover') {
      const lost = solo() && S.strikes >= MAX_STRIKES;
      return showRound(lost ? '😵' : '🎉', lost ? 'Three strikes!' : `${p.name} solved it!`, lost ? 'This round banks nothing.' : '', 0);
    }
    if (st.phase === 'letter' && typeof st.wedge === 'number') {
      // The wheel had already stopped: the letter is still owed, with a full clock.
      S.wedge = st.wedge;
      showLanded(money(st.wedge));
      say(`${money(st.wedge)}! Pick a letter.`);
      return openLetters('consonant');
    }
    say(consonantsLeft() ? `${p.name}, your turn!` : 'No consonants left! Buy a vowel or solve.');
    resetTurn();
  }

  // The server's view of the game: the players, whose turn, the strikes, the
  // letters called, and the board with every hidden letter as _.
  function apply(st) {
    S.state = st;
    S.players = st.players;
    S.cur = st.cur;
    S.round = st.round;
    S.rounds = st.rounds;
    S.strikes = st.strikes;
    S.used = new Set(st.used);
    if (st.board) S.puzzle = { category: st.category, pack: st.pack, board: st.board, answer: st.answer || '' };
  }

  async function startGame() {
    if (window.ArcadeStats) ArcadeStats.play();
    Blip.unlock();
    try {
      const body = { names: S.names, rounds: S.rounds, ...(S.pack === 'all' ? { level: S.level } : { pack: S.pack }) };
      const got = await api('/api/spinsolve/run/start', body, { ...pinHeaders(), ...profileHeaders() });
      S.run = got.id;
      S.banter = got.banter;
      apply(got);
      rememberRun();
    } catch (e) { toast(e.message); return; }
    $('setup').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('overView').classList.add('hidden');
    beginRound();
  }

  async function nextRound() {
    $('roundView').classList.add('hidden');
    try { apply((await runApi('/next', {})).state); } catch (e) { toast(e.message); return; }
    beginRound();
  }

  function beginRound() {
    if (S.state.phase === 'over') return gameOver();
    S.wedge = null;
    S.heckledThisRound = false;
    render();
    say(`${S.players[S.cur].name}, spin the wheel!`);
    requestAnimationFrame(() => {
      Host.home();
      const host = Host.rotate();
      Host.pose('wave', 1500);
      Host.talk(pick(host.intro), 2200);
    });
    resetTurn();
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
    const rows = lines(S.puzzle.board);
    // Where each row starts in the answer, so a tile knows its place (data-pos)
    // when the server says which places a letter is in.
    const starts = [];
    let pos = 0;
    for (const line of rows) { starts.push(pos); pos += line.length + 1; }
    while (rows.length < 3) { const top = rows.length % 2 === 0; rows[top ? 'unshift' : 'push'](''); starts[top ? 'unshift' : 'push'](-1); }
    rows.forEach((line, r) => {
      const pad = Math.floor((COLS - line.length) / 2);
      for (let c = 0; c < COLS; c++) {
        const ch = line[c - pad];
        const tile = document.createElement('div');
        tile.style.setProperty('--i', board.children.length);
        if (ch === undefined || ch === ' ') tile.className = 'tile blank';
        else if (ch !== '_') {
          tile.className = 'tile shown' + (flash === ch ? ' flip' : '');
          tile.textContent = ch;
        } else {
          tile.className = 'tile covered';
          tile.dataset.pos = starts[r] + c - pad;
        }
        board.appendChild(tile);
      }
    });
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

  const consonantsLeft = () => !!(S.state && S.state.consonantsLeft);
  const vowelsLeft = () => !!(S.state && S.state.vowelsLeft);

  function render(flash) {
    renderBoard(flash);
    $('categoryLabel').textContent = S.puzzle.category;
    $('roundLabel').textContent = `Round ${S.round} of ${S.rounds}` + (S.puzzle.pack ? ` · ${S.puzzle.pack}` : '');
    $('strikes').textContent = solo() ? '❌'.repeat(S.strikes) + '⬜'.repeat(MAX_STRIKES - S.strikes) : '';
    renderPlayers();
    const p = S.players[S.cur];
    $('spinBtn').disabled = S.busy || !consonantsLeft();
    $('vowelBtn').disabled = S.busy || p.round < VOWEL_COST || !vowelsLeft();
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
    function talk(text, ms = 2000, punch = false) {
      voice();
      bubble.classList.toggle('punch', punch);
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
    vowel: ['Vowels are on me!', 'One vowel, coming up!'],
    timeup: ['Time\'s up!', 'Tick tock… too slow!', 'Buzzer! Out of time!']
  };

  // Lights up every hidden copy of a letter, one at a time, with Vee touching
  // each: a ding for every one, and the tile glows as it turns over.
  async function revealLetter(ch, positions) {
    const board = $('puzzleBoard');
    const tiles = positions.map(p => board.querySelector(`.tile.covered[data-pos="${p}"]`)).filter(Boolean);
    for (const [i, tile] of tiles.entries()) {
      await Host.walkTo(tile);
      Host.pose('touch');
      tile.classList.add('lit');
      Blip.ding(i);
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
      tile.textContent = S.puzzle.answer[Number(tile.dataset.pos)] || '';
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

  // The server spins; the wheel then turns to where it landed.
  async function spin() {
    if (S.busy) return;
    Blip.unlock();
    S.busy = true;
    render();
    let res;
    try { res = await runApi('/spin', {}); } catch (e) { S.busy = false; toast(e.message); render(); return; }
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
    const target = res.wedge;
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
        // The click of a peg passing the pointer, and the pointer kicking.
        Blip.tick();
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
        landed(res);
      }
    };
    requestAnimationFrame(frame);
  }

  // The big word over the wheel. Every sound in the game has one of these
  // (or a glow on the board) too, so it all works with the sound off. A
  // passing note (`ms`) clears itself.
  let landedTimer = null;
  function showLanded(text, bad = false, ms = 0) {
    clearTimeout(landedTimer);
    $('landed').innerHTML = '<span></span>';
    $('landed').firstChild.textContent = text;
    $('landed').classList.toggle('bad', bad);
    $('landed').classList.remove('hidden');
    if (ms) landedTimer = setTimeout(() => $('landed').classList.add('hidden'), ms);
  }
  // The board flashes red for the buzzer.
  function buzz(text) {
    Blip.buzzer();
    showLanded(text, true, 2200);
    const board = $('puzzleBoard');
    board.classList.remove('buzz');
    void board.offsetWidth;
    board.classList.add('buzz');
  }

  function landed(res) {
    const w = res.value;
    const p = S.players[S.cur];
    if (w === 'BANKRUPT') {
      showLanded('💸 BANKRUPT', true);
      Host.pose('oops', 1800);
      Host.talk(Host.line('bankrupt'));
      Blip.sting();
      S.busy = false;
      apply(res.state);
      return endTurn(`${p.name} went bankrupt!`, res);
    }
    if (w === 'LOSE A TURN') {
      showLanded('🙅 LOSE A TURN', true);
      Host.pose('oops', 1500);
      Host.talk(Host.line('lose'));
      Blip.tone([400, 200], 0.3, { type: 'square', volume: 0.08 });
      S.busy = false;
      apply(res.state);
      return endTurn(`${p.name} loses a turn.`, res);
    }
    apply(res.state);
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
    startClock(mode === 'vowel' ? 'vowel' : 'letter');
  }

  async function callLetter(ch) {
    const p = S.players[S.cur];
    stopClock();
    S.busy = true;
    let res;
    try { res = await runApi('/letter', { letter: ch, vowel: letterMode === 'vowel' }); } catch (e) { S.busy = false; toast(e.message); render(); return; }
    S.busy = false;
    const count = res.count;
    if (letterMode === 'vowel') Host.talk(Host.line('vowel'), 1200);
    $('landed').classList.add('hidden');
    if (!count) {
      apply(res.state);
      buzz(`✕ NO ${ch}`);
      Host.pose('oops', 1500);
      Host.talk(`${Host.line('miss')} No ${ch}.`);
      return endTurn(`No ${ch}. ${solo() ? 'Strike!' : 'Next player.'}`, res);
    }
    // Vee walks the wall lighting each one; the buttons wait until she's done.
    S.busy = true;
    if (!res.solved) S.players = res.state.players;
    S.used.add(ch);
    renderPlayers();
    $('spinBtn').disabled = $('vowelBtn').disabled = $('solveBtn').disabled = true;
    say(`${count} ${ch}${count > 1 ? '\'s' : ''}!`);
    await revealLetter(ch, res.positions);
    apply(res.state);
    S.busy = false;
    if (res.solved) return solved(res.won);
    Host.pose('cheer', 900);
    Host.talk(Host.line('hit', count), 1500);
    render();
    say(`${count} ${ch}${count > 1 ? '\'s' : ''}! ${p.name}, go again: spin, buy a vowel, or solve.`);
    if (!consonantsLeft()) say('No consonants left! Buy a vowel or solve.');
    resetTurn();
  }

  // After a miss of any kind; the server has already moved the turn on (or
  // counted the strike), and `res.lost` says the third strike ended the round.
  function endTurn(message, res = {}) {
    if (solo()) {
      render();
      if (res.lost) return roundLost();
      say(`${message} ${MAX_STRIKES - S.strikes} strike${MAX_STRIKES - S.strikes === 1 ? '' : 's'} left.`);
      resetTurn();
      maybeHeckle();
      return;
    }
    render();
    say(`${message} ${S.players[S.cur].name}, your turn!`);
    resetTurn();
    maybeHeckle();
  }

  // ---- the turn clock ---------------------------------------------------------------------
  // Like the TV show, there's no clock while you decide what to do (spin, buy
  // a vowel or solve), so nothing runs before your first spin. The clock runs
  // only when you owe an answer: once the wheel stops you have that long to
  // call a consonant, and the same to pick a vowel you're buying or to type
  // your answer when you solve. Running out passes the turn. It pauses while
  // the host lights up letters, behind a results screen, and while the page is
  // hidden (a locked screen, another app in front), so putting the device down
  // never burns a turn. Jokes and hecklers never stop it: they're just
  // entertainment while you think.

  const thinking = Blip.thinker();
  function resetTurn() {
    stopClock();
    S.idleSince = Date.now();
    S.jokedThisTurn = false;
  }
  // which: 'letter' (after a spin), 'vowel' or 'solve'.
  function startClock(which) {
    S.clock = which;
    S.timeLeft = S.turnSecs * 1000;
    thinking.reset();
    paintClock();
  }
  function stopClock() {
    S.clock = null;
    S.timeLeft = S.turnSecs * 1000;
    thinking.reset();
    $('turnTimer').classList.toggle('hidden', !S.turnSecs);
    paintClock();
  }

  const overlayOpen = id => !$(id).classList.contains('hidden');
  function clockPaused() {
    return document.hidden || $('game').classList.contains('hidden') || S.busy || help.isOpen ||
      overlayOpen('roundView') || overlayOpen('overView') || overlayOpen('scoresView');
  }

  const CLOCK_FOR = { letter: 'to call a letter', vowel: 'to pick a vowel', solve: 'to solve' };
  function paintClock(paused = false) {
    if (!S.turnSecs) return;
    const who = S.players[S.cur] ? S.players[S.cur].name : '';
    const secs = Math.ceil(S.timeLeft / 1000);
    $('ttFill').style.transform = `scaleX(${Math.max(0, S.timeLeft / (S.turnSecs * 1000))})`;
    $('ttText').textContent = S.clock
      ? `${paused ? '⏸' : '⏱'} ${secs}s ${CLOCK_FOR[S.clock]} · ${who}`
      : `${who}: spin, buy a vowel or solve`;
    $('turnTimer').classList.toggle('paused', paused || !S.clock);
    $('turnTimer').classList.toggle('warn', !!S.clock && secs <= 10);
  }

  // A page that isn't running (the screen locked, the browser put it to sleep)
  // misses its ticks, and the first one after it wakes would otherwise count
  // the whole gap. So a late tick counts for a second at most, and coming back
  // into view starts counting from that moment.
  const MAX_STEP = 1000;
  let lastTick = Date.now();
  const wake = () => { lastTick = Date.now(); S.idleSince = lastTick; };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pagehide', wake);
  window.addEventListener('pageshow', wake);
  setInterval(() => {
    const now = Date.now();
    const step = Math.min(Math.max(0, now - lastTick), MAX_STEP);
    lastTick = now;
    if (!S.puzzle || clockPaused()) {
      S.idleSince += step;
      if (S.puzzle && S.clock && (S.busy || document.hidden)) paintClock(true);
      return;
    }
    if (S.turnSecs && S.clock) {
      const before = Math.ceil(S.timeLeft / 1000);
      S.timeLeft -= step;
      const after = Math.ceil(S.timeLeft / 1000);
      // The thinking tune while the player decides (it pauses with the
      // clock), or quiet ticks at the end if the tune is turned off.
      if (Blip.tuneOn) thinking.step(S.timeLeft);
      else if (after !== before && after <= 5 && after > 0) Blip.tone(after <= 2 ? 1320 : 990, 0.05, { type: 'square', volume: 0.05 });
      paintClock();
      if (S.timeLeft <= 0) return timeUp();
    }
    // Nobody's done anything for a while: the host fills the silence.
    const letterOrSolveOpen = overlayOpen('letterView') || overlayOpen('solveView');
    if (!S.jokedThisTurn && !S.heckling && !letterOrSolveOpen && now - S.idleSince > 9000) {
      S.jokedThisTurn = true;
      tellJoke();
    }
  }, 250);

  async function timeUp() {
    S.timeLeft = 0;
    S.clock = null;
    $('letterView').classList.add('hidden');
    $('solveView').classList.add('hidden');
    S.wedge = null;
    buzz('⏰ TIME\'S UP');
    Host.pose('oops', 1500);
    Host.talk(Host.line('timeup'));
    let res = {};
    try { res = await runApi('/timeup', {}); apply(res.state); } catch (e) { toast(e.message); }
    endTurn('⏰ Time\'s up!', res);
  }

  // Any tap on the game counts as "doing something", so the host waits for a lull.
  document.addEventListener('pointerdown', () => { S.idleSince = Date.now(); }, true);

  // ---- jokes and hecklers -----------------------------------------------------------------

  async function tellJoke() {
    const jokes = S.banter && S.banter.jokes;
    if (!jokes || !jokes.length) return;
    const [setup, punch] = pick(jokes);
    const beeper = $('host').dataset.host === 'bleep';
    // Each line stays up long enough to read at a relaxed pace.
    Host.talk(beeper ? `Bwee-doo? (${setup})` : setup, ArcadeKit.readMs(setup) + 400);
    await wait(ArcadeKit.readMs(setup));
    if (clockPaused()) return;
    Host.talk(beeper ? `Dweet! (${punch})` : punch, ArcadeKit.readMs(punch) + 1000, true);
    Host.pose('cheer', 900);
    // Ba-dum-tss.
    Blip.tone(150, 0.08, { type: 'sine', volume: 0.12 });
    Blip.tone(150, 0.08, { type: 'sine', volume: 0.12, delay: 0.14 });
    setTimeout(() => Blip.noise(0.35, 0.08), 330);
  }

  // Once a round, sometimes, between turns.
  function maybeHeckle() {
    if (S.heckledThisRound || !S.banter || Math.random() > 0.4) return;
    S.heckledThisRound = true;
    setTimeout(heckle, 1400);
  }

  async function heckle() {
    if (clockPaused() || S.heckling || overlayOpen('letterView') || overlayOpen('solveView')) return;
    const hostEl = $('host');
    const hostId = hostEl.dataset.host;
    const hostName = SPIN_HOSTS[hostId].name;
    const others = Object.keys(SPIN_HOSTS).filter(id => id !== hostId);
    const id = pick(others);
    const h = $('heckler');
    const lane = $('hostLane');
    // Come in from whichever side the host isn't on.
    const hostX = hostEl.getBoundingClientRect().left - lane.getBoundingClientRect().left;
    const fromLeft = hostX > lane.clientWidth / 2;
    const offstage = fromLeft ? -80 : lane.clientWidth + 30;
    const stop = fromLeft ? Math.max(0, hostX - 110) : Math.min(lane.clientWidth - 52, hostX + 110);
    S.heckling = true;
    $('hecklerArt').innerHTML = SPIN_HOSTS[id].svg;
    h.dataset.host = id;
    h.style.transition = 'none';
    h.style.transform = `translateX(${offstage}px)`;
    h.classList.remove('hidden');
    $('hecklerSay').classList.toggle('left', !fromLeft);
    h.getBoundingClientRect();
    h.style.transition = '';
    h.style.transform = `translateX(${stop}px)`;
    Blip.tone([200, 900], 0.3, { type: 'sawtooth', volume: 0.04 });
    await wait(600);
    h.dataset.pose = 'point';
    const say = $('hecklerSay');
    say.textContent = pick(S.banter.heckles).replace(/\{host\}/g, hostName);
    say.classList.add('show');
    await wait(ArcadeKit.readMs(say.textContent));
    say.classList.remove('show');
    // The comeback, with a gesture popping up over the host's head.
    const comeback = pick(S.banter.comebacks);
    const gesture = [...comeback][0];
    const text = comeback.slice(gesture.length).trim();
    Host.pose(gesture === '🖕' || gesture === '✋' ? 'point' : 'oops', 1800);
    const g = $('hostGesture');
    g.textContent = gesture;
    g.classList.remove('show');
    void g.offsetWidth;
    g.classList.add('show');
    Host.talk(text, ArcadeKit.readMs(text) + 600);
    await wait(ArcadeKit.readMs(text));
    h.dataset.pose = 'oops';
    await wait(500);
    h.style.transform = `translateX(${offstage}px)`;
    Blip.tone([900, 200], 0.3, { type: 'sawtooth', volume: 0.04 });
    await wait(600);
    h.classList.add('hidden');
    h.dataset.pose = 'idle';
    S.heckling = false;
    S.idleSince = Date.now();
  }

  // ---- solving --------------------------------------------------------------------------

  function openSolve() {
    $('solveCategory').textContent = S.puzzle.category;
    $('solveInput').value = '';
    $('solveMsg').textContent = '';
    $('solveView').classList.remove('hidden');
    startClock('solve');
    // On a TV the answer is typed on the keyboard on the screen, with the remote.
    if (TV) { const first = $('solveKeys').querySelector('button'); if (first) first.focus(); } else $('solveInput').focus();
  }
  // The keyboard on the screen for solving on a TV: the letters, a space and ⌫.
  function buildSolveKeys() {
    const box = $('solveKeys');
    for (const row of ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ', [' ', '⌫']]) {
      const r = document.createElement('div');
      r.className = 'row';
      for (const k of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = k === ' ' ? 'Space' : k;
        b.className = k.length > 1 || k === ' ' || k === '⌫' ? 'wide' : '';
        b.setAttribute('aria-label', k === ' ' ? 'Space' : k === '⌫' ? 'Erase' : k);
        b.addEventListener('click', () => {
          const input = $('solveInput');
          input.value = k === '⌫' ? input.value.slice(0, -1) : (input.value + k).slice(0, 80);
          $('solveMsg').textContent = '';
        });
        r.appendChild(b);
      }
      box.appendChild(r);
    }
  }

  async function trySolve() {
    const guess = letters($('solveInput').value.toUpperCase());
    if (!guess) { $('solveMsg').textContent = 'Type your answer first.'; return; }
    $('solveView').classList.add('hidden');
    stopClock();
    let res;
    try { res = await runApi('/solve', { guess }); } catch (e) { toast(e.message); return; }
    apply(res.state);
    if (res.correct) return solved(res.won);
    buzz('✕ NOT QUITE');
    Host.pose('oops', 1500);
    Host.talk(Host.line('wrong'));
    endTurn('Not quite!', res);
  }

  // The server banked `won` for whoever's turn it is; the board still shows
  // what was hidden, and the whole answer sweeps in.
  async function solved(won) {
    const p = S.players[S.cur];
    S.busy = true;
    renderPlayers();
    Host.talk(Host.line('solved'), 2600);
    Blip.fanfare();
    showLanded('🎉 SOLVED!', false, 2600);
    await revealAll();
    S.busy = false;
    showRound('🎉', `${p.name} solved it!`, `+${money(won)}`, 1400);
  }

  function roundLost() {
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
    const canSave = !!S.state.canSave;
    // Nothing left to come back for, unless there's a score still to save.
    if (!canSave) forgetRun();
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
      // The server saves the total it worked out; the page only says who.
      const r = await api(`/api/spinsolve/run/${S.run}/save`, { initials: who }, { ...pinHeaders(), ...profileHeaders() });
      initials.remember(who);
      forgetRun();
      $('overScore').classList.add('hidden');
      openScores(r.id);
      toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
    } catch (e) {
      $('scoreMsg').textContent = e.message;
      $('saveScoreBtn').disabled = false;
    }
  }

  function openScores(highlightId, board = isAdult() ? 'adult' : 'solo') {
    // Both boards are open to everyone; only playing the adult level needs the PIN.
    $('scoreBoardSeg').classList.remove('hidden');
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
    // Leaving on purpose: there's no game to come back to.
    forgetRun();
    S.puzzle = null;
    S.run = null;
    $('overView').classList.add('hidden');
    $('roundView').classList.add('hidden');
    $('game').classList.add('hidden');
    $('setup').classList.remove('hidden');
  }

  // Back: from a game (or its results) to the setup screen, asking first
  // while the game's going, and from there to the arcade.
  ArcadeBack.setup({
    atMenu: () => !$('setup').classList.contains('hidden'),
    back: backToSetup,
    busy: () => !$('game').classList.contains('hidden') && $('overView').classList.contains('hidden')
  });

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
        <p>If it isn't there, you hear the buzzer and your turn ends. On your turn you can spin, buy a vowel or solve, in any order, as long as you keep finding letters.</p>`
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
      html: `<p><b>Buy a vowel</b> for $250 of this round's money. It shows every A, E, I, O or U you pick, but earns nothing, and if the vowel isn't there your turn ends.</p>
        <p>Think you know it? Tap <b>Solve</b> and type the whole answer. Get it right and you bank this round's money (at least $1,000). Get it wrong and your turn ends.</p>`
    },
    {
      emoji: '🎮', title: 'Solo or together',
      html: `<p><b>Solo:</b> you get 3 strikes a round: a missing letter, a wrong answer, Bankrupt or Lose a Turn each cost one. Your total goes on the 🏆 board.</p>
        <p><b>2–4 players:</b> pass the device. Only whoever solves keeps that round's money.</p>
        <p><b>Turn timer:</b> pick 30 to 90 seconds (or Off) in setup. Like on the TV show, nothing ticks while you decide whether to spin, buy a vowel or solve. The clock starts once the wheel stops (to call a letter), when you buy a vowel, and when you tap Solve. Run out and your turn passes.</p>
        <p><b>Sound off?</b> Everything you'd hear also shows: letters light up, a wrong letter flashes the board red with a big ✕, and Bankrupt, Lose a Turn and Solved show up over the wheel.</p>
        <p><b>Puzzles:</b> play everything, or pick one theme pack from the list. 💡 Suggest a theme to ask for a new one. Adults can turn up the heat with Cheeky, Spicy or Filthy.</p>
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
  for (const b of $('timerSeg').children) {
    b.addEventListener('click', () => {
      S.turnSecs = Number(b.dataset.secs);
      for (const x of $('timerSeg').children) x.setAttribute('aria-pressed', String(x === b));
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
  $('letterCancel').addEventListener('click', () => { $('letterView').classList.add('hidden'); stopClock(); });
  $('solveOk').addEventListener('click', trySolve);
  $('solveInput').addEventListener('keydown', e => { if (e.key === 'Enter') trySolve(); });
  $('solveCancel').addEventListener('click', () => { $('solveView').classList.add('hidden'); stopClock(); });
  $('nextRoundBtn').addEventListener('click', nextRound);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', backToSetup);
  $('quitBtn').addEventListener('click', async () => { if (await ArcadeBack.ask('Leave this game?')) backToSetup(); });
  $('setupMenuBtn').addEventListener('click', () => $('quitBtn').click());
  if (TV) {
    buildSolveKeys();
    // Typing on a TV pops up its own keyboard over everything; the one on the screen is easier.
    $('solveInput').readOnly = true;
    // A spin on the TV counts as a game being played (adults' night keeps going).
    $('spinBtn').addEventListener('click', () => ArcadeTV.played());
    // During a game the puzzle stays in sight under the top bar, whichever
    // button the highlight is on.
    document.addEventListener('focusin', () => requestAnimationFrame(() => {
      if ($('game').classList.contains('hidden') || !document.activeElement.closest('#game')) return;
      const bar = document.querySelector('.ah');
      const top = Math.max(0, $('game').getBoundingClientRect().top + window.scrollY - (bar ? bar.getBoundingClientRect().bottom : 0) - 8);
      // Only if the button the highlight is on stays clear of the bar at the bottom.
      const below = document.activeElement.getBoundingClientRect().bottom + window.scrollY - top;
      if (below < window.innerHeight - 110) window.scrollTo({ top });
    }));
    // Adults' night ended (Back to family, or it ran out): family puzzles at once.
    document.addEventListener('arcadetv:mode', e => {
      if (e.detail.adult) return;
      S.pin = '';
      if (isAdult()) {
        if (S.puzzle) { backToSetup(); toast('Back to family mode.'); }
        S.level = 'kids';
        S.pack = 'all';
      }
      loadConfig();
    });
  }
  $('saveScoreBtn').addEventListener('click', saveScore);
  $('scoresBtn').addEventListener('click', () => openScores());
  $('scoresClose').addEventListener('click', () => $('scoresView').classList.add('hidden'));
  $('helpBtn').addEventListener('click', () => help.open());
  Blip.muteButton($('muteBtn'));
  Blip.tuneButton($('tuneBtn'));
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overScore .ini')], saveScore);

  buildWheel();
  Host.setHost('vee');
  renderNames();
  // Once the levels are known: a game this page was in the middle of comes back.
  loadConfig().then(pickUpGame);
  // On a TV, How to play waits for the ? button instead of opening by itself.
  if (!TV) help.autoOpen();
})();
