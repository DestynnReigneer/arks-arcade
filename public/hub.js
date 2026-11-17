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
    towers: { label: 'Tower Defense', href: 'towers.html' },
    sudoku: { label: 'Sudoku', href: 'sudoku.html' },
    scuffle: { label: 'Shuffle Scuffle', href: 'scuffle.html' },
    crisscross: { label: 'Words with Family', href: 'crisscross.html' },
    clueless: { label: 'Clueless Crosswords', href: 'clueless.html' },
    tumbler: { label: 'Tumbler Rumble', href: 'tumbler.html' },
    racer: { label: 'ARKS Racer', href: 'racer.html' },
    train: { label: 'ARKS Train Station', href: 'train.html' },
    launcher: { label: 'ARKS Launcher', href: 'launcher.html' },
    bucketdrop: { label: 'Bucket Drop', href: 'bucketdrop.html' },
    bigswing: { label: 'Big Swing', href: 'bigswing.html' }
  };

  // ---- who's playing ---------------------------------------------------------
  function paintChip() {
    const chip = $('playerChip');
    const p = ArcadeProfile.get();
    chip.innerHTML = '';
    chip.appendChild(ArcadeProfile.avatarEl(p ? p.avatar : 'emoji:👤', 24));
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
  // The same check every game page runs (topbar.js), except that the home
  // page asks even without ARKS ID.
  ArcadeProfile.askIfNobody({ always: true, delay: 600 });

  // ---- Words with Family turns waiting on you ---------------------------------------
  // A Words with Family game can wait days for a turn, so its card says when some
  // are waiting on whoever is playing on this phone.
  async function paintTurns() {
    const card = document.querySelector('.game.crisscross');
    if (!card) return;
    const token = ArcadeProfile.token();
    let n = 0;
    if (token) {
      try {
        const r = await fetch('/api/crisscross/turns', { headers: { 'X-Profile-Token': token }, cache: 'no-store' });
        n = r.ok ? (await r.json()).yourTurn || 0 : 0;
      } catch { /* leave it off */ }
    }
    // Looked up after the answer, not before: two checks can run at once (the page opening and
    // the profile arriving), and each used to add its own badge.
    let badge = card.querySelector('.turn-badge');
    if (!n) { card.querySelectorAll('.turn-badge').forEach(b => b.remove()); return; }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'turn-badge';
      card.querySelector('h2').after(badge);
    }
    badge.textContent = `🔔 Your turn in ${n} game${n === 1 ? '' : 's'}`;
  }
  ArcadeProfile.onChange(paintTurns);
  paintTurns();
  setInterval(() => { if (!document.hidden) paintTurns(); }, 60 * 1000);

  // ---- continue a game -------------------------------------------------------
  // The games whoever is playing on this device left unfinished, on any
  // device. The server works out who's asking from the profile token, so
  // this only ever lists your own.
  const CONTINUE_EMOJI = { crisscross: '🔡', sudoku: '🧩', clueless: '📰', chess: '♞', spinsolve: '🎡' };
  async function paintContinue() {
    const token = ArcadeProfile.token();
    let games = [];
    if (token) {
      try {
        const r = await fetch('/api/continue', { headers: { 'X-Profile-Token': token }, cache: 'no-store' });
        games = r.ok ? (await r.json()).games || [] : [];
      } catch { /* leave it out */ }
    }
    // Someone else may have been picked while that was loading.
    if (token !== ArcadeProfile.token()) return;
    const list = $('continueList');
    list.innerHTML = '';
    for (const g of games) {
      const li = document.createElement('li');
      li.className = g.yourTurn ? 'open' : '';
      li.innerHTML = '<span class="l-emoji"></span><span class="l-main"><div class="l-title"></div><div class="l-sub"></div></span><a class="l-join">Play</a>';
      li.querySelector('.l-emoji').textContent = CONTINUE_EMOJI[g.game] || '🎮';
      li.querySelector('.l-title').textContent = g.title;
      li.querySelector('.l-sub').textContent = detailOf(g);
      li.querySelector('.l-join').href = g.href;
      // Press and hold (or right-click) for Resume and Leave.
      if (window.LongPress) LongPress.attach(li, () => continueMenu(g));
      list.appendChild(li);
    }
    $('continue').classList.toggle('hidden', !games.length);
  }
  // What leaving means depends on the game, so each says it its own way. The server
  // says which kind of leaving a row is (g.leave, arcade/continue.js). The words are
  // the maintainer's.
  // A waiting Words with Family lobby says when it was opened, so two of them can be told
  // apart: "Waiting for players, opened 2:14 PM" (the date goes in front when it isn't today).
  function detailOf(g) {
    if (!g.openedAt) return g.detail;
    const at = new Date(g.openedAt);
    if (Number.isNaN(at.getTime())) return g.detail;
    const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const day = at.toDateString() === new Date().toDateString() ? '' : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, `;
    return `${g.detail}, opened ${day}${time}`;
  }
  function leaveWords(g) {
    const me = ArcadeProfile.name() || 'you';
    // The server names the other players in Words with Family and Chess.
    const others = Array.isArray(g.others) ? g.others : [];
    switch (g.leave) {
      case 'give-up':
      {
        const which = g.title.split(', ')[1] || "today's puzzle";
        // The server says what giving up would do next (sudoku/routes.js, giveUp).
        const then = {
          fresh: 'You can start over once with a fresh clock.',
          carry: 'If you try again, the clock picks up where you left off.',
          last: "This is your last scored try. After this, you can still play, but your time won't go on the board."
        }[g.giveUp] || "It comes off your list, and today's time won't go on the board.";
        return { icon: '🚪', label: "Give up today's puzzle", yes: 'Give up', ask: `Give up ${which}? ${then}` };
      }
      case 'close':
        return { icon: '🚪', label: 'Close lobby', yes: 'Close', ask: 'Close this lobby? Nobody can join after this.' };
      case 'lobby':
        return { icon: '🚪', label: 'Leave lobby', yes: 'Leave', ask: 'Leave this lobby? Your seat opens up for someone else.' };
      case 'resign':
        return { icon: '🏳️', label: 'Resign', yes: 'Resign', ask: others.length ? `Resign Chess match with ${others[0]}? It counts as a loss.` : 'Resign this Chess match? It counts as a loss.' };
      case 'end':
        return { icon: '🚪', label: 'End this game', yes: 'End it', ask: "End this game? Your score won't be saved." };
      case 'ends':
        return { icon: '🚪', label: 'Leave this game', yes: 'Leave', ask: others.length ? `Leave your game with ${others[0]}? The game ends, and ${others[0]} wins.` : 'Leave this game? The game ends, and the other player wins.' };
      case 'continues':
        return { icon: '🚪', label: 'Leave this game', yes: 'Leave', ask: `Leave this game, ${me}? Everyone else keeps playing without you.` };
      default:
        return null;
    }
  }
  function continueMenu(g) {
    const leave = leaveWords(g);
    const items = [{ icon: '▶️', label: 'Resume', run: () => { location.href = g.href; } }];
    if (leave) items.push({ ...leave, danger: true, run: () => leaveGame(g) });
    return { title: `${g.title} · ${detailOf(g)}`, items };
  }
  async function leaveGame(g) {
    const token = ArcadeProfile.token();
    if (!token) return;
    try {
      const r = await fetch('/api/continue/leave', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Profile-Token': token },
        body: JSON.stringify({ game: g.game, ref: g.ref })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "That didn't work. Try again in a moment.", 3200); return; }
    } catch {
      toast("That didn't work. Try again in a moment.", 3200);
      return;
    }
    // A puzzle given up is closed on the arcade, so this device forgets which run it was
    // on for that level (sudoku.current.<day>.<level>), and the page starts a new one
    // instead of asking for the old one first.
    if (g.leave === 'give-up') {
      try {
        for (let k = localStorage.length - 1; k >= 0; k--) {
          const key = localStorage.key(k) || '';
          if (key.startsWith(`${g.game}.current.`) && key.endsWith(`.${g.ref}`)) {
            localStorage.removeItem(`${g.game}.progress.${localStorage.getItem(key)}`);
            localStorage.removeItem(key);
          }
        }
      } catch { /* storage unavailable */ }
    }
    paintContinue();
    paintTurns();
  }
  ArcadeProfile.onChange(paintContinue);
  paintContinue();
  setInterval(() => { if (!document.hidden) paintContinue(); }, 60 * 1000);

  // Every room being hosted anywhere in the arcade, refreshed every few seconds.
  const STATUS = { open: 'Join', live: 'Join game in progress?', playing: 'Playing now', full: 'Full' };
  // While a finger is on a row, or its menu is open, the list isn't rebuilt under it.
  let touchingRow = false;
  $('lobbyList').addEventListener('pointerdown', () => { touchingRow = true; });
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { touchingRow = false; });
  async function loadLobby() {
    if (touchingRow || (window.LongPress && LongPress.isOpen)) return;
    try {
      // With a profile, the lobby you're already in is marked as yours.
      const token = typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null;
      const { rooms } = await (await fetch('/api/lobby', { headers: token ? { 'X-Profile-Token': token } : {}, cache: 'no-store' })).json();
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
        li.querySelector('.l-sub').textContent = `${r.players}/${r.max} players · ${r.detail}${r.status === 'playing' ? ' · game in progress' : ''}`;
        const join = li.querySelector('.l-join');
        join.textContent = STATUS[r.status];
        if (r.status === 'open' || r.status === 'live') join.href = r.href;
        else join.classList.add('off');
        // Press and hold (or right-click) for the lobby's quick menu.
        if (window.LongPress) LongPress.attach(li, () => lobbyMenu(r, li));
        list.appendChild(li);
      }
      // With nobody hosting there's nothing to show, so the LIVE pill stays out of the bar.
      $('liveN').textContent = rooms.length;
      $('liveDock').classList.toggle('hidden', !rooms.length);
      $('lobbyEmpty').classList.toggle('hidden', rooms.length > 0);
      const open = rooms.filter(r => r.status === 'open' || r.status === 'live').length;
      if (rooms.length && !open) $('lobbyEmpty').classList.remove('hidden');
      $('lobbyEmpty').innerHTML = rooms.length && !open
        ? 'Those games have already started or are full. Please pick another game to play or choose to <b>Host</b> your own.'
        : 'Nobody\'s hosting right now. Pick a game below and choose <b>Create a game lobby</b> to start one; it shows up here for everyone.';
    } catch { /* the server's away; try again shortly */ }
  }
  // The quick menu on a lobby row: join it, show its QR code so someone else can scan
  // in, or go to that game to make your own lobby, read how to play or see trophies.
  function lobbyMenu(r, li) {
    const page = r.page;
    const items = [];
    if (r.status === 'open' || r.status === 'live') {
      items.push({ icon: '▶️', label: STATUS[r.status].replace(/\?$/, ''), run: () => { location.href = r.href; } });
      if (r.code) items.push({ icon: '📷', label: 'Show QR code', run: () => ArcadeQR.open(page, r.code) });
      items.push({ sep: true });
    }
    items.push({ icon: '👥', label: 'Create a game lobby', run: () => { location.href = `${page}?go=create`; } });
    items.push({ icon: '❓', label: 'How to play', run: () => { location.href = `${page}?go=help`; } });
    if (trophyGames.includes(r.game)) items.push({ icon: '🏆', label: 'Trophies', run: () => { location.href = `trophies.html#${r.game}`; } });
    return { title: li.querySelector('.l-title').textContent, items };
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
    trophyGames = info.trophies || [];
    placeGames(homeGames.order);
    orderGames();
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
  // picked a profile or haven't played much yet. The order moves slowly
  // (arcade/game-order.js), starting from what this device showed last time,
  // so one game played once doesn't jump up and push the others around.
  const orderKey = () => `arcade.homeOrder.${(ArcadeProfile.get() || {}).id || 'guest'}`;
  async function sortByPlayed() {
    if (!homeGames || homeGames.sort !== 'played' || arranged) return;
    let previous = null;
    try { previous = JSON.parse(localStorage.getItem(orderKey()) || 'null'); } catch { /* nothing kept */ }
    try {
      const res = await fetch('/api/stats/game-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ArcadeProfile.token(), previous })
      });
      if (!res.ok) return;
      const { order } = await res.json();
      placeGames(order);
      try { localStorage.setItem(orderKey(), JSON.stringify(order)); } catch { /* private mode */ }
    } catch { /* keep the admin's order */ }
  }
  ArcadeProfile.onChange(orderGames);

  // ---- your own order (2026-11-16) -----------------------------------------
  // Once you pin a game to the front, move one to the bottom or reorder them, your
  // games stay exactly where you put them and the most-played order stops for you.
  // Pinned games come first (the newest pin first), then the rest; a game the arcade
  // adds later goes on the end. A profile's order is kept by the arcade, so it
  // follows you to any device (arcade/stats.js); a guest's stays on this device.
  let arranged = null;              // { pinned: [...], order: [...] } or null
  let trophyGames = [];
  const guestKey = 'arcade.arranged.guest';
  const cardId = card => card.classList[1];
  const allCards = () => [...document.querySelectorAll('.games > .game')];

  async function loadArranged() {
    const token = ArcadeProfile.token();
    if (!token) {
      try { return JSON.parse(localStorage.getItem(guestKey) || 'null'); } catch { return null; }
    }
    try {
      const res = await fetch('/api/stats/arrangement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
      });
      return res.ok ? (await res.json()).arranged : null;
    } catch { return null; }
  }
  async function orderGames() {
    if (!homeGames) return;
    const asked = ArcadeProfile.token();
    const a = await loadArranged();
    if (ArcadeProfile.token() !== asked) return;   // the profile changed while this was loading
    arranged = a && Array.isArray(a.pinned) && Array.isArray(a.order) ? a : null;
    if (arranged) showArranged();
    else { markPins(); sortByPlayed(); }
  }
  function showArranged() {
    const listed = [...arranged.pinned, ...arranged.order];
    placeGames([...listed, ...homeGames.order.filter(id => !listed.includes(id))]);
    markPins();
  }
  function markPins() {
    const pinned = arranged ? arranged.pinned : [];
    for (const card of allCards()) {
      const on = pinned.includes(cardId(card));
      let pin = card.querySelector(':scope > .pin');
      if (on && !pin) {
        pin = document.createElement('span');
        pin.className = 'pin';
        pin.textContent = '📌';
        pin.title = 'Pinned to the front';
        card.appendChild(pin);
      }
      if (!on && pin) pin.remove();
    }
  }
  async function saveArranged(pinned, order) {
    arranged = { pinned, order };
    showArranged();
    const token = ArcadeProfile.token();
    if (!token) {
      try { localStorage.setItem(guestKey, JSON.stringify(arranged)); } catch { /* private mode */ }
      return;
    }
    try {
      const res = await fetch('/api/stats/arrangement/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pinned, order })
      });
      if (!res.ok) throw new Error();
    } catch { toast("Your order didn't save. Try again in a moment.", 3200); }
  }
  // The games as they're shown now, split into the pinned ones and the rest.
  function shownNow() {
    const ids = allCards().map(cardId);
    const pinned = arranged ? arranged.pinned.filter(id => ids.includes(id)) : [];
    return { pinned, rest: ids.filter(id => !pinned.includes(id)) };
  }
  function moveToFront(id) {
    const { pinned, rest } = shownNow();
    saveArranged([id, ...pinned.filter(x => x !== id)], rest.filter(x => x !== id));
  }
  function unpin(id) {
    const { pinned, rest } = shownNow();
    saveArranged(pinned.filter(x => x !== id), [id, ...rest.filter(x => x !== id)]);
  }
  function moveToBottom(id) {
    const { pinned, rest } = shownNow();
    saveArranged(pinned.filter(x => x !== id), [...rest.filter(x => x !== id), id]);
  }

  // ---- Reorder games: dotted outlines, drag them where you want, Done or Cancel.
  let reorder = null;
  function startReorder() {
    if (reorder) return;
    const list = document.querySelector('.games');
    const before = allCards().map(cardId);
    const bar = document.createElement('div');
    bar.className = 'reorder-bar';
    bar.innerHTML = '<span>Drag the games into the order you want.</span><button type="button" class="rb-cancel">Cancel</button><button type="button" class="rb-done">Done</button>';
    list.before(bar);
    list.classList.add('reorder');
    let lifted = null, waiting = null, at = null, edgeLoop = 0;
    const stopClick = e => { e.preventDefault(); e.stopPropagation(); };
    const lift = (card, e) => {
      lifted = card;
      card.classList.add('lifted');
      try { card.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* no buzz here */ }
      edgeLoop = requestAnimationFrame(edge);
    };
    // A mouse lifts a card at once. A finger lifts it after a short hold, so a quick
    // swipe still scrolls the page.
    const down = e => {
      const card = e.target.closest('.games > .game');
      if (!card || e.button > 0) return;
      at = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse') { e.preventDefault(); lift(card, e); return; }
      clearTimeout(waiting);
      waiting = setTimeout(() => { waiting = null; lift(card, e); }, 220);
    };
    // While a card is held near the top or bottom of the screen, the page keeps scrolling.
    const edge = () => {
      if (!lifted) return;
      const zone = 90;
      const speed = at.y < zone ? -Math.ceil((zone - at.y) / 6) : at.y > innerHeight - zone ? Math.ceil((at.y - innerHeight + zone) / 6) : 0;
      if (speed) { window.scrollBy(0, speed); follow(); }
      edgeLoop = requestAnimationFrame(edge);
    };
    const follow = () => {
      const over = document.elementsFromPoint(at.x, at.y).map(el => el.closest && el.closest('.games > .game')).find(c => c && c !== lifted);
      if (!over) return;
      const cards = allCards();
      if (cards.indexOf(over) < cards.indexOf(lifted)) over.before(lifted); else over.after(lifted);
    };
    const move = e => {
      if (waiting && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) { clearTimeout(waiting); waiting = null; }
      if (!lifted) return;
      at = { x: e.clientX, y: e.clientY };
      follow();
    };
    // Once a card is lifted, a finger moving it doesn't scroll the page.
    const noScroll = e => { if (lifted && e.cancelable) e.preventDefault(); };
    const up = () => {
      clearTimeout(waiting); waiting = null;
      cancelAnimationFrame(edgeLoop);
      if (lifted) lifted.classList.remove('lifted');
      lifted = null;
    };
    const esc = e => { if (e.key === 'Escape' && reorder) { e.preventDefault(); reorder.finish(false); } };
    // With a keyboard: the arrow keys move the focused game earlier or later.
    const key = e => {
      const card = e.target.closest && e.target.closest('.games > .game');
      if (!card) return;
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp', on = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      if (!back && !on) return;
      e.preventDefault();
      const sib = back ? card.previousElementSibling : card.nextElementSibling;
      if (sib && sib.classList.contains('game')) { if (back) sib.before(card); else sib.after(card); card.focus(); }
    };
    list.addEventListener('pointerdown', down);
    list.addEventListener('pointermove', move);
    list.addEventListener('pointerup', up);
    list.addEventListener('pointercancel', up);
    list.addEventListener('click', stopClick, true);
    list.addEventListener('keydown', key);
    list.addEventListener('touchmove', noScroll, { passive: false });
    document.addEventListener('keydown', esc);
    const finish = keep => {
      list.removeEventListener('pointerdown', down);
      list.removeEventListener('pointermove', move);
      list.removeEventListener('pointerup', up);
      list.removeEventListener('pointercancel', up);
      list.removeEventListener('click', stopClick, true);
      list.removeEventListener('keydown', key);
      list.removeEventListener('touchmove', noScroll);
      document.removeEventListener('keydown', esc);
      list.classList.remove('reorder');
      up();
      bar.remove();
      reorder = null;
      if (!keep) { placeGames(before); markPins(); return; }
      // Pinned games stay pinned while they're still at the front.
      const ids = allCards().map(cardId);
      const was = arranged ? arranged.pinned : [];
      const pinned = [];
      for (const id of ids) { if (was.includes(id)) pinned.push(id); else break; }
      saveArranged(pinned, ids.slice(pinned.length));
    };
    bar.querySelector('.rb-cancel').onclick = () => finish(false);
    bar.querySelector('.rb-done').onclick = () => finish(true);
    reorder = { finish };
    bar.scrollIntoView({ block: 'nearest' });
  }

  // ---- the quick menu: press and hold a game card (or right-click it) -------
  const TODAY = {
    sudoku: { row: "Jump to today's puzzle", levels: [['family', 'Family'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] },
    clueless: { row: "Jump to today's crossword", levels: [['mini', 'Family mini'], ['big', 'Big']] }
  };
  const LOBBIES = ['chess', 'rambler', 'crisscross', 'daredevil', 'partdeux', 'scuffle', 'trivia'];
  function cardMenu(card) {
    const id = cardId(card);
    const href = card.getAttribute('href');
    const go = where => () => { location.href = `${href}?go=${where}`; };
    const items = [];
    if (!card.classList.contains('closed')) {
      items.push({ icon: '▶️', label: 'Play', run: () => { location.href = href; } });
      const t = TODAY[id];
      if (t) items.push({ row: t.row, choices: t.levels.map(([lv, label]) => ({ label, run: () => { location.href = `${href}?level=${lv}`; } })) });
      if (LOBBIES.includes(id)) {
        items.push({ icon: '👥', label: 'Create a game lobby', run: go('create') });
        items.push({ icon: '🔎', label: 'List Hosted Games', run: go('list') });
      }
      items.push({ icon: '❓', label: 'How to play', run: go('help') });
      if (trophyGames.includes(id)) items.push({ icon: '🏆', label: 'Trophies', run: () => { location.href = `trophies.html#${id}`; } });
      items.push({ sep: true });
    }
    const pinned = !!(arranged && arranged.pinned.includes(id));
    items.push(pinned ? { icon: '📌', label: 'Unpin', run: () => unpin(id) } : { icon: '📌', label: 'Move to the front', run: () => moveToFront(id) });
    items.push({ icon: '⤵️', label: 'Move to the bottom', run: () => moveToBottom(id) });
    items.push({ icon: '↕️', label: 'Reorder games', run: startReorder });
    return { title: card.querySelector('h2').textContent, items };
  }
  if (window.LongPress && !document.documentElement.classList.contains('tv')) {
    for (const card of allCards()) LongPress.attach(card, () => (reorder ? null : cardMenu(card)));
  }

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

  // What the pixel characters do when tapped. The Cheat codes box and typing
  // commands were taken out (the maintainer's call, 2026-11-13); the characters
  // carry them now. A character picture named after one of the owner's clips
  // (custom-media.js) plays that clip.
  const COMMANDS = {
    '/help': () => $('helpModal').classList.remove('hidden'),
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
  function runCommand(raw) {
    const cmd = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (COMMANDS[cmd]) { COMMANDS[cmd](); return true; }
    return ArcadeMedia.play(cmd.replace(/^\//, ''));
  }

  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let keys = [];

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
      // The helm keeps its drawing with the mist washed over its colors; the logo is
      // its own shape filled with the mist (mist.js).
      const helm = document.createElement('span');
      helm.className = 'helm mist-tint';
      helm.style.setProperty('--mist-src', `url("${brand.avatar}")`);
      const helmImg = document.createElement('img');
      helmImg.src = brand.avatar; helmImg.alt = '';
      helm.appendChild(helmImg);
      const wide = document.createElement('span');
      wide.className = 'wide mist-mask';
      wide.setAttribute('role', 'img'); wide.setAttribute('aria-label', 'ARKS');
      wide.style.setProperty('--mist-src', `url("${brand.wide}")`);
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
    // Once trimmed, the outline fills with the mist too.
    t.ownerSVGElement.classList.add('mist-stroke');
    if (window.Mist) window.Mist.refresh();
  }

  // ---- clickable characters --------------------------------------------------
  // Little pixel friends on the side walls (under INSERT COIN on a phone). Each
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

  // While nobody's touched the page for 20 seconds, a character (one you can see)
  // breaks into a little dance every few seconds, until someone moves again.
  let idleSince = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'mousemove']) addEventListener(ev, () => { idleSince = Date.now(); }, { passive: true });
  setInterval(() => {
    if (document.hidden || Date.now() - idleSince < 20000 || Math.random() < 0.4) return;
    const seen = [...document.querySelectorAll('.pal')].filter(p => p.offsetParent && p.getBoundingClientRect().bottom > 0 && p.getBoundingClientRect().top < innerHeight);
    const p = seen[Math.floor(Math.random() * seen.length)];
    if (!p) return;
    p.classList.remove('jig');
    void p.offsetWidth;
    p.classList.add('jig');
    setTimeout(() => p.classList.remove('jig'), 1700);
  }, 3000);

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
