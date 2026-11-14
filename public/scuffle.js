'use strict';

// Shuffle Scuffle: the page. The server (scuffle/) picks the letters, keeps
// the clock, checks every word and adds up the points. This page draws the
// tiles, takes taps and typing, and shows what the server says.
//
// On a TV (tv.js): the daily letters and free play work with the remote (the
// arrows move along the tiles and OK picks one), or the TV hosts a room as
// its screen and shows the letters, the clock and everyone's counts big while
// everyone races on their own phone. The unfiltered list needs an adults'
// night, never a PIN on the TV.

(() => {
  const { $, toast, api } = ArcadeKit;
  const TV = !!(window.ArcadeTV && ArcadeTV.on);
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const token = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);
  const myName = () => { try { return typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.name() || '' : ''; } catch { return ''; } };

  const S = {
    config: null,
    status: null,        // which of today's dailies this profile has finished, from the server
    mode: TV ? 'tvphones' : ['daily', 'free', 'host', 'join'].includes(recall('scuffle.mode')) ? recall('scuffle.mode') : 'daily',
    dict: 'kids',
    rounds: Number(recall('scuffle.rounds')) || 5,
    seconds: Number(recall('scuffle.seconds')) || 75,
    pin: TV ? '' : (() => { try { return sessionStorage.getItem('scuffle.adultPin') || ''; } catch { return ''; } })(),
    adultOk: !TV && (() => { try { return sessionStorage.getItem('scuffle.adultOk') === 'yes'; } catch { return false; } })(),
    solo: null,          // what the server said about a solo game
    room: null,          // { code, playerId, token } in a room
    snap: null,          // the room's latest state
    es: null,
    skew: 0,             // server clock minus this phone's clock
    letters: '',         // this round's letters, as the server sent them
    order: [],           // the order the tiles are shown in (shuffling only changes this)
    guess: [],           // the tiles picked so far, by their place in `letters`
    roundKey: null,      // which round the tiles are drawn for
    found: [],           // [{ word, points }] this round
    busy: false,
    shownReveal: null,
    shownFirst: null
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  // On a TV, the unfiltered list follows adults' night, with the TV's adult pass.
  const unlocked = () => (TV ? ArcadeTV.adult() && !!S.pin : S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
  const show = id => { for (const s of ['setup', 'lobby', 'play', 'reveal']) $(s).classList.toggle('hidden', s !== id); };
  // The TV showing a room: it shows the game and doesn't play.
  const onScreen = () => !!(S.room && S.snap && S.snap.isScreen);
  const now = () => Date.now() + S.skew;
  const playing = () => (S.room ? S.snap && S.snap.phase === 'playing' : S.solo && S.solo.phase === 'playing');
  const adultMode = on => document.documentElement.classList.toggle('adult-mode', !!on);

  // ---- today's dailies -------------------------------------------------------------------
  // There's a family daily and an unfiltered daily, each with its own letters
  // and board. Once you've played one today it fades and free play is picked
  // instead. A profile's plays come from the server; a guest's are kept on
  // this device.
  const LIST = { kids: 'family', adult: 'unfiltered' };
  const today = () => (S.config && S.config.day) || (S.status && S.status.day) || '';
  function localDone() {
    try {
      const v = JSON.parse(recall('scuffle.dailyDone', 'null'));
      return v && v.day === today() ? v : { day: today() };
    } catch { return { day: today() }; }
  }
  const dailyDone = dict => !!today() && ((S.status && S.status.day === today() && S.status[dict] === 'done') || !!localDone()[dict]);
  function markDailyDone(st) {
    if (!st || st.mode !== 'daily' || st.phase !== 'over') return;
    if (st.day !== today()) return;
    const v = localDone();
    v[st.dictionary] = true;
    store('scuffle.dailyDone', JSON.stringify(v));
    if (S.status) S.status[st.dictionary] = 'done';
  }
  async function refreshStatus() {
    try {
      S.status = await api('/api/scuffle/daily-status', { profileToken: token() });
      paintSetup();
    } catch { /* the device's own record still works */ }
  }

  // ---- setup ---------------------------------------------------------------------------
  const HINTS = {
    daily: 'Today\'s letters are the same for everyone: four rounds of 75 seconds. Your first go of the day can go on the 🏆 board.',
    free: 'New letters every time, as many games as you like. Free play scores don\'t go on the board.',
    host: 'Everyone plays on their own device at the same time. You\'ll get a four-letter code for the others to type in.',
    join: 'Type the four-letter code from whoever is hosting. If a game is already going, you can jump in on the next word.',
    tvphones: 'The TV shows the letters, the clock and how many words everyone has found. Everyone scans the code on the TV with their own phone and races on the same letters at the same time.'
  };
  if (TV) {
    HINTS.daily = 'Today\'s letters, the same for everyone: four rounds of 75 seconds. Use the arrows to move along the tiles and OK to pick a letter. Your first go of the day can go on the 🏆 board.';
    HINTS.free = 'New letters every time, played with the remote: the arrows move along the tiles and OK picks a letter. Free play scores don\'t go on the board.';
  }

  function seg(box, items, current, onPick) {
    box.innerHTML = '';
    for (const [v, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(String(v) === String(current)));
      b.onclick = () => onPick(v);
      box.appendChild(b);
    }
  }

  function paintSetup() {
    // Today's daily on this word list is done: fade it and pick free play.
    const done = dailyDone(S.dict);
    if (done && S.mode === 'daily') S.mode = 'free';
    const daily = $('modeSeg').querySelector('[data-mode="daily"]');
    daily.classList.toggle('faded', done);
    if (done) daily.setAttribute('aria-disabled', 'true'); else { daily.removeAttribute('aria-disabled'); daily.classList.remove('tip-on'); }
    $('dailyTip').textContent = done ? `You've played today's ${LIST[S.dict]} daily. Come back tomorrow for a new one.` : '';
    for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
    $('modeHint').textContent = S.mode === 'daily'
      ? `${HINTS.daily} The ${LIST[S.dict]} daily has its own letters and its own board; ${S.dict === 'adult' ? 'family words' : 'the unfiltered list'} has a separate one.`
      : HINTS[S.mode];
    $('hostSetup').classList.toggle('hidden', S.mode !== 'host');
    $('joinSetup').classList.toggle('hidden', S.mode !== 'join');
    $('wordsPanel').classList.toggle('hidden', S.mode === 'join');
    $('optionsPanel').classList.toggle('hidden', S.mode === 'daily' || S.mode === 'join');
    $('hostSetup').classList.toggle('hidden', S.mode !== 'host');
    for (const b of $('dictSeg').children) b.setAttribute('aria-pressed', String(b.dataset.v === S.dict));
    $('dictHint').textContent = S.dict === 'adult'
      ? 'Every word on the list counts, rude ones included. Rooms on this list get a lobby password so kids can\'t wander in.'
      : 'Rude words are left out, so it\'s good for kids. The full word is always an everyday word.';
    adultMode(S.dict === 'adult');
    if (S.config) {
      seg($('roundsSeg'), S.config.rounds.map(n => [n, String(n)]), S.rounds, v => { S.rounds = v; store('scuffle.rounds', v); paintSetup(); });
      seg($('secondsSeg'), S.config.seconds.map(n => [n, `${n}s`]), S.seconds, v => { S.seconds = v; store('scuffle.seconds', v); paintSetup(); });
    }
    $('goBtn').textContent = S.mode === 'host' ? 'Get a game code' : S.mode === 'join' ? 'Join the game'
      : S.mode === 'tvphones' ? 'Show the code on the TV' : S.mode === 'daily' ? 'Play today\'s letters' : 'Let\'s play';
  }

  async function pickDict(v) {
    if (v === 'adult' && !unlocked() && !(await unlockAdult())) return;
    S.dict = v;
    paintSetup();
  }

  async function unlockOnTv() {
    S.pin = await ArcadeTV.adultPass();
    return !!S.pin;
  }

  function unlockAdult() {
    if (TV) return unlockOnTv();
    if (!S.config || !S.config.adultRequiresPin) {
      // The arcade's own card, not the browser's confirm box.
      return ArcadeBack.ask('The unfiltered list is for adults only (18+). Continue?', { yes: "I'm 18 or older", no: 'Back' }).then(ok => {
        if (ok) { S.adultOk = true; try { sessionStorage.setItem('scuffle.adultOk', 'yes'); } catch { /* unavailable */ } }
        return ok;
      });
    }
    return new Promise(resolve => {
      $('pinInput').value = '';
      $('pinMsg').textContent = '';
      $('pinView').classList.remove('hidden');
      $('pinInput').focus();
      const done = ok => { $('pinView').classList.add('hidden'); $('pinCancel').onclick = null; resolve(ok); };
      PinPad.attach($('pinInput'), async pin => {
        const r = await api('/api/scuffle/unlock', { pin }).catch(() => ({ ok: false }));
        if (!r.ok) { $('pinMsg').textContent = 'Adult levels need an adult signed in with ARKS ID.'; PinPad.clear($('pinInput')); return; }
        S.pin = pin;
        try { sessionStorage.setItem('scuffle.adultPin', pin); } catch { /* unavailable */ }
        done(true);
      });
      $('pinCancel').onclick = () => done(false);
    });
  }

  async function go() {
    Blip.unlock();
    $('setupMsg').textContent = '';
    try {
      if (S.mode === 'daily' || S.mode === 'free') {
        const state = await api('/api/scuffle/solo', {
          mode: S.mode, dictionary: S.dict, rounds: S.rounds, seconds: S.seconds, profileToken: token()
        }, pinHeaders());
        S.solo = state;
        S.room = null;
        markDailyDone(state);
        if (window.ArcadeStats) ArcadeStats.play();
        if (state.phase === 'ready') await soloNext(); else applySolo(state);
        return;
      }
      if (S.mode === 'tvphones') {
        // The TV hosts as its screen. The unfiltered list needs a lobby
        // password for the guests' phones; the TV makes one up and shows it.
        const PASSWORDS = ['tacos', 'disco', 'pickle', 'waffle', 'banjo', 'noodle', 'meteor', 'cactus', 'walrus', 'jelly'];
        const password = S.dict === 'adult' ? PASSWORDS[Math.floor(Math.random() * PASSWORDS.length)] + (10 + Math.floor(Math.random() * 90)) : undefined;
        if (window.ArcadeStats) ArcadeStats.play();
        enterRoom(await api('/api/scuffle/rooms', {
          name: (ArcadeTV.state.tv && ArcadeTV.state.tv.name) || 'TV', screen: true, password,
          settings: { rounds: S.rounds, seconds: S.seconds, dictionary: S.dict }
        }, pinHeaders()));
        return;
      }
      if (S.mode === 'host') {
        const r = await RoomPassword.withPassword(password => api('/api/scuffle/rooms', {
          name: $('hostName').value || myName(), password,
          settings: { rounds: S.rounds, seconds: S.seconds, dictionary: S.dict }
        }, pinHeaders()));
        if (r) enterRoom(r);
        return;
      }
      const code = $('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { $('setupMsg').textContent = 'Type the four-letter code first.'; return; }
      // A adults game asks for its lobby password (not the adult pass).
      const r = await RoomPassword.withPassword(password =>
        api(`/api/scuffle/rooms/${code}/join`, { name: $('joinName').value || myName(), password }));
      if (r) enterRoom(r);
    } catch (e) { $('setupMsg').textContent = e.message; }
  }

  // ---- solo --------------------------------------------------------------------------------
  const soloApi = (path, body = {}) => api(`/api/scuffle/solo/${S.solo.gameId}${path}`, body);

  async function soloNext() {
    if (S.busy) return;
    S.busy = true;
    try { applySolo(await soloApi('/next')); } catch (e) { toast(e.message, 4000); }
    S.busy = false;
  }

  function applySolo(state) {
    S.solo = state;
    markDailyDone(state);
    S.skew = state.serverNow - Date.now();
    adultMode(state.dictionary === 'adult');
    if (state.phase === 'playing') {
      startRound(`solo:${state.gameId}:${state.index}`, state.round.letters);
      S.found = state.round.found;
      paintPlay();
      return;
    }
    if (state.phase === 'reveal' || state.phase === 'over') showSoloReveal(state);
  }

  // When the clock runs out, ask the server how the round ended.
  let endCheck = null;
  function soloTimeUp() {
    if (endCheck) return;
    endCheck = setTimeout(async () => {
      endCheck = null;
      try {
        const st = await api(`/api/scuffle/solo/${S.solo.gameId}`);
        if (st.phase === 'playing') { soloTimeUp(); return; }
        applySolo(st);
      } catch (e) { toast(e.message); }
    }, 1700);
  }

  function showSoloReveal(st) {
    const key = `solo:${st.gameId}:${st.index}`;
    if (S.shownReveal === key && !$('reveal').classList.contains('hidden')) return;
    S.shownReveal = key;
    Blip.musicPlaying(false);
    const mine = st.round.found.map(f => f.word);
    paintReveal({
      roundText: `Round ${st.index + 1} of ${st.totalRounds}`,
      word: st.reveal.word, full: st.reveal.full, words: st.reveal.words, mine, found: st.round.found,
      scoreText: `You scored ${st.round.score.toLocaleString('en-US')} this round, and ${st.total.toLocaleString('en-US')} so far.`
    });
    $('standingsPanel').classList.add('hidden');
    const over = st.phase === 'over';
    $('nextBtn').classList.toggle('hidden', over);
    $('nextBtn').textContent = st.index + 2 === st.totalRounds ? 'Last round' : 'Next round';
    $('waitNext').classList.add('hidden');
    $('againBtn').classList.toggle('hidden', !over || st.mode === 'daily');
    $('overPanel').classList.toggle('hidden', !over);
    if (over) showSoloOver(st);
    show('reveal');
    window.scrollTo({ top: 0 });
  }

  function showSoloOver(st) {
    $('overTitle').textContent = `Game over: ${st.total.toLocaleString('en-US')} points`;
    const rounds = st.past.map((p, i) => [p.word, `${p.found} of ${p.words} words`, p.score, i]);
    roundList(rounds);
    const daily = st.mode === 'daily';
    const p = profile();
    $('savePart').classList.toggle('hidden', !daily || st.saved);
    $('iniRow').classList.toggle('hidden', !!p);
    $('saveHint').textContent = p ? `Saving as ${p.name}.` : 'Type your initials to put your score on today\'s board.';
    $('saveMsg').textContent = '';
    $('saveBtn').disabled = false;
    $('rankLine').textContent = daily ? (st.saved ? 'Your score is on today\'s board.' : '')
      : 'Free play scores don\'t go on the board. Try the daily letters for that.';
    if (daily && !p && !st.saved) initials.reset();
    Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], { type: 'triangle', volume: 0.06 });
    if (window.Fx && st.total > 0) Fx.burst({ count: 120, coins: 12 });
  }

  function roundList(rows) {
    const ol = $('roundList');
    ol.innerHTML = '';
    for (const [word, detail, score] of rows) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><small></small><b></b>';
      li.firstChild.textContent = word;
      li.children[1].textContent = ` · ${detail}`;
      li.lastChild.textContent = score.toLocaleString('en-US');
      ol.appendChild(li);
    }
  }

  // ---- the daily board -------------------------------------------------------------------
  const initials = ArcadeKit.wireInitials([...document.querySelectorAll('#iniRow .ini')], () => saveScore());
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }
  async function saveScore() {
    const st = S.solo;
    if (!st || st.mode !== 'daily' || st.saved) return;
    const p = profile();
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      const r = await api(`/api/scuffle/solo/${st.gameId}/save`, { initials: ini, profileToken: token() });
      if (!p) initials.remember(ini);
      st.saved = true;
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = r.allRank === 1 ? 'That\'s the best daily score ever! 🏆'
        : `You're #${r.dayRank} for today, and #${r.allRank} overall!`;
      // Celebrations are real: the banner only says #1 when the board says so.
      if (r.dayRank === 1 && window.Fx) { Fx.banner(r.allRank === 1 ? 'BEST EVER!' : 'TOP OF TODAY!', 'You\'re #1', { ms: 2200 }); Fx.burst({ count: 200, coins: 30 }); }
      openScores('day', r.id, st.dictionary);
    } catch (e) {
      $('saveMsg').textContent = e.message;
      $('saveBtn').disabled = false;
    }
  }

  let scoreScope = 'day', scoreDict = null;
  async function openScores(scope = scoreScope, highlightId, dict = scoreDict || S.dict) {
    scoreScope = scope;
    scoreDict = dict === 'adult' ? 'adult' : 'kids';
    for (const b of $('scoreScope').children) b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    for (const b of $('scoreDict').children) b.setAttribute('aria-pressed', String(b.dataset.dict === scoreDict));
    $('scoreNote').textContent = scope === 'day'
      ? `Everyone gets the same ${LIST[scoreDict]} letters today. Only your first go counts, and new letters arrive at midnight.`
      : `The best ${LIST[scoreDict]} daily scores from every day so far. Before November 2026 there was one daily for both lists; those scores are on the board of the list they were played with.`;
    $('scores').classList.remove('hidden');
    const list = $('scoreList');
    list.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const rows = await api(`/api/scuffle/board?scope=${scope}&dictionary=${scoreDict}&limit=20`);
      ArcadeKit.renderScores(list, rows.map(r => ({
        ...r,
        detail: [`${r.words} words`, r.bestWord || '', scope === 'all' ? niceDay(r.day) : '']
          .filter(Boolean).join(' · ')
      })), highlightId);
      if (!rows.length) list.firstChild.textContent = scope === 'day' ? 'Nobody has played today\'s letters yet. Be the first!' : 'No scores yet. Be the first!';
    } catch (e) {
      list.innerHTML = '<li class="empty"></li>';
      list.firstChild.textContent = e.message;
    }
  }
  const niceDay = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // ---- rooms --------------------------------------------------------------------------------
  function enterRoom(r) {
    S.room = { code: r.code, playerId: r.playerId, token: r.token };
    S.solo = null;
    S.shownReveal = null;
    try { sessionStorage.setItem('scuffle.room', JSON.stringify(S.room)); } catch { /* unavailable */ }
    $('lobbyCode').textContent = r.code;
    show('lobby');
    connect();
  }

  function connect() {
    if (S.es) S.es.close();
    const { code, playerId, token: tk } = S.room;
    const q = `playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(tk)}`;
    S.es = new EventSource(`/api/scuffle/rooms/${code}/events?${q}`);
    S.es.addEventListener('state', e => applySnap(JSON.parse(e.data)));
    S.es.onerror = () => {
      fetch(`/api/scuffle/rooms/${code}?${q}`).then(r => {
        if (r.status === 404 || r.status === 403) { leaveRoom(); show('setup'); toast('That game has ended.'); }
      }).catch(() => {});
    };
  }

  function leaveRoom() {
    if (S.es) { S.es.close(); S.es = null; }
    S.room = null;
    S.snap = null;
    try { sessionStorage.removeItem('scuffle.room'); } catch { /* unavailable */ }
  }

  async function roomPost(path, body = {}) {
    const { code, playerId, token: tk } = S.room;
    return api(`/api/scuffle/rooms/${code}/${path}`, { playerId, token: tk, ...body });
  }

  function applySnap(snap) {
    // A new round on the TV counts as a game being played (adults' night keeps going).
    if (TV && snap.phase === 'playing' && (!S.snap || S.snap.index !== snap.index || S.snap.phase !== 'playing')) ArcadeTV.played();
    S.snap = snap;
    S.skew = snap.serverNow - Date.now();
    adultMode(snap.settings.dictionary === 'adult');
    document.body.classList.toggle('tv-screen', !!snap.isScreen);
    if (snap.phase === 'lobby') { Blip.musicPlaying(false); return renderLobby(snap); }
    if (snap.phase === 'playing') {
      startRound(`room:${snap.code}:${snap.index}:${snap.endsAt}`, snap.round.letters);
      S.found = snap.mine ? snap.mine.found : [];
      if (snap.round.firstFull && S.shownFirst !== S.roundKey) {
        S.shownFirst = S.roundKey;
        const me = snap.players.find(p => p.id === snap.you);
        if (snap.isScreen) news(`⚡ ${snap.round.firstFull} found the full word first!`);
        else if (!me || me.name !== snap.round.firstFull) {
          news(`⚡ ${snap.round.firstFull} found the full word first! You can still find it too.`);
          Blip.tone([880, 660], 0.15, { type: 'triangle', volume: 0.05 });
        }
      }
      paintPlay();
      return;
    }
    renderRoomReveal(snap);
  }

  function renderLobby(snap) {
    show('lobby');
    $('lobbyCode').textContent = snap.code;
    if ($('joinQr').dataset.code !== snap.code) { $('joinQr').dataset.code = snap.code; ArcadeQR.forGame($('joinQr'), 'scuffle.html', snap.code, $('joinLink')); }
    const s = snap.settings;
    $('lobbySettings').textContent = `${s.rounds} rounds of ${s.seconds} seconds, ${s.dictionary === 'adult' ? 'unfiltered words' : 'family words'}` +
      (snap.lobbyPassword ? `. Lobby password: ${snap.lobbyPassword}` : snap.locked ? '. Locked with a password' : '') + '.';
    $('lobbyHow').textContent = snap.isScreen
      ? 'Everyone scans the code with their own phone and types their name. You all race on the same letters at the same time, and the letters, the clock and the scores show up here on the TV.'
      : 'Scan the code with another phone, or open Shuffle Scuffle there, tap Join and type the code in.';
    $('lobbyCount').textContent = `(${snap.players.length} of ${snap.maxPlayers})`;
    const list = $('lobbyPlayers');
    list.innerHTML = '';
    for (const p of snap.players) {
      const li = document.createElement('li');
      li.className = p.online ? '' : 'offline';
      li.textContent = p.name;
      if (p.id === snap.you) li.insertAdjacentHTML('beforeend', '<span class="tag">you</span>');
      if (p.name === snap.hostName && !snap.screen) li.insertAdjacentHTML('beforeend', '<span class="tag">host</span>');
      list.appendChild(li);
    }
    if (!snap.players.length) list.innerHTML = '<li class="offline">Nobody yet. Scan the code to join.</li>';
    $('startBtn').classList.toggle('hidden', !snap.host);
    $('startBtn').disabled = !snap.players.length;
    $('startBtn').toggleAttribute('data-tv-start', !!snap.players.length);
    $('waitHost').classList.toggle('hidden', snap.host && !!snap.players.length);
    $('waitHost').textContent = snap.host ? 'Waiting for someone to join…' : snap.screen ? 'Waiting for the TV to start the game…' : 'Waiting for the host to start…';
  }

  function renderRoomReveal(snap) {
    const rv = snap.reveal;
    if (!rv) return;
    const key = `room:${snap.code}:${snap.index}:${snap.phase}`;
    const me = rv.players.find(p => p.id === snap.you);
    const mine = me ? me.words : [];
    paintReveal({
      roundText: `Round ${snap.index + 1} of ${snap.totalRounds}`,
      word: rv.word, full: rv.full, words: rv.words, mine,
      found: mine.map(w => ({ word: w })),
      first: rv.firstFull ? `${rv.firstFull.name} found it first and got ${S.config ? S.config.firstBonus : 50} extra points.` : 'Nobody found the full word this round.',
      scoreText: me ? `You scored ${me.roundScore.toLocaleString('en-US')} this round.` : ''
    });
    // The TV didn't play: it shows every word in the letters instead of "yours".
    if (snap.isScreen) {
      $('revealFound').closest('.panel').querySelector('h2').textContent = 'Every word in these letters';
      $('revealFound').innerHTML = '';
      $('missedTitle').textContent = '';
    } else $('revealFound').closest('.panel').querySelector('h2').textContent = 'Words you found';
    const over = snap.phase === 'over';
    $('standingsPanel').classList.remove('hidden');
    $('standingsTitle').textContent = over ? 'Final scores' : 'Scores so far';
    const ol = $('standings');
    ol.innerHTML = '';
    for (const p of snap.players.slice().sort((a, b) => b.score - a.score)) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><small></small><b></b>';
      li.firstChild.textContent = p.name + (p.id === snap.you ? ' (you)' : '');
      li.children[1].textContent = `+${p.roundScore.toLocaleString('en-US')} this round`;
      li.lastChild.textContent = p.score.toLocaleString('en-US');
      ol.appendChild(li);
    }
    $('overPanel').classList.toggle('hidden', !over);
    if (over) {
      const top = snap.players.slice().sort((a, b) => b.score - a.score)[0];
      $('overTitle').textContent = top ? `${top.name} wins the scuffle! 🏆` : 'Game over';
      $('roundList').innerHTML = '';
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = '';
    }
    $('nextBtn').classList.toggle('hidden', over || !snap.host);
    $('nextBtn').textContent = snap.index + 2 === snap.totalRounds ? 'Last round' : 'Next round';
    $('waitNext').classList.toggle('hidden', over || snap.host);
    $('againBtn').classList.toggle('hidden', !over || !snap.host);
    if (S.shownReveal !== key) {
      S.shownReveal = key;
      Blip.musicPlaying(false);
      if (over && top1(snap) === snap.you && window.Fx) { Fx.banner('YOU WIN!', 'Top of the room', { ms: 2200 }); Fx.burst({ count: 200, coins: 30 }); }
      show('reveal');
      window.scrollTo({ top: 0 });
    }
  }
  const top1 = snap => { const t = snap.players.slice().sort((a, b) => b.score - a.score); return t.length > 1 && t[0].score > t[1].score ? t[0].id : null; };

  // ---- a round: the tiles ------------------------------------------------------------------
  function startRound(key, letters) {
    if (S.roundKey === key) return;
    S.roundKey = key;
    S.letters = letters;
    S.order = [...letters].map((_, i) => i);
    S.guess = [];
    S.found = [];
    $('news').textContent = '';
    show('play');
    window.scrollTo({ top: 0 });
    Blip.musicPlaying(true);
    lastSec = null;
  }

  function paintPlay() {
    const tiles = $('tiles');
    tiles.innerHTML = '';
    for (const i of S.order) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-tile' + (S.guess.includes(i) ? ' used' : '');
      b.textContent = S.letters[i];
      b.setAttribute('aria-label', `Letter ${S.letters[i]}`);
      b.onclick = () => tap(i);
      // The TV showing a room only shows the letters.
      if (onScreen()) { b.disabled = true; b.tabIndex = -1; }
      tiles.appendChild(b);
    }
    const guess = $('guess');
    guess.innerHTML = '';
    for (let k = 0; k < S.letters.length; k++) {
      const s = document.createElement('div');
      const i = S.guess[k];
      s.className = 'sc-slot' + (i !== undefined ? ' on' : '');
      s.textContent = i !== undefined ? S.letters[i] : '';
      guess.appendChild(s);
    }
    const list = $('found');
    list.innerHTML = '';
    const sorted = S.found.slice().sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
    for (const f of sorted) {
      const li = document.createElement('li');
      li.className = f.word.length === S.letters.length ? 'full' : '';
      li.textContent = f.word;
      if (f.points) li.insertAdjacentHTML('beforeend', `<small>+${f.points}</small>`);
      list.appendChild(li);
    }
    if (!sorted.length) list.innerHTML = '<li class="empty">Words you find show up here.</li>';
    const gotFull = S.found.some(f => f.word.length === S.letters.length);
    const count = S.room ? S.snap.round.wordCount : S.solo.round.wordCount;
    $('goal').innerHTML = onScreen()
      ? `There are <b>${count}</b> words of 3 or more letters hiding in here, and the full word uses all <b>${S.letters.length}</b> letters. Find them on your own devices!`
      : `There are <b>${count}</b> words of 3 or more letters hiding in here. You've found <b>${S.found.length}</b>. ` +
      (gotFull ? '<span class="got">★ You found the full word!</span>' : `The full word uses all <b>${S.letters.length}</b> letters.`);
    if (S.room) {
      const s = S.snap;
      $('roundLabel').textContent = `${s.index + 1}/${s.totalRounds}`;
      const me = s.players.find(p => p.id === s.you);
      $('scoreLabel').textContent = me ? me.score.toLocaleString('en-US') : '0';
      const strip = $('strip');
      strip.classList.remove('hidden');
      strip.innerHTML = '';
      for (const p of s.players.slice().sort((a, b) => b.score - a.score)) {
        const li = document.createElement('li');
        li.className = [p.id === s.you ? 'me' : '', p.gotFull ? 'star' : '', p.done ? 'done' : ''].join(' ').trim();
        li.innerHTML = '<span></span><b></b>';
        li.firstChild.textContent = `${p.name} (${p.count})`;
        li.lastChild.textContent = p.score.toLocaleString('en-US');
        li.title = `${p.name} has found ${p.count} word${p.count === 1 ? '' : 's'}${p.gotFull ? ', including the full word' : ''}.`;
        strip.appendChild(li);
      }
      $('doneBtn').disabled = !!(s.mine && s.mine.done);
      $('doneBtn').textContent = s.isScreen ? 'End this round now' : s.mine && s.mine.done ? 'Waiting for the others to finish…' : 'I\'m done with this round';
    } else {
      $('strip').classList.add('hidden');
      $('roundLabel').textContent = `${S.solo.index + 1}/${S.solo.totalRounds}`;
      $('scoreLabel').textContent = (S.solo.total + S.solo.round.score).toLocaleString('en-US');
      $('doneBtn').disabled = false;
      $('doneBtn').textContent = 'End this round now';
    }
    tick();
  }

  function tap(i) {
    if (!playing() || S.guess.includes(i) || S.busy) return;
    Blip.unlock();
    S.guess.push(i);
    Blip.tone(520 + S.guess.length * 60, 0.04, { type: 'triangle', volume: 0.04 });
    paintPlay();
  }
  function typeLetter(ch) {
    const i = S.order.find(k => S.letters[k] === ch && !S.guess.includes(k));
    if (i === undefined) { nudge(); return; }
    tap(i);
  }
  function back() { if (S.guess.length) { S.guess.pop(); paintPlay(); } }
  function clear() { if (S.guess.length) { S.guess = []; paintPlay(); } }
  function shuffle() {
    if (!playing()) return;
    for (let i = S.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [S.order[i], S.order[j]] = [S.order[j], S.order[i]];
    }
    Blip.tone([300, 600], 0.1, { type: 'sine', volume: 0.04 });
    paintPlay();
  }
  function nudge() {
    const g = $('guess');
    g.classList.remove('bad');
    void g.offsetWidth;
    g.classList.add('bad');
  }

  const REASONS = {
    short: 'Words need at least 3 letters.',
    letters: 'That uses a letter that isn\'t here (or one too many times).',
    again: 'You already found that one.',
    unknown: 'That one isn\'t in the word list.'
  };

  async function enter() {
    if (!playing() || S.busy) return;
    const word = S.guess.map(i => S.letters[i]).join('');
    if (word.length < 3) { toast(REASONS.short); nudge(); return; }
    S.busy = true;
    try {
      let verdict;
      if (S.room) verdict = await roomPost('word', { word });
      else {
        const r = await api(`/api/scuffle/solo/${S.solo.gameId}/word`, { word });
        verdict = r;
        S.solo = r.state;
      }
      S.busy = false;
      if (verdict.ok) {
        S.found = S.found.filter(f => f.word !== verdict.word).concat([{ word: verdict.word, points: verdict.points }]);
        S.guess = [];
        const g = $('guess');
        g.classList.add('good');
        setTimeout(() => g.classList.remove('good'), 300);
        if (window.Fx) Fx.flyTo(`+${verdict.points}`, g, $('scoreLabel'), { tone: verdict.full ? 'gold' : 'teal' });
        if (verdict.full) {
          Blip.tune([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]], { type: 'triangle', volume: 0.07 });
          if (window.Fx) {
            Fx.banner(verdict.first ? 'FIRST!' : 'FULL WORD!', verdict.first ? `${verdict.word} · +${verdict.points} with the bonus` : `${verdict.word} · +${verdict.points}`, { ms: 1800 });
            Fx.burst({ count: 160, coins: 20 });
          }
        } else {
          Blip.tune([[660, 0.06], [880, 0.1]], { type: 'triangle', volume: 0.05 });
        }
      } else {
        toast(REASONS[verdict.reason] || 'That one doesn\'t count.');
        Blip.tone([220, 140], 0.18, { type: 'sawtooth', volume: 0.04 });
        nudge();
        if (verdict.reason === 'again') S.guess = [];
      }
      if (!S.room) applySolo(S.solo); else paintPlay();
    } catch (e) {
      S.busy = false;
      toast(e.message);
      if (!S.room && S.solo) soloTimeUp();
    }
  }

  async function doneEarly() {
    if (!playing()) return;
    if (S.room) { try { await roomPost(onScreen() ? 'next' : 'done'); } catch (e) { toast(e.message); } return; }
    if (!(await ArcadeBack.ask('End this round now? Any words you haven\'t found yet will be shown.', { yes: 'End the round', no: 'Keep playing' }))) return;
    try { applySolo(await api(`/api/scuffle/solo/${S.solo.gameId}/stop`, {})); } catch (e) { toast(e.message); }
  }

  // ---- the clock ---------------------------------------------------------------------------
  let lastSec = null;
  function tick() {
    if (!playing()) return;
    const endsAt = S.room ? S.snap.endsAt : S.solo.round.endsAt;
    const left = Math.max(0, endsAt - now());
    const sec = Math.ceil(left / 1000);
    $('clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('clock').parentElement.classList.toggle('low', sec <= 10);
    if (sec !== lastSec && sec <= 5 && sec > 0) Blip.tone(sec <= 2 ? 1320 : 990, 0.04, { type: 'square', volume: 0.04 });
    lastSec = sec;
    if (left <= 0 && !S.room) soloTimeUp();
  }
  setInterval(tick, 200);

  // ---- end of a round --------------------------------------------------------------------
  function chips(box, words, cls = () => '', points = {}) {
    box.innerHTML = '';
    for (const w of words) {
      const li = document.createElement('li');
      li.className = cls(w);
      li.textContent = w;
      if (points[w]) li.insertAdjacentHTML('beforeend', `<small>+${points[w]}</small>`);
      box.appendChild(li);
    }
  }

  function paintReveal({ roundText, word, full, words, mine, found, first = '', scoreText }) {
    $('revealRound').textContent = roundText;
    $('revealFull').textContent = word;
    // Other words that use every letter counted as the full word too.
    const others = full.filter(w => w !== word);
    $('revealFirst').textContent = [others.length ? `${others.join(', ')} used every letter too, so ${others.length === 1 ? 'it' : 'they'} counted as the full word.` : '', first].filter(Boolean).join(' ');
    $('revealScore').textContent = scoreText;
    const length = full[0].length;
    const points = Object.fromEntries(found.filter(f => f.points).map(f => [f.word, f.points]));
    const have = new Set(mine);
    const sortW = list => list.slice().sort((a, b) => b.length - a.length || a.localeCompare(b));
    chips($('revealFound'), sortW(mine), w => (w.length === length ? 'full' : ''), points);
    if (!mine.length) $('revealFound').innerHTML = '<li class="empty">None this time. Next round!</li>';
    const missed = sortW(words.filter(w => !have.has(w)));
    chips($('revealMissed'), missed, w => (w.length === length ? 'full' : ''));
    $('missedTitle').textContent = missed.length ? `Words you missed (${missed.length})` : 'You found every word! 🎉';
  }

  function news(text) {
    $('news').textContent = text;
    clearTimeout(news.t);
    news.t = setTimeout(() => { $('news').textContent = ''; }, 5000);
  }

  function backToMenu() {
    if (S.room) { roomPost('leave').catch(() => {}); leaveRoom(); }
    S.solo = null;
    S.roundKey = null;
    Blip.musicPlaying(false);
    show('setup');
    paintSetup();
    refreshStatus();
  }

  // Back: from a round, the scores between rounds or a room's lobby to the
  // menu (asking first while the game's still going), and from there to the arcade.
  ArcadeBack.setup({
    atMenu: () => !$('setup').classList.contains('hidden'),
    back: backToMenu,
    busy: () => !$('play').classList.contains('hidden') || (!$('reveal').classList.contains('hidden') && $('overPanel').classList.contains('hidden'))
  });

  // ---- how to play --------------------------------------------------------------------------
  const help = Tutorial.create('scuffle', [
    {
      emoji: '🔀', title: 'Find the hidden word',
      html: `<p>Every round you get the same 6 or 7 letters as everyone else, all mixed up. They spell a word when they're put back in the right order. That's the <b>full word</b>, and finding it is the big prize.</p>
        <p>While you hunt for it, every smaller word you can make from the letters (3 letters or more) scores too. Each letter can only be used as many times as it shows up.</p>`
    },
    {
      emoji: '👆', title: 'Spelling a word',
      html: `<p>Tap the letter tiles in order to spell a word, then tap <b>Enter</b>. <b>Back</b> takes off the last letter, <b>Clear</b> starts over, and <b>Shuffle</b> mixes the tiles up again, which often helps you see a new word.</p>
        <table><tr><td>⌨️ Keyboard</td><td>Type the letters, <b>Enter</b> to try the word, <b>Backspace</b> to take one back, <b>Space</b> to shuffle, <b>Esc</b> to clear.</td></tr></table>`
    },
    {
      emoji: '⭐', title: 'Points',
      html: `<table>
          <tr><td>3 letters</td><td>10 points</td></tr>
          <tr><td>4 letters</td><td>20 points</td></tr>
          <tr><td>5 letters</td><td>35 points</td></tr>
          <tr><td>6 letters</td><td>60 points</td></tr>
          <tr><td>7 letters</td><td>90 points</td></tr>
          <tr><td>★ The full word</td><td>100 extra points</td></tr>
        </table>
        <p>In a room, whoever finds the full word <b>first</b> gets another 50 on top. The arcade checks every word and keeps the score, so nobody's device can fudge it.</p>`
    },
    {
      emoji: '⏱️', title: 'Rounds and the clock',
      html: `<p>Each round has a clock (60, 75 or 90 seconds). When it runs out you see the full word and every word you missed, then the next round starts with new letters. Done early? Tap the button under your words to end the round.</p>`
    },
    {
      emoji: '📅', title: 'Daily or free play',
      html: `<table>
          <tr><td>📅 Daily</td><td>Four rounds of 75 seconds, with letters that are the same for everybody today. There are two: one for <b>family words</b> and one for the <b>unfiltered</b> list, each with its own letters and its own 🏆 board. Pick the list under Which words count. Your first go at each can go on its board. New letters arrive at midnight.</td></tr>
          <tr><td>✔️ Played it?</td><td>Once you've played today's daily for a list, its button fades (tap or point at it to see why) and free play is picked for you. Come back tomorrow for a new one.</td></tr>
          <tr><td>🎲 Free play</td><td>New letters every game. Pick how many rounds and how long. These scores don't go on the board.</td></tr>
        </table>`
    },
    {
      emoji: '📡', title: 'Playing together',
      html: `<p><b>Host</b> a game to get a four-letter code, and everyone else taps <b>Join</b> on their own device and types it in (or scans the QR code). The host picks the rounds, the time and which words count, and everyone races on the same letters at the same time.</p>
        <p>You'll see how many words each player has found and a ★ when someone gets the full word, but not their words until the round is over.</p>`
    },
    {
      emoji: '🔞', title: 'Family words or unfiltered',
      html: `<p><b>Family words</b> leaves rude words out, so it's good for kids. <b>Unfiltered</b> counts every word on the list, rude ones included, and is for adults signed in with ARKS ID. A room on the unfiltered list gets a lobby password so kids can't wander in.</p>
        <div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>`
    }
  ]);

  // ---- wiring -------------------------------------------------------------------------------
  for (const b of $('modeSeg').children) {
    b.onclick = () => {
      // A daily you've already played only says why it's faded.
      if (b.dataset.mode === 'daily' && dailyDone(S.dict)) {
        b.classList.add('tip-on');
        clearTimeout(b.tipTimer);
        b.tipTimer = setTimeout(() => b.classList.remove('tip-on'), 2800);
        return;
      }
      S.mode = b.dataset.mode; store('scuffle.mode', S.mode); paintSetup();
    };
  }
  for (const b of $('scoreDict').children) b.onclick = () => openScores(scoreScope, undefined, b.dataset.dict);
  for (const b of $('dictSeg').children) b.onclick = () => pickDict(b.dataset.v);
  $('goBtn').onclick = go;
  $('joinCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('startBtn').onclick = async () => { if (window.ArcadeStats) ArcadeStats.play(); try { await roomPost('start'); } catch (e) { toast(e.message); } };
  $('lobbyLeave').onclick = backToMenu;
  $('menuBtn').onclick = backToMenu;
  $('tiles').addEventListener('contextmenu', e => e.preventDefault());
  $('shuffleBtn').onclick = shuffle;
  $('clearBtn').onclick = clear;
  $('backBtn').onclick = back;
  $('enterBtn').onclick = enter;
  $('doneBtn').onclick = doneEarly;
  $('nextBtn').onclick = async () => {
    if (S.room) { try { await roomPost('next'); } catch (e) { toast(e.message); } } else soloNext();
  };
  $('againBtn').onclick = async () => {
    if (S.room) { try { await roomPost('start'); } catch (e) { toast(e.message); } return; }
    S.mode = S.solo ? S.solo.mode : 'free';
    go();
  };
  $('saveBtn').onclick = saveScore;
  $('scoresBtn').onclick = () => openScores('day', undefined, S.solo ? S.solo.dictionary : S.dict);
  $('scoresClose').onclick = () => $('scores').classList.add('hidden');
  $('scores').addEventListener('click', e => { if (e.target === $('scores')) $('scores').classList.add('hidden'); });
  for (const b of $('scoreScope').children) b.onclick = () => openScores(b.dataset.scope);
  $('helpBtn').onclick = () => help.open();
  window.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || help.isOpen) return;
    if (!$('scores').classList.contains('hidden')) { if (e.key === 'Escape') $('scores').classList.add('hidden'); return; }
    if (!playing() || onScreen()) return;
    const k = e.key;
    if (/^[a-zA-Z]$/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeLetter(k.toUpperCase()); return; }
    // On a TV, OK (Enter) presses whatever the highlight is on: a tile, or the Enter key on the screen.
    if (k === 'Enter' && TV && e.target.closest && e.target.closest('button, a')) return;
    if (k === 'Enter') { e.preventDefault(); enter(); return; }
    if (k === 'Backspace') { e.preventDefault(); back(); return; }
    if (k === 'Escape') { e.preventDefault(); clear(); return; }
    if (k === ' ') { e.preventDefault(); shuffle(); }
  });
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('scuffle');

  // ---- start ---------------------------------------------------------------------------------
  if (TV) {
    // Adults' night ended (Back to family, or it ran out): family words at once.
    document.addEventListener('arcadetv:mode', e => {
      if (e.detail.adult) return;
      S.pin = '';
      if (S.room && S.snap && S.snap.settings.dictionary === 'adult') { backToMenu(); toast('Back to family mode.'); }
      if (S.solo && S.solo.dictionary === 'adult') { backToMenu(); toast('Back to family mode.'); }
      S.dict = 'kids';
      paintSetup();
    });
  }
  paintSetup();
  api('/api/scuffle/config').then(c => {
    S.config = c;
    if (!c.rounds.includes(S.rounds)) S.rounds = c.defaultRounds;
    if (!c.seconds.includes(S.seconds)) S.seconds = c.defaultSeconds;
    paintSetup();
    refreshStatus();
  }).catch(e => toast(e.message));
  // Signing in or switching profile changes whose dailies these are.
  if (typeof ArcadeProfile !== 'undefined' && ArcadeProfile.onChange) ArcadeProfile.onChange(() => refreshStatus());
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam && !TV) { S.mode = 'join'; $('joinCode').value = joinParam.toUpperCase().slice(0, 4); paintSetup(); }
  try {
    const saved = JSON.parse(sessionStorage.getItem('scuffle.room') || 'null');
    if (saved && saved.code) { S.room = saved; connect(); }
  } catch { /* nothing saved */ }
  // On a TV, How to play waits for the ? button instead of opening by itself.
  if (!TV) help.autoOpen();
})();
