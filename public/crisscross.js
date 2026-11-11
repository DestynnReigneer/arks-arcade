'use strict';

// Words with Family (once called Criss Cross): the page. The server (crisscross/) keeps the bag and every
// rack, checks every move and decides every score. This page draws the board
// and your tiles, lets you tap or drag them into place, and sends only where
// they went.
//
// On a TV (tv.js), it's played on the TV against the computer, or with the
// remote passed between players: OK on one of your tiles picks it up and
// sends the highlight to the board, the arrows move it from square to
// square, and OK puts the tile down. The games on everyone's own phone need
// to know who you are, so they stay on the phones.

(() => {
  const { $, toast, api } = ArcadeKit;
  const TV = !!(window.ArcadeTV && ArcadeTV.on);
  const ask = text => (TV ? ArcadeTV.confirm(text) : Promise.resolve(confirm(text)));
  const store = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const token = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);
  const me = () => { try { return token() ? ArcadeProfile.get() : null; } catch { return null; } };
  const SECTIONS = ['home', 'newOnline', 'newLocal', 'waiting', 'invite', 'game'];
  const show = id => {
    for (const s of SECTIONS) $(s).classList.toggle('hidden', s !== id);
    if (id !== 'game') { adultMode(false); Blip.musicPlaying(false); }
  };
  const adultMode = on => document.documentElement.classList.toggle('adult-mode', !!on);

  const S = {
    config: null,
    pin: TV ? '' : (() => { try { return sessionStorage.getItem('crisscross.adultPin') || ''; } catch { return ''; } })(),
    adultOk: !TV && (() => { try { return sessionStorage.getItem('crisscross.adultOk') === 'yes'; } catch { return false; } })(),
    view: null,          // the game, as the server showed it to us
    key: null,           // a pass-and-play game's key, from this device's list
    rack: [],            // [{ id, letter }] in the order shown; letter '?' is a blank
    rackSeat: null,      // whose rack it is (it changes as a shared phone goes round)
    pending: new Map(),  // board square -> { id, letter, blank }, tiles placed but not played yet
    selected: null,      // the rack tile picked up by a tap
    swapping: false,
    swapPick: new Set(),
    handoffSeen: null,
    previewSeq: 0,
    poll: null,
    busy: false,
    onlineDict: 'kids',
    localDict: 'kids',
    localPlayers: []
  };
  let tileIds = 0;

  // ---- talking to the server ---------------------------------------------------------------
  function headers() {
    const h = {};
    if (token()) h['X-Profile-Token'] = token();
    if (S.key) h['X-Game-Key'] = S.key;
    if (S.pin) h['X-Adult-Pin'] = S.pin;
    return h;
  }
  // Asks again after the adult PIN when an unfiltered game wants it.
  async function call(path, body) {
    try {
      return await api('/api/crisscross' + path, body, headers());
    } catch (e) {
      if (e.data && e.data.adult && await unlockAdult()) return api('/api/crisscross' + path, body, headers());
      throw e;
    }
  }

  // On a TV, the unfiltered list follows adults' night, with the TV's adult pass.
  function unlocked() { return TV ? ArcadeTV.adult() && !!S.pin : S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk; }
  async function unlockOnTv() {
    S.pin = await ArcadeTV.adultPass();
    return !!S.pin;
  }
  function unlockAdult() {
    if (TV) return unlockOnTv();
    if (!S.config || !S.config.adultRequiresPin) {
      const ok = confirm('The unfiltered list is for adults only (18+). Continue?');
      if (ok) { S.adultOk = true; try { sessionStorage.setItem('crisscross.adultOk', 'yes'); } catch { /* unavailable */ } }
      return Promise.resolve(ok);
    }
    return new Promise(resolve => {
      $('pinInput').value = '';
      $('pinMsg').textContent = '';
      $('pinView').classList.remove('hidden');
      $('pinInput').focus();
      const done = ok => { $('pinView').classList.add('hidden'); $('pinCancel').onclick = null; resolve(ok); };
      PinPad.attach($('pinInput'), async pin => {
        const r = await api('/api/crisscross/unlock', { pin }).catch(() => ({ ok: false }));
        if (!r.ok) { $('pinMsg').textContent = 'That PIN is not right.'; PinPad.clear($('pinInput')); return; }
        S.pin = pin;
        try { sessionStorage.setItem('crisscross.adultPin', pin); } catch { /* unavailable */ }
        done(true);
      });
      $('pinCancel').onclick = () => done(false);
    });
  }

  // ---- little helpers -----------------------------------------------------------------------
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  const names = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
  const possessive = n => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
  function setUrl(params) {
    const q = new URLSearchParams(params).toString();
    // Keeps the history entry's state, which Back (topbar.js) uses.
    history.replaceState(history.state, '', location.pathname + (q ? `?${q}` : ''));
  }
  function seg(box, current, onPick) {
    for (const b of box.children) {
      b.setAttribute('aria-pressed', String(b.dataset.v === current));
      b.onclick = () => onPick(b.dataset.v);
    }
  }
  function moveText(m, players) {
    const who = players[m.seat] ? players[m.seat].name : 'Someone';
    if (m.kind === 'play') return `${who} played ${m.words.map(w => w.word).join(', ')} for ${m.score}`;
    if (m.kind === 'swap') return `${who} swapped ${m.count} tile${m.count === 1 ? '' : 's'}`;
    if (m.kind === 'pass') return `${who} passed`;
    return `${who} left the game`;
  }

  // ---- your games -----------------------------------------------------------------------------
  const localGames = () => { try { return JSON.parse(recall('crisscross.local', '[]')) || []; } catch { return []; } };
  const saveLocalGames = list => store('crisscross.local', JSON.stringify(list.slice(0, 20)));

  async function home() {
    stopPoll();
    S.view = null; S.key = null;
    setUrl({});
    show('home');
    paintLocalList();
    const p = me();
    $('noProfile').classList.toggle('hidden', !!p);
    $('minepanel').classList.toggle('hidden', !p);
    if (!p) $('pushCard').classList.add('hidden');
    if (!p || TV) return;
    ArcadePush.card($('pushCard'));
    await loadMine();
    S.poll = setInterval(() => { if (!document.hidden) loadMine(); }, 30000);
  }

  async function loadMine() {
    const list = $('mineList');
    try {
      const r = await call('/mine');
      $('mineTitle').textContent = r.yourTurn ? `Your turn in ${r.yourTurn} game${r.yourTurn === 1 ? '' : 's'}` : 'Your games';
      $('mineHint').textContent = r.games.length
        ? 'Tap a game to open it. Games you\'re waiting on update by themselves.'
        : 'You aren\'t in any games yet. Start one and invite the family, and it shows up here for everyone in it.';
      list.innerHTML = '';
      for (const g of r.games) list.appendChild(gameItem(g));
    } catch (e) {
      list.innerHTML = '<li class="empty"></li>';
      list.firstChild.textContent = e.message;
    }
  }

  function gameItem(g) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="cc-li-main"><div class="cc-li-title"></div><div class="cc-li-sub"></div></span><span class="cc-li-tag"></span>';
    const others = g.players.filter(p => !p.you).map(p => p.name);
    li.querySelector('.cc-li-title').textContent = `${g.dictionary === 'adult' ? '🔞 ' : ''}You and ${names(others)}`;
    let tag, sub;
    if (g.status === 'waiting') {
      tag = 'Waiting';
      sub = `${g.players.length} of ${g.seats} players are in. It starts when the seats fill up.`;
    } else {
      const lead = g.players.map(p => `${p.you ? 'You' : p.name} ${p.score.toLocaleString('en-US')}`).join(' · ');
      sub = g.lastMove ? `${moveText({ ...g.lastMove, words: (g.lastMove.words || []).map(w => ({ word: w })) }, g.players)}, ${ago(g.lastMove.at)} · ${lead}` : `Started ${ago(g.updatedAt)} · ${lead}`;
      if (g.status === 'over') {
        const winners = (g.over && g.over.winners || []).map(s => g.players[s]);
        tag = winners.some(p => p && p.you) ? 'You won! 🏆' : winners.length ? `${winners.map(p => p.name).join(' and ')} won` : 'Over';
      } else tag = g.yourTurn ? 'Your turn' : `${possessive(g.players[g.turn].name)} turn`;
    }
    li.classList.toggle('turn', !!g.yourTurn);
    li.querySelector('.cc-li-sub').textContent = sub;
    li.querySelector('.cc-li-tag').textContent = tag;
    li.onclick = () => openGame(g.id);
    if (g.status === 'over') {
      const x = document.createElement('button');
      x.className = 'cc-x'; x.title = 'Clear it from my list'; x.setAttribute('aria-label', 'Clear it from my list'); x.textContent = '✕';
      x.onclick = async e => {
        e.stopPropagation();
        try { await call(`/games/${g.id}/hide`, {}); li.remove(); } catch (err) { toast(err.message); }
      };
      li.appendChild(x);
    }
    return li;
  }

  function paintLocalList() {
    const list = $('localList');
    list.innerHTML = '';
    for (const g of localGames()) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="cc-li-main"><div class="cc-li-title"></div><div class="cc-li-sub"></div></span><button class="cc-x" title="Forget this game" aria-label="Forget this game">✕</button>';
      li.querySelector('.cc-li-title').textContent = `${g.dictionary === 'adult' ? '🔞 ' : ''}${names(g.names)}`;
      li.querySelector('.cc-li-sub').textContent = `Started ${ago(g.at)} on this phone`;
      li.onclick = () => openGame(g.id, g.key);
      li.querySelector('.cc-x').onclick = e => {
        e.stopPropagation();
        saveLocalGames(localGames().filter(x => x.id !== g.id));
        paintLocalList();
      };
      list.appendChild(li);
    }
  }

  // ---- a new online game ------------------------------------------------------------------------
  let people = [];
  let openSeats = 0;
  async function newOnline() {
    if (!me()) { ArcadeProfile.open(); return; }
    show('newOnline');
    $('onlineMsg').textContent = '';
    paintDict();
    const box = $('peopleList');
    box.innerHTML = '<li class="cc-note">Loading…</li>';
    try {
      people = await call('/people');
      box.innerHTML = '';
      if (!people.length) box.innerHTML = '<li class="cc-note">Nobody else has a profile yet. Leave a seat open and send them the link instead.</li>';
      for (const p of people) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = p.id;
        cb.onchange = () => paintSeats();
        label.append(cb, ArcadeProfile.avatarEl(p.avatar, 26), p.name);
        li.appendChild(label);
        if (p.adultOk === false) {
          const note = document.createElement('span');
          note.className = 'cc-note kid-note';
          note.textContent = 'family words only';
          li.appendChild(note);
        }
        box.appendChild(li);
      }
    } catch (e) { box.innerHTML = '<li class="cc-note"></li>'; box.firstChild.textContent = e.message; }
    paintSeats();
  }
  const picked = () => [...$('peopleList').querySelectorAll('input:checked')].map(cb => cb.value);
  function paintSeats() {
    const boxes = [...$('peopleList').querySelectorAll('input')];
    const n = picked().length;
    for (const cb of boxes) cb.disabled = !cb.checked && n + openSeats >= 3;
    openSeats = Math.min(openSeats, 3 - n);
    const box = $('openSeg');
    box.innerHTML = '';
    for (let k = 0; k <= 3 - n; k++) {
      const b = document.createElement('button');
      b.textContent = k === 0 ? 'None' : String(k);
      b.setAttribute('aria-pressed', String(k === openSeats));
      b.onclick = () => { openSeats = k; paintSeats(); };
      box.appendChild(b);
    }
  }
  function paintDict() {
    seg($('dictSeg'), S.onlineDict, async v => {
      if (v === 'adult' && !unlocked() && !(await unlockAdult())) return;
      S.onlineDict = v; paintDict();
    });
    $('dictHint').textContent = S.onlineDict === 'adult'
      ? 'Every word on the list counts, rude ones included. Everyone has to be a grown-up, and each of them will need to be signed in with ARKS ID to participate.'
      : 'Rude words are left out, so it\'s good for kids.';
    adultMode(S.onlineDict === 'adult');
  }
  async function startOnline() {
    $('onlineMsg').textContent = '';
    if (!picked().length && !openSeats) { $('onlineMsg').textContent = 'Choose someone to play with, or leave open.'; return; }
    try {
      const r = await call('/games', { kind: 'online', invite: picked(), openSeats, dictionary: S.onlineDict });
      if (window.ArcadeStats) ArcadeStats.play();
      showGame(r.game);
    } catch (e) { $('onlineMsg').textContent = e.message; }
  }

  // ---- a new game on one phone ------------------------------------------------------------------------
  function newLocal() {
    show('newLocal');
    $('localMsg').textContent = '';
    const p = me();
    S.localPlayers = [{ name: p ? p.name : '' }, { bot: true }];
    paintLocalPlayers();
    paintLocalDict();
  }
  function paintLocalPlayers() {
    const box = $('localPlayers');
    box.innerHTML = '';
    S.localPlayers.forEach((p, k) => {
      const row = document.createElement('div');
      row.className = 'cc-local-row';
      if (p.bot) {
        row.innerHTML = '<span class="cc-bot">🤖 The computer</span>';
      } else {
        const input = document.createElement('input');
        input.maxLength = 16;
        input.placeholder = `Player ${k + 1}'s name`;
        input.value = p.name || '';
        input.setAttribute('aria-label', `Player ${k + 1}'s name`);
        input.oninput = () => { p.name = input.value; };
        row.appendChild(input);
      }
      const x = document.createElement('button');
      x.className = 'ghost'; x.textContent = '✕'; x.title = 'Take this player out';
      x.disabled = S.localPlayers.length <= 2;
      x.onclick = () => { S.localPlayers.splice(k, 1); paintLocalPlayers(); };
      row.appendChild(x);
      box.appendChild(row);
    });
    $('addPerson').disabled = $('addBot').disabled = S.localPlayers.length >= 4;
  }
  function paintLocalDict() {
    seg($('localDictSeg'), S.localDict, async v => {
      if (v === 'adult' && !unlocked() && !(await unlockAdult())) return;
      S.localDict = v; paintLocalDict();
    });
    $('localDictHint').textContent = S.localDict === 'adult'
      ? 'Every word on the list counts, rude ones included. Grown-ups only.'
      : 'Rude words are left out, so it\'s good for kids.';
    adultMode(S.localDict === 'adult');
  }
  async function startLocal() {
    $('localMsg').textContent = '';
    try {
      const r = await call('/games', { kind: 'local', players: S.localPlayers, dictionary: S.localDict });
      const g = r.game;
      saveLocalGames([{ id: r.id, key: r.key, names: g.players.map(p => p.name), dictionary: g.dictionary, at: Date.now() },
        ...localGames().filter(x => x.id !== r.id)]);
      S.key = r.key;
      if (window.ArcadeStats) ArcadeStats.play();
      showGame(g);
    } catch (e) { $('localMsg').textContent = e.message; }
  }

  // ---- the share link ------------------------------------------------------------------------------------
  async function showInvite(code) {
    show('invite');
    setUrl({ join: code });
    $('inviteMsg').textContent = '';
    try {
      const r = await call(`/invite/${encodeURIComponent(code)}`);
      $('inviteTitle').textContent = `${r.players[0]} invited you`;
      $('inviteText').textContent = `${names(r.players)} ${r.players.length === 1 ? 'is' : 'are'} playing Words with Family, with ${r.seats - r.players.length} seat${r.seats - r.players.length === 1 ? '' : 's'} left, on ${r.dictionary === 'adult' ? 'the unfiltered word list (grown-ups only)' : 'family words'}.` +
        (me() ? '' : ' Pick your profile first, so the game knows whose turn is whose.');
      $('inviteJoin').textContent = me() ? 'Join the game' : 'Pick my profile';
      $('inviteJoin').onclick = async () => {
        if (!me()) { ArcadeProfile.open(); return; }
        try {
          const j = await call(`/invite/${encodeURIComponent(code)}/join`, {});
          showGame(j.game);
        } catch (e) { $('inviteMsg').textContent = e.message; }
      };
    } catch (e) {
      $('inviteTitle').textContent = 'That invite has ended';
      $('inviteText').textContent = e.message;
      $('inviteJoin').classList.add('hidden');
    }
  }

  // ---- opening a game -----------------------------------------------------------------------------------------
  async function openGame(id, key = null) {
    stopPoll();
    // A notification for this game that's still showing has done its job.
    ArcadePush.clear(`ww-${id}`);
    S.key = key || (localGames().find(g => g.id === id) || {}).key || null;
    try {
      showGame(await call(`/games/${encodeURIComponent(id)}`));
    } catch (e) {
      if (S.key && e.message && /isn't here/.test(e.message)) { saveLocalGames(localGames().filter(g => g.id !== id)); }
      toast(e.message, 4000);
      home();
    }
  }

  function showGame(g) {
    const changedGame = !S.view || S.view.id !== g.id;
    if (changedGame) { S.pending.clear(); S.rack = []; S.rackSeat = null; S.selected = null; S.swapping = false; }
    S.view = g;
    setUrl({ game: g.id });
    adultMode(g.dictionary === 'adult');
    if (g.status === 'waiting') { paintWaiting(g); startPoll(); return; }
    show('game');
    adultMode(g.dictionary === 'adult');
    // A move on the TV counts as a game being played (adults' night keeps going).
    if (TV && (changedGame || S.movesSeen !== g.moves.length)) ArcadeTV.played();
    S.movesSeen = g.moves.length;
    syncRack(g);
    paintGame();
    startPoll();
  }

  function paintWaiting(g) {
    show('waiting');
    adultMode(g.dictionary === 'adult');
    $('waitHint').textContent = g.host
      ? `Send this link to the people you're waiting for, or let them scan the code. The game starts by itself when all ${g.seats} seats are full.`
      : `You're in! The game starts when all ${g.seats} seats are full, or when ${g.players[0].name} starts it.`;
    const link = g.joinCode ? `crisscross.html?join=${g.joinCode}` : null;
    $('joinQr').classList.toggle('hidden', !link);
    $('copyLink').classList.toggle('hidden', !link);
    $('joinLink').textContent = '';
    if (link) ArcadeQR.show($('joinQr'), link, $('joinLink'));
    $('copyLink').onclick = async () => {
      try { await navigator.clipboard.writeText(await ArcadeQR.url(link)); toast('Link copied.'); } catch { toast('Copy it from the line above the button.'); }
    };
    const list = $('seatedList');
    list.innerHTML = '';
    g.players.forEach(p => {
      const li = document.createElement('li');
      li.append(ArcadeProfile.avatarEl(p.avatar, 24), `${p.name}${p.you ? ' (you)' : ''}`);
      list.appendChild(li);
    });
    for (let k = g.players.length; k < g.seats; k++) {
      const li = document.createElement('li');
      li.className = 'cc-note';
      li.textContent = 'An open seat';
      list.appendChild(li);
    }
    $('startNow').classList.toggle('hidden', !g.host || g.players.length < 2);
    $('waitLeave').textContent = g.host ? 'Call the game off' : 'Leave';
  }

  // Keeps your tiles in the order you arranged them when the game updates.
  function syncRack(g) {
    if (S.rackSeat !== g.rackSeat) { S.rack = []; S.pending.clear(); S.selected = null; }
    S.rackSeat = g.rackSeat;
    const left = (g.rack || []).slice();
    const next = [];
    for (const t of S.rack) {
      const k = left.indexOf(t.letter);
      if (k >= 0) { next.push(t); left.splice(k, 1); }
    }
    for (const letter of left) next.push({ id: ++tileIds, letter });
    S.rack = next;
    const ids = new Set(S.rack.map(t => t.id));
    for (const [i, p] of [...S.pending]) if (!ids.has(p.id) || g.board[i]) S.pending.delete(i);
    if (S.selected && !ids.has(S.selected)) S.selected = null;
  }

  // ---- drawing the game -----------------------------------------------------------------------------------------
  const cells = [];
  function buildBoard() {
    const box = $('board');
    const size = S.config.size;
    S.config.layout.join('').split('').forEach((ch, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = i;
      b.dataset.bonus = { T: 'tw', D: 'dw', t: 'tl', d: 'dl', '*': 'star' }[ch] || '';
      b.addEventListener('click', () => { if (justDragged) { justDragged = false; return; } tapCell(i); });
      hookCell(b, i);
      b.setAttribute('role', 'gridcell');
      box.appendChild(b);
      cells.push(b);
    });
    box.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  }
  const BONUS_TEXT = { tw: '3W', dw: '2W', tl: '3L', dl: '2L', star: '★' };
  const BONUS_SAY = { tw: 'triple word', dw: 'double word', tl: 'triple letter', dl: 'double letter', star: 'the star' };

  function paintBoard() {
    const g = S.view;
    const last = new Set(g.last || []);
    cells.forEach((c, i) => {
      const ch = g.board[i];
      const pend = S.pending.get(i);
      const bonus = c.dataset.bonus;
      c.className = 'cc-cell';
      c.replaceChildren();
      const where = `row ${Math.floor(i / S.config.size) + 1}, column ${(i % S.config.size) + 1}`;
      if (ch || pend) {
        const letter = ch ? ch.toUpperCase() : pend.letter;
        const blank = ch ? ch !== ch.toUpperCase() : pend.blank;
        c.classList.add('filled');
        if (blank) c.classList.add('blank');
        if (pend) c.classList.add('pending'); else if (last.has(i)) c.classList.add('last');
        c.append(letter);
        const v = document.createElement('span');
        v.className = 'v';
        v.textContent = blank ? '' : S.config.values[letter];
        c.appendChild(v);
        c.setAttribute('aria-label', `${where}: ${letter}${pend ? ', yours, not played yet' : ''}`);
      } else {
        if (bonus) { c.classList.add(bonus); c.textContent = BONUS_TEXT[bonus]; }
        c.setAttribute('aria-label', `${where}: empty${bonus ? `, ${BONUS_SAY[bonus]}` : ''}`);
      }
    });
  }

  function paintRack() {
    const box = $('rack');
    box.replaceChildren();
    const used = new Set([...S.pending.values()].map(p => p.id));
    for (const t of S.rack) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-tile' + (t.letter === '?' ? ' blank' : '') + (used.has(t.id) ? ' used' : '') +
        (S.selected === t.id ? ' sel' : '') + (S.swapping && S.swapPick.has(t.id) ? ' swap' : '');
      b.dataset.id = t.id;
      b.dataset.letter = t.letter;
      b.textContent = t.letter === '?' ? '' : t.letter;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = t.letter === '?' ? '' : S.config.values[t.letter];
      b.appendChild(v);
      b.setAttribute('aria-label', t.letter === '?' ? 'Blank tile' : `${t.letter}, worth ${S.config.values[t.letter]}`);
      hookTile(b, t);
      // On a TV the highlight starts on your tiles.
      if (TV && !box.children.length) b.dataset.tvStart = '';
      box.appendChild(b);
    }
  }

  function paintGame() {
    const g = S.view;
    const local = g.kind === 'local';
    // Scores, with the player whose turn it is marked.
    const strip = $('scoreStrip');
    strip.replaceChildren();
    g.players.forEach((p, s) => {
      const li = document.createElement('li');
      if (!g.over && g.turn === s) li.classList.add('turn');
      if (p.resigned) li.classList.add('out');
      const nm = document.createElement('div');
      nm.className = 'cc-name';
      if (p.bot) nm.append('🤖 '); else if (p.avatar) nm.append(ArcadeProfile.avatarEl(p.avatar, 16));
      nm.append(p.you ? 'You' : p.name);
      const pts = document.createElement('div');
      pts.className = 'cc-pts';
      pts.textContent = p.score.toLocaleString('en-US');
      const sm = document.createElement('small');
      sm.textContent = p.resigned ? 'left' : `${p.tiles} tile${p.tiles === 1 ? '' : 's'}`;
      li.append(nm, pts, sm);
      strip.appendChild(li);
    });
    const lastMove = g.moves[g.moves.length - 1];
    let status;
    if (g.over) status = 'Game over';
    else if (g.yourTurn) status = local ? `${possessive(g.players[g.turn].name)} turn` : 'Your turn!';
    else status = `Waiting for ${g.players[g.turn].name}`;
    if (lastMove && !g.over) status = `${moveText(lastMove, g.players)}. ${status}`;
    $('status').textContent = status;
    $('bagLabel').textContent = `${g.bag} tile${g.bag === 1 ? '' : 's'} left in the bag`;
    document.body.classList.toggle('waiting-turn', !g.yourTurn);
    $('actions').classList.toggle('hidden', !!g.over || S.swapping);
    $('swapActions').classList.toggle('hidden', !S.swapping || !!g.over);
    $('rack').classList.toggle('hidden', !!g.over || !g.rack);
    $('preview').classList.toggle('hidden', !!g.over);
    $('resignBtn').classList.toggle('hidden', !!g.over);
    $('resignBtn').textContent = local ? `${g.players[g.turn].name} leaves the game` : 'Leave this game';
    paintBoard();
    paintRack();
    paintMoves();
    paintOver();
    preview();
    Blip.musicPlaying(!g.over);
    handoff();
  }

  function paintMoves() {
    const g = S.view;
    const list = $('moveList');
    list.replaceChildren();
    if (!g.moves.length) { list.innerHTML = '<li class="empty">Nothing yet. The first word has to cover the ★ in the middle.</li>'; return; }
    for (const m of [...g.moves].reverse()) {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = g.players[m.seat].you ? 'You' : g.players[m.seat].name;
      const what = document.createElement('span');
      what.className = 'what';
      if (m.kind === 'play') {
        m.words.forEach((w, k) => {
          if (k) what.append(', ');
          const b = document.createElement('b');
          b.textContent = w.word;
          what.append(b, ` ${w.score}`);
        });
        if (m.allTiles) what.append(` + ${S.config.allTilesBonus} for all seven tiles`);
      } else what.textContent = m.kind === 'swap' ? `swapped ${m.count} tile${m.count === 1 ? '' : 's'}` : m.kind === 'pass' ? 'passed' : 'left the game';
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = m.kind === 'play' ? `+${m.score}` : '';
      li.append(who, what, pts);
      list.appendChild(li);
    }
  }

  let celebrated = null;
  function paintOver() {
    const g = S.view;
    $('overPanel').classList.toggle('hidden', !g.over);
    if (!g.over) return;
    const o = g.over;
    const winners = o.winners.map(s => g.players[s]);
    const youWon = winners.some(p => p.you);
    $('overTitle').textContent = winners.length > 1 ? `It's a tie: ${names(winners.map(p => p.name))}! 🎉`
      : youWon ? 'You won! 🏆' : `${winners[0].name} wins! 🏆`;
    const list = $('finalList');
    list.replaceChildren();
    const order = g.players.map((p, s) => s).sort((a, b) => g.players[b].score - g.players[a].score);
    for (const s of order) {
      const p = g.players[s];
      const li = document.createElement('li');
      if (o.winners.includes(s)) li.classList.add('win');
      const left = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = p.you ? 'You' : p.name;
      left.appendChild(b);
      const adj = o.adjust[s];
      if (adj) {
        const sm = document.createElement('small');
        sm.textContent = adj > 0 ? `  +${adj} from everyone's leftover tiles` : `  ${adj} for tiles left (${(p.rack || []).join(' ').replace(/\?/g, 'blank')})`;
        left.appendChild(sm);
      } else if (p.resigned) {
        const sm = document.createElement('small');
        sm.textContent = '  left the game';
        left.appendChild(sm);
      }
      const right = document.createElement('b');
      right.textContent = p.score.toLocaleString('en-US');
      li.append(left, right);
      list.appendChild(li);
    }
    $('overNote').textContent = o.why === 'out'
      ? `${g.players[o.outSeat].name} used their last tile with the bag empty, so the game ended. Everyone else's leftover tiles were taken off their score and given to ${g.players[o.outSeat].name}.`
      : o.why === 'stalled' ? `Nobody scored for ${S.config.scorelessEnd} turns in a row, so the game ended. Everyone's leftover tiles were taken off their score.`
        : 'Everyone else left the game.';
    $('againBtn').onclick = () => (g.kind === 'local' ? newLocal() : newOnline());
    if (celebrated !== g.id) {
      celebrated = g.id;
      if (youWon || g.kind === 'local') {
        if (window.Fx) { Fx.burst({ count: 200, coins: 30 }); Fx.banner(youWon ? 'You won!' : `${winners[0].name} wins!`, `${winners[0].score.toLocaleString('en-US')} points`); }
        Blip.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]], { type: 'triangle', volume: 0.06 });
      }
    }
  }

  // A shared phone hides the tiles until the next person says they're holding it.
  function handoff() {
    const g = S.view;
    const humans = g.players.filter((p, s) => !p.bot && !p.resigned).length;
    const key = `${g.id}:${g.moves.length}`;
    const need = g.kind === 'local' && humans > 1 && !g.over && g.yourTurn && S.handoffSeen !== key;
    $('handoff').classList.toggle('hidden', !need);
    $('rack').style.visibility = need ? 'hidden' : '';
    if (!need) return;
    const name = g.players[g.turn].name;
    $('handoffTitle').textContent = `Pass the ${TV ? 'remote' : 'phone'} to ${name}`;
    $('handoffText').textContent = `It's ${possessive(name)} turn. Only ${name} should look at the tiles that come up next.`;
    $('handoffGo').textContent = `I'm ${name}, show my tiles`;
    $('handoffGo').onclick = () => { S.handoffSeen = key; handoff(); };
  }

  // ---- placing tiles -------------------------------------------------------------------------------------------------
  function place(i, tile) {
    const g = S.view;
    if (!g || g.over || g.board[i]) return;
    const old = S.pending.get(i);
    if (old && old.id === tile.id) return;
    const finish = letter => {
      S.lastCell = i;
      // A tile dropped on one you put down this turn sends that one back to your rack.
      for (const [k, p] of [...S.pending]) if (p.id === tile.id) S.pending.delete(k);
      S.pending.set(i, { id: tile.id, letter, blank: tile.letter === '?' });
      S.selected = null;
      Blip.tone(520, 0.04, { type: 'triangle', volume: 0.05 });
      paintBoard(); paintRack(); preview();
    };
    if (tile.letter === '?') pickBlank(finish); else finish(tile.letter);
  }
  function pickBlank(then) {
    const box = $('blankLetters');
    box.replaceChildren();
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const b = document.createElement('button');
      b.textContent = ch;
      b.onclick = () => { $('blankView').classList.add('hidden'); then(ch); };
      box.appendChild(b);
    }
    $('blankCancel').onclick = () => $('blankView').classList.add('hidden');
    $('blankView').classList.remove('hidden');
  }

  function tapCell(i) {
    const g = S.view;
    if (!g || g.over || S.swapping) return;
    if (S.pending.has(i)) {
      const used = new Set([...S.pending.values()].map(p => p.id));
      const pick = S.rack.find(t => t.id === S.selected && !used.has(t.id));
      if (pick) { place(i, pick); return; }
      // Tapping your own tile takes it back.
      S.pending.delete(i);
      paintBoard(); paintRack(); preview();
      return;
    }
    if (g.board[i]) return;
    const used = new Set([...S.pending.values()].map(p => p.id));
    const tile = S.rack.find(t => t.id === S.selected && !used.has(t.id));
    if (!tile) { toast('You can drag your tile to the board, or tap a tile and the position on the board to place it.'); return; }
    place(i, tile);
  }

  // Tap to pick a tile up, or drag it straight onto a square.
  let drag = null, justDragged = false;
  function hookTile(el, t) {
    el.addEventListener('click', () => {
      if (justDragged) { justDragged = false; return; }
      tapTile(t);
    });
    el.addEventListener('pointerdown', e => {
      if (S.swapping || el.classList.contains('used') || !S.view || S.view.over) return;
      drag = { t, x: e.clientX, y: e.clientY, ghost: null, el, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
    });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
        drag.ghost = el.cloneNode(true);
        drag.ghost.classList.remove('sel');
        drag.ghost.classList.add('cc-ghost');
        document.body.appendChild(drag.ghost);
        el.style.opacity = '0.3';
      }
      drag.ghost.style.left = `${e.clientX}px`;
      drag.ghost.style.top = `${e.clientY}px`;
      const over = cellAt(e.clientX, e.clientY);
      cells.forEach(c => c.classList.toggle('target', c === over));
    });
    const end = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      cells.forEach(c => c.classList.remove('target'));
      if (!d.ghost) return;
      d.ghost.remove();
      el.style.opacity = '';
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 50);
      const over = e.type === 'pointerup' ? cellAt(e.clientX, e.clientY) : null;
      if (over) place(Number(over.dataset.i), d.t);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function cellAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const c = hit && hit.closest && hit.closest('.cc-cell');
    return c && (!c.classList.contains('filled') || c.classList.contains('pending')) ? c : null;
  }

  // Press and hold a tile you put down this turn to pick it up again, then drop it
  // on another square (or on another of yours to swap them), or on your rack to
  // take it back.
  const HOLD_MS = 300;
  function hookCell(el, i) {
    let hold = null;
    el.addEventListener('contextmenu', e => { if (S.pending.has(i)) e.preventDefault(); });
    el.addEventListener('pointerdown', e => {
      if (drag || S.swapping || !S.pending.has(i) || !S.view || S.view.over) return;
      const start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
      hold = { start, timer: setTimeout(() => {
        const ghost = el.cloneNode(true);
        ghost.className = 'cc-tile cc-ghost';
        ghost.style.left = `${start.x}px`;
        ghost.style.top = `${start.y}px`;
        document.body.appendChild(ghost);
        el.style.opacity = '0.3';
        hold.ghost = ghost;
        if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* fine */ }
      }, HOLD_MS) };
    });
    el.addEventListener('pointermove', e => {
      if (!hold || hold.start.id !== e.pointerId) return;
      if (!hold.ghost) {
        // Moving before the hold finishes isn't a pick-up.
        if (Math.hypot(e.clientX - hold.start.x, e.clientY - hold.start.y) > 10) { clearTimeout(hold.timer); hold = null; }
        return;
      }
      hold.ghost.style.left = `${e.clientX}px`;
      hold.ghost.style.top = `${e.clientY}px`;
      const over = cellAt(e.clientX, e.clientY);
      cells.forEach(c => c.classList.toggle('target', c === over && c !== el));
    });
    const end = e => {
      if (!hold || hold.start.id !== e.pointerId) return;
      const h = hold;
      hold = null;
      clearTimeout(h.timer);
      cells.forEach(c => c.classList.remove('target'));
      if (!h.ghost) return;
      h.ghost.remove();
      el.style.opacity = '';
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 50);
      if (e.type !== 'pointerup') return;
      const mine = S.pending.get(i);
      if (!mine) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit && hit.closest && hit.closest('#rack')) { S.pending.delete(i); paintBoard(); paintRack(); preview(); return; }
      const over = cellAt(e.clientX, e.clientY);
      if (!over) return;
      const to = Number(over.dataset.i);
      if (to === i) return;
      const other = S.pending.get(to);
      S.pending.delete(i);
      if (other) S.pending.set(i, other);
      S.pending.set(to, mine);
      S.lastCell = to;
      Blip.tone(520, 0.04, { type: 'triangle', volume: 0.05 });
      paintBoard(); paintRack(); preview();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function tapTile(t) {
    if (S.swapping) {
      if (S.swapPick.has(t.id)) S.swapPick.delete(t.id); else S.swapPick.add(t.id);
      paintRack();
      return;
    }
    if ([...S.pending.values()].some(p => p.id === t.id)) return;
    S.selected = S.selected === t.id ? null : t.id;
    paintRack();
    // On a TV, a tile picked up sends the highlight to the board: next to
    // the last tile put down, or the middle square, so the arrows can take it
    // to its square.
    if (TV && S.selected) {
      const at = cells[S.lastCell] && !cells[S.lastCell].classList.contains('filled') ? S.lastCell : S.config.center;
      cells[at].focus();
      cells[at].scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  // ---- the score before you play --------------------------------------------------------------------------------
  let previewTimer = null;
  function placements() {
    return [...S.pending].map(([index, p]) => ({ index, letter: p.letter, blank: p.blank }));
  }
  function preview() {
    clearTimeout(previewTimer);
    const box = $('preview');
    const g = S.view;
    box.className = 'cc-preview';
    $('playBtn').querySelector('small').textContent = 'Play';
    if (!g || g.over) { box.textContent = ''; return; }
    if (!S.pending.size) {
      box.textContent = g.yourTurn ? (g.moves.some(m => m.kind === 'play') ? 'Drag or tap your tiles onto the board.' : 'Make the first word. It has to cover the ★ in the middle.')
        : 'You can try out words while you wait.';
      return;
    }
    const seq = ++S.previewSeq;
    previewTimer = setTimeout(async () => {
      try {
        const r = await call(`/games/${S.view.id}/preview`, { placements: placements() });
        if (seq !== S.previewSeq) return;
        box.classList.add('ok');
        box.textContent = `${r.words.map(w => `${w.word} ${w.score}`).join(', ')}${r.allTiles ? `, +${S.config.allTilesBonus} for all seven` : ''}. That's ${r.score} point${r.score === 1 ? '' : 's'}.`;
        $('playBtn').querySelector('small').textContent = `Play ${r.score}`;
      } catch (e) {
        if (seq !== S.previewSeq) return;
        box.classList.add('bad');
        box.textContent = e.message;
      }
    }, 200);
  }

  // ---- your turn -------------------------------------------------------------------------------------------------
  async function act(kind, body = {}) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const r = await call(`/games/${S.view.id}/${kind}`, body);
      if (kind === 'play') S.pending.clear();
      S.swapping = false; S.swapPick.clear(); S.selected = null;
      if (r.game) showGame(r.game); else home();
      return r;
    } catch (e) {
      toast(e.message, 4000);
      return null;
    } finally { S.busy = false; }
  }
  async function playWord() {
    const g = S.view;
    if (!g.yourTurn) { toast(`It's ${possessive(g.players[g.turn].name)} turn. You can set up your word, and play it when your turn comes.`); return; }
    if (!S.pending.size) { toast('Put some tiles on the board first.'); return; }
    const r = await act('play', { placements: placements() });
    if (!r) return;
    const res = r.result || {};
    Blip.tune([[660, 0.07], [880, 0.12]], { type: 'triangle', volume: 0.06 });
    if (res.allTiles && window.Fx) { Fx.burst({ count: 160, coins: 24 }); Fx.banner('All seven tiles!', `+${S.config.allTilesBonus} bonus points`); } else if (res.score >= 30 && window.Fx) Fx.burst({ count: 70 });
  }

  // ---- keeping up with the others -----------------------------------------------------------------------------------
  function stopPoll() { clearInterval(S.poll); S.poll = null; }
  function startPoll() {
    stopPoll();
    const g = S.view;
    if (!g || g.kind === 'local' || g.status === 'over') return;
    S.poll = setInterval(async () => {
      if (document.hidden || S.busy || !S.view) return;
      try {
        const before = S.view;
        const next = await call(`/games/${before.id}`);
        if (!S.view || S.view.id !== next.id) return;
        const moved = next.status !== before.status || (next.moves || []).length !== (before.moves || []).length || (next.players || []).length !== (before.players || []).length;
        if (!moved) return;
        showGame(next);
        if (next.yourTurn && !before.yourTurn) {
          toast('Your turn!');
          Blip.tune([[784, 0.08], [1047, 0.14]], { type: 'sine', volume: 0.06 });
        }
      } catch { /* try again next time */ }
    }, 8000);
  }

  // ---- buttons -----------------------------------------------------------------------------------------------------
  $('newOnlineBtn').onclick = newOnline;
  $('pickProfileBtn').onclick = () => ArcadeProfile.open();
  $('newLocalBtn').onclick = newLocal;
  $('onlineGo').onclick = startOnline;
  $('onlineBack').onclick = home;
  $('localGo').onclick = startLocal;
  $('localBack').onclick = home;
  $('addPerson').onclick = () => { S.localPlayers.push({ name: '' }); paintLocalPlayers(); };
  $('addBot').onclick = () => { S.localPlayers.push({ bot: true }); paintLocalPlayers(); };
  $('inviteBack').onclick = home;
  $('waitBack').onclick = home;
  $('startNow').onclick = async () => {
    try { showGame((await call(`/games/${S.view.id}/start`, {})).game); } catch (e) { toast(e.message); }
  };
  $('waitLeave').onclick = async () => {
    if (!(await ask(S.view.host ? 'Call this game off? Everyone who joined will lose it.' : 'Leave this game?'))) return;
    await act('resign');
  };
  $('backBtn').onclick = home;
  $('overBackBtn').onclick = home;
  $('shuffleBtn').onclick = () => {
    for (let i = S.rack.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.rack[i], S.rack[j]] = [S.rack[j], S.rack[i]]; }
    paintRack();
  };
  $('recallBtn').onclick = () => { S.pending.clear(); S.selected = null; paintBoard(); paintRack(); preview(); };
  $('swapBtn').onclick = () => {
    const g = S.view;
    if (!g.yourTurn) { toast('You can swap tiles on your turn.'); return; }
    if (!g.canSwap) { toast(`Swapping needs at least ${S.config.swapMin} tiles left in the bag.`); return; }
    S.pending.clear(); S.selected = null; S.swapping = true; S.swapPick.clear();
    paintGame();
  };
  $('swapCancel').onclick = () => { S.swapping = false; S.swapPick.clear(); paintGame(); };
  $('swapGo').onclick = () => {
    const tiles = S.rack.filter(t => S.swapPick.has(t.id)).map(t => t.letter);
    if (!tiles.length) { toast('Tap the tiles you want to swap first.'); return; }
    act('swap', { tiles });
  };
  $('passBtn').onclick = async () => {
    const g = S.view;
    if (!g.yourTurn) { toast('You can pass on your turn.'); return; }
    if (await ask('Skip your turn without playing?')) act('pass');
  };
  $('playBtn').onclick = playWord;
  $('resignBtn').onclick = async () => {
    const g = S.view;
    const who = g.kind === 'local' ? g.players[g.turn].name : 'you';
    if (await ask(g.kind === 'local' ? `Should ${who} leave this game? Their score stays, but they can't win.` : 'Leave this game? Your score stays, but you can\'t win, and the others carry on without you.')) act('resign');
  };
  $('zoomBtn').onclick = () => {
    const box = $('boardBox');
    const on = !box.classList.contains('zoomed');
    box.classList.toggle('zoomed', on);
    $('zoomBtn').textContent = on ? '🔍 Zoom out' : '🔍 Zoom in';
    store('crisscross.zoom', on ? 'on' : 'off');
    if (on) {
      // Zoom in around your tiles, the last move, or the middle.
      const focus = [...S.pending.keys()][0] ?? (S.view && S.view.last && S.view.last[0]) ?? S.config.center;
      const c = cells[focus];
      requestAnimationFrame(() => {
        box.scrollLeft = c.offsetLeft - box.clientWidth / 2 + c.offsetWidth / 2;
        box.scrollTop = c.offsetTop - box.clientHeight / 2 + c.offsetHeight / 2;
      });
    }
  };
  window.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || help.isOpen || !S.view || $('game').classList.contains('hidden')) return;
    // On a TV, OK (Enter) presses whatever the highlight is on: a tile, a square, Play.
    if (TV && e.target.closest && e.target.closest('button, a')) return;
    if (e.key === 'Enter') { e.preventDefault(); playWord(); }
    if (e.key === 'Escape') $('recallBtn').click();
  });
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('crisscross');

  // Back: every other screen goes back to your games. Games are kept, so
  // nothing needs asking. From your games, Back goes to the arcade.
  ArcadeBack.setup({ atMenu: () => !$('home').classList.contains('hidden'), back: home });

  // ---- how to play ---------------------------------------------------------------------------------------------------
  const help = Tutorial.create('crisscross', [
    {
      emoji: '🔡', title: 'Build words that cross',
      html: `<p>Everyone has seven letter tiles on their rack. Take turns putting tiles on the board to make words, across or down, that join onto the words already there, like a crossword.</p>
        <p>The first word has to cover the <b>★</b> in the middle. After that, every new word has to touch a tile that's already on the board.</p>
        <p>This game used to be called Criss Cross. Only the name changed, so any game you had going is still in your list.</p>`
    },
    {
      emoji: '👆', title: 'Placing your tiles',
      html: `<p>You can drag your tile to the board, or tap a tile and the position on the board to place it. To move a tile you put down, press and hold it, then drag it somewhere else. Drop a tile on one you put down to switch them. Tap a tile you put down to take it back, or <b>Recall</b> to take them all back.</p>
        <p>All the tiles you put down in one turn have to be in one line, across or down, with no gaps. Before you play, the line under your tiles says which words you've made and how many points they're worth.</p>
        <table>
          <tr><td>🔀 Shuffle</td><td>Mixes up the order of your tiles, which can help you spot a word.</td></tr>
          <tr><td>🔍 Zoom</td><td>Makes the board bigger. Slide it around with your finger to see the rest.</td></tr>
        </table>`
    },
    {
      emoji: '💯', title: 'Points',
      html: `<p>Each tile shows what it's worth in its corner. Common letters like E and S are worth 1, and rare ones like Q and Z are worth 10. A word scores the total of its tiles, and every new word you make in a turn counts, including the ones that cross.</p>
        <table>
          <tr><td>2L, 3L</td><td>Doubles or triples the letter on it.</td></tr>
          <tr><td>2W, 3W, ★</td><td>Doubles or triples the whole word.</td></tr>
          <tr><td>🎉 All seven</td><td>Use every tile on your rack in one turn for <b>40 bonus points</b>.</td></tr>
        </table>
        <p>Bonus squares only count on the turn a tile lands on them. The two blank tiles can be any letter you like, but they're worth nothing.</p>`
    },
    {
      emoji: '♻️', title: 'Swap, pass or leave',
      html: `<table>
          <tr><td>♻️ Swap</td><td>Trade some tiles for new ones from the bag. It uses your turn, and the bag needs at least 7 tiles left.</td></tr>
          <tr><td>⏭️ Pass</td><td>Skip your turn.</td></tr>
          <tr><td>🚪 Leave</td><td>Drop out of the game. Your score stays, but you can't win.</td></tr>
        </table>`
    },
    {
      emoji: '🏁', title: 'The end',
      html: `<p>The game ends when the bag is empty and someone uses their last tile. Everyone else loses the points on the tiles still on their rack, and the player who went out gets them all.</p>
        <p>It also ends if nobody scores for six turns in a row. Then everyone loses what's left on their rack. The highest score wins.</p>`
    },
    {
      emoji: '📱', title: 'Playing with the family',
      html: `<p><b>New game with the family</b> lets each person play on their own phone. Choose who to play with, and the game shows up in their list. There's no rush: a turn can wait hours, and the arcade's home page says when it's your turn. You can also leave a seat open and share a link or QR code.</p>
        <p><b>Play on this phone</b> is for passing one phone around, or playing against the computer. The tiles are hidden between turns so nobody peeks.</p>
        <p><b>Family words</b> leaves rude words out. <b>Unfiltered</b> counts every word on the list, and everyone in the game has to be a grown-up signed in with ARKS ID.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => help.open());

  // ---- start ---------------------------------------------------------------------------------------------------------
  if (recall('crisscross.zoom') === 'on' && !TV) { $('boardBox').classList.add('zoomed'); $('zoomBtn').textContent = '🔍 Zoom out'; }
  if (typeof ArcadeProfile !== 'undefined') ArcadeProfile.onChange(() => { if (!$('home').classList.contains('hidden')) home(); });
  api('/api/crisscross/config').then(cfg => {
    S.config = cfg;
    buildBoard();
    const q = new URLSearchParams(location.search);
    if (q.get('join')) showInvite(q.get('join'));
    else if (q.get('game')) openGame(q.get('game'));
    else home();
  }).catch(e => toast(e.message, 5000));
  // On a TV, How to play waits for the ? button instead of opening by itself.
  if (!TV) help.autoOpen();
  if (TV) {
    // Adults' night ended (Back to family, or it ran out): family words at once.
    document.addEventListener('arcadetv:mode', e => {
      if (e.detail.adult) return;
      S.pin = '';
      S.localDict = 'kids';
      if (S.view && S.view.dictionary === 'adult') { home(); toast('Back to family mode.'); }
      else if (!$('newLocal').classList.contains('hidden')) paintLocalDict();
    });
  }
})();
