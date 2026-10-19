'use strict';

// Short Fuse client. One file for both ways of playing:
//   local - one phone passed around; a cover screen hides each hand between turns
//   room  - a phone each; the server pushes state over server-sent events
// The server owns the rules. This only shows state and sends moves.

const API = '/api/shortfuse';
const $ = id => document.getElementById(id);

const S = {
  config: null,
  level: 'kids',
  mode: 'local',
  names: ['', ''],
  pin: sessionGet('sf.pin') || '',
  adultOk: sessionGet('sf.adultOk') === 'yes',
  table: null,        // { kind: 'local', id, token } | { kind: 'room', code, playerId, token }
  snap: null,
  stream: null,
  selected: [],
  viewer: null,       // local: whose hand the phone is showing right now
  seenPeek: null,
  reactionTick: null
};

// ---- small helpers -----------------------------------------------------------

function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }
function sessionDel(k) { try { sessionStorage.removeItem(k); } catch { /* private mode */ } }

const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

let toastTimer = null;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error('Could not reach the game server.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}

const levelInfo = id => S.config.levels.find(l => l.id === id) || S.config.levels[0];

function paintPalette(level) {
  document.documentElement.classList.toggle('adult', !!levelInfo(level).adult);
  document.documentElement.classList.toggle('adult-mode', !!levelInfo(level).adult);
}

// What each kind of card does, in two words. Card names change with the deck
// (a kids Skip is "Nap Time", a filthy one is "Post-Nut Clarity"); the tag is
// how you know what you are holding without memorizing every joke.
const TAGS = {
  bomb: '💣 Bomb', defuse: '✂️ Defuse', skip: '⏭ Skip', attack: '⚔️ Attack',
  shuffle: '🔀 Shuffle', peek: '👀 Peek', favor: '🎁 Favor', nope: '🙅 Nope', junk: '🃏 Pair up'
};

function cardEl(card, { onClick, selected } = {}) {
  const el = document.createElement(onClick ? 'button' : 'div');
  el.className = `card k-${card.kind}${selected ? ' selected' : ''}`;
  if (onClick) { el.type = 'button'; el.onclick = onClick; }
  el.innerHTML = '<div class="c-tag"></div><div class="c-emoji"></div><div class="c-name"></div><div class="c-quip"></div><div class="c-rule"></div>';
  el.querySelector('.c-tag').textContent = TAGS[card.kind] || card.kind;
  el.querySelector('.c-emoji').textContent = card.emoji;
  el.querySelector('.c-name').textContent = card.name;
  el.querySelector('.c-quip').textContent = card.quip;
  el.querySelector('.c-rule').textContent = card.rule;
  return el;
}

// ---- setup -------------------------------------------------------------------

function renderLevels(host, current, onPick) {
  host.innerHTML = '';
  for (const l of S.config.levels) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'level';
    b.setAttribute('aria-pressed', String(l.id === current));
    b.innerHTML = '<div class="l-name"></div><div class="l-blurb"></div>';
    b.querySelector('.l-name').textContent = `${l.emoji} ${l.label}`;
    b.querySelector('.l-blurb').textContent = l.blurb;
    if (l.adult) {
      const lock = document.createElement('div');
      lock.className = 'l-lock';
      lock.textContent = '🔞 Adults only';
      b.appendChild(lock);
    }
    b.onclick = () => onPick(l.id);
    host.appendChild(b);
  }
}

// Adult levels need the PIN when one is set, or a one-tap "I'm an adult" when not.
async function unlockAdult() {
  if (S.config.adultRequiresPin ? S.pin : S.adultOk) return true;
  if (!S.config.adultRequiresPin) {
    const ok = confirm('This deck is for adults only (18+). Continue?');
    if (ok) { S.adultOk = true; sessionSet('sf.adultOk', 'yes'); }
    return ok;
  }
  return new Promise(resolve => {
    $('pinInput').value = '';
    $('pinMsg').textContent = '';
    show('pinView');
    $('pinInput').focus();
    const done = ok => { hide('pinView'); $('pinOk').onclick = $('pinCancel').onclick = null; resolve(ok); };
    $('pinCancel').onclick = () => done(false);
    $('pinOk').onclick = async () => {
      const pin = $('pinInput').value.trim();
      try {
        const r = await api('/unlock', { method: 'POST', body: { pin } });
        if (!r.ok) { $('pinMsg').textContent = 'That PIN is not right.'; return; }
        S.pin = pin;
        sessionSet('sf.pin', pin);
        done(true);
      } catch (e) { $('pinMsg').textContent = e.message; }
    };
  });
}

