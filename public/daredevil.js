'use strict';

// Dare Devil: draw a card, do the dare (or chicken out). The deck and
// scoring run on the server (daredevil/engine.js); this draws it.

(() => {
  const { $, toast } = ArcadeKit;
  const API = '/api/daredevil';
  const S = {
    config: null, level: 'kids', length: 'standard', mode: 'local', names: [typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.name() : '', ''],
    pin: (() => { try { return sessionStorage.getItem('dd.pin') || ''; } catch { return ''; } })(),
    adultOk: (() => { try { return sessionStorage.getItem('dd.adultOk') === 'yes'; } catch { return false; } })(),
    table: null, snap: null, es: null, seenCallout: 0, overShown: false
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  const levelInfo = id => (S.config ? S.config.levels.find(l => l.id === id) : null) || { id: 'kids', label: 'Family', adult: false };
  const unlocked = () => (S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
  const G = () => S.snap && S.snap.game;
  const show = id => { for (const s of ['setup', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id); };

  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { data });
    return data;
  }

  // ---- setup -----------------------------------------------------------------------

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
    renderLevels($('levelList'), id, pickLevel);
    paintLevel(id);
  }
  function unlockAdult() {
    if (!S.config.adultRequiresPin) {
      const ok = confirm('These cards are for adults only (18+). Continue?');
      if (ok) { S.adultOk = true; try { sessionStorage.setItem('dd.adultOk', 'yes'); } catch { /* unavailable */ } }
      return Promise.resolve(ok);
    }
    return new Promise(resolve => {
      $('pinInput').value = '';
      $('pinMsg').textContent = '';
      $('pinView').classList.remove('hidden');
      const done = ok => { $('pinView').classList.add('hidden'); resolve(ok); };
      PinPad.attach($('pinInput'), async pin => {
        const r = await api('/unlock', { method: 'POST', body: { pin } }).catch(() => ({ ok: false }));
        if (!r.ok) { $('pinMsg').textContent = 'That PIN is not right.'; PinPad.clear($('pinInput')); return; }
        S.pin = pin;
        try { sessionStorage.setItem('dd.pin', pin); } catch { /* unavailable */ }
        done(true);
      });
      $('pinCancel').onclick = () => done(false);
    });
  }
  function setMode(mode) {
    S.mode = mode;
    for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    for (const m of ['local', 'host', 'join']) $(`${m}Setup`).classList.toggle('hidden', m !== mode);
    $('goBtn').textContent = mode === 'host' ? 'Get a game code' : mode === 'join' ? 'Join the game' : 'I dare you';
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
    $('addPlayerBtn').classList.toggle('hidden', S.names.length >= 12);
  }

  async function go() {
    Blip.unlock();
    $('setupMsg').textContent = '';
    const drinking = levelInfo(S.level).adult && $('drinkingOpt').checked;
    const options = { length: S.length };
    try {
      if (S.mode === 'local') {
        const names = S.names.map((n, i) => n.trim() || `Player ${i + 1}`);
        if (window.ArcadeStats) ArcadeStats.play();
        const r = await api('/local', { method: 'POST', body: { names, level: S.level, drinking, options }, headers: pinHeaders() });
        S.table = { kind: 'local', id: r.id, token: r.token };
        S.seenCallout = 0;
        S.overShown = false;
        return applySnap(r);
      }
      if (S.mode === 'host') {
        const r = await RoomPassword.withPassword(password =>
          api('/rooms', { method: 'POST', body: { name: $('hostName').value, level: S.level, drinking, password, options }, headers: pinHeaders() }));
        if (r) enterRoom(r);
        return;
      }
      const code = $('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { $('setupMsg').textContent = 'Codes are 4 letters.'; return; }
      const r = await RoomPassword.withPassword(password => api(`/rooms/${code}/join`, { method: 'POST', body: { name: $('joinName').value, password } }));
      if (r) enterRoom(r);
    } catch (e) { $('setupMsg').textContent = e.message; }
  }

  // ---- rooms ---------------------------------------------------------------------------

  function enterRoom(r) {
    S.table = { kind: 'room', code: r.code, playerId: r.playerId, token: r.token };
    try { sessionStorage.setItem('dd.room', JSON.stringify(S.table)); } catch { /* unavailable */ }
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
    try { sessionStorage.removeItem('dd.room'); } catch { /* unavailable */ }
  }
  const roomCreds = () => ({ playerId: S.table.playerId, token: S.table.token });

  async function send(action) {
    try {
      if (S.table.kind === 'local') {
        applySnap(await api(`/local/${S.table.id}/act`, { method: 'POST', body: { action, as: G().turn }, headers: { 'X-Table-Token': S.table.token } }));
      } else {
        applySnap(await api(`/rooms/${S.table.code}/act`, { method: 'POST', body: { ...roomCreds(), action } }));
      }
    } catch (e) { toast(e.message); }
  }

  // ---- drawing ---------------------------------------------------------------------------

  const nameOf = id => ((G() && G().players.find(p => p.id === id)) || {}).name || '?';

  function applySnap(snap) {
    S.snap = snap;
    document.documentElement.classList.toggle('adult-mode', levelInfo(snap.level).adult);
    if (snap.kind === 'room' && !snap.game) return renderLobby(snap);
    show('game');
    renderGame();
  }

  function renderLobby(snap) {
    show('lobby');
    $('lobbyCode').textContent = snap.code;
    if ($('joinQr').dataset.code !== snap.code) { $('joinQr').dataset.code = snap.code; ArcadeQR.forGame($('joinQr'), 'daredevil.html', snap.code, $('joinLink')); }
    const lv = levelInfo(snap.level);
    $('lobbyInfo').textContent = `${lv.emoji} ${lv.label} · ${(snap.options && snap.options.length) || 'standard'} game` + (snap.drinking ? ' · 🍺 Drinking' : '') +
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
        try { await RoomPassword.withPassword(password => api(`/rooms/${snap.code}/settings`, { method: 'POST', body: { ...roomCreds(), level: id, password }, headers: pinHeaders() })); }
        catch (e) { $('lobbyMsg').textContent = e.message; }
      });
      $('lobbyDrinkRow').classList.toggle('hidden', !lv.adult);
      $('lobbyDrinking').checked = snap.drinking;
      $('startBtn').disabled = snap.players.length < 2;
    }
  }

  function renderGame() {
    const g = G();
    const local = S.table.kind === 'local';
    const myTurn = g.phase !== 'over' && (local || g.turn === S.snap.you);

    const strip = $('scoreStrip');
    strip.innerHTML = '';
    for (const p of g.players) {
      const li = document.createElement('li');
      li.className = p.id === g.turn ? 'now' : '';
      li.innerHTML = '<span></span><b></b>';
      li.firstChild.textContent = p.name;
      li.lastChild.textContent = p.score;
      strip.appendChild(li);
    }
    $('ruleBanner').classList.toggle('hidden', !g.rule);
    $('ruleBanner').textContent = g.rule ? `📜 ${g.rule}` : '';

    const turn = $('turnLine');
    turn.innerHTML = '';
    if (g.phase === 'over') turn.textContent = 'Game over!';
    else {
      const who = document.createElement('span');
      who.textContent = local ? nameOf(g.turn) : g.turn === S.snap.you ? 'You' : nameOf(g.turn);
      turn.append(who, local || g.turn !== S.snap.you ? `'s turn` : `r turn`);
    }

    const drawing = g.phase === 'draw';
    $('deckBtn').classList.toggle('hidden', !drawing);
    $('deckBtn').disabled = !myTurn;
    $('deckTap').textContent = myTurn ? 'Tap to draw' : `${nameOf(g.turn)} is drawing…`;
    $('deckLeft').textContent = `${g.left} of ${g.total} cards left`;

    const card = g.card;
    $('dareCard').classList.toggle('hidden', !card);
    if (card) {
      $('dareCard').classList.toggle('bomb', card.type === 'bomb');
      $('dcEmoji').textContent = card.emoji;
      $('dcLabel').textContent = card.label;
      $('dcPts').textContent = `+${card.points}`;
      $('dcText').textContent = card.text;
      $('dcBtns').classList.toggle('hidden', !myTurn);
      $('doneBtn').textContent = `✅ Did it! +${card.points}`;
      $('chickenBtn').textContent = g.drinking ? '🐔 Chicken out (drink 3)' : '🐔 Chicken out (−1)';
      $('dcWait').textContent = myTurn ? '' : `Waiting for ${nameOf(g.turn)}…`;
    }

    timeCard(card, g, myTurn);

    $('log').innerHTML = '';
    for (const l of g.log) { const d = document.createElement('div'); d.textContent = l; $('log').appendChild(d); }
    $('log').scrollTop = $('log').scrollHeight;

    showCallouts(g);
    if (g.phase === 'over') showOver(g);
  }

  // ---- timed dares ---------------------------------------------------------------------------
  // A card that says "for 10 seconds" gets a timer: a few seconds to read it
  // first, then the countdown with the thinking tune, then the buzzer.
  const GRACE = 5;
  const timer = { key: null, run: null, grace: null };

  function stopTimer() {
    if (timer.run) timer.run.stop();
    clearInterval(timer.grace);
    timer.run = timer.grace = null;
  }

  function paintTimer(state, label, num, fraction) {
    const box = $('dcTimer');
    box.className = `dc-timer ${state}`;
    $('dctLabel').textContent = label;
    $('dctNum').textContent = num;
    $('dctFill').style.transform = `scaleX(${fraction})`;
  }

  function timeCard(card, g, myTurn) {
    const match = card && /(\d+)[- ]second/i.exec(card.text);
    const secs = match ? Math.min(120, Number(match[1])) : 0;
    const key = secs ? `${g.left}|${card.text}` : null;
    if (key === timer.key) { $('dctGo').classList.toggle('hidden', !myTurn || !timer.grace); return; }
    stopTimer();
    timer.key = key;
    $('dcTimer').classList.toggle('hidden', !secs);
    if (!secs) return;

    const start = () => {
      clearInterval(timer.grace);
      timer.grace = null;
      $('dctGo').classList.add('hidden');
      paintTimer('', 'Go!', secs, 1);
      timer.run = Blip.think(secs, {
        onTick: left => paintTimer(left <= 3 ? 'final' : '', 'Go!', left, left / secs),
        onDone: () => paintTimer('done', 'Time!', '⏰', 0)
      });
    };
    let wait = GRACE;
    paintTimer('reading', `Read it. ${secs}-second timer starts in`, wait, 1);
    $('dctGo').classList.toggle('hidden', !myTurn);
    $('dctGo').onclick = () => { Blip.unlock(); start(); };
    timer.grace = setInterval(() => {
      wait--;
      if (wait <= 0) return start();
      paintTimer('reading', `Read it. ${secs}-second timer starts in`, wait, wait / GRACE);
    }, 1000);
  }

  let queue = Promise.resolve();
  function showCallouts(g) {
    for (const c of g.callouts) {
      if (c.n <= S.seenCallout) continue;
      S.seenCallout = c.n;
      queue = queue.then(() => new Promise(resolve => {
        $('calloutWho').textContent = c.name ? c.name.toUpperCase() : 'EVERYONE';
        $('calloutText').textContent = c.text;
        $('calloutView').classList.remove('hidden');
        const t = setTimeout(done, 4000);
        function done() { clearTimeout(t); $('calloutView').classList.add('hidden'); resolve(); }
        $('calloutOk').onclick = done;
      }));
    }
  }

  function showOver(g) {
    if (S.overShown) return;
    S.overShown = true;
    const ranked = g.players.slice().sort((a, b) => b.score - a.score);
    $('overTitle').textContent = `${nameOf(g.winner)} is the Dare Devil!`;
    const ol = $('finalList');
    ol.innerHTML = '';
    for (const p of ranked) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><b></b>';
      li.firstChild.textContent = p.name + (p.chickens ? ` (🐔×${p.chickens})` : '');
      li.lastChild.textContent = p.score;
      ol.appendChild(li);
    }
    $('againBtn').classList.toggle('hidden', S.table.kind === 'room' && !S.snap.youAreHost);
    setTimeout(() => $('overView').classList.remove('hidden'), 700);
    Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], { type: 'triangle' });
  }

  async function playAgain() {
    $('overView').classList.add('hidden');
    S.overShown = false;
    S.seenCallout = 0;
    try {
      if (S.table.kind === 'local') applySnap(await api(`/local/${S.table.id}/rematch`, { method: 'POST', headers: { 'X-Table-Token': S.table.token } }));
      else await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() });
    } catch (e) { toast(e.message); }
  }

  async function leave() {
    stopTimer();
    timer.key = null;
    if (S.table && S.table.kind === 'room') {
      try { await api(`/rooms/${S.table.code}/leave`, { method: 'POST', body: roomCreds() }); } catch { /* gone */ }
      closeRoom();
    }
    S.table = null;
    S.snap = null;
    $('overView').classList.add('hidden');
    show('setup');
    paintLevel(S.level);
  }

  const help = Tutorial.create('daredevil', [
    { emoji: '😈', title: 'The goal', html: '<p>On your turn, <b>draw a card and do what it says</b>. Do it and you score points; chicken out and you pay for it.</p><p>Most points when the deck runs out is the <b>Dare Devil</b>.</p>' },
    { emoji: '🃏', title: 'The cards', html: `<table>
        <tr><td>😈 Dare</td><td>Do it. +2</td></tr>
        <tr><td>🙊 Truth</td><td>Answer honestly. +1</td></tr>
        <tr><td>📜 New rule</td><td>Stays in play until the next rule. +1</td></tr>
        <tr><td>🙋 Everyone</td><td>The whole table plays. +1</td></tr>
        <tr><td>👉 Pick someone</td><td>Choose who does it. +1</td></tr>
        <tr><td>🎯 Challenge</td><td>A quick contest. +2</td></tr>
        <tr><td>💣 Uh-Oh!</td><td>A big one. +3</td></tr>
      </table>` },
    { emoji: '🐔', title: 'Chickening out', html: '<p>Don\'t want to? Tap <b>Chicken out</b>. You lose a point, or in <b>🍺 Drinking</b> mode you drink 3 sips instead.</p>' },
    { emoji: '🔞', title: 'How wild?', html: '<p><b>Family</b> is silly dares for everyone. <b>Cheeky</b>, <b>Spicy</b> and <b>Filthy</b> unlock with the adult PIN and get raunchier as you go, from flirting to clothes coming off.</p><p>Hosting an adult game? You\'ll make a lobby password for your guests.</p><div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>' }
  ]);

  // ---- wiring -------------------------------------------------------------------------------
  for (const b of $('modeSeg').children) b.onclick = () => setMode(b.dataset.mode);
  for (const b of $('lengthSeg').children) b.onclick = () => { S.length = b.dataset.v; for (const x of $('lengthSeg').children) x.setAttribute('aria-pressed', String(x === b)); };
  $('addPlayerBtn').onclick = () => { if (S.names.length < 12) { S.names.push(''); renderNames(); } };
  $('goBtn').onclick = go;
  $('joinCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('deckBtn').onclick = () => { Blip.tone([300, 900], 0.15, { type: 'triangle' }); send('draw'); };
  $('doneBtn').onclick = () => { Blip.tune([[660, 0.08], [990, 0.14]], { type: 'triangle' }); send('done'); };
  $('chickenBtn').onclick = () => { Blip.tune([[500, 0.08], [380, 0.08], [300, 0.14]], { type: 'square', volume: 0.06 }); send('chicken'); };
  $('startBtn').onclick = async () => { if (window.ArcadeStats) ArcadeStats.play(); try { await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() }); } catch (e) { $('lobbyMsg').textContent = e.message; } };
  $('lobbyDrinking').onchange = () => api(`/rooms/${S.table.code}/settings`, { method: 'POST', body: { ...roomCreds(), drinking: $('lobbyDrinking').checked } }).catch(e => toast(e.message));
  $('leaveBtn').onclick = leave;
  $('quitBtn').onclick = () => { if (confirm('Leave this game?')) leave(); };
  $('againBtn').onclick = playAgain;
  $('menuBtn').onclick = leave;
  $('helpBtn').onclick = () => help.open();
  Blip.muteButton($('muteBtn'));

  (async () => {
    try { S.config = await api('/config'); } catch { $('setupMsg').textContent = 'Could not reach the server.'; return; }
    renderLevels($('levelList'), S.level, pickLevel);
    paintLevel(S.level);
    renderNames();
    setMode('local');
    const join = new URLSearchParams(location.search).get('join');
    if (join) { setMode('join'); $('joinCode').value = join.toUpperCase().slice(0, 4); }
    try {
      const saved = JSON.parse(sessionStorage.getItem('dd.room') || 'null');
      if (saved && saved.code) { S.table = saved; connect(); }
    } catch { /* nothing saved */ }
    help.autoOpen();
  })();
})();
