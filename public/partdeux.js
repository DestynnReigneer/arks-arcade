'use strict';

// Uh-Oh: Part Deux. The rules run on the server (partdeux/engine.js); this
// draws the table, the hand, and the overlays around them.

(() => {
  const { $, toast } = ArcadeKit;
  const API = '/api/partdeux';
  const TAGS = { skip: '⏭ Skip', draw2: '+2 Draw', reverse: '🔁 Reverse', nope: '🙅 Nope', gift: '🎁 Gift', wild: '🌈 Wild', wild4: '💣 +4 Wild' };
  const COLOR_HEX = { red: '#e5383b', yellow: '#f6c90e', green: '#2fbf71', blue: '#2e86de' };

  const S = {
    config: null, level: 'kids', mode: 'local', names: [typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.name() : '', ''],
    pin: (() => { try { return sessionStorage.getItem('pd.pin') || ''; } catch { return ''; } })(),
    adultOk: (() => { try { return sessionStorage.getItem('pd.adultOk') === 'yes'; } catch { return false; } })(),
    table: null,       // { kind: 'local', id, token } or { kind: 'room', code, playerId, token }
    snap: null, viewer: null, es: null, seenCallout: 0, overShown: false
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  const levelInfo = id => (S.config ? S.config.levels.find(l => l.id === id) : null) || { id: 'kids', label: 'Kids', adult: false };
  const unlocked = () => (S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
  const G = () => S.snap && S.snap.game;
  const show = id => { for (const s of ['setup', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id); };

  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(API + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { data });
    return data;
  }

  // ---- setup ---------------------------------------------------------------------

  function renderLevels(box, current, onPick) {
    box.innerHTML = '';
    for (const l of S.config.levels) {
      const b = document.createElement('button');
      b.className = 'level';
      b.setAttribute('aria-pressed', String(l.id === current));
      b.innerHTML = '<div class="l-name"></div><div class="l-blurb"></div>';
      b.querySelector('.l-name').textContent = `${l.emoji} ${l.label}`;
      b.querySelector('.l-blurb').textContent = l.blurb;
      if (l.adult && !unlocked()) b.insertAdjacentHTML('beforeend', '<div class="l-lock">🔞 Adults only</div>');
      b.onclick = () => onPick(l.id);
      box.appendChild(b);
    }
  }

  function paintLevel(level) {
    const adult = levelInfo(level).adult;
    document.documentElement.classList.toggle('adult-mode', adult);
    $('drinkRow').classList.toggle('hidden', !adult);
  }

  async function pickLevel(id) {
    if (levelInfo(id).adult && !unlocked() && !(await unlockAdult())) return;
    S.level = id;
    renderLevels($('levelList'), S.level, pickLevel);
    paintLevel(id);
  }

  function unlockAdult() {
    if (!S.config.adultRequiresPin) {
      const ok = confirm('This deck is for adults only (18+). Continue?');
      if (ok) { S.adultOk = true; try { sessionStorage.setItem('pd.adultOk', 'yes'); } catch { /* unavailable */ } }
      return Promise.resolve(ok);
    }
    return new Promise(resolve => {
      $('pinInput').value = '';
      $('pinMsg').textContent = '';
      $('pinView').classList.remove('hidden');
      $('pinInput').focus();
      const done = ok => { $('pinView').classList.add('hidden'); $('pinOk').onclick = $('pinCancel').onclick = null; resolve(ok); };
      $('pinOk').onclick = async () => {
        const pin = $('pinInput').value.trim();
        const r = await api('/unlock', { method: 'POST', body: { pin } }).catch(() => ({ ok: false }));
        if (!r.ok) { $('pinMsg').textContent = 'That PIN is not right.'; return; }
        S.pin = pin;
        try { sessionStorage.setItem('pd.pin', pin); } catch { /* unavailable */ }
        done(true);
      };
      $('pinCancel').onclick = () => done(false);
    });
  }

  function setMode(mode) {
    S.mode = mode;
    for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    for (const m of ['local', 'host', 'join']) $(`${m}Setup`).classList.toggle('hidden', m !== mode);
    $('goBtn').textContent = mode === 'host' ? 'Get a game code' : mode === 'join' ? 'Join the game' : 'Deal \'em';
    $('levelList').closest('.panel').classList.toggle('hidden', mode === 'join');
  }

  function renderNames() {
    const list = $('nameList');
    list.innerHTML = '';
    S.names.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'name-row';
      row.innerHTML = `<input maxlength="16" placeholder="Player ${i + 1}"><button title="Remove">✕</button>`;
      const input = row.querySelector('input');
      input.value = n;
      input.oninput = () => { S.names[i] = input.value; };
      row.querySelector('button').onclick = () => { if (S.names.length > 2) { S.names.splice(i, 1); renderNames(); } };
      list.appendChild(row);
    });
    $('addPlayerBtn').classList.toggle('hidden', S.names.length >= 8);
  }

  async function go() {
    Blip.unlock();
    $('setupMsg').textContent = '';
    const drinking = levelInfo(S.level).adult && $('drinkingOpt').checked;
    try {
      if (S.mode === 'local') {
        const names = S.names.map((n, i) => n.trim() || `Player ${i + 1}`);
        const r = await api('/local', { method: 'POST', body: { names, level: S.level, drinking }, headers: pinHeaders() });
        S.table = { kind: 'local', id: r.id, token: r.token };
        S.viewer = null;
        S.seenCallout = 0;
        S.overShown = false;
        return applySnap(r);
      }
      if (S.mode === 'host') {
        const r = await RoomPassword.withPassword(password =>
          api('/rooms', { method: 'POST', body: { name: $('hostName').value, level: S.level, drinking, password }, headers: pinHeaders() }));
        if (r) enterRoom(r);
        return;
      }
      const code = $('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { $('setupMsg').textContent = 'Codes are 4 letters.'; return; }
      const r = await RoomPassword.withPassword(password =>
        api(`/rooms/${code}/join`, { method: 'POST', body: { name: $('joinName').value, password } }));
      if (r) enterRoom(r);
    } catch (e) { $('setupMsg').textContent = e.message; }
  }

  // ---- rooms ------------------------------------------------------------------------

  function enterRoom(r) {
    S.table = { kind: 'room', code: r.code, playerId: r.playerId, token: r.token };
    try { sessionStorage.setItem('pd.room', JSON.stringify(S.table)); } catch { /* unavailable */ }
    S.seenCallout = 0;
    S.overShown = false;
    connect();
  }

  function connect() {
    if (S.es) S.es.close();
    const { code, playerId, token } = S.table;
    S.es = new EventSource(`${API}/rooms/${code}/events?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`);
    S.es.addEventListener('state', e => applySnap(JSON.parse(e.data)));
    S.es.onerror = () => {
      fetch(`${API}/rooms/${code}?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`)
        .then(r => { if (r.status === 404 || r.status === 403) { closeRoom(); show('setup'); toast('That game has ended.'); } }).catch(() => {});
    };
  }

  function closeRoom() {
    if (S.es) { S.es.close(); S.es = null; }
    try { sessionStorage.removeItem('pd.room'); } catch { /* unavailable */ }
  }

  const roomCreds = () => ({ playerId: S.table.playerId, token: S.table.token });

  async function send(body) {
    try {
      if (S.table.kind === 'local') {
        const snap = await api(`/local/${S.table.id}/act`, { method: 'POST', body: { ...body, as: body.as || S.viewer }, headers: { 'X-Table-Token': S.table.token } });
        applySnap(snap);
      } else {
        applySnap(await api(`/rooms/${S.table.code}/act`, { method: 'POST', body: { ...roomCreds(), ...body } }));
      }
    } catch (e) { toast(e.message); }
  }

  // ---- drawing everything ----------------------------------------------------------------

  const me = () => (S.table.kind === 'room' ? S.snap.you : S.viewer);
  const nameOf = id => ((G() && G().players.find(p => p.id === id)) || {}).name || '?';
  const myHand = () => (S.table.kind === 'room' ? G().hand : (G().hands && G().hands[S.viewer]) || []);

  function applySnap(snap) {
    S.snap = snap;
    document.documentElement.classList.toggle('adult-mode', levelInfo(snap.level).adult);
    if (snap.kind === 'room' && !snap.game) return renderLobby(snap);
    if (snap.kind === 'room' && snap.game.phase === 'over' && S.overShown && !$('overView').classList.contains('hidden')) { /* keep results */ }
    show('game');
    renderGame();
  }

  function renderLobby(snap) {
    show('lobby');
    $('lobbyCode').textContent = snap.code;
    if ($('joinQr').dataset.code !== snap.code) { $('joinQr').dataset.code = snap.code; ArcadeQR.forGame($('joinQr'), 'partdeux.html', snap.code, $('joinLink')); }
    const lv = levelInfo(snap.level);
    $('lobbyInfo').textContent = `Deck: ${lv.emoji} ${lv.label}` + (snap.drinking ? ' · 🍺 Drinking' : '') +
      (snap.lobbyPassword ? ` · 🔒 Password: ${snap.lobbyPassword}` : snap.locked ? ' · 🔒 Locked' : '');
    $('lobbyCount').textContent = `(${snap.players.length})`;
    const ul = $('lobbyPlayers');
    ul.innerHTML = '';
    for (const p of snap.players) {
      const li = document.createElement('li');
      li.className = p.online ? '' : 'offline';
      li.textContent = p.name;
      if (p.id === snap.you) li.insertAdjacentHTML('beforeend', '<span class="tag">you</span>');
      if (p.host) li.insertAdjacentHTML('beforeend', '<span class="tag">host</span>');
      ul.appendChild(li);
    }
    $('hostControls').classList.toggle('hidden', !snap.youAreHost);
    $('waitHost').classList.toggle('hidden', snap.youAreHost);
    if (snap.youAreHost) {
      renderLevels($('lobbyLevels'), snap.level, async id => {
        if (levelInfo(id).adult && !unlocked() && !(await unlockAdult())) return;
        try {
          await RoomPassword.withPassword(password => api(`/rooms/${snap.code}/settings`, { method: 'POST', body: { ...roomCreds(), level: id, password }, headers: pinHeaders() }));
        } catch (e) { $('lobbyMsg').textContent = e.message; }
      });
      $('lobbyDrinkRow').classList.toggle('hidden', !lv.adult);
      $('lobbyDrinking').checked = snap.drinking;
      $('startBtn').disabled = snap.players.length < 2;
    }
  }

  function cardEl(c, { mini = false } = {}) {
    const el = document.createElement('div');
    el.className = `card ${c.color || 'wild'}`;
    if (c.kind === 'num') {
      el.innerHTML = '<span class="corner"></span><span class="big"></span>';
      el.querySelector('.corner').textContent = c.value;
      el.querySelector('.big').textContent = c.value;
    } else {
      el.innerHTML = '<span class="face"><span class="emo"></span></span><span class="nm"></span><span class="tag"></span>';
      el.querySelector('.emo').textContent = c.emoji;
      el.querySelector('.nm').textContent = mini ? '' : c.name;
      el.querySelector('.tag').textContent = TAGS[c.kind];
    }
    el.title = c.kind === 'num' ? `${c.color} ${c.value}` : `${c.name}: ${c.rule}`;
    return el;
  }

  function renderGame() {
    const g = G();
    const local = S.table.kind === 'local';

    // One phone: hide the hand until the right person has it.
    if (local && g.phase !== 'over' && g.turn !== S.viewer) {
      $('passTitle').textContent = `Pass the phone to ${nameOf(g.turn)}`;
      const forgot = g.vulnerable && g.vulnerable !== g.turn;
      $('passCatch').classList.toggle('hidden', !forgot);
      if (forgot) {
        $('passCatchText').textContent = `🚨 ${nameOf(g.vulnerable)} has one card and never said "Uh-Oh!"`;
        $('passCatchBtn').textContent = `Catch ${nameOf(g.vulnerable)}! (+2 cards)`;
        $('passCatchBtn').onclick = () => send({ action: 'catch', as: g.turn, target: g.vulnerable });
      }
      $('passReady').onclick = () => { S.viewer = g.turn; $('passCover').classList.add('hidden'); renderGame(); };
      $('passCover').classList.remove('hidden');
    } else {
      $('passCover').classList.add('hidden');
    }

    const viewer = me();
    const myTurn = g.phase !== 'over' && g.turn === viewer;

    // Everyone else around the table
    const opp = $('opponents');
    opp.innerHTML = '';
    for (const p of g.players) {
      if (p.id === viewer) continue;
      const li = document.createElement('li');
      li.className = (p.id === g.turn ? 'now' : '') + (p.cards === 1 ? ' one' : '');
      li.innerHTML = '<span class="nm"></span><span class="n"></span>';
      li.querySelector('.nm').textContent = p.name;
      li.querySelector('.n').textContent = p.cards;
      if (p.cards === 1) li.insertAdjacentHTML('beforeend', '<span class="alert">UH-OH!</span>');
      if (g.vulnerable === p.id && viewer && !local) {
        const b = document.createElement('button');
        b.textContent = 'Catch!';
        b.onclick = () => send({ action: 'catch', target: p.id });
        li.appendChild(b);
      }
      opp.appendChild(li);
    }

    // The pile
    const discard = $('discard');
    discard.innerHTML = '';
    if (g.top) discard.appendChild(cardEl(g.top));
    discard.style.setProperty('--now', COLOR_HEX[g.color] || '#fff');
    $('deckCount').textContent = `${g.deckCount} left`;
    $('dirArrow').classList.toggle('ccw', g.dir < 0);
    $('pendingBanner').classList.toggle('hidden', !g.pendingDraw);
    $('pendingBanner').textContent = g.pendingDraw ? `+${g.pendingDraw} waiting for ${nameOf(g.turn)}! Draw, or bounce it with a 🙅 Nope.` : '';

    const line = $('turnLine');
    line.className = 'turn-line' + (myTurn ? ' mine' : '');
    line.textContent = g.phase === 'over' ? `${nameOf(g.winner)} wins! 🏆`
      : myTurn ? (g.drew ? 'You drew a card you can play. Play it, or keep it.' : `Your turn. The color is ${g.color}.`)
        : `${nameOf(g.turn)}'s turn · color: ${g.color}`;

    // My hand
    const hand = $('hand');
    hand.innerHTML = '';
    hand.classList.toggle('myturn', myTurn);
    const cards = viewer ? myHand() : [];
    const playable = new Set(local ? playableLocal(g, cards) : g.playable);
    for (const c of cards) {
      const el = cardEl(c);
      if (myTurn && playable.has(c.id)) el.classList.add('ok');
      el.onclick = () => tapCard(c, myTurn && playable.has(c.id));
      hand.appendChild(el);
    }

    const handSize = cards.length;
    $('uhohBtn').classList.toggle('hidden', !(myTurn && handSize === 2 && g.calledUhOh !== viewer));
    $('drawBtn').classList.toggle('hidden', !!g.drew);
    $('drawBtn').disabled = !myTurn;
    $('drawBtn').textContent = g.pendingDraw && myTurn ? `Draw ${g.pendingDraw}` : 'Draw a card';
    $('drawPile').disabled = !myTurn || !!g.drew;
    $('keepBtn').classList.toggle('hidden', !(myTurn && g.drew));

    $('log').innerHTML = '';
    for (const l of g.log) { const d = document.createElement('div'); d.textContent = l; $('log').appendChild(d); }
    $('log').scrollTop = $('log').scrollHeight;

    showCallouts(g);
    if (g.phase === 'over') showOver(g);
  }

  // On one phone the server sends every hand; work out what can be played here.
  function playableLocal(g, cards) {
    if (g.phase === 'over' || g.turn !== S.viewer) return [];
    return cards.filter(c => {
      if (g.drew && g.drew !== c.id) return false;
      if (g.pendingDraw) return c.kind === 'nope';
      if (c.kind === 'wild' || c.kind === 'wild4') return true;
      if (c.color === g.color) return true;
      if (c.kind === 'num') return g.top.kind === 'num' && g.top.value === c.value;
      return c.kind === g.top.kind;
    }).map(c => c.id);
  }

  // Tap a playable card to play it. Tap any other card to see what it does.
  async function tapCard(c, canPlay) {
    Blip.unlock();
    if (!canPlay) return openSheet(c);
    if (c.kind === 'wild' || c.kind === 'wild4') {
      const color = await pickColor();
      if (!color) return;
      Blip.tone(520, 0.08, { type: 'triangle' });
      return send({ action: 'play', cardId: c.id, color });
    }
    if (c.kind === 'gift') {
      const pickedGift = await pickGift(c);
      if (!pickedGift) return;
      return send({ action: 'play', cardId: c.id, ...pickedGift });
    }
    Blip.tone(c.kind === 'num' ? 560 : 700, 0.06, { type: 'triangle', volume: 0.1 });
    send({ action: 'play', cardId: c.id });
  }

  function openSheet(c) {
    const box = $('sheetCard');
    box.innerHTML = '';
    box.appendChild(cardEl(c));
    $('sheetName').textContent = c.kind === 'num' ? `${c.color} ${c.value}` : c.name;
    $('sheetQuip').textContent = c.quip || '';
    $('sheetRule').textContent = c.rule;
    const g = G();
    $('sheetWhy').textContent = g.turn !== me() ? '' : g.pendingDraw ? 'Right now only a Nope can bounce the draw.' : 'This one doesn\'t match the color or number right now.';
    $('cardSheet').classList.remove('hidden');
  }

  function pickColor() {
    return new Promise(resolve => {
      const row = $('colorRow');
      row.innerHTML = '';
      for (const color of ['red', 'yellow', 'green', 'blue']) {
        const b = document.createElement('button');
        b.className = color;
        b.textContent = color;
        b.onclick = () => { $('colorPick').classList.add('hidden'); resolve(color); };
        row.appendChild(b);
      }
      $('colorCancel').onclick = () => { $('colorPick').classList.add('hidden'); resolve(null); };
      $('colorPick').classList.remove('hidden');
    });
  }

  function pickGift(giftCard) {
    return new Promise(resolve => {
      const others = myHand().filter(c => c.id !== giftCard.id);
      if (!others.length) { toast('You need another card to give away.'); resolve(null); return; }
      let chosen = null;
      const cards = $('giftCards');
      cards.innerHTML = '';
      for (const c of others) {
        const el = cardEl(c, { mini: true });
        el.onclick = () => { chosen = c.id; for (const x of cards.children) x.classList.remove('pick'); el.classList.add('pick'); };
        cards.appendChild(el);
      }
      const targets = $('giftTargets');
      targets.innerHTML = '';
      for (const p of G().players) {
        if (p.id === me()) continue;
        const b = document.createElement('button');
        b.className = 'ghost';
        b.textContent = `🎁 Give it to ${p.name}`;
        b.onclick = () => {
          if (!chosen) { toast('Pick a card first.'); return; }
          $('giftPick').classList.add('hidden');
          resolve({ giftCardId: chosen, target: p.id });
        };
        targets.appendChild(b);
      }
      $('giftCancel').onclick = () => { $('giftPick').classList.add('hidden'); resolve(null); };
      $('giftPick').classList.remove('hidden');
    });
  }

  // Drinking mode: new party rules pop up one at a time.
  let calloutQueue = Promise.resolve();
  function showCallouts(g) {
    for (const c of g.callouts) {
      if (c.n <= S.seenCallout) continue;
      S.seenCallout = c.n;
      calloutQueue = calloutQueue.then(() => new Promise(resolve => {
        $('calloutWho').textContent = c.name ? c.name.toUpperCase() : 'EVERYONE';
        $('calloutText').textContent = c.text;
        $('calloutView').classList.remove('hidden');
        Blip.tune([[392, 0.1], [523, 0.15]], { type: 'triangle', volume: 0.08 });
        const t = setTimeout(done, 4000);
        function done() { clearTimeout(t); $('calloutView').classList.add('hidden'); resolve(); }
        $('calloutOk').onclick = done;
      }));
    }
  }

  function showOver(g) {
    if (S.overShown) return;
    S.overShown = true;
    const iWon = g.winner === me() || S.table.kind === 'local';
    $('overTitle').textContent = `${nameOf(g.winner)} wins!`;
    $('overHint').textContent = g.players.filter(p => p.id !== g.winner).map(p => `${p.name}: ${p.cards} left`).join(' · ');
    $('againBtn').classList.toggle('hidden', S.table.kind === 'room' && !S.snap.youAreHost);
    setTimeout(() => $('overView').classList.remove('hidden'), 900);
    if (iWon) Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], { type: 'triangle' });
  }

  async function playAgain() {
    $('overView').classList.add('hidden');
    S.overShown = false;
    S.seenCallout = 0;
    try {
      if (S.table.kind === 'local') {
        S.viewer = null;
        applySnap(await api(`/local/${S.table.id}/rematch`, { method: 'POST', headers: { 'X-Table-Token': S.table.token } }));
      } else {
        await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() });
      }
    } catch (e) { toast(e.message); }
  }

  async function leave() {
    if (S.table && S.table.kind === 'room') {
      try { await api(`/rooms/${S.table.code}/leave`, { method: 'POST', body: roomCreds() }); } catch { /* gone anyway */ }
      closeRoom();
    }
    S.table = null;
    S.snap = null;
    for (const id of ['overView', 'passCover', 'calloutView']) $(id).classList.add('hidden');
    show('setup');
    paintLevel(S.level);
  }

  // ---- how to play --------------------------------------------------------------------------

  const help = Tutorial.create('partdeux', [
    { emoji: '🎯', title: 'The goal', html: '<p>Be the first to get rid of <b>all your cards</b>.</p><p>Everyone starts with 7. Play one card on your turn, if you can.</p>' },
    { emoji: '🃏', title: 'Matching', html: '<p>Play a card that matches the top of the pile by <b>color</b> or by <b>number</b> (or the same action).</p><p>Can\'t play? <b>Draw a card.</b> If it fits, you can play it right away; or keep it and end your turn.</p><div class="tut-tip">Tap a card that can be played to play it. Tap any other card to see what it does.</div>' },
    { emoji: '😂', title: 'The action cards', html: `<p>Every deck gives them different funny names, but the <b>tag at the bottom</b> always says what they do:</p><table>
        <tr><td>⏭ Skip</td><td>Next player misses a turn.</td></tr>
        <tr><td>+2 Draw</td><td>Next player draws 2 and misses a turn.</td></tr>
        <tr><td>🔁 Reverse</td><td>Turn order flips.</td></tr>
        <tr><td>🙅 Nope</td><td>Bounce a +2 or +4 on to the next player.</td></tr>
        <tr><td>🎁 Gift</td><td>Give one of your cards away. One closer to winning!</td></tr>
        <tr><td>🌈 Wild</td><td>Play on anything and pick the color.</td></tr>
        <tr><td>💣 +4 Wild</td><td>Pick the color; the next player draws 4.</td></tr>
      </table>` },
    { emoji: '🚨', title: 'Say "Uh-Oh!"', html: '<p>When you\'re about to play your <b>second-to-last card</b>, tap <b>Say "Uh-Oh!"</b> first.</p><p>Forget, and anyone can <b>catch</b> you before the next turn: you draw 2.</p>' },
    { emoji: '🍺', title: 'Grown-up decks', html: '<p>Cheeky, Spicy and Filthy decks have naughtier card names, behind the adult PIN.</p><p><b>🍺 Drinking</b>: drink a sip for every card you\'re forced to draw, drink when you\'re caught, and when someone wins, everyone else drinks.</p><div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>' }
  ]);

  // ---- wiring ---------------------------------------------------------------------------------

  for (const b of $('modeSeg').children) b.onclick = () => setMode(b.dataset.mode);
  $('addPlayerBtn').onclick = () => { if (S.names.length < 8) { S.names.push(''); renderNames(); } };
  $('goBtn').onclick = go;
  $('joinCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('drawBtn').onclick = () => { Blip.tone(330, 0.06, { type: 'triangle' }); send({ action: 'draw' }); };
  $('drawPile').onclick = () => $('drawBtn').click();
  $('keepBtn').onclick = () => send({ action: 'pass' });
  $('uhohBtn').onclick = () => { Blip.tune([[880, 0.08], [660, 0.08], [880, 0.12]], { type: 'square', volume: 0.07 }); send({ action: 'uhoh' }); };
  $('sheetClose').onclick = () => $('cardSheet').classList.add('hidden');
  $('startBtn').onclick = async () => { try { await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() }); } catch (e) { $('lobbyMsg').textContent = e.message; } };
  $('lobbyDrinking').onchange = () => api(`/rooms/${S.table.code}/settings`, { method: 'POST', body: { ...roomCreds(), drinking: $('lobbyDrinking').checked } }).catch(e => toast(e.message));
  $('leaveBtn').onclick = leave;
  $('quitBtn').onclick = () => { if (confirm('Leave this game?')) leave(); };
  $('passLeave').onclick = () => { if (confirm('Leave this game?')) leave(); };
  $('againBtn').onclick = playAgain;
  $('menuBtn').onclick = leave;
  $('helpBtn').onclick = () => help.open();
  Blip.muteButton($('muteBtn'));

  // ---- boot ---------------------------------------------------------------------------------------
  (async () => {
    try { S.config = await api('/config'); } catch { $('setupMsg').textContent = 'Could not reach the server.'; return; }
    renderLevels($('levelList'), S.level, pickLevel);
    paintLevel(S.level);
    renderNames();
    setMode('local');
    const join = new URLSearchParams(location.search).get('join');
    if (join) { setMode('join'); $('joinCode').value = join.toUpperCase().slice(0, 4); }
    try {
      const saved = JSON.parse(sessionStorage.getItem('pd.room') || 'null');
      if (saved && saved.code) { S.table = saved; connect(); }
    } catch { /* nothing saved */ }
    help.autoOpen();
  })();
})();