async function pickLevel(id) {
  if (levelInfo(id).adult && !(await unlockAdult())) return;
  S.level = id;
  paintPalette(id);
  renderLevels($('levelList'), S.level, pickLevel);
}

function setMode(mode) {
  S.mode = mode;
  for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('localSetup').classList.toggle('hidden', mode !== 'local');
  $('hostSetup').classList.toggle('hidden', mode !== 'host');
  $('joinSetup').classList.toggle('hidden', mode !== 'join');
  $('goBtn').textContent = mode === 'join' ? 'Join' : mode === 'host' ? 'Create game' : 'Light the fuse';
  $('levelList').closest('.panel').classList.toggle('hidden', mode === 'join');
}

function renderNames() {
  const host = $('nameList');
  host.innerHTML = '';
  S.names.forEach((n, i) => {
    const row = document.createElement('div');
    row.className = 'name-row';
    const input = document.createElement('input');
    input.maxLength = 16;
    input.placeholder = `Player ${i + 1}`;
    input.value = n;
    input.oninput = () => { S.names[i] = input.value; };
    row.appendChild(input);
    if (S.names.length > 2) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.title = 'Remove';
      del.onclick = () => { S.names.splice(i, 1); renderNames(); };
      row.appendChild(del);
    }
    host.appendChild(row);
  });
  $('addPlayerBtn').classList.toggle('hidden', S.names.length >= S.config.maxPlayers);
}

const pinHeader = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});

