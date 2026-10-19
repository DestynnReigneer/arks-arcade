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
}

function cardEl(card, { onClick, selected } = {}) {
  const el = document.createElement(onClick ? 'button' : 'div');
  el.className = `card k-${card.kind}${selected ? ' selected' : ''}`;
  if (onClick) { el.type = 'button'; el.onclick = onClick; }
  el.innerHTML = '<div class="c-emoji"></div><div class="c-name"></div><div class="c-quip"></div><div class="c-rule"></div>';
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
  $('handHint').textContent = out ? 'You blew up. Watch the rest go boom.'
    : mine && g.phase === 'play' ? 'Tap cards to play them, then draw to end your turn.'
      : 'Waiting…';

  const hand = $('hand');
  hand.innerHTML = '';
  for (const c of myHand()) {
    hand.appendChild(cardEl(c, {
      selected: S.selected.includes(c.id),
      onClick: () => toggleCard(c)
    }));
  }

  const canAct = mine && g.phase === 'play' && !out;
  $('drawBtn').disabled = !canAct;
  const play = playable();
  $('playBtn').disabled = !canAct || !play;
  $('playBtn').textContent = play ? `Play ${play.label}` : 'Play';

  renderReaction();
  renderFavor();
  renderDefuse();
  renderPeek();
  renderOver();
}

function toggleCard(c) {
  const i = S.selected.indexOf(c.id);
  if (i >= 0) S.selected.splice(i, 1);
  else {
    // Keep a selection that could make sense: one action, or a pair.
    S.selected.push(c.id);
    if (S.selected.length > 2) S.selected.shift();
  }
  renderGame();
}

const ACTIONS = ['skip', 'attack', 'shuffle', 'peek', 'favor'];

function playable() {
  const cards = S.selected.map(id => myHand().find(c => c.id === id)).filter(Boolean);
  if (cards.length === 1 && ACTIONS.includes(cards[0].type)) {
    return { cards, action: cards[0].type, label: cards[0].name, target: cards[0].type === 'favor' };
  }
  if (cards.length === 2 && cards[0].kind === 'junk' && cards[0].type === cards[1].type) {
    return { cards, action: 'steal', label: 'pair (steal)', target: true };
  }
  return null;
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

async function playSelected() {
  const p = playable();
  if (!p) return;
  let target = null;
  if (p.target) {
    target = await pickTarget(p.action === 'favor' ? 'Who owes you a favor?' : 'Steal from who?');
    if (!target) return;
  }
  const snap = await send({ action: 'play', cards: p.cards.map(c => c.id), target });
  S.selected = [];
  take(snap);
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
    timer.classList.add('hidden');
    const go = document.createElement('button');
    go.className = 'primary';
    go.textContent = p.nopes % 2 ? 'Nobody — it stays Noped' : 'Nobody — go ahead';
    go.onclick = async () => take(await send({ action: 'resolve' }));
    buttons.appendChild(go);
    for (const s of g.seats) {
      if (s.out || !s.hasNope) continue;
      const b = document.createElement('button');
      b.className = 'ghost';
      b.textContent = `🙅 ${s.name} plays a Nope`;
      b.onclick = async () => take(await send({ action: 'nope', as: s.id }));
      buttons.appendChild(b);
    }
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

// ---- rules -----------------------------------------------------------------------

function renderRules() {
  const host = $('rulesCards');
  host.innerHTML = '';
  const names = { bomb: '💣 Bomb', defuse: '✂️ Defuse', skip: '😴 Skip', attack: '⚔️ Attack', shuffle: '🌀 Shuffle',
    peek: '👀 Peek', favor: '🎁 Favor', nope: '🙅 Nope', junk: '🃏 Junk' };
  for (const [kind, rule] of Object.entries(S.config.rules)) {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = '<b></b><span></span>';
    row.querySelector('b').textContent = names[kind] || kind;
    row.querySelector('span').textContent = rule;
    host.appendChild(row);
  }
}

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
  renderRules();
  setMode('local');

  for (const b of $('modeSeg').children) b.onclick = () => setMode(b.dataset.mode);
  $('addPlayerBtn').onclick = () => { S.names.push(''); renderNames(); };
  $('goBtn').onclick = go;
  $('startBtn').onclick = async () => {
    try { await api(`/rooms/${S.table.code}/start`, { method: 'POST', body: roomCreds() }); }
    catch (e) { $('lobbyMsg').textContent = e.message; }
  };
  $('leaveBtn').onclick = leave;
  $('drawBtn').onclick = drawCard;
  $('playBtn').onclick = playSelected;
  $('peekClose').onclick = () => hide('peekView');
  $('rulesBtn').onclick = () => show('rulesView');
  $('rulesClose').onclick = () => hide('rulesView');
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
