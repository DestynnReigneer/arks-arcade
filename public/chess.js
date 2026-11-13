'use strict';

// Chess: against the computer, two players on one phone, or each on their own
// phone. For that, the host creates a lobby (who can join: anyone at the arcade,
// or only the people they pick) and it shows up in List Hosted Games and on the
// home page; whoever joins taps Ready, and the host starts (lobby-ui.js draws the
// seats and the chat). Nobody types a code. A game on two phones is saved on the server, so leaving
// doesn't end it: it waits in the Continue row, and opening it on another
// device (chess.html?room=CODE) puts you back in your seat. The rules live in chess-engine.js; this file draws the board and
// runs the game around it.

(() => {
  const { $, toast, api } = ArcadeKit;
  const E = ChessEngine;

  // Filled glyphs for both sides (colored by CSS), with the "text, not emoji"
  // selector so phones don't swap the pawn for a cartoon.
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const glyph = p => GLYPH[p.toLowerCase()] + '︎';
  const COLOR_NAME = { w: 'White', b: 'Black' };
  const LEVEL_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  const other = c => (c === 'w' ? 'b' : 'w');

  const S = {
    mode: 'ai', level: 'medium', colorPref: 'w',
    state: null, history: [], moves: [], lastMove: null,
    me: 'w', picked: null, targets: [], hintMove: null,
    thinking: false, ended: null, suggestions: 0, overShown: null,
    room: null, es: null, snap: null,
    lastPlayed: null,   // the last move with who made it, for the words above the board
    animating: false
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const cap = s => s[0].toUpperCase() + s.slice(1);

  // ---- the computer, in a worker ---------------------------------------------

  let worker = null;
  let askId = 0;
  const waiting = new Map();
  function askEngine(level) {
    if (!worker) {
      worker = new Worker('chess-worker.js');
      worker.onmessage = ({ data }) => {
        const resolve = waiting.get(data.id);
        waiting.delete(data.id);
        if (resolve) resolve(data.move);
      };
    }
    const id = ++askId;
    return new Promise(resolve => {
      waiting.set(id, resolve);
      worker.postMessage({ id, fen: E.toFen(S.state), level });
    });
  }

  // ---- setup ---------------------------------------------------------------------

  function pressed(seg, attr, value) {
    for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
  }

  // Choose game mode: the computer and one device start from here; Create a game
  // lobby and List Hosted Games open their own screens.
  function setMode(mode) {
    if (mode === 'host') return openCreate();
    if (mode === 'find') return openFind();
    S.mode = mode;
    pressed($('modeSeg'), 'mode', mode);
    $('aiSetup').classList.toggle('hidden', mode !== 'ai');
    $('localSetup').classList.toggle('hidden', mode !== 'local');
    $('colorPick').classList.toggle('hidden', mode !== 'ai');
    $('setupMsg').textContent = '';
  }

  function show(screen) {
    for (const id of ['setup', 'create', 'find', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== screen);
    if (screen !== 'find') stopFinding();
    const tvBoard = $('boardWrap').closest('.tv-stage');
    if (tvBoard) tvBoard.classList.toggle('hidden', screen !== 'game');
  }

  async function start() {
    if (window.ArcadeStats) ArcadeStats.play();
    Blip.unlock();
    $('setupMsg').textContent = '';
    const color = S.colorPref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : S.colorPref;
    try {
      return newLocalGame(color);
    } catch (e) {
      $('setupMsg').textContent = e.message;
    }
  }

  // ---- Create a game lobby -----------------------------------------------------------

  function openCreate() {
    S.who = 'anyone';
    S.createColor = 'w';
    S.chosen = new Set();
    pressed($('whoSeg'), 'who', S.who);
    pressed($('createColorSeg'), 'color', S.createColor);
    // With a profile, your name comes from it.
    $('hostNameRow').classList.toggle('hidden', !!profileToken());
    $('pickPeople').classList.add('hidden');
    $('createMsg').textContent = '';
    show('create');
  }
  async function setWho(who) {
    if (who === 'selected' && !profileToken()) {
      $('createMsg').textContent = 'Pick your profile at the top first, so the people you choose know who it\'s from.';
      return;
    }
    S.who = who;
    pressed($('whoSeg'), 'who', who);
    $('createMsg').textContent = '';
    $('pickPeople').classList.toggle('hidden', who !== 'selected');
    if (who === 'selected') { await loadPeople(); paintPeople(); }
  }
  async function createLobby() {
    if (window.ArcadeStats) ArcadeStats.play();
    Blip.unlock();
    $('createMsg').textContent = '';
    if (S.who === 'selected' && !S.chosen.size) { $('createMsg').textContent = 'Choose at least one person.'; return; }
    try {
      const r = await api('/api/chess/rooms', { name: $('hostName').value, color: S.createColor, who: S.who,
        allowed: S.who === 'selected' ? [...S.chosen] : [] }, profileHeaders());
      if (S.who === 'selected') toast('The people you chose will get a notification.');
      enterRoom(r);
    } catch (e) { $('createMsg').textContent = e.message; }
  }

  // ---- List Hosted Games ------------------------------------------------------------

  const COLOR_WORDS = { w: 'White', b: 'Black', random: 'Random' };
  function openFind() {
    show('find');
    loadLobbies();
    stopFinding();
    // Checked every 5 seconds while the list is on screen and the tab is showing.
    S.findTimer = setInterval(() => { if (!document.hidden) loadLobbies(); }, 5000);
  }
  function stopFinding() { if (S.findTimer) { clearInterval(S.findTimer); S.findTimer = null; } }
  async function loadLobbies() {
    try {
      const r = await fetch('/api/chess/lobbies', { headers: profileHeaders(), cache: 'no-store' });
      paintLobbies((await r.json()).lobbies || []);
    } catch { /* tries again in a moment */ }
  }
  function paintLobbies(list) {
    S.lobbies = list;
    const rows = $('lobbyRows');
    rows.replaceChildren();
    $('findEmpty').classList.toggle('hidden', list.length > 0);
    for (const l of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lb-row';
      if (l.status === 'full' && !l.mine) b.setAttribute('aria-disabled', 'true');
      const main = document.createElement('span'); main.className = 'lb-row-main';
      const name = document.createElement('b'); name.textContent = `${l.host}'s lobby`;
      const sub = document.createElement('small'); sub.textContent = 'Multiplayer-Multiple devices';
      main.append(name, sub);
      const count = document.createElement('span'); count.className = 'lb-count'; count.textContent = `${l.count}/${l.max}`;
      b.append(main, count);
      if (l.status === 'full') { const f = document.createElement('span'); f.className = 'lb-full'; f.textContent = 'FULL'; b.append(f); }
      b.addEventListener('click', () => openDetails(l));
      li.append(b);
      rows.append(li);
    }
  }

  // The lobby's details, before joining it.
  function openDetails(l) {
    if (l.mine) return api(`/api/chess/rooms/${l.code}/seat`, {}, profileHeaders()).then(enterRoom, e => toast(e.message));
    S.detailsCode = l.code;
    $('detailsTitle').textContent = `${l.host}'s Chess lobby`;
    $('dPlayers').textContent = `${l.players.join(', ')} · ${l.count} of ${l.max}`;
    const theirs = l.color === 'random' ? 'A random color' : COLOR_WORDS[other(l.color)];
    $('dYou').textContent = `${theirs} (${l.host} chose ${COLOR_WORDS[l.color]})`;
    $('dStatus').textContent = l.status === 'full' ? 'Full' : 'Waiting for players';
    $('dGuest').classList.toggle('hidden', !!profileToken());
    $('joinBtn').disabled = l.status === 'full';
    $('detailsMsg').textContent = '';
    $('detailsView').classList.remove('hidden');
    $('joinBtn').focus({ preventScroll: true });
  }
  const closeDetails = () => $('detailsView').classList.add('hidden');
  async function joinLobby() {
    $('detailsMsg').textContent = '';
    try {
      const r = await api(`/api/chess/rooms/${S.detailsCode}/join`, { name: $('joinName').value }, profileHeaders());
      closeDetails();
      enterRoom(r);
    } catch (e) { $('detailsMsg').textContent = e.message; }
  }

  // ---- games on this phone (computer, or pass and play) ---------------------------

  function newLocalGame(color) {
    leaveRoom();
    S.state = E.fromFen();
    S.history = [];
    S.moves = [];
    S.lastMove = null;
    S.ended = null;
    S.overShown = null;
    S.suggestions = 0;
    S.localBottom = null;
    S.lastPlayed = null;
    S.me = S.mode === 'ai' ? color : 'w';
    clearPick();
    show('game');
    $('overView').classList.add('hidden');
    render();
    if (S.mode === 'ai' && S.state.turn !== S.me) computerMove();
  }

  async function playHere(move) {
    S.history.push({ state: E.clone(S.state), moves: S.moves.slice(), lastMove: S.lastMove, lastPlayed: S.lastPlayed });
    const mover = S.state.turn;
    const played = E.play(S.state, move);
    if (!played) return false;
    S.moves.push(played.san);
    S.lastMove = { from: played.from, to: played.to };
    S.lastPlayed = { ...played, by: mover };
    clearPick();
    const s = E.status(S.state);
    if (s.over) S.ended = s;
    // The other side's moves glide slowly enough to follow; yours just snap in.
    const theirs = S.mode === 'ai' ? mover !== S.me : S.mode === 'local';
    S.animating = true;
    render();
    moveSound(played);
    await animateMove(played, theirs ? 520 : 200);
    S.animating = false;
    // Pass and play turns the board around only after the move has landed.
    if (S.mode === 'local' && !S.ended) await new Promise(r => setTimeout(r, 350));
    render();
    if (S.ended) setTimeout(showOver, 600);
    else if (S.mode === 'ai' && S.state.turn !== S.me) computerMove();
    return true;
  }

  async function computerMove() {
    S.thinking = true;
    render();
    const started = Date.now();
    const move = await askEngine(S.level);
    // A beat of "thinking" even when it's instant, so you see your move land.
    await new Promise(r => setTimeout(r, Math.max(0, 650 - (Date.now() - started))));
    S.thinking = false;
    if (move && S.state && !S.ended) playHere(move);
    else render();
  }

  function undo() {
    if (S.thinking || !S.history.length) return;
    // Against the computer, take back its reply too so it's your move again.
    const steps = S.mode === 'ai' ? (S.state.turn === S.me ? 2 : 1) : 1;
    let snap = null;
    for (let i = 0; i < steps && S.history.length; i++) snap = S.history.pop();
    if (!snap) return;
    S.state = snap.state;
    S.moves = snap.moves;
    S.lastMove = snap.lastMove;
    S.lastPlayed = snap.lastPlayed;
    S.ended = null;
    clearPick();
    render();
    if (S.mode === 'ai' && S.state.turn !== S.me) computerMove();
  }

  async function suggest() {
    if (!myTurn()) return;
    S.suggestions++;
    $('suggestBtn').disabled = true;
    const move = await askEngine('medium');
    $('suggestBtn').disabled = false;
    if (!move || !myTurn()) return;
    clearPick();
    S.hintMove = move;
    pick(move.from);
    toast(S.mode === 'ai' ? '💡 Try the highlighted move. Suggestions cost a few points.' : '💡 Try the highlighted move.');
  }

  // ---- two phones ------------------------------------------------------------------

  const profileToken = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);
  const profileHeaders = () => (profileToken() ? { 'X-Profile-Token': profileToken() } : {});

  function enterRoom(r) {
    S.room = { code: r.code, playerId: r.playerId, token: r.token };
    try { sessionStorage.setItem('chess.room', JSON.stringify(S.room)); } catch { /* unavailable */ }
    S.mode = 'room';
    S.me = r.color;
    S.ended = null;
    S.overShown = null;
    S.snap = null;
    show('lobby');
    connect();
  }

  // Opening chess.html?room=CODE (an invite, the Continue row, another device) or
  // ?join=CODE (Join a game on the home page). Your profile finds your seat; anyone
  // else sees the lobby's details first, the same as from List Hosted Games.
  async function openRoom(code) {
    if (profileToken()) {
      try { return enterRoom(await api(`/api/chess/rooms/${code}/seat`, {}, profileHeaders())); } catch { /* not in it yet */ }
    }
    try {
      const r = await fetch('/api/chess/lobbies', { headers: profileHeaders(), cache: 'no-store' });
      const l = ((await r.json()).lobbies || []).find(x => x.code === code);
      if (l) return openDetails(l);
    } catch { /* falls through */ }
    $('setupMsg').textContent = 'That lobby isn\'t open anymore. Choose List Hosted Games to see the ones that are.';
  }

  // ---- the lobby -------------------------------------------------------------------

  const roomCall = (path, body = {}) => {
    const { code, playerId, token } = S.room;
    return api(`/api/chess/rooms/${code}/${path}`, { playerId, token, ...body });
  };
  async function loadPeople() {
    if (S.people || S.loadingPeople || !profileToken()) return;
    S.loadingPeople = true;
    try {
      S.people = (await api('/api/invites/people', undefined, profileHeaders())).people;
    } catch { S.people = []; }
    S.loadingPeople = false;
    paintPeople();
  }
  // Only People Selected: everyone with a profile here, to check one, a few or all.
  function paintPeople() {
    LobbyUI.people($('pickPeople'), S.people || [], S.chosen, () => {});
    if (S.people && !S.people.length) $('createMsg').textContent = 'Nobody else has a profile here yet.';
  }

  function renderLobby(snap) {
    const host = snap.host;
    $('lobbyTitle').textContent = host ? 'Your Chess lobby' : `${snap.hostName}'s Chess lobby`;
    $('lobbyCount').textContent = `${snap.seats.length} of ${snap.max || 2} players · ${snap.settings.who === 'selected' ? 'Only people selected' : 'Anyone can join'}`;
    LobbyUI.seats($('lobbySeats'), snap.seats, { invited: snap.invited, max: snap.max || 2, canMute: host, onMute: (seat, on) => mute(seat, on),
      onRemove: seat => roomCall('remove', { seat }).then(applySnap, e => toast(e.message)) });
    $('lobbyHost').classList.toggle('hidden', !host);
    $('lobbyGuest').classList.toggle('hidden', host);
    if (host) {
      pressed($('lobbyColorSeg'), 'color', snap.settings.color);
      // Lights up only once someone has joined and everyone is ready.
      const full = snap.seats.length >= (snap.max || 2);
      $('lobbyStart').disabled = !full || !snap.allReady;
      $('lobbyStart').textContent = !full ? 'Waiting on players to join...' : !snap.allReady ? 'Waiting on players to be ready...' : 'Players Ready, Start Game!';
    } else {
      const theirs = snap.settings.color === 'random' ? null : COLOR_WORDS[other(snap.settings.color)];
      $('lobbySettings').textContent = `${theirs ? `You play ${theirs}.` : 'Your color is picked at random when the game starts.'} Each player on their own phone. No clock.`;
      const me = snap.seats.find(x => x.you);
      const ready = !!(me && me.ready);
      $('readyHint').classList.toggle('hidden', ready);
      $('readyBtn').textContent = ready ? 'Not ready yet' : 'Ready!';
      $('readyBtn').className = ready ? 'ghost big' : 'primary big';
      $('lobbyWait').classList.toggle('hidden', !ready);
      $('lobbyWait').textContent = `Waiting for ${snap.hostName} to start the game…`;
    }
    S.lobbyChat.render(snap.chat, { muted: snap.muted });
  }

  async function setReady() {
    const me = S.snap && S.snap.seats.find(x => x.you);
    try { applySnap(await roomCall('ready', { ready: !(me && me.ready) })); } catch (e) { toast(e.message); }
  }
  async function setColor(color) {
    try { applySnap(await roomCall('settings', { color })); } catch (e) { toast(e.message); }
  }
  async function startRoom() {
    try { applySnap(await roomCall('start')); } catch (e) { toast(e.message); }
  }
  async function mute(seat, on) {
    try { applySnap(await roomCall('mute', { seat, on })); } catch (e) { toast(e.message); }
  }
  const sendChat = text => roomCall('chat', { text });

  function connect() {
    if (S.es) S.es.close();
    const { code, playerId, token } = S.room;
    S.es = new EventSource(`/api/chess/rooms/${code}/events?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`);
    S.es.addEventListener('state', e => applySnap(JSON.parse(e.data)));
    S.es.addEventListener('closed', () => { leaveRoom(); show('setup'); toast('The host closed the lobby.'); });
    S.es.addEventListener('removed', () => { leaveRoom(); show('setup'); toast('The host took you out of the lobby.'); });
    S.es.onerror = () => {
      // A room that no longer exists (server restarted, game expired) can't come back.
      fetch(`/api/chess/rooms/${code}?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`)
        .then(r => { if (r.status === 404 || r.status === 403) { leaveRoom(); show('setup'); toast('That game has ended.'); } })
        .catch(() => {});
    };
  }

  function leaveRoom() {
    if (S.es) { S.es.close(); S.es = null; }
    S.room = null;
    S.snap = null;
    try { sessionStorage.removeItem('chess.room'); } catch { /* unavailable */ }
  }

  function applySnap(snap) {
    const fresh = !S.snap || snap.moves.length < S.snap.moves.length;
    const prevLen = S.snap ? S.snap.moves.length : 0;
    // One new move since last time: find it in the old position so we know
    // the piece, what it took, and can animate it.
    let played = null;
    if (S.snap && S.state && snap.moves.length === prevLen + 1 && snap.lastMove) {
      const san = snap.moves[snap.moves.length - 1];
      const promo = (san.match(/=([QRBN])/) || [])[1];
      const m = E.legalMoves(S.state).find(x => x.from === snap.lastMove.from && x.to === snap.lastMove.to &&
        (!x.promo || x.promo.toLowerCase() === (promo || 'q').toLowerCase()));
      if (m) played = { ...m, san, by: S.state.turn };
    }
    if (fresh) S.lastPlayed = null;
    if (played) S.lastPlayed = played;
    S.snap = snap;
    S.me = snap.you;
    S.state = E.fromFen(snap.fen);
    S.moves = snap.moves;
    S.lastMove = snap.lastMove;
    S.ended = snap.ended;
    if (snap.phase === 'lobby') { renderLobby(snap); show('lobby'); return; }
    show('game');
    $('gameChat').classList.remove('hidden');
    S.gameChat.render(snap.chat, { muted: snap.muted });
    // A new game after a rematch: clear the results.
    if (!snap.ended && fresh) { S.overShown = null; $('overView').classList.add('hidden'); }
    $('drawOfferView').classList.toggle('hidden', !(snap.drawOffer && snap.drawOffer !== snap.you && !snap.ended));
    clearPick();
    render();
    if (played) {
      moveSound(played);
      animateMove(played, played.by === S.me ? 200 : 520).then(() => { if (snap.ended) showOver(); });
    } else if (snap.ended) showOver();
  }

  async function roomAct(action) {
    try {
      const { code, playerId, token } = S.room;
      applySnap(await api(`/api/chess/rooms/${code}/act`, { playerId, token, action }));
    } catch (e) { toast(e.message); }
  }

  async function roomMove(move) {
    const { code, playerId, token } = S.room;
    clearPick();
    try {
      applySnap(await api(`/api/chess/rooms/${code}/move`, { playerId, token, ...move }));
    } catch (e) { toast(e.message); render(); }
  }

  // ---- input -------------------------------------------------------------------------

  function myTurn() {
    if (!S.state || S.ended || S.thinking || S.animating) return false;
    if (S.mode === 'local') return true;
    if (S.mode === 'room') return !!(S.snap && S.snap.players.w && S.snap.players.b && S.state.turn === S.me);
    return S.state.turn === S.me;
  }

  function clearPick() { S.picked = null; S.targets = []; S.hintMove = null; }

  function pick(sq) {
    S.picked = sq;
    S.targets = E.movesFrom(S.state, sq);
    render();
  }

  function onSquare(sq) {
    Blip.unlock();
    if (!myTurn()) {
      if (S.state && !S.ended && S.mode !== 'local') toast(S.thinking ? 'The computer is thinking…' : 'Wait for your turn.');
      return;
    }
    const piece = S.state.board[sq];
    if (S.picked != null && S.targets.some(m => m.to === sq)) return tryMove(S.picked, sq);
    if (piece && E.colorOf(piece) === S.state.turn) {
      if (S.picked === sq) { clearPick(); render(); return; }
      S.hintMove = null;
      return pick(sq);
    }
    clearPick();
    render();
  }

  function tryMove(from, to) {
    const options = S.targets.filter(m => m.to === to);
    if (options.some(m => m.promo)) return askPromotion(from, to);
    commit({ from, to });
  }

  function askPromotion(from, to) {
    const row = $('promoRow');
    row.innerHTML = '';
    const white = S.state.turn === 'w';
    for (const kind of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="pc ${white ? 'w' : 'b'}">${glyph(kind)}</span>`;
      b.addEventListener('click', () => { $('promoView').classList.add('hidden'); commit({ from, to, promo: kind }); });
      row.appendChild(b);
    }
    $('promoView').classList.remove('hidden');
  }

  function commit(move) {
    if (S.mode === 'room') roomMove(move);
    else playHere(move);
  }

  // ---- drawing -------------------------------------------------------------------------

  // Whose side sits at the bottom of the screen.
  function bottomColor() {
    if (S.mode === 'local') {
      // The board turns to face whoever's move it is, and stays put once it's over.
      if (!S.ended && !S.animating) S.localBottom = S.state.turn;
      return S.localBottom || 'w';
    }
    return S.me || 'w';
  }

  function render() {
    if (!S.state) return;
    const bottom = bottomColor();
    const board = $('board');
    const focusedSq = board.contains(document.activeElement) ? document.activeElement.dataset.sq : null;
    board.innerHTML = '';
    const check = !S.ended && E.inCheck(S.state) ? S.state.board.indexOf(S.state.turn === 'w' ? 'K' : 'k') : -1;
    for (let i = 0; i < 64; i++) {
      const sq = bottom === 'w' ? i : 63 - i;
      const row = sq >> 3, col = sq & 7;
      const btn = document.createElement('button');
      btn.className = 'sq ' + ((row + col) % 2 ? 'dark' : 'light');
      btn.type = 'button';
      btn.setAttribute('aria-label', E.name(sq));
      if (S.lastMove && (S.lastMove.from === sq || S.lastMove.to === sq)) btn.classList.add('last');
      if (S.picked === sq) btn.classList.add('picked');
      if (sq === check) btn.classList.add('check');
      const target = S.targets.find(m => m.to === sq);
      if (target) {
        btn.classList.add('to');
        if (target.captured) btn.classList.add('take');
        if (S.hintMove && S.hintMove.to === sq) btn.classList.add('picked');
      }
      const p = S.state.board[sq];
      if (p) btn.innerHTML = `<span class="pc ${E.colorOf(p)}">${glyph(p)}</span>`;
      // File letters along the bottom row, rank numbers up the left side.
      if (i >= 56) btn.insertAdjacentHTML('beforeend', `<span class="coord file">${'abcdefgh'[col]}</span>`);
      if (i % 8 === 0) btn.insertAdjacentHTML('beforeend', `<span class="coord rank">${8 - row}</span>`);
      btn.dataset.sq = sq;
      btn.addEventListener('click', () => onSquare(sq));
      board.appendChild(btn);
    }
    if (focusedSq != null) { const again = board.querySelector(`[data-sq="${focusedSq}"]`); if (again) again.focus({ preventScroll: true }); }
    renderBars(bottom);
    renderLastMove();
    renderStatus();
    renderMoves();
    renderButtons();
  }

  // "🤖 Computer: Knight takes your Bishop on c4", with the pieces drawn in.
  function renderLastMove() {
    const box = $('lastMove');
    const m = S.lastPlayed;
    box.classList.remove('capture');
    if (!m) { box.innerHTML = ''; box.dataset.key = ''; return; }
    const key = `${S.moves.length}`;
    const fresh = box.dataset.key !== key;
    box.dataset.key = key;
    const who = S.mode === 'ai' ? (m.by === S.me ? 'You' : '🤖 Computer')
      : S.mode === 'room' ? (m.by === S.me ? 'You' : stripTags(seatName(m.by)).trim())
        : COLOR_NAME[m.by];
    const pieceHtml = (p, c) => `<span class="g ${c}">${glyph(p)}</span>`;
    const kind = m.piece.toLowerCase();
    const victimColor = m.by === 'w' ? 'b' : 'w';
    const whose = (S.mode === 'local' || victimColor !== S.me) ? (S.mode === 'local' ? `${COLOR_NAME[victimColor]}'s ` : 'the ') : 'your ';
    let text;
    if (m.flag === 'castle') {
      text = `Castled ${m.to > m.from ? 'kingside' : 'queenside'} (king and rook swapped sides)`;
    } else if (m.captured) {
      const victim = m.captured.toLowerCase();
      text = `${cap(PIECE_NAME[kind])} takes <span class="taken">${whose}${pieceHtml(m.captured, victimColor)} ${PIECE_NAME[victim]}</span> on <b>${E.name(m.to)}</b>` +
        (m.flag === 'ep' ? ' (en passant)' : '');
      box.classList.add('capture');
    } else {
      text = `${cap(PIECE_NAME[kind])} <b>${E.name(m.from)}</b> → <b>${E.name(m.to)}</b>`;
    }
    if (m.promo) text += ` and becomes a ${PIECE_NAME[m.promo.toLowerCase()]}!`;
    if (/#$/.test(m.san)) text += ' <b>Checkmate!</b>';
    else if (/\+$/.test(m.san)) text += ' <b>Check!</b>';
    box.innerHTML = `${pieceHtml(m.piece, m.by)}<span><b>${escapeHtml(who)}:</b> ${text}</span>`;
    if (fresh) { box.classList.remove('fresh'); void box.offsetWidth; box.classList.add('fresh'); }
  }

  // Slides the piece that just moved from its old square to its new one. If
  // something was taken, it flashes red and pops off the board on arrival.
  function animateMove(m, ms) {
    if (reducedMotion) return Promise.resolve();
    const wrap = $('boardWrap');
    const sqEl = sq => $('board').querySelector(`.sq[aria-label="${E.name(sq)}"]`);
    const wrapBox = wrap.getBoundingClientRect();
    const boxOf = el => { const b = el.getBoundingClientRect(); return { x: b.left - wrapBox.left, y: b.top - wrapBox.top, w: b.width, h: b.height }; };
    const ghosts = [];
    const makeGhost = (piece, at) => {
      const g = document.createElement('span');
      g.className = `glide pc ${E.colorOf(piece)}`;
      g.textContent = glyph(piece);
      const b = boxOf(at);
      Object.assign(g.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', fontSize: getComputedStyle(at).fontSize });
      wrap.appendChild(g);
      ghosts.push(g);
      return g;
    };
    const slide = (piece, fromSq, toSq) => {
      const from = sqEl(fromSq), to = sqEl(toSq);
      if (!from || !to) return;
      const landed = to.querySelector('.pc');
      if (landed) landed.style.visibility = 'hidden';
      const g = makeGhost(piece, from);
      g.classList.add('moving');
      const a = boxOf(from), b = boxOf(to);
      g.getBoundingClientRect();
      g.style.transition = `transform ${ms}ms cubic-bezier(.3,.75,.3,1)`;
      g.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`;
      from.classList.add('from-ring');
      setTimeout(() => {
        if (landed) landed.style.visibility = '';
        from.classList.remove('from-ring');
        to.classList.add('arrive');
        g.remove();
      }, ms);
    };
    // What got taken sits on its square until the attacker arrives.
    if (m.captured) {
      const capSq = m.flag === 'ep' ? m.to + (m.by === 'w' ? 8 : -8) : m.to;
      const at = sqEl(capSq);
      if (at) {
        const g = makeGhost(m.captured, at);
        setTimeout(() => {
          g.classList.add('taken');
          Blip.tone(180, 0.18, { type: 'sawtooth', volume: 0.07 });
          const bar = (m.by === bottomColor()) ? 'bottomTaken' : 'topTaken';
          $(bar).classList.remove('bump'); void $(bar).offsetWidth; $(bar).classList.add('bump');
        }, Math.max(0, ms - 60));
        setTimeout(() => g.remove(), ms + 600);
      }
    }
    slide(m.promo ? (m.by === 'w' ? 'P' : 'p') : m.piece, m.from, m.to);
    if (m.flag === 'castle') {
      const kingSide = m.to > m.from;
      const rook = m.by === 'w' ? 'R' : 'r';
      slide(rook, kingSide ? m.from + 3 : m.from - 4, kingSide ? m.from + 1 : m.from - 1);
    }
    return new Promise(r => setTimeout(r, ms + 120));
  }

  function seatName(color) {
    if (S.mode === 'ai') return color === S.me ? 'You' : `🤖 Computer · ${LEVEL_NAME[S.level]}`;
    if (S.mode === 'room' && S.snap) {
      const p = S.snap.players[color];
      if (!p) return 'Waiting…';
      return `${escapeHtml(p.name)}${color === S.me ? ' (you)' : ''}<span class="dot${p.online ? '' : ' off'}" title="${p.online ? 'Connected' : 'Not connected'}"></span>`;
    }
    return COLOR_NAME[color];
  }

  // What each side has taken, and who's ahead on material.
  function renderBars(bottom) {
    const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const left = { w: {}, b: {} };
    for (const p of S.state.board) if (p) { const c = E.colorOf(p); left[c][p.toLowerCase()] = (left[c][p.toLowerCase()] || 0) + 1; }
    const taken = (by) => {
      const victim = other(by);
      let html = '', points = 0;
      for (const k of ['q', 'r', 'b', 'n', 'p']) {
        const n = Math.max(0, START_COUNT[k] - (left[victim][k] || 0));
        html += glyph(k).repeat(n);
        points += n * VALUE[k];
      }
      return { html, points };
    };
    const top = other(bottom);
    for (const [bar, color] of [['top', top], ['bottom', bottom]]) {
      const mine = taken(color), theirs = taken(other(color));
      $(`${bar}Name`).innerHTML = seatName(color);
      $(`${bar}Taken`).innerHTML = mine.html + (mine.points > theirs.points ? `<b>+${mine.points - theirs.points}</b>` : '');
      $(`${bar}Bar`).classList.toggle('turn', !S.ended && S.state.turn === color);
    }
  }

  function resultLine(ended) {
    if (!ended) return '';
    if (ended.winner) {
      const how = ended.reason === 'checkmate' ? 'Checkmate' : ended.reason === 'resignation' ? 'Resigned' : ended.reason;
      if (S.mode === 'ai') return ended.winner === S.me ? `${how}! You win 🎉` : `${how}. The computer wins.`;
      if (S.mode === 'room') return ended.winner === S.me ? `${how}! You win 🎉` : `${how}. ${stripTags(seatName(ended.winner))} wins.`;
      return `${how}! ${COLOR_NAME[ended.winner]} wins 🎉`;
    }
    return `Draw: ${ended.reason}.`;
  }
  // Back to plain text (names were escaped for HTML in seatName).
  const stripTags = s => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent; };
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function renderStatus() {
    const line = $('statusLine');
    line.className = 'status-line';
    if (S.ended) { line.textContent = resultLine(S.ended) + ' Tap for results.'; return; }
    const check = E.inCheck(S.state);
    if (check) line.classList.add('alert');
    let text;
    if (S.thinking) { line.innerHTML = '<span class="thinking">🤖 Thinking</span>'; return; }
    if (S.mode === 'local') text = `${COLOR_NAME[S.state.turn]} to move`;
    else if (S.state.turn === S.me) text = 'Your move';
    else text = S.mode === 'room' ? `Waiting for ${stripTags(seatName(S.state.turn)).replace(' (you)', '')}` : 'Computer to move';
    line.textContent = (check ? 'Check! ' : '') + text;
  }

  function renderMoves() {
    const list = $('moveList');
    list.innerHTML = '';
    for (let i = 0; i < S.moves.length; i += 2) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${i / 2 + 1}.`;
      list.appendChild(n);
      for (const san of S.moves.slice(i, i + 2)) {
        const m = document.createElement('span');
        m.className = 'm';
        m.textContent = san;
        list.appendChild(m);
      }
    }
    list.scrollTop = list.scrollHeight;
  }

  function renderButtons() {
    const room = S.mode === 'room';
    $('suggestBtn').classList.toggle('hidden', room);
    $('undoBtn').classList.toggle('hidden', room);
    $('undoBtn').disabled = !S.history.length || S.thinking;
    $('drawBtn').classList.toggle('hidden', S.mode === 'ai');
    for (const id of ['suggestBtn', 'drawBtn', 'resignBtn']) {
      $(id).disabled = !!S.ended || (id === 'suggestBtn' && !myTurn());
    }
  }

  // ---- the end ----------------------------------------------------------------------

  // Points for beating the computer: harder levels and quicker wins score
  // more; each suggestion costs a little.
  function winPoints() {
    const base = { easy: 100, medium: 300, hard: 600 }[S.level];
    const mult = { easy: 1, medium: 2, hard: 3 }[S.level];
    const myMoves = Math.ceil(S.moves.length / 2);
    return Math.max(10, base + Math.max(0, 80 - myMoves) * mult * 2 - S.suggestions * 25 * mult);
  }

  let initials = null;
  function showOver() {
    const key = `${S.moves.length}:${S.ended && S.ended.reason}`;
    if (S.overShown === key) return;
    S.overShown = key;
    const e = S.ended;
    const won = e.winner && (S.mode === 'local' || e.winner === S.me);
    $('overEmoji').textContent = !e.winner ? '🤝' : won ? '🏆' : '😵';
    $('overTitle').textContent = resultLine(e);
    $('overHint').textContent = `${Math.ceil(S.moves.length / 2)} moves.` +
      (e.reason === 'stalemate' ? ' Stalemate: no legal moves, but not in check, so nobody wins.' : '');
    const scoring = S.mode === 'ai' && e.winner === S.me;
    $('overScore').classList.toggle('hidden', !scoring);
    $('saveScoreBtn').disabled = false;
    $('scoreMsg').textContent = '';
    if (scoring) {
      $('overPoints').textContent = winPoints().toLocaleString('en-US');
      setTimeout(() => initials.reset(), 50);
    }
    $('againBtn').textContent = S.mode === 'room' ? 'Rematch (swap colors)' : 'Play again';
    $('overView').classList.remove('hidden');
    if (e.winner) {
      if (won) Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], { type: 'triangle' });
      else Blip.tune([[392, 0.18], [330, 0.18], [262, 0.35]], { type: 'triangle' });
    }
  }

  async function saveScore() {
    const who = initials.value();
    if (!who) { $('scoreMsg').textContent = 'Type your initials first.'; return; }
    $('saveScoreBtn').disabled = true;
    try {
      const myMoves = Math.ceil(S.moves.length / 2);
      const r = await ArcadeKit.saveScore('chess', {
        initials: who, score: winPoints(), board: S.level,
        detail: `Won as ${COLOR_NAME[S.me]} in ${myMoves} moves${S.suggestions ? ` · ${S.suggestions} 💡` : ''}`,
        // On a TV it's the initials' score, not the TV's (see tv-play.js).
        ...(TvPlay.on ? { profileToken: null } : {})
      });
      initials.remember(who);
      $('overScore').classList.add('hidden');
      openScores(S.level, r.id);
      toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
    } catch (e) {
      $('scoreMsg').textContent = e.message;
      $('saveScoreBtn').disabled = false;
    }
  }

  function playAgain() {
    $('overView').classList.add('hidden');
    if (S.mode === 'room') { roomAct('rematch'); toast('Waiting for your opponent to agree…'); return; }
    newLocalGame(S.colorPref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : S.colorPref);
  }

  function backToSetup() {
    $('overView').classList.add('hidden');
    // Leaving a lobby gives up the seat (or closes it, for the host). A game
    // that started is saved, so it's only left, not ended.
    if (S.room && S.snap && S.snap.phase === 'lobby') roomCall('leave').catch(() => {});
    else if (S.room && S.state && !S.ended) toast('Your game is saved. Find it in Continue on the arcade\'s home page.');
    leaveRoom();
    $('gameChat').classList.add('hidden');
    if (S.mode === 'room') setMode('ai');
    S.state = null;
    show('setup');
  }

  function openScores(board, highlightId) {
    pressed($('scoreBoardSeg'), 'board', board);
    ArcadeKit.loadScores('chess', board, $('scoreList'), highlightId);
    $('scoresView').classList.remove('hidden');
  }

  function moveSound(move) {
    if (move.captured) { Blip.noise(0.07, 0.12); Blip.tone(260, 0.08, { type: 'triangle' }); }
    else Blip.tone(560, 0.05, { type: 'triangle', volume: 0.1 });
    if (S.state && !S.ended && E.inCheck(S.state)) Blip.tune([[880, 0.08], [660, 0.12]], { type: 'square', volume: 0.08 });
  }

  // ---- how to play ------------------------------------------------------------------------

  const help = Tutorial.create('chess', [
    {
      emoji: '🎯',
      title: 'The goal',
      html: `<p>Trap the other side's <b>king</b> so it has no way to escape. That's <b>checkmate</b>, and it wins the game.</p>
        <p>White always moves first, then you take turns, one move each.</p>`
    },
    {
      emoji: '👆',
      title: 'Making a move',
      html: `<p><b>Tap one of your pieces.</b> Dots show every square it can move to. A <b>ring</b> around an enemy piece means you can take it.</p>
        <p>Tap a dot to move there. Tap the piece again to put it back down.</p>
        <div class="tut-tip">The game only lets you make legal moves, so tapping around is the best way to learn.</div>`
    },
    {
      emoji: '♛',
      title: 'King, queen and rook',
      html: `<table>
          <tr><td>♚ King</td><td>One square in any direction. Keep it safe!</td></tr>
          <tr><td>♛ Queen</td><td>As far as she likes in a straight line or diagonal. The strongest piece.</td></tr>
          <tr><td>♜ Rook</td><td>As far as it likes up, down or sideways.</td></tr>
        </table>
        <p>Nothing can jump over other pieces, except the knight.</p>`
    },
    {
      emoji: '♞',
      title: 'Bishop, knight and pawn',
      html: `<table>
          <tr><td>♝ Bishop</td><td>As far as it likes on a diagonal.</td></tr>
          <tr><td>♞ Knight</td><td>An L shape: two squares one way, then one to the side. It jumps over pieces.</td></tr>
          <tr><td>♟ Pawn</td><td>Forward one square (two on its first move). It takes pieces one square diagonally forward.</td></tr>
        </table>`
    },
    {
      emoji: '⚠️',
      title: 'Check, checkmate, stalemate',
      html: `<p><b>Check</b>: your king is under attack (it glows red). You <b>must</b> get out of check on your move.</p>
        <p><b>Checkmate</b>: in check with no way out. Game over.</p>
        <p><b>Stalemate</b>: not in check, but no legal move at all. That's a <b>draw</b>, so don't trap a lonely king without checking it!</p>`
    },
    {
      emoji: '✨',
      title: 'Special moves',
      html: `<table>
          <tr><td>🏰 Castling</td><td>The king slides two squares toward a rook and the rook hops over it. Only if neither has moved and the king isn't in or passing through check.</td></tr>
          <tr><td>👑 Promotion</td><td>A pawn that reaches the far side becomes a queen (or anything you pick).</td></tr>
          <tr><td>🥷 En passant</td><td>If a pawn jumps two squares to land beside yours, you can take it as if it moved one, but only right away.</td></tr>
        </table>
        <p>When these are allowed, they show up as dots like any other move.</p>`
    },
    {
      emoji: '💡',
      title: 'Help while you play',
      html: `<p><b>💡 Suggest</b> highlights a good move. Against the computer it costs a few points.</p>
        <p><b>↶ Undo</b> takes back your last move. Against the computer it takes back its reply too.</p>
        <p>The move list underneath uses chess notation: <b>Nf3</b> means a knight moved to f3, <b>x</b> means a capture, <b>+</b> is check, <b>#</b> is checkmate.</p>`
    },
    {
      emoji: '🎮',
      title: 'Ways to play',
      html: `<table>
          <tr><td>🤖 VS Computer</td><td>Easy, Medium or Hard. Win to get on the 🏆 board.</td></tr>
          <tr><td>📱 Multiplayer-Single device</td><td>Two players take turns sharing this device. The board turns to face whoever's move it is.</td></tr>
          <tr><td>📱📱 Create a game lobby</td><td>Each player on their own phone. Choose who can join, then start once everyone taps Ready. There's a chat under the board, and the game is saved until you finish it.</td></tr>
          <tr><td>🔎 List Hosted Games</td><td>The lobbies waiting for players. Tap one to see who's in and join.</td></tr>
        </table>
        <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
    }
  ]);

  // ---- wiring ------------------------------------------------------------------------------

  for (const b of $('modeSeg').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  for (const b of $('levelSeg').children) b.addEventListener('click', () => { S.level = b.dataset.level; pressed($('levelSeg'), 'level', S.level); });
  for (const b of $('colorSeg').children) b.addEventListener('click', () => { S.colorPref = b.dataset.color; pressed($('colorSeg'), 'color', S.colorPref); });
  for (const b of $('scoreBoardSeg').children) b.addEventListener('click', () => openScores(b.dataset.board));
  $('goBtn').addEventListener('click', start);
  for (const b of $('whoSeg').children) b.addEventListener('click', () => setWho(b.dataset.who));
  for (const b of $('createColorSeg').children) b.addEventListener('click', () => { S.createColor = b.dataset.color; pressed($('createColorSeg'), 'color', S.createColor); });
  $('createBtn').addEventListener('click', createLobby);
  $('createBack').addEventListener('click', () => show('setup'));
  $('findBack').addEventListener('click', () => show('setup'));
  $('joinBtn').addEventListener('click', joinLobby);
  $('detailsClose').addEventListener('click', closeDetails);
  $('joinName').addEventListener('keydown', e => { if (e.key === 'Enter') joinLobby(); });
  $('readyBtn').addEventListener('click', setReady);
  $('lobbyLeave').addEventListener('click', backToSetup);
  $('lobbyStart').addEventListener('click', startRoom);
  for (const b of $('lobbyColorSeg').children) b.addEventListener('click', () => setColor(b.dataset.color));
  S.lobbyChat = LobbyUI.chat($('lobbyChat'), { send: sendChat });
  S.gameChat = LobbyUI.chat($('gameChat'), { send: sendChat });
  if (typeof ArcadeProfile !== 'undefined') ArcadeProfile.onChange(() => {
    if (!$('create').classList.contains('hidden')) $('hostNameRow').classList.toggle('hidden', !!profileToken());
    if (!$('detailsView').classList.contains('hidden')) $('dGuest').classList.toggle('hidden', !!profileToken());
    if (!$('find').classList.contains('hidden')) loadLobbies();
  });
  $('suggestBtn').addEventListener('click', suggest);
  $('undoBtn').addEventListener('click', undo);
  $('resignBtn').addEventListener('click', () => {
    if (S.ended || !confirm(S.mode === 'local' ? `${COLOR_NAME[S.state.turn]} resigns?` : 'Resign this game?')) return;
    if (S.mode === 'room') return roomAct('resign');
    const loser = S.mode === 'ai' ? S.me : S.state.turn;
    S.ended = { over: true, reason: 'resignation', winner: other(loser) };
    render();
    showOver();
  });
  $('drawBtn').addEventListener('click', () => {
    if (S.ended) return;
    if (S.mode === 'room') { roomAct('offer-draw'); toast('Draw offered. Waiting for an answer…'); return; }
    if (!confirm('Do both players agree to a draw?')) return;
    S.ended = { over: true, reason: 'agreement', winner: null };
    render();
    showOver();
  });
  $('drawAccept').addEventListener('click', () => { $('drawOfferView').classList.add('hidden'); roomAct('accept-draw'); });
  $('drawDecline').addEventListener('click', () => { $('drawOfferView').classList.add('hidden'); roomAct('decline-draw'); });
  $('statusLine').addEventListener('click', () => { if (S.ended) { S.overShown = null; showOver(); } });
  $('againBtn').addEventListener('click', playAgain);
  $('reviewBtn').addEventListener('click', () => $('overView').classList.add('hidden'));
  $('menuBtn').addEventListener('click', backToSetup);
  $('quitBtn').addEventListener('click', () => {
    if (S.mode !== 'room' && S.state && !S.ended && S.moves.length && !confirm('Leave this game?')) return;
    backToSetup();
  });
  $('saveScoreBtn').addEventListener('click', saveScore);
  $('scoresBtn').addEventListener('click', () => openScores(S.level));
  $('scoresClose').addEventListener('click', () => $('scoresView').classList.add('hidden'));
  $('helpBtn').addEventListener('click', () => help.open());
  Blip.muteButton($('muteBtn'));
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overScore .ini')], saveScore, { guest: TvPlay.on });

  // Back: from a game (or its results, or the two-phone lobby) to the setup
  // screen, asking first if moves have been played, and from there to the arcade.
  ArcadeBack.setup({
    atMenu: () => !$('setup').classList.contains('hidden'),
    back: () => {
      $('overView').classList.add('hidden');
      closeDetails();
      if (!$('create').classList.contains('hidden') || !$('find').classList.contains('hidden')) return show('setup');
      backToSetup();
    },
    // A game on two phones is saved, so leaving it needs no question.
    busy: () => S.mode !== 'room' && !$('game').classList.contains('hidden') && !!S.state && !S.ended && S.moves.length > 0,
    question: () => 'Leave this game? It ends here and won\'t be saved.'
  });

  // ---- on the TV ---------------------------------------------------------------------------
  // The board on the right, big; the players, the moves and the buttons on
  // the left. The squares are buttons, so the remote's arrows move the
  // highlight from square to square and OK picks a piece, then the square to
  // move it to. Playing the computer or two players sharing the remote; the
  // two-phone games (Host and Join) stay on phones.
  TvPlay.setup({
    stage: $('boardWrap'),
    steering: () => false,
    active: () => !!S.state && !S.ended && !$('game').classList.contains('hidden'),
    start: () => {
      if ($('game').classList.contains('hidden')) return null;
      const b = $('board');
      return b.querySelector('.sq.picked') || b.querySelector(`[data-sq="${S.lastMove ? S.lastMove.to : (S.me === 'b' && S.mode !== 'local' ? 12 : 52)}"]`);
    },
    hint: 'Move around the board with the arrows and press OK on one of your pieces, then OK on the square to move it to. Left of the board are Suggest, Undo and the rest.'
  });
  if (TvPlay.on) $('boardWrap').closest('.tv-stage').classList.add('hidden');

  // ---- boot --------------------------------------------------------------------------------

  setMode('ai');
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || params.get('join') || '').toUpperCase().slice(0, 4);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('chess.room') || 'null'); } catch { /* nothing saved */ }
  if (saved && saved.code && (!roomParam || saved.code === roomParam)) {
    // Coming back to a two-phone game after a refresh.
    S.room = saved;
    S.mode = 'room';
    connect();
  } else if (roomParam) {
    openRoom(roomParam);
  }
  help.autoOpen();
})();