async function go() {
  $('setupMsg').textContent = '';
  try {
    if (S.mode === 'local') {
      const names = S.names.map((n, i) => n.trim() || `Player ${i + 1}`);
      const r = await api('/local', { method: 'POST', body: { names, level: S.level }, headers: pinHeader() });
      S.table = { kind: 'local', id: r.id, token: r.token };
      S.viewer = null;
      enterGame(r);
    } else if (S.mode === 'host') {
      const r = await api('/rooms', { method: 'POST', body: { name: $('hostName').value, level: S.level }, headers: pinHeader() });
      joinedRoom(r);
    } else {
      const code = $('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { $('setupMsg').textContent = 'Codes are 4 letters.'; return; }
      const r = await api(`/rooms/${code}/join`, { method: 'POST', body: { name: $('joinName').value } });
      joinedRoom(r);
    }
  } catch (e) {
    $('setupMsg').textContent = e.message;
    if (/PIN/.test(e.message)) { S.pin = ''; sessionDel('sf.pin'); }
  }
}

function screen(id) {
  for (const s of ['setup', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
}

function backToSetup() {
  closeStream();
  S.table = null;
  S.snap = null;
  sessionDel('sf.room');
  for (const o of document.querySelectorAll('.overlay')) o.classList.add('hidden');
  paintPalette(S.level);
  screen('setup');
}

// ---- rooms ---------------------------------------------------------------------

function joinedRoom(r) {
  S.table = { kind: 'room', code: r.code, playerId: r.playerId, token: r.token };
  sessionSet('sf.room', JSON.stringify(S.table));
  openStream();
}

function openStream() {
  closeStream();
  const { code, playerId, token } = S.table;
  S.stream = new EventSource(`${API}/rooms/${code}/events?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`);
  S.stream.addEventListener('state', e => applyRoom(JSON.parse(e.data)));
  S.stream.onerror = () => { /* EventSource retries on its own */ };
}

function closeStream() {
  if (S.stream) S.stream.close();
  S.stream = null;
}

const roomCreds = () => ({ playerId: S.table.playerId, token: S.table.token });

function applyRoom(snap) {
  S.snap = snap;
  S.clockSkew = snap.serverNow - Date.now();
  paintPalette(snap.level);
  if (!snap.game) return renderLobby(snap);
  if (!$('lobby').classList.contains('hidden') || !$('setup').classList.contains('hidden')) screen('game');
  renderGame();
}

function renderLobby(snap) {
  screen('lobby');
  $('lobbyCode').textContent = snap.code;
  if ($('joinQr').dataset.code !== snap.code) { $('joinQr').dataset.code = snap.code; ArcadeQR.forGame($('joinQr'), 'shortfuse.html', snap.code, $('joinLink')); }
  $('lobbyCount').textContent = `(${snap.players.length}/${snap.maxPlayers})`;
  const list = $('lobbyPlayers');
  list.innerHTML = '';
  for (const p of snap.players) {
    const li = document.createElement('li');
    li.className = p.connected ? '' : 'offline';
    li.textContent = p.name;
    if (p.isHost) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'HOST'; li.appendChild(t); }
    if (p.id === snap.you) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'YOU'; li.appendChild(t); }
    list.appendChild(li);
  }
  const lv = levelInfo(snap.level);
  $('lobbyLevel').textContent = `Deck: ${lv.emoji} ${lv.label}`;
  $('hostControls').classList.toggle('hidden', !snap.youAreHost);
  $('waitHost').classList.toggle('hidden', snap.youAreHost);
  if (snap.youAreHost) {
    renderLevels($('lobbyLevels'), snap.level, async id => {
      if (levelInfo(id).adult && !(await unlockAdult())) return;
      try {
        await api(`/rooms/${snap.code}/level`, { method: 'POST', body: { ...roomCreds(), level: id }, headers: pinHeader() });
      } catch (e) { $('lobbyMsg').textContent = e.message; }
    });
    $('startBtn').disabled = snap.players.length < 2;
  }
}

// ---- the game --------------------------------------------------------------------

function enterGame(localSnap) {
  screen('game');
  applyLocal(localSnap);
}

function applyLocal(snap) {
  S.snap = snap;
  paintPalette(snap.game.level);
  renderGame();
}

const G = () => S.snap.game;
const seat = id => G().seats.find(s => s.id === id);
const nameOf = id => (seat(id) || { name: '?' }).name;

// Whose screen this is right now. In a room it is always you.
function me() {
  return S.table.kind === 'room' ? S.snap.you : S.viewer;
}

function myHand() {
  if (S.table.kind === 'room') return G().hand;
  return (G().hands && G().hands[S.viewer]) || [];
}

// Who has to touch the phone next, on a shared phone.
function neededSeat() {
  const g = G();
  if (g.phase === 'over' || g.phase === 'reaction') return null;
  if (g.phase === 'favor') return g.pending.target;
  if (g.phase === 'defuse') return g.defusing.playerId;
  return g.turn;
}

function renderGame() {
  const g = G();
  S.selected = S.selected.filter(id => myHand().some(c => c.id === id));

  // Shared phone: hide everything until the right person says they have it.
  if (S.table.kind === 'local') {
    const need = neededSeat();
    if (need && need !== S.viewer) {
      S.viewer = null;
      $('passTitle').textContent = `Pass the phone to ${nameOf(need)}`;
      $('passHint').textContent = g.phase === 'favor'
        ? `${nameOf(g.pending.by)} wants a favor. Only ${nameOf(need)} should look.`
        : 'No peeking, everyone else.';
      $('passReady').onclick = () => { S.viewer = need; hide('passCover'); renderGame(); };
      show('passCover');
    } else {
      hide('passCover');
    }
  }

  const mine = g.turn === me();
  $('deckCount').textContent = g.deckCount;
  $('bombLine').textContent = `💣 ${g.bombsLeft} bomb${g.bombsLeft === 1 ? '' : 's'} in the pile`;
  $('discardFace').textContent = g.discardTop ? g.discardTop.emoji : '·';
  const turnLine = $('turnLine');
  turnLine.textContent = g.phase === 'over' ? 'Game over'
    : mine ? `Your turn${g.turnsOwed > 1 ? ` (${g.turnsOwed} to take)` : ''}`
      : `${nameOf(g.turn)}'s turn${g.turnsOwed > 1 ? ` (${g.turnsOwed})` : ''}`;
  turnLine.classList.toggle('mine', mine && g.phase !== 'over');

  const seats = $('seatList');
  seats.innerHTML = '';
  for (const s of g.seats) {
    const li = document.createElement('li');
    li.className = s.out ? 'out' : s.id === g.turn ? 'now' : '';
    li.textContent = `${s.out ? '💥' : s.id === g.turn ? '▶' : ''} ${s.name} · ${s.handCount}🂠`;
    seats.appendChild(li);
  }

  const log = $('log');
  log.innerHTML = '';
  for (const line of g.log) {
    const d = document.createElement('div');
    d.textContent = line.text;
    log.appendChild(d);
  }
  log.scrollTop = log.scrollHeight;
  const newest = g.log[g.log.length - 1];
  if (newest && newest.seq !== S.lastSeq) {
    if (S.lastSeq && /blew up/.test(newest.text)) { document.body.classList.add('boom'); setTimeout(() => document.body.classList.remove('boom'), 700); }
    S.lastSeq = newest.seq;
  }

  const viewing = me();
  $('handTitle').textContent = S.table.kind === 'local' && viewing ? `${nameOf(viewing)}'s hand` : 'Your hand';
  const out = viewing && seat(viewing) && seat(viewing).out;
  renderCoach(mine, out);

  const hand = $('hand');
  hand.innerHTML = '';
  for (const c of myHand()) {
    hand.appendChild(cardEl(c, { onClick: () => openCardSheet(c) }));
  }

  const canAct = mine && g.phase === 'play' && !out;
  $('drawBtn').disabled = !canAct;

  renderReaction();
  renderFavor();
  renderDefuse();
  renderPeek();
  renderOver();
}

const ACTIONS = ['skip', 'attack', 'shuffle', 'peek', 'favor'];

// The one line that says what to do now, in plain words.
function renderCoach(mine, out) {
  const g = G();
  const el = $('coach');
  let html;
  let waiting = true;
  if (g.phase === 'over') html = 'Game over.';
  else if (out) html = '💥 You blew up. Hang around and watch who goes next!';
  else if (!mine) {
    const hasNope = myHand().some(c => c.kind === 'nope');
    html = `Waiting for <b>${escapeHtml(nameOf(g.turn))}</b>.` + (hasNope
      ? ' You have a <b>Nope</b> — if they play an action card, you can cancel it.'
      : ' Nothing to do until your turn.');
  } else if (g.phase === 'play') {
    waiting = false;
    const owed = g.turnsOwed > 1 ? ` You were attacked: take <b>${g.turnsOwed} turns</b> (draw ${g.turnsOwed} times).` : '';
    const actions = myHand().filter(c => ACTIONS.includes(c.kind)).length;
    html = `<b>Your turn.</b>${owed} ` + (actions
      ? 'Play a card first if you want (tap it), then tap <b>Draw</b> to end your turn.'
      : 'No action cards to play — just tap <b>Draw</b> to end your turn.');
    if (g.bombsLeft && g.deckCount && g.bombsLeft / g.deckCount >= 0.25) {
      html += ' ⚠️ The pile is getting dangerous.';
    }
  } else {
    html = 'Hang on…';
  }
  el.innerHTML = html;
  el.classList.toggle('waiting', waiting);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Tap a card: what it does, how to use it, and a button to play it if you can.
function openCardSheet(card) {
  const g = G();
  const mine = g.turn === me() && g.phase === 'play' && !(seat(me()) || {}).out;
  const pair = myHand().filter(c => c.type === card.type);
  const host = $('sheetCard');
  host.innerHTML = '';
  host.appendChild(cardEl(card));
  $('sheetDoes').textContent = card.rule;

  const how = {
    bomb: 'You should never be holding one of these!',
    defuse: 'Just keep it. If you draw a bomb, your Defuse is used automatically and you survive. Then you get to hide the bomb back in the pile — put it on top to blow up the next player.',
    skip: 'Play it on your turn instead of drawing. Your turn ends and you don\'t have to draw — handy when you think a bomb is on top.',
    attack: 'Play it on your turn instead of drawing. You don\'t draw, and the next player has to take two turns in a row.',
    shuffle: 'Play it on your turn to shuffle the pile. Good when you know (or fear) a bomb is near the top. You still draw afterwards.',
    peek: 'Play it on your turn to secretly see the top three cards. Then decide: draw, or Skip/Attack to dodge a bomb.',
    favor: 'Play it on your turn and pick another player. They choose a card from their hand to give you.',
    nope: 'Keep it. When anyone plays an action card, a big NOPE button pops up — tap it to cancel their card. You can even Nope a Nope.',
    junk: pair.length >= 2
      ? 'You have a matching pair! Play both together on your turn to steal a random card from another player.'
      : 'On its own it does nothing. Collect a second one with the same picture, then play the pair to steal a random card from someone.'
  }[card.kind];
  $('sheetHow').textContent = how;

  const btn = $('sheetPlay');
  let play = null;
  if (mine && ACTIONS.includes(card.kind)) {
    play = { cards: [card.id], action: card.kind, target: card.kind === 'favor' };
    btn.textContent = `Play ${card.name}`;
  } else if (mine && card.kind === 'junk' && pair.length >= 2) {
    play = { cards: [pair[0].id, pair[1].id], action: 'steal', target: true };
    btn.textContent = 'Play the pair — steal a card';
  }
  btn.classList.toggle('hidden', !play);
  btn.onclick = async () => {
    hide('cardSheet');
    let target = null;
    if (play.target) {
      target = await pickTarget(play.action === 'favor' ? 'Who has to do you a favor?' : 'Steal from who?');
      if (!target) return;
    }
    take(await send({ action: 'play', cards: play.cards, target }));
  };
  show('cardSheet');
}

async function send(body) {
  try {
    if (S.table.kind === 'local') {
      const snap = await api(`/local/${S.table.id}/act`, {
        method: 'POST', body: { ...body, as: body.as || S.viewer }, headers: { 'X-Table-Token': S.table.token }
      });
      return snap;
    }
    return await api(`/rooms/${S.table.code}/act`, { method: 'POST', body: { ...roomCreds(), ...body } });
  } catch (e) {
    toast(e.message);
    return null;
  }
}

// Apply a response. Rooms also get it over the stream, but using the reply
// straight away makes the phone feel instant.
function take(snap) {
  if (!snap) return;
  if (S.table.kind === 'local') applyLocal(snap);
  else applyRoom(snap);
}

function pickTarget(title) {
  return new Promise(resolve => {
    $('targetTitle').textContent = title;
    const list = $('targetList');
    list.innerHTML = '';
    for (const s of G().seats) {
      if (s.out || s.id === me() || !s.handCount) continue;
      const b = document.createElement('button');
      b.className = 'ghost';
      b.textContent = `${s.name} (${s.handCount} cards)`;
      b.onclick = () => { hide('targetPick'); resolve(s.id); };
      list.appendChild(b);
    }
    $('targetCancel').onclick = () => { hide('targetPick'); resolve(null); };
    show('targetPick');
  });
}

async function drawCard() {
  const drawer = me();
  const snap = await send({ action: 'draw' });
  if (!snap) return;
  const g = snap.game;
  const drawn = g.lastDraw && g.lastDraw.playerId === drawer ? g.lastDraw.card : null;
  // Show what you drew before the phone gets passed on.
  if (drawn && drawn.type !== 'bomb') {
    $('drawTitle').textContent = 'You drew';
    $('drawCard').innerHTML = '';
    $('drawCard').appendChild(cardEl(drawn));
    show('drawView');
    $('drawClose').onclick = () => { hide('drawView'); take(snap); };
    return;
  }
  if (drawn && drawn.type === 'bomb' && g.phase !== 'defuse') toast(`💥 ${drawn.name}! ${drawn.quip}`, 3500);
  take(snap);
}

// ---- overlays driven by state ---------------------------------------------------

function renderReaction() {
  const g = G();
  clearInterval(S.reactionTick);
  if (g.phase !== 'reaction' || !g.pending) { hide('reaction'); return; }
  const p = g.pending;
  const played = $('reactionCard');
  played.innerHTML = '';
  played.appendChild(cardEl(p.cards[0]));
  const target = p.target ? ` → ${nameOf(p.target)}` : '';
  $('reactionTitle').textContent = p.nopes % 2
    ? `Noped! Anyone Nope the Nope?`
    : `${nameOf(p.by)} played ${p.cards.length === 2 ? 'a pair' : p.cards[0].name}${target}. Nope it?`;

  const buttons = $('reactionButtons');
  buttons.innerHTML = '';
  const timer = $('reactionTimer');

  if (S.table.kind === 'local') {
    // One phone: put it in the middle of the table. Anyone with a Nope shouts
    // it and taps their own name. Every other player gets a button, holding a
    // Nope or not, so the buttons don't give anyone's hand away. If nobody
    // moves before the countdown ends, the card goes ahead.
    $('reactionTitle').textContent = (p.nopes % 2
      ? 'Noped! Anyone Nope the Nope?'
      : `${nameOf(p.by)} played ${p.cards.length === 2 ? 'a pair' : p.cards[0].name}${target}.`) +
      ' 🙅 Got a Nope? Shout it and tap your name!';
    timer.classList.remove('hidden');
    const bar = document.createElement('div');
    timer.innerHTML = '';
    timer.appendChild(bar);
    const total = 5000;
    const ends = Date.now() + total;
    let fired = false;
    const goAhead = async () => { if (fired) return; fired = true; clearInterval(S.reactionTick); take(await send({ action: 'resolve' })); };
    S.reactionTick = setInterval(() => {
      const left = Math.max(0, ends - Date.now());
      bar.style.width = `${(left / total) * 100}%`;
      if (!left) goAhead();
    }, 100);
    for (const s of g.seats) {
      if (s.out) continue;
      const b = document.createElement('button');
      b.className = 'ghost';
      b.textContent = `🙅 ${s.name}: NOPE!`;
      b.onclick = async () => {
        if (fired) return;
        fired = true;
        clearInterval(S.reactionTick);
        // No Nope in that hand: the server says so, and the countdown starts again.
        const snap = await send({ action: 'nope', as: s.id });
        if (!snap) { renderReaction(); return; }
        take(snap);
      };
      buttons.appendChild(b);
    }
    const go = document.createElement('button');
    go.className = 'primary';
    go.textContent = p.nopes % 2 ? 'Nobody: it stays Noped' : 'Nobody: go ahead';
    go.onclick = goAhead;
    buttons.appendChild(go);
  } else {
    timer.classList.remove('hidden');
    const bar = document.createElement('div');
    timer.innerHTML = '';
    timer.appendChild(bar);
    const ends = S.snap.reactionEndsAt;
    const total = S.snap.reactionMs;
    const tick = () => {
      const left = Math.max(0, ends - (Date.now() + (S.clockSkew || 0)));
      bar.style.width = `${(left / total) * 100}%`;
    };
    tick();
    if (ends) S.reactionTick = setInterval(tick, 100);
    const myNope = G().hand.some(c => c.type === 'nope') && !(seat(me()) || {}).out;
    const b = document.createElement('button');
    b.className = myNope ? 'primary' : 'ghost';
    b.disabled = !myNope;
    b.textContent = myNope ? '🙅 NOPE!' : 'No Nope in your hand';
    b.onclick = async () => take(await send({ action: 'nope' }));
    buttons.appendChild(b);
  }
  show('reaction');
}

function renderFavor() {
  const g = G();
  if (g.phase !== 'favor' || g.pending.target !== me()) { hide('givePick'); return; }
  $('giveTitle').textContent = `Give ${nameOf(g.pending.by)} a card`;
  $('giveHint').textContent = 'Your choice. Choose wisely.';
  const host = $('giveHand');
  host.innerHTML = '';
  for (const c of myHand()) {
    host.appendChild(cardEl(c, { onClick: async () => { hide('givePick'); take(await send({ action: 'give', card: c.id })); } }));
  }
  show('givePick');
}

function renderDefuse() {
  const g = G();
  if (g.phase !== 'defuse' || g.defusing.playerId !== me()) { hide('defusePick'); return; }
  const range = $('defuseRange');
  range.max = g.deckCount;
  if (Number(range.value) > g.deckCount) range.value = 0;
  const where = () => {
    const v = Number(range.value);
    $('defuseWhere').textContent = v === 0 ? 'On top — the very next card drawn.'
      : v >= g.deckCount ? 'At the very bottom.' : `${v} card${v === 1 ? '' : 's'} down from the top.`;
  };
  range.oninput = where;
  where();
  $('defuseHere').onclick = async () => take(await send({ action: 'place', position: Number(range.value) }));
  $('defuseRandom').onclick = async () => take(await send({ action: 'place', position: Math.floor(Math.random() * (g.deckCount + 1)) }));
  show('defusePick');
}

function renderPeek() {
  const g = G();
  const p = g.peek;
  if (!p || p.playerId !== me()) return;
  const key = `${p.playerId}:${p.cards.map(c => c.id).join()}`;
  if (S.seenPeek === key) return;
  S.seenPeek = key;
  const host = $('peekCards');
  host.innerHTML = '';
  p.cards.forEach(c => host.appendChild(cardEl(c)));
  show('peekView');
}

function renderOver() {
  const g = G();
  if (g.phase !== 'over') { hide('overView'); return; }
  const won = g.winner === me();
  $('overTitle').textContent = S.table.kind === 'room' && won ? 'You survived! 🎉' : `${nameOf(g.winner)} wins!`;
  $('overHint').textContent = 'Last one standing. Everyone else went boom.';
  const isHost = S.table.kind === 'local' || S.snap.youAreHost;
  $('againBtn').classList.toggle('hidden', !isHost);
  $('againBtn').onclick = async () => {
    try {
      if (S.table.kind === 'local') {
        S.viewer = null;
        hide('overView');
        applyLocal(await api(`/local/${S.table.id}/rematch`, { method: 'POST', headers: { 'X-Table-Token': S.table.token } }));
      } else {
        await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() });
      }
    } catch (e) { toast(e.message); }
  };
  $('menuBtn').onclick = leave;
  show('overView');
}

