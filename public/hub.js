'use strict';

// The arcade's front door: its name, the Comm Center, feedback, and a pile of
// gaming-culture Easter eggs for whoever goes poking around.

(() => {
  const $ = id => document.getElementById(id);
  const GAMES = {
    wordless: { label: 'Wordless', href: 'wordless.html' },
    rambler: { label: 'Rambler', href: 'rambler.html' },
    spinsolve: { label: 'Spin & Solve', href: 'spinsolve.html' },
    chess: { label: 'Chess', href: 'chess.html' },
    dino: { label: 'Dino Dash', href: 'dino.html' },
    trivia: { label: 'Know-It-All', href: 'trivia.html' },
    partdeux: { label: 'Uh-Oh: Part Deux', href: 'partdeux.html' },
    daredevil: { label: 'Dare Devil', href: 'daredevil.html' },
    snake: { label: 'Snake', href: 'snake.html' },
    bricks: { label: 'Brick Breaker', href: 'bricks.html' },
    blocks: { label: 'Block Drop', href: 'blocks.html' },
    towers: { label: 'Tower Defense', href: 'towers.html' }
  };

  // ---- who's playing ---------------------------------------------------------
  function paintChip() {
    const chip = $('playerChip');
    const p = ArcadeProfile.get();
    chip.innerHTML = '';
    chip.appendChild(ArcadeProfile.avatarEl(p ? p.avatar : 'emoji:👤', 26));
    const label = document.createElement('span');
    label.textContent = p ? p.name : 'Who\'s playing?';
    chip.title = p ? `Playing as ${p.name}. Tap to switch.` : 'Pick who is playing';
    chip.appendChild(label);
    chip.insertAdjacentHTML('beforeend', '<small>▾</small>');
  }
  $('playerChip').onclick = () => ArcadeProfile.open();
  ArcadeProfile.onChange(paintChip);
  paintChip();
  // First visit on this device: ask. With ARKS ID on, wait until it has said
  // who's signed in, so someone just back from signing in isn't asked again.
  ArcadeProfile.arksId().ready.then(() => {
    if (!ArcadeProfile.get()) setTimeout(() => ArcadeProfile.open(), 600);
  });

  // ---- join a game -----------------------------------------------------------
  // Every room being hosted anywhere in the arcade, refreshed every few seconds.
  const STATUS = { open: 'Join', playing: 'Playing now', full: 'Full' };

  async function loadLobby() {
    try {
      const { rooms } = await (await fetch('/api/lobby')).json();
      const list = $('lobbyList');
      list.innerHTML = '';
      for (const r of rooms) {
        const li = document.createElement('li');
        li.className = r.status;
        li.innerHTML = '<span class="l-emoji"></span><span class="l-main"><div class="l-title"></div><div class="l-sub"></div></span><a class="l-join"></a>';
        if (r.icon) {
          const img = document.createElement('img');
          img.src = r.icon;
          img.alt = '';
          img.style.cssText = 'width:26px;height:26px;display:block';
          li.querySelector('.l-emoji').appendChild(img);
        } else li.querySelector('.l-emoji').textContent = r.emoji;
        li.querySelector('.l-title').textContent = `${r.adult ? '🔞 ' : ''}${r.label} · ${r.host || 'someone'}'s game${r.locked ? ' 🔒' : ''}`;
        li.querySelector('.l-sub').textContent = `Code ${r.code} · ${r.players}/${r.max} players · ${r.detail}${r.status === 'playing' ? ' · game in progress' : ''}`;
        const join = li.querySelector('.l-join');
        join.textContent = STATUS[r.status];
        if (r.status === 'open') join.href = r.href;
        else join.classList.add('off');
        list.appendChild(li);
      }
      // With nobody hosting there's nothing to show, so the LIVE pill stays out of the bar.
      $('liveN').textContent = rooms.length;
      $('liveDock').classList.toggle('hidden', !rooms.length);
      $('lobbyEmpty').classList.toggle('hidden', rooms.length > 0);
      const open = rooms.filter(r => r.status === 'open').length;
      if (rooms.length && !open) $('lobbyEmpty').classList.remove('hidden');
      $('lobbyEmpty').innerHTML = rooms.length && !open
        ? 'Those games are full or already going. Pick a game below and choose <b>Host</b> to start your own.'
        : 'Nobody\'s hosting right now. Pick a game below and choose <b>Host</b> to start one; it shows up here for everyone.';
    } catch { /* the server's away; try again shortly */ }
  }
  loadLobby();

  // ---- the sticky top bar -----------------------------------------------------
  // It shrinks once you scroll, and the footer logo fades in at the bottom
  // (dock.js). While anyone is hosting, a LIVE pill fades into the bar as the
  // lobby scrolls away; tapping it scrolls back up to the lobby.
  const liveDock = $('liveDock');
  Dock.header(document.querySelector('.top-bar'));
  Dock.catch($('lobby'), [liveDock]);
  Dock.chin($('chin'));
  liveDock.addEventListener('click', () => $('lobby').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  setInterval(() => { if (!document.hidden) loadLobby(); }, 5000);

  $('qrToggle').onclick = () => {
    const card = $('qrCard');
    const opening = card.classList.contains('hidden');
    card.classList.toggle('hidden', !opening);
    $('qrToggle').setAttribute('aria-expanded', String(opening));
    if (opening) ArcadeQR.show($('arcadeQr'), $('qrTarget').value, $('arcadeLink'));
  };
  $('qrTarget').onchange = () => ArcadeQR.show($('arcadeQr'), $('qrTarget').value, $('arcadeLink'));

  // ---- the arcade's name --------------------------------------------------
  // ARCADE_NAME in .env: "Smith" makes this the Smith Arcade. Blank is just Arcade.
  fetch('/api/arcade-info').then(r => r.json()).then(info => {
    const name = (info.name || '').trim();
    $('arcadeName').textContent = name ? name + ' ' : '';
    document.title = name ? `${name} Arcade` : 'Arcade';
    // The admin page decides which games show. The order is the admin's,
    // unless sorting by most played is on (the default).
    if (!info.games) return;
    homeGames = info.games;
    placeGames(homeGames.order);
    sortByPlayed();
  }).catch(() => {});

  let homeGames = null;
  function placeGames(order) {
    const list = document.querySelector('.games');
    if (!list) return;
    for (const id of order) {
      const card = list.querySelector(`.game.${id}`);
      if (!card) continue;
      list.appendChild(card);
      card.classList.toggle('hidden', homeGames.hidden.includes(id));
      closeGame(card, id, (homeGames.closed || []).includes(id));
    }
  }
  // A game the admin turned off keeps its spot, faded, with the sign on it.
  // Tapping it explains instead of opening a half-working game.
  function closeGame(card, id, closed) {
    card.classList.toggle('closed', closed);
    card.toggleAttribute('aria-disabled', closed);
    const sign = card.querySelector('.dust-sign');
    if (closed && !sign) card.appendChild(DustSign.el());
    if (!closed && sign) sign.remove();
    card.onclick = closed ? e => { e.preventDefault(); toast(DustSign.message(id), 3200); } : null;
  }
  // Your most-played games first; everyone's favorites if you haven't
  // picked a profile or haven't played much yet.
  async function sortByPlayed() {
    if (!homeGames || homeGames.sort !== 'played') return;
    try {
      const res = await fetch('/api/stats/game-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ArcadeProfile.token() })
      });
      if (res.ok) placeGames((await res.json()).order);
    } catch { /* keep the admin's order */ }
  }
  ArcadeProfile.onChange(sortByPlayed);

  // ---- Comm Center ----------------------------------------------------------

  // SQLite stores UTC without a zone marker.
  const parseWhen = iso => new Date(String(iso).replace(' ', 'T') + 'Z');

  function ago(iso) {
    const s = Math.max(0, (Date.now() - parseWhen(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
    return parseWhen(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const TAGS = { highscore: 'High score', theme: 'New theme', announcement: 'News' };

  async function loadFeed() {
    const host = $('commFeed');
    try {
      const posts = await fetch('/api/comm/posts?limit=8').then(r => r.json());
      host.innerHTML = '';
      if (!posts.length) {
        host.innerHTML = '<li class="comm-empty">All quiet on the server. Go set a high score.</li>';
        return;
      }
      for (const p of posts) {
        const li = document.createElement('li');
        li.innerHTML = `<button type="button"><span class="post-emoji"></span>
          <span class="post-main"><div class="post-title"></div><div class="post-meta"></div></span>
          <span class="post-tag"></span></button>`;
        li.querySelector('.post-emoji').textContent = p.emoji;
        li.querySelector('.post-title').textContent = p.title;
        li.querySelector('.post-meta').textContent = ago(p.createdAt);
        li.querySelector('.post-tag').textContent = TAGS[p.kind] || '';
        li.querySelector('button').onclick = () => openPost(p);
        host.appendChild(li);
      }
    } catch {
      host.innerHTML = '<li class="comm-empty">Comm link down. Try again in a bit.</li>';
    }
  }

  function openPost(p) {
    $('postEmoji').textContent = p.emoji;
    $('postTitle').textContent = p.title;
    $('postWhen').textContent = parseWhen(p.createdAt).toLocaleString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('postBody').textContent = p.body || '';
    const game = GAMES[p.game];
    $('postPlay').classList.toggle('hidden', !game);
    if (game) {
      $('postPlay').href = game.href;
      $('postPlay').textContent = `▶ Play ${game.label}`;
    }
    $('postModal').classList.remove('hidden');
    $('postClose').focus();
  }

  // ---- Easter eggs ----------------------------------------------------------

  const QUOTES = [
    "It's dangerous to go alone! Take this. 🗡️",
    'The cake is a lie.',
    'All your base are belong to us.',
    'Thank you Mario! But our princess is in another castle.',
    'Hey! Listen!',
    'Stay a while and listen.',
    'War. War never changes.',
    'Would you kindly… play a round?',
    'Press F to pay respects.',
    'Snake? Snake?! SNAAAKE!',
    'Leeroy Jenkins!',
    'You have died of dysentery.',
    'A winner is you!',
    'Do a barrel roll!',
    'Praise the sun! \\[T]/',
    'Finish him!',
    'Achievement unlocked: opened the arcade.',
    'Wake up, Samurai.',
    'Get over here!',
    'Hadouken!'
  ];

  function rotateQuotes() {
    const el = $('quote');
    let i = Math.floor(Math.random() * QUOTES.length);
    const show = () => {
      el.style.opacity = 0;
      setTimeout(() => { el.textContent = QUOTES[i]; el.style.opacity = 1; i = (i + 1) % QUOTES.length; }, 400);
    };
    show();
    setInterval(show, 9000);
  }

  let toastTimer = null;
  function toast(text, ms = 2600) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function rain(emojis, count = 40) {
    if (reduced) return;
    for (let n = 0; n < count; n++) {
      const d = document.createElement('div');
      d.className = 'rain';
      d.textContent = emojis[n % emojis.length];
      d.style.left = Math.random() * 100 + 'vw';
      d.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
      d.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 4500);
    }
  }

  function bodyEffect(cls, ms) {
    document.body.classList.remove(cls);
    void document.body.offsetWidth;   // restart the animation if it is already running
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), ms);
  }

  // Commands work from the Cheat codes box (so phones get them too) or typed
  // anywhere on the page with a keyboard. The owner's clips (custom-media.js)
  // each become a command too: rickroll.mp4 plays with /rickroll.
  const COMMANDS = {
    '/help': () => $('helpModal').classList.remove('hidden'),
    '/secret': () => toggleCheatList(),
    '/feedback': () => ArcadeFeedback.open(),
    '/dance': () => { bodyEffect('dancing', 4000); toast('💃 /dance 🕺'); },
    '/gg': () => { rain(['🤝', 'GG', '🏆', '✨']); toast('GG WP 🤝'); },
    '/glhf': () => { rain(['🍀', '🎮', '✨']); toast('Good luck, have fun! 🍀'); },
    '/roll': () => toast(`🎲 You rolled a ${1 + Math.floor(Math.random() * 20)} (d20)`),
    '/respawn': () => { location.reload(); },
    '/afk': () => toast('brb… 🚽'),
    '/wave': () => toast('👋 o/'),
    '/flex': () => toast('💪 Flexing on the leaderboard.'),
    '/f': () => { rain(['🫡'], 20); toast('Respects paid. 🫡'); },
    // the secrets
    'gg': () => { rain(['🤝', 'GG', '🏆', '✨']); toast('GG WP 🤝'); },
    'iddqd': () => toast('😇 God mode enabled. (It does nothing. You were already a god.)', 3500),
    'idkfa': () => toast('🔫 All weapons and keys. Still have to find the words yourself.', 3500),
    'xyzzy': () => toast('A hollow voice says "Plugh."'),
    'hesoyam': () => { rain(['💵', '❤️', '🛡️']); toast('Health, armor, $250,000. 💵'); },
    'barrelroll': () => { bodyEffect('barrel', 1300); toast('🛩️ Do a barrel roll!'); },
    'thecakeisalie': () => { rain(['🍰']); toast('🍰 …it really was.'); },
    'leeroy': () => toast('LEEEEROOOOY JENKIIIINS! 🐔', 3000),
    'rickroll': () => ArcadeMedia.play('rickroll') || toast('🎵 Never gonna give you up… 🎵', 3500)
  };
  // What /secret lists. The true secrets above stay off the list.
  const LISTED = [
    ['/dance', 'Everything dances'], ['/gg', 'Good game!'], ['/glhf', 'Good luck, have fun'],
    ['/roll', 'Roll a 20-sided die'], ['/f', 'Pay respects'], ['/wave', 'Say hi'],
    ['/flex', 'Show off'], ['/afk', 'Be right back'], ['/respawn', 'Start the page over'],
    ['/feedback', 'Tell us about a bug or an idea']
  ];
  function toggleCheatList() {
    const ul = $('cheatList');
    if (!ul.children.length) {
      for (const [cmd, what] of LISTED) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<b></b><span></span>';
        b.firstChild.textContent = cmd;
        b.lastChild.textContent = what;
        b.onclick = () => runCommand(cmd);
        li.appendChild(b);
        ul.appendChild(li);
      }
    }
    ul.classList.toggle('hidden');
    if (!ul.classList.contains('hidden')) toast('Psst… a few more aren\'t on the list. 🤫', 3000);
  }
  // Typed-anywhere triggers, checked against the end of what was typed.
  const TYPED = ['gg', 'iddqd', 'idkfa', 'xyzzy', 'hesoyam', 'barrelroll', 'thecakeisalie', 'leeroy', 'rickroll',
    '/dance', '/gg', '/glhf', '/help', '/roll', '/afk', '/wave', '/flex', '/feedback'];

  function runCommand(raw) {
    const cmd = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (COMMANDS[cmd]) { COMMANDS[cmd](); return true; }
    return ArcadeMedia.play(cmd.replace(/^\//, ''));
  }

  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let keys = [];
  let typed = '';

  function onKey(e) {
    if (e.target.closest('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();

    keys = [...keys, k].slice(-KONAMI.length);
    if (keys.join() === KONAMI.join()) {
      keys = [];
      $('arcadeTitle').classList.add('rainbow');
      rain(['❤️', '⭐', '🍄']);
      toast('↑↑↓↓←→←→BA — 30 extra lives! 🍄', 3500);
      return;
    }

    if (k.length !== 1) return;
    typed = (typed + k).slice(-20);
    // Longest match first, so "/gg" is not swallowed by "gg".
    const hit = TYPED.filter(c => typed.endsWith(c)).sort((a, b) => b.length - a.length)[0];
    if (hit) { typed = ''; runCommand(hit); }
  }

  // Five quick taps on the title.
  let taps = [];
  function onTitleTap() {
    const now = Date.now();
    taps = [...taps.filter(t => now - t < 1500), now];
    if (taps.length >= 5) {
      taps = [];
      rain(['🏅']);
      toast('🏅 Achievement unlocked: Button Masher', 3000);
    }
  }

  // ---- the owner's logos (brand/ folder on their server) -------------------
  // With all three files, the title becomes the logo lockup and the square
  // logo spins in the footer. Without them, the plain title stays.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function showBrand(brand) {
    if (brand.avatar && brand.wide) {
      const box = $('lockup');
      const helm = document.createElement('img');
      helm.className = 'helm'; helm.src = brand.avatar; helm.alt = '';
      const wide = document.createElement('img');
      wide.className = 'wide'; wide.src = brand.wide; wide.alt = 'ARKS';
      box.append(helm, wide, titleWord('ARCADE'));
      box.classList.remove('hidden');
      $('arcadeTitle').classList.add('hidden');
      document.fonts.load('800 20px Orbitron').then(fitTitleWord, fitTitleWord);
    }
    if (brand.square) {
      const img = document.createElement('img');
      img.className = 'spin-turn'; img.src = brand.square; img.alt = 'ARKS';
      $('footLogo').appendChild(img);
      $('footLogo').classList.remove('hidden');
    }
  }
  // The app's name as a see-through outline in the logo's pink-to-turquoise
  // blend, drawn on the logo's own 445-unit-tall canvas so its capitals sit
  // exactly where the logo's letters do (136.5 to 308.6).
  function titleWord(text) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'word');
    svg.setAttribute('viewBox', '0 0 900 445');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', text);
    svg.innerHTML = '<defs><linearGradient id="titleBlend" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff2ec4"/>' +
      '<stop offset=".5" stop-color="#8a3ffc"/><stop offset="1" stop-color="#00ffc2"/></linearGradient></defs>' +
      '<text x="0" y="308.6" fill="none" stroke="url(#titleBlend)" stroke-width="1.3" vector-effect="non-scaling-stroke"></text>';
    svg.querySelector('text').textContent = text;
    return svg;
  }
  function fitTitleWord() {
    const t = document.querySelector('.lockup .word text');
    if (!t) return;
    const c = document.createElement('canvas').getContext('2d');
    c.font = '800 1000px Orbitron';
    const m = c.measureText(t.textContent);
    const size = (308.6 - 136.5) / ((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 1000);
    t.setAttribute('font-size', size.toFixed(1));
    t.setAttribute('y', (308.6 - m.actualBoundingBoxDescent * size / 1000).toFixed(1));
    const b = t.getBBox();
    t.ownerSVGElement.setAttribute('viewBox', `${b.x} 0 ${b.width} 445`);
  }

  // ---- clickable characters --------------------------------------------------
  // Little pixel friends on the wall (in the Cheat codes box on a phone). Each
  // one runs a command. Pictures in the owner's media/sprites folder take their
  // place; one named after a command (dance-hero.gif) always runs it.
  const PAL = { G: '#3ddc84', W: '#ffffff', K: '#12111c', R: '#ff5e8a', A: '#ffc72c', B: '#8fa3c7', Y: '#2e9bff', P: '#c86bff', S: '#c9d1e0', O: '#ff8a3d' };
  const PIXEL_FRIENDS = [
    { name: 'Slime', cmd: '/dance', px: ['....GGGG....', '...GGGGGG...', '..GGGGGGGG..', '.GGWKGGWKGG.', '.GGKKGGKKGG.', 'GGGGGGGGGGGG', 'GGGGGRRGGGGG', 'GGGGGGGGGGGG', '.GGGGGGGGGG.', '..GG.GG.GG..'] },
    { name: 'Robot', cmd: '/roll', px: ['....AAAA....', '.....AA.....', '..BBBBBBBB..', '..BWWBBWWB..', '..BWKBBWKB..', '..BBBBBBBB..', '..BBYYYYBB..', '...BBBBBB...', '.BBBBBBBBBB.', '.B.BBBBBB.B.', '...BB..BB...', '...BB..BB...'] },
    { name: 'Bat', cmd: '/gg', px: ['PP........PP', 'PPP..PP..PPP', 'PPPPPPPPPPPP', '.PPPWPPWPPP.', '..PPPPPPPP..', '...P.PP.P...'] },
    { name: 'Knight', cmd: '/glhf', px: ['....SSSS....', '...SSSSSS...', '...SKKKKS...', '...SSSSSS...', '....OOOO....', '..OOOOOOOO..', '.O.OOOOOO.O.', '.S.OOOOOO.S.', '...OO..OO...', '...KK..KK...'] }
  ];
  const RANDOM_CMDS = ['/dance', '/gg', '/glhf', '/roll', '/f', '/wave', '/flex'];
  function pixelSvg(px) {
    const w = px[0].length, h = px.length, n = Math.max(w, h);
    let rects = '';
    px.forEach((row, y) => [...row].forEach((ch, x) => {
      if (PAL[ch]) rects += `<rect x="${x}" y="${y + n - h}" width="1.02" height="1.02" fill="${PAL[ch]}"/>`;
    }));
    return `<svg viewBox="0 0 ${n} ${n}" width="100%" height="100%" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }
  function friendButton(f) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pal';
    b.title = f.name;
    b.setAttribute('aria-label', `${f.name}: ${f.cmd}`);
    if (f.url) { const img = document.createElement('img'); img.src = f.url; img.alt = ''; b.appendChild(img); }
    else b.innerHTML = pixelSvg(f.px);
    b.onclick = () => { b.classList.remove('hop'); void b.offsetWidth; b.classList.add('hop'); runCommand(f.cmd); };
    return b;
  }
  function placeCharacters(sprites) {
    const friends = sprites.length
      ? sprites.slice(0, 6).map((sp, i) => {
        const named = '/' + sp.name.split(/[-_]/)[0];
        return { name: sp.name, url: sp.url, cmd: COMMANDS[named] ? named : RANDOM_CMDS[i % RANDOM_CMDS.length] };
      })
      : PIXEL_FRIENDS;
    const wall = document.createElement('div');
    wall.className = 'wall';
    document.body.appendChild(wall);
    friends.forEach((f, i) => {
      const b = friendButton(f);
      b.style.left = i % 2 ? 'calc(50% + 395px)' : 'calc(50% - 455px)';
      b.style.top = `${330 + i * 320}px`;
      wall.appendChild(b);
      $('spriteRow').appendChild(friendButton(f));
    });
  }

  // ---- INSERT COIN -----------------------------------------------------------
  // A coin drops in. The third coin in a row gets an announcer: one of the
  // owner's clips from media/coin if there are any, else the browser's voice.
  let audioCtx = null;
  let coins = 0;
  let coinReset = null;
  function coinSound() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      for (const [freq, at] of [[1975, 0], [2637, 0.07], [1568, 0.2]]) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(0.18, t + at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.18);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + at);
        o.stop(t + at + 0.2);
      }
      const len = audioCtx.sampleRate * 0.08;
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const noise = audioCtx.createBufferSource();
      const lp = audioCtx.createBiquadFilter();
      const ng = audioCtx.createGain();
      noise.buffer = buf;
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      ng.gain.value = 0.5;
      noise.connect(lp).connect(ng).connect(audioCtx.destination);
      noise.start(t + 0.28);
    } catch { /* no sound on this browser */ }
  }
  const ANNOUNCER = ['Choose your fighter!', 'Player one, ready!', 'Get ready!', 'Here comes a new challenger!', 'Game on!'];
  function announce() {
    const own = (ArcadeMedia.info().coin || []);
    if (own.length) {
      const a = new Audio(own[Math.floor(Math.random() * own.length)].url);
      a.play().catch(() => {});
      return;
    }
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(ANNOUNCER[Math.floor(Math.random() * ANNOUNCER.length)]);
    u.rate = 0.9;
    u.pitch = 0.5;
    speechSynthesis.speak(u);
  }
  function insertCoin() {
    coinSound();
    coins++;
    clearTimeout(coinReset);
    coinReset = setTimeout(() => { coins = 0; }, 4000);
    if (coins >= 3) { coins = 0; setTimeout(announce, 450); }
  }

  // ---- wiring -----------------------------------------------------------------

  $('postClose').onclick = () => $('postModal').classList.add('hidden');
  // Send feedback opens the same card as the little bug in the corner.
  $('feedbackOpen').onclick = () => ArcadeFeedback.open();

  // Click outside a card, or Escape, closes it.
  for (const id of ['postModal', 'helpModal']) {
    $(id).addEventListener('click', e => { if (e.target.id === id) $(id).classList.add('hidden'); });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  });

  $('cheatInput').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const value = e.target.value;
    e.target.value = '';
    if (!value.trim()) return;
    if (!runCommand(value)) toast('Nothing happened… try /secret. 🤔');
  });
  document.addEventListener('keydown', onKey);
  $('arcadeTitle').addEventListener('click', onTitleTap);
  $('lockup').addEventListener('click', onTitleTap);
  $('helpOpen').onclick = () => $('helpModal').classList.remove('hidden');
  $('helpClose').onclick = () => $('helpModal').classList.add('hidden');
  $('insertCoin').addEventListener('click', insertCoin);
  $('insertCoin').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertCoin(); } });
  ArcadeMedia.ready.then(info => { showBrand(info.brand || {}); placeCharacters(info.sprites || []); });

  loadFeed();
  rotateQuotes();
  setInterval(loadFeed, 60000);
})();