async function leave() {
  if (S.table && S.table.kind === 'room') {
    try { await api(`/rooms/${S.table.code}/leave`, { method: 'POST', body: roomCreds() }); } catch { /* gone anyway */ }
  }
  backToSetup();
}

// ---- how to play -----------------------------------------------------------------

const tutorial = Tutorial.create('shortfuse', [
  {
    emoji: '💣',
    title: 'The goal',
    html: `<p>Somewhere in the draw pile are <b>bombs</b>. Draw one and you're <b>out</b>.</p>
      <p>Be the <b>last player standing</b>.</p>
      <p>Everybody draws from the same pile, so every card drawn makes the next draw more dangerous.</p>`
  },
  {
    emoji: '🔁',
    title: 'Your turn, in two steps',
    html: `<ol><li><b>Play cards</b> if you want to — as many as you like, or none. Tap a card to see what it does and play it.</li>
      <li><b>Draw one card</b> from the pile. That ends your turn.</li></ol>
      <p>That's the whole game. Everything else is about not drawing the bomb.</p>
      <div class="tut-tip">💡 Not sure what to do? Just tap <b>Draw</b>.</div>`
  },
  {
    emoji: '✂️',
    title: 'Defuse cards save you',
    html: `<p>Everyone starts with one <b>Defuse</b> (it has a green tag).</p>
      <p>If you draw a bomb while holding a Defuse, it's used <b>automatically</b> and you survive.</p>
      <p>Then you secretly <b>hide the bomb back</b> in the pile wherever you like. Put it on top and the next player is in trouble. 😈</p>`
  },
  {
    emoji: '⚡',
    title: 'Action cards',
    html: `<p>Play these on your turn, <b>before</b> you draw:</p>
      <table>
        <tr><td>⏭ Skip</td><td>End your turn <b>without drawing</b>.</td></tr>
        <tr><td>⚔️ Attack</td><td>Don't draw — the next player takes <b>two turns</b>.</td></tr>
        <tr><td>👀 Peek</td><td>Secretly see the top 3 cards.</td></tr>
        <tr><td>🔀 Shuffle</td><td>Shuffle the pile.</td></tr>
        <tr><td>🎁 Favor</td><td>Someone has to give you a card.</td></tr>
      </table>
      <div class="tut-tip">💡 Peek, then Skip or Attack if a bomb is on top.</div>`
  },
  {
    emoji: '🙅',
    title: 'Nope!',
    html: `<p>A <b>Nope</b> cancels someone's action card — and you can play it even when it's <b>not your turn</b>.</p>
      <p>Whenever anyone plays an action card, a <b>NOPE</b> button pops up for a few seconds. Tap it to cancel their card.</p>
      <p>You can even Nope a Nope.</p>`
  },
  {
    emoji: '🃏',
    title: 'Pair-up cards',
    html: `<p>Cards with a blue <b>Pair up</b> tag do nothing alone.</p>
      <p>Get <b>two with the same picture</b> and play them together to <b>steal a random card</b> from anyone.</p>`
  },
  {
    emoji: '🏷️',
    title: 'Reading the cards',
    html: `<p>Every deck (Kids, Cheeky, Spicy, Filthy) gives the cards different funny names — but the <b>colored tag at the top</b> always tells you what the card really does.</p>
      <p>Tap any card for a full explanation. The box above your hand always tells you what you can do right now.</p>
      <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
  }
]);

// ---- boot ------------------------------------------------------------------------

async function boot() {
  try {
    S.config = await api('/config');
  } catch (e) {
    $('setupMsg').textContent = e.message;
    return;
  }
  renderLevels($('levelList'), S.level, pickLevel);
  renderNames();
  setMode('local');

  for (const b of $('modeSeg').children) b.onclick = () => setMode(b.dataset.mode);
  $('addPlayerBtn').onclick = () => { S.names.push(''); renderNames(); };
  $('goBtn').onclick = go;
  $('startBtn').onclick = async () => {
    try { await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() }); }
    catch (e) { $('lobbyMsg').textContent = e.message; }
  };
  $('leaveBtn').onclick = leave;
  $('passLeave').onclick = () => { if (confirm('Leave this game?')) leave(); };
  $('drawBtn').onclick = drawCard;
  $('peekClose').onclick = () => hide('peekView');
  $('sheetClose').onclick = () => hide('cardSheet');
  $('rulesBtn').onclick = () => tutorial.open();
  $('goalBtn').onclick = () => tutorial.open();
  $('passHelp').onclick = () => tutorial.open();
  tutorial.autoOpen();
  $('joinCode').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };

  // A link like shortfuse.html?join=ABCD drops you straight into Join.
  const join = new URLSearchParams(location.search).get('join');
  if (join) { setMode('join'); $('joinCode').value = join.toUpperCase().slice(0, 4); }

  // Back in a room after a refresh.
  const saved = sessionGet('sf.room');
  if (saved) {
    try {
      S.table = JSON.parse(saved);
      const snap = await api(`/rooms/${S.table.code}?playerId=${encodeURIComponent(S.table.playerId)}&token=${encodeURIComponent(S.table.token)}`);
      applyRoom(snap);
      openStream();
    } catch {
      S.table = null;
      sessionDel('sf.room');
    }
  }
}

boot();
