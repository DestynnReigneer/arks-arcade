'use strict';

// Know-It-All: multiple-choice trivia. Solo or take turns on one phone (all
// in the browser), or everyone on their own phone in a room run by the
// server. Adult levels add spicier questions, a drinking mode and
// couples dares.
//
// On a TV (tv.js), the TV hosts a room and shows it big, in one of three
// ways: everyone answers on their own phone, one phone is passed around, or
// the TV remote plays for everyone in turn. The server keeps every score.
// The TV always starts in family mode; adult levels need an adults' night,
// unlocked from an adult's phone, and never a PIN on the TV.

(() => {
  const { $, toast, api } = ArcadeKit;
  const KEYS = ['A', 'B', 'C', 'D'];
  const TV = !!(window.ArcadeTV && ArcadeTV.on);

  const S = {
    config: null, level: 'kids', drinking: false, couples: false, genres: new Set(), pack: '',
    difficulty: 'mixed', count: 10, seconds: 20, mode: TV ? 'tvphones' : 'solo', names: [typeof ArcadeProfile !== 'undefined' && !TV ? ArcadeProfile.name() : '', ''],
    pin: TV ? '' : (() => { try { return sessionStorage.getItem('trivia.adultPin') || ''; } catch { return ''; } })(),
    adultOk: !TV && (() => { try { return sessionStorage.getItem('trivia.adultOk') === 'yes'; } catch { return false; } })(),
    game: null,      // a solo / one-phone game
    room: null, es: null, snap: null, skew: 0, shownReveal: null, shownFinale: false
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  const levelInfo = id => (S.config ? S.config.levels.find(l => l.id === id) : null) || { id: 'kids', label: 'Family', adult: false, genres: [] };
  const isAdult = () => levelInfo(S.level).adult;
  // On a TV, adult levels follow adults' night, with the TV's adult pass.
  const unlocked = () => (TV ? ArcadeTV.adult() && !!S.pin : S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
  const show = id => { for (const s of ['setup', 'lobby', 'play']) $(s).classList.toggle('hidden', s !== id); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- setup -----------------------------------------------------------------------

  async function loadConfig() {
    try { S.config = await api('/api/trivia/config', undefined, pinHeaders()); } catch (e) { toast(e.message); return; }
    $('credit').textContent = S.config.credit + (S.config.online.downloaded ? ` ${S.config.online.downloaded.toLocaleString('en-US')} downloaded so far.` : '');
    renderLevels();
    renderGenres();
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
      if (l.adult && !unlocked()) b.insertAdjacentHTML('beforeend', TV && !ArcadeTV.adult() ? '<div class="l-lock">🔞 Needs an adults\' night</div>' : '<div class="l-lock">🔞 Adults only</div>');
      b.onclick = () => pickLevel(l.id);
      list.appendChild(b);
    }
    $('adultOptions').classList.toggle('hidden', !isAdult());
    document.documentElement.classList.toggle('adult-mode', isAdult());
  }

  function renderGenres() {
    const box = $('genreChips');
    box.innerHTML = '';
    const genres = levelInfo(S.level).genres || [];
    for (const g of [...S.genres]) if (!genres.some(x => x.name === g)) S.genres.delete(g);
    for (const g of genres) {
      const b = document.createElement('button');
      b.setAttribute('aria-pressed', String(S.genres.has(g.name)));
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = g.name;
      b.lastChild.textContent = g.count;
      b.onclick = () => {
        if (S.genres.has(g.name)) S.genres.delete(g.name); else S.genres.add(g.name);
        b.setAttribute('aria-pressed', String(S.genres.has(g.name)));
      };
      box.appendChild(b);
    }
  }

  function renderPacks() {
    const sel = $('packSelect');
    sel.innerHTML = '<option value="">No, use the genres above</option>';
    for (const p of S.config.packs.filter(p => p.level === S.level)) {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = `${p.emoji} ${p.label} (${p.count})`;
      sel.appendChild(o);
    }
    if (![...sel.options].some(o => o.value === S.pack)) S.pack = '';
    sel.value = S.pack;
  }

  async function pickLevel(id) {
    if (levelInfo(id).adult && !unlocked() && !(await unlockAdult())) return;
    S.level = id;
    await loadConfig();
  }

  // On a TV: an adults' night (a QR code for an adult's phone, tv.js), then
  // the TV's adult pass from the arcade, used wherever the PIN would go.
  async function unlockOnTv() {
    if (!ArcadeTV.adult() && !(await ArcadeTV.unlock())) return false;
    try {
      const res = await fetch('/api/arksid/adult-pass', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pass) throw new Error(data.error || 'That didn\'t work. Try again in a moment.');
      S.pin = data.pass;
      return true;
    } catch (e) { toast(e.message); return false; }
  }

  function unlockAdult() {
    if (TV) return unlockOnTv();
    if (!S.config.adultRequiresPin) {
      const ok = confirm('These questions are for adults only (18+). Continue?');
      if (ok) { S.adultOk = true; try { sessionStorage.setItem('trivia.adultOk', 'yes'); } catch { /* unavailable */ } }
      return Promise.resolve(ok);
    }
    return new Promise(resolve => {
      $('pinInput').value = '';
      $('pinMsg').textContent = '';
      $('pinView').classList.remove('hidden');
      $('pinInput').focus();
      const done = ok => { $('pinView').classList.add('hidden'); $('pinCancel').onclick = null; resolve(ok); };
      const tryPin = async pin => {
        const r = await api('/api/trivia/unlock', { pin }).catch(() => ({ ok: false }));
        if (!r.ok) { $('pinMsg').textContent = 'Adult levels need an adult signed in with ARKS ID.'; PinPad.clear($('pinInput')); return; }
        S.pin = pin;
        try { sessionStorage.setItem('trivia.adultPin', pin); } catch { /* unavailable */ }
        done(true);
      };
      PinPad.attach($('pinInput'), tryPin);
      $('pinCancel').onclick = () => done(false);
    });
  }

  function setMode(mode) {
    S.mode = mode;
    for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    // The remote plays for everyone in turn: the same list of names as sharing a phone.
    const panel = mode === 'tvremote' ? 'local' : mode;
    for (const m of ['solo', 'local', 'host', 'join', 'tvphones', 'tvpass']) $(`${m}Setup`).classList.toggle('hidden', m !== panel);
    $('goBtn').textContent = mode === 'host' ? 'Create lobby'
      : mode === 'tvphones' || mode === 'tvpass' ? 'Show the code on the TV' : 'Let\'s play';
    // List Hosted Games: the lobbies to pick from replace the game's own settings.
    const finding = mode === 'join';
    for (const id of ['levelList', 'genreChips']) $(id).closest('.panel').classList.toggle('hidden', finding);
    $('goBtn').classList.toggle('hidden', finding);
    if (finding) startFinding(); else stopFinding();
    $('hostNameRow').classList.toggle('hidden', !!profileToken());
    $('countHint').textContent = ['local', 'tvpass', 'tvremote'].includes(mode) ? '(each)' : '';
    $('localSetup').querySelector('.hint').textContent = mode === 'tvremote'
      ? 'Take turns with the remote: each player gets their own questions. Add everyone\'s names (or leave them as they are).'
      : 'Take turns: each player gets their own questions.';
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
      row.querySelector('button').onclick = () => { if (S.names.length > (S.mode === 'tvremote' ? 1 : 2)) { S.names.splice(i, 1); renderNames(); } };
      list.appendChild(row);
    });
    $('addPlayerBtn').classList.toggle('hidden', S.names.length >= 8);
  }

  function settings() {
    return {
      level: S.level, drinking: isAdult() && $('drinkingOpt').checked, couples: isAdult() && $('couplesOpt').checked,
      genres: [...S.genres], difficulty: S.difficulty, count: S.count, seconds: S.seconds, packId: Number(S.pack) || null
    };
  }

  async function go() {
    Blip.unlock();
    $('setupMsg').textContent = '';
    try {
      if (S.mode.startsWith('tv')) return await hostOnTv(S.mode);
      if (S.mode === 'solo' || S.mode === 'local') return await startLocal();
      if (S.mode === 'host') {
        if (S.who === 'selected' && !S.chosen.size) { $('setupMsg').textContent = 'Choose at least one person.'; return; }
        const r = await RoomPassword.withPassword(password =>
          api('/api/trivia/rooms', { name: $('hostName').value, settings: settings(), password, who: S.who,
            allowed: S.who === 'selected' ? [...S.chosen] : [] }, { ...pinHeaders(), ...profileHeaders() }));
        if (r) { if (S.who === 'selected') toast('The people you chose will get a notification.'); enterRoom(r); }
        return;
      }
    } catch (e) { $('setupMsg').textContent = e.message; }
  }

  // ---- Create a game lobby: who can join --------------------------------------------
  const profileToken = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);
  const profileHeaders = () => (profileToken() ? { 'X-Profile-Token': profileToken() } : {});
  S.who = 'anyone';
  S.chosen = new Set();
  async function setWho(who) {
    if (who === 'selected' && !profileToken()) { $('setupMsg').textContent = 'Pick your profile at the top first, so the people you choose know who it\'s from.'; return; }
    S.who = who;
    for (const b of $('whoSeg').children) b.setAttribute('aria-pressed', String(b.dataset.who === who));
    $('setupMsg').textContent = '';
    $('pickPeople').classList.toggle('hidden', who !== 'selected');
    if (who === 'selected') {
      if (!S.people) { try { S.people = (await api('/api/invites/people', undefined, profileHeaders())).people; } catch { S.people = []; } }
      LobbyUI.people($('pickPeople'), S.people, S.chosen, () => {});
      if (!S.people.length) $('setupMsg').textContent = 'Nobody else has a profile here yet.';
    }
  }

  // ---- List Hosted Games ----------------------------------------------------------------
  function startFinding() {
    stopFinding();
    loadLobbies();
    S.findTimer = setInterval(() => { if (!document.hidden) loadLobbies(); }, 5000);
  }
  function stopFinding() { if (S.findTimer) { clearInterval(S.findTimer); S.findTimer = null; } }
  async function fetchLobbies() {
    const r = await fetch('/api/trivia/lobbies', { headers: profileHeaders(), cache: 'no-store' });
    return (await r.json()).lobbies || [];
  }
  async function loadLobbies() {
    let list;
    try { list = await fetchLobbies(); } catch { return; }
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
      const name = document.createElement('b'); name.textContent = `${l.adult ? '🔞 ' : ''}${l.host}'s lobby`;
      const sub = document.createElement('small');
      sub.textContent = l.question ? `Game started · question ${l.question.index} of ${l.question.total}` : `${l.level} · Multiplayer-Multiple devices`;
      main.append(name, sub);
      const count = document.createElement('span'); count.className = 'lb-count'; count.textContent = `${l.count}/${l.max}`;
      b.append(main, count);
      if (l.status === 'full') { const f = document.createElement('span'); f.className = 'lb-full'; f.textContent = 'FULL'; b.append(f); }
      b.addEventListener('click', () => openDetails(l));
      li.append(b);
      rows.append(li);
    }
  }
  function openDetails(l) {
    S.details = l;
    $('detailsTitle').textContent = `${l.host}'s Know-It-All lobby`;
    $('dPlayers').textContent = `${l.players.join(', ')} · ${l.count} of ${l.max}`;
    $('dHow').textContent = l.screen ? 'The questions are on the TV. Everyone answers on their own device at the same time.'
      : 'Each player on their own device. Everyone answers at the same time, and faster right answers score more.';
    $('dStatus').textContent = l.status === 'full' ? 'Full' : l.question ? `Playing, question ${l.question.index} of ${l.question.total}` : 'Waiting for players';
    $('dLate').classList.toggle('hidden', !l.question);
    $('joinBtn').textContent = l.question ? 'Join game in progress?' : 'Join lobby';
    $('joinBtn').disabled = l.status === 'full';
    $('dGuest').classList.toggle('hidden', !!profileToken());
    $('detailsMsg').textContent = '';
    $('detailsView').classList.remove('hidden');
  }
  const closeDetails = () => $('detailsView').classList.add('hidden');
  async function joinLobby() {
    const l = S.details;
    if (!l) return;
    $('detailsMsg').textContent = '';
    try {
      // An adult game asks for its lobby password (not the adult pass).
      const r = await RoomPassword.withPassword(password =>
        api(`/api/trivia/rooms/${l.code}/join`, { name: $('joinName').value, password }, profileHeaders()));
      if (r) { closeDetails(); enterRoom(r); }
    } catch (e) { $('detailsMsg').textContent = e.message; }
  }
  // Opening trivia.html?join=CODE (an invite, the home page): that lobby's details.
  async function openFromLink(code) {
    try {
      const l = (await fetchLobbies()).find(x => x.code === code);
      if (l) return openDetails(l);
    } catch { /* falls through */ }
    setMode('join');
    $('setupMsg').textContent = 'That game isn\'t open anymore. Here are the ones that are.';
  }

  // ---- the TV hosts ------------------------------------------------------------------
  // The TV makes the room as its screen (it shows the game and doesn't play).
  // Everyone on their own phone answers together; passing a phone around or
  // using the remote takes turns. With the remote, the TV holds every player.
  const PASSWORDS = ['tacos', 'disco', 'pickle', 'waffle', 'banjo', 'noodle', 'meteor', 'cactus', 'walrus', 'jelly'];
  async function hostOnTv(mode) {
    if (window.ArcadeStats) ArcadeStats.play();
    const st = { ...settings(), style: mode === 'tvphones' ? 'together' : 'turns' };
    // An adult game needs a lobby password for the guests' phones. Typing on
    // a TV is slow, so the TV makes one up and shows it in its lobby.
    const password = isAdult() ? PASSWORDS[Math.floor(Math.random() * PASSWORDS.length)] + (10 + Math.floor(Math.random() * 90)) : undefined;
    const tvName = (ArcadeTV.state.tv && ArcadeTV.state.tv.name) || 'TV';
    const r = await api('/api/trivia/rooms', { name: tvName, screen: true, settings: st, password }, pinHeaders());
    if (mode === 'tvremote') {
      for (const [i, n] of S.names.entries()) {
        await api(`/api/trivia/rooms/${r.code}/seats`, { playerId: r.playerId, token: r.token, name: n.trim() || `Player ${i + 1}` });
      }
    }
    enterRoom(r);
  }

  // ---- solo and one-phone games ------------------------------------------------------

  async function startLocal() {
    if (window.ArcadeStats) ArcadeStats.play();
    const names = S.mode === 'solo' ? ['You'] : S.names.map((n, i) => n.trim() || `Player ${i + 1}`);
    const st = settings();
    const per = st.count;
    const q = new URLSearchParams({ level: st.level, genres: st.genres.join(','), difficulty: st.difficulty, count: String(per * names.length), seconds: String(st.seconds) });
    if (st.packId) q.set('pack', String(st.packId));
    const data = await api(`/api/trivia/questions?${q}`, undefined, pinHeaders());
    if (!data.questions.length) throw new Error('No questions match. Try more genres.');
    S.game = {
      settings: st, players: names.map(name => ({ id: name, name, score: 0, streak: 0 })),
      questions: data.questions, qi: -1, drinks: data.drinks, dares: data.dares, timer: null
    };
    show('play');
    nextLocal();
  }

  async function nextLocal() {
    const g = S.game;
    g.qi++;
    $('nextBtn').classList.add('hidden');
    if (g.qi >= g.questions.length) return finishLocal();
    const owner = g.players[g.qi % g.players.length];
    if (g.players.length > 1) {
      $('passTitle').textContent = `${owner.name}'s turn`;
      $('passView').classList.remove('hidden');
      await new Promise(r => { $('passOk').onclick = () => { $('passView').classList.add('hidden'); r(); }; });
    }
    const q = g.questions[g.qi];
    renderQuestion(q, g.qi, g.questions.length, g.players.length > 1 ? `${owner.name.toUpperCase()}'S QUESTION` : null);
    renderStrip(g.players, owner.id);
    const total = g.settings.seconds * 1000;
    const started = Date.now();
    g.answered = false;
    enableAnswers(choice => answerLocal(choice, Date.now() - started, total));
    runTimer(started + total, total, () => answerLocal(null, total, total));
  }

  async function answerLocal(choice, used, total) {
    const g = S.game;
    if (g.answered) return;
    g.answered = true;
    stopTimer();
    const q = g.questions[g.qi];
    const owner = g.players[g.qi % g.players.length];
    const correct = choice === q.correctIndex;
    const pts = TriviaRules.points(q.difficulty, correct, total - used, total);
    owner.score += pts;
    owner.streak = correct ? owner.streak + 1 : 0;
    markAnswers(q.correctIndex, choice);
    sound(correct);
    $('qStatus').innerHTML = choice == null ? '⏰ Out of time!' : correct ? `✅ Right! <span class="pts">+${pts}</span>` : '❌ Not quite.';
    renderStrip(g.players, owner.id);
    await sleep(900);
    const callouts = TriviaRules.afterQuestion([{ id: owner.id, name: owner.name, correct, streak: owner.streak }], { ...g.settings, drinks: g.drinks, dares: g.dares });
    for (const c of callouts) await showCallout(c);
    $('nextBtn').textContent = g.qi + 1 >= g.questions.length ? 'See the results →' : 'Next question →';
    $('nextBtn').classList.remove('hidden');
  }

  async function finishLocal() {
    const g = S.game;
    const standings = g.players.slice().sort((a, b) => b.score - a.score);
    for (const c of TriviaRules.afterGame(standings, { ...g.settings, drinks: g.drinks, dares: g.dares })) await showCallout(c);
    showFinal(standings, g.players.length === 1 ? `You scored ${standings[0].score.toLocaleString('en-US')}!` : `${standings[0].name} knows it all! 🏆`, g.players.length === 1 && standings[0].score > 0);
  }

  // ---- rooms ------------------------------------------------------------------------------

  function enterRoom(r) {
    S.room = { code: r.code, playerId: r.playerId, token: r.token };
    try { sessionStorage.setItem('trivia.room', JSON.stringify(S.room)); } catch { /* unavailable */ }
    S.game = null;
    S.shownReveal = null;
    S.shownFinale = false;
    $('lobbyCode').textContent = r.code;
    show('lobby');
    connect();
  }

  function connect() {
    if (S.es) S.es.close();
    const { code, playerId, token } = S.room;
    S.es = new EventSource(`/api/trivia/rooms/${code}/events?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`);
    S.es.addEventListener('state', e => applySnap(JSON.parse(e.data)));
    S.es.addEventListener('removed', () => { leaveRoom(); show('setup'); toast('The host removed you from the lobby.'); });
    S.es.onerror = () => {
      fetch(`/api/trivia/rooms/${code}?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`)
        .then(r => { if (r.status === 404 || r.status === 403) { leaveRoom(); show('setup'); toast('That game has ended.'); } }).catch(() => {});
    };
  }

  function leaveRoom() {
    if (S.es) { S.es.close(); S.es = null; }
    S.room = null;
    S.snap = null;
    try { sessionStorage.removeItem('trivia.room'); } catch { /* unavailable */ }
  }

  async function roomPost(path, body = {}) {
    const { code, playerId, token } = S.room;
    try { await api(`/api/trivia/rooms/${code}/${path}`, { playerId, token, ...body }); } catch (e) { toast(e.message); }
  }

  function applySnap(snap) {
    S.snap = snap;
    S.skew = snap.serverNow - Date.now();
    document.documentElement.classList.toggle('adult-mode', !!(levelInfo(snap.settings.level).adult || ['cheeky', 'spicy', 'filthy'].includes(snap.settings.level)));
    if (snap.phase === 'lobby') return renderLobby(snap);
    if (snap.phase === 'over') return renderRoomFinal(snap);
    show('play');
    // The chat goes on under the game (not on the TV's own screen).
    $('gameChat').classList.toggle('hidden', !!snap.isScreen);
    if (!snap.isScreen) S.gameChat.render(snap.chat || [], { muted: snap.muted });
    $('overView').classList.add('hidden');
    const turns = snap.settings.style === 'turns';
    const turn = snap.turn;
    $('turnBanner').classList.toggle('hidden', !turn);
    if (turn) $('turnBanner').textContent = `${turn.name.toUpperCase()}'S TURN`;
    renderStrip(snap.players.map(p => ({ ...p, done: p.answered })), turn ? turn.id : null, snap.phase === 'question' && !turns);
    // Taking turns: the room waits until whoever's up is ready.
    const waiting = snap.phase === 'ready';
    $('readyBox').classList.toggle('hidden', !waiting);
    for (const id of ['qText', 'answers', 'qStatus']) $(id).classList.toggle('hidden', waiting);
    $('qText').parentElement.classList.toggle('hidden', waiting);
    if (waiting) {
      stopTimer();
      S.focusedKey = null;
      const u = snap.upNext;
      $('qProgress').textContent = u ? `Q ${u.index + 1} / ${u.total}` : '';
      $('qGenre').textContent = u ? u.genre : '';
      $('qDiff').textContent = u ? u.difficulty : '';
      $('qDiff').className = `tag ${u ? u.difficulty : ''}`;
      $('qTimerFill').style.transform = 'scaleX(1)';
      $('readyTitle').textContent = `${turn.name}'s turn`;
      const seat = snap.players.find(p => p.id === turn.id) || {};
      $('readyHint').textContent = turn.yours
        ? (snap.isScreen ? `${turn.name}, grab the remote. Press OK when you're ready and the clock starts.`
          : snap.mine.length > 1 ? `Hand the device to ${turn.name}. The clock starts when they press I'm ready.` : 'The clock starts when you press I\'m ready.')
        : seat.on === 'screen' ? `${turn.name} answers with the TV remote.`
          : `Waiting for ${turn.name} to get ready${seat.on ? ` on ${seat.on}'s device` : ''}.`;
      $('readyBtn').textContent = turn.yours ? 'I\'m ready' : 'Start the clock';
      $('readyBtn').classList.toggle('hidden', !turn.yours && !snap.host);
      $('nextBtn').classList.add('hidden');
      return;
    }
    const q = snap.question;
    const key = `${q.index}`;
    if ($('qText').dataset.key !== key) {
      renderQuestion(q, q.index, q.total, null);
      $('turnBanner').classList.toggle('hidden', !turn);
      $('qText').dataset.key = key;
      // A question on the TV counts as a game being played (adults' night keeps going).
      if (TV) ArcadeTV.played();
    }
    $('nextBtn').classList.toggle('hidden', !snap.host);
    $('nextBtn').textContent = snap.phase === 'question' ? 'Reveal now →' : 'Next question →';
    if (snap.phase === 'question') {
      if (snap.answeringFor && snap.yourChoice == null) {
        const seat = snap.answeringFor;
        enableAnswers(choice => { markMine(choice); roomPost('answer', { choice, seat }); });
        $('qStatus').textContent = '';
        // On the TV, the highlight starts on the first answer.
        if (S.focusedKey !== key) { S.focusedKey = key; const first = $('answers').firstElementChild; if (first && TV) first.focus(); }
      } else if (snap.answeringFor) {
        markMine(snap.yourChoice, true);
        const n = snap.players.filter(p => p.answered).length;
        $('qStatus').textContent = turns ? '🔒 Locked in!' : `🔒 Locked in! Waiting for the others (${n}/${snap.players.length})`;
      } else {
        const n = snap.players.filter(p => p.answered).length;
        const seat = turn && snap.players.find(p => p.id === turn.id);
        $('qStatus').textContent = turn ? `${turn.name} is answering${seat && seat.on && seat.on !== 'screen' ? ` on ${seat.on}'s device` : ''}…`
          : `📱 Answer on your own devices! (${n}/${snap.players.length} locked in)`;
      }
      const total = snap.settings.seconds * 1000;
      runTimer(snap.endsAt - S.skew, total, () => {});
    } else if (snap.phase === 'reveal') {
      stopTimer();
      const rv = snap.reveal;
      const me = rv.results.find(r => r.id === snap.answeringFor) || rv.results.find(r => r.id === snap.you);
      markAnswers(rv.correctIndex, me ? me.choice : null, rv.results);
      if (S.shownReveal !== key) {
        S.shownReveal = key;
        if (me) sound(me.correct); else if (rv.results.length) sound(rv.results.some(r => r.correct));
        const right = rv.results.filter(r => r.correct);
        const who = me && turns ? `${me.name}: ` : '';
        $('qStatus').innerHTML = '';
        if (me) $('qStatus').textContent = me.choice == null ? `⏰ ${who}Out of time!` : me.correct ? `✅ ${who}Right! +${me.points}` : `❌ ${who}Not quite.`;
        else if (rv.results.length === 1) { const r = rv.results[0]; $('qStatus').textContent = r.choice == null ? `⏰ ${r.name} ran out of time.` : r.correct ? `✅ ${r.name} got it! +${r.points}` : `❌ Not quite, ${r.name}.`; }
        else if (rv.results.length) $('qStatus').textContent = right.length ? `✅ ${right.map(r => r.name).join(', ')} got it right!` : '❌ Nobody got that one.';
        (async () => { for (const c of rv.callouts) await showCallout(c, 4500); })();
      }
    }
  }

  function renderLobby(snap) {
    show('lobby');
    $('lobbyTitle').textContent = snap.screen ? 'Know-It-All on the TV' : snap.host ? 'Your Know-It-All lobby' : `${snap.hostName}'s Know-It-All lobby`;
    // The code and the QR are for the TV, where phones scan to join. A lobby hosted
    // on a phone is joined from List Hosted Games, with no code.
    $('tvJoin').classList.toggle('hidden', !snap.screen);
    $('lobbyCode').textContent = snap.code;
    if (snap.screen && $('joinQr').dataset.code !== snap.code) { $('joinQr').dataset.code = snap.code; ArcadeQR.forGame($('joinQr'), 'trivia.html', snap.code, $('joinLink')); }
    const s = snap.settings;
    const turns = s.style === 'turns';
    $('lobbyLevel').textContent = `${s.levelLabel} · ${s.count} questions${turns ? ' each' : ''} · ${s.seconds}s each` +
      (s.drinking ? ' · 🍺 Drinking' : '') + (s.couples ? ' · 💋 Dares' : '') + (snap.lobbyPassword ? ` · 🔒 Password: ${snap.lobbyPassword}` : snap.locked ? ' · 🔒 Locked' : '');
    $('lobbyHow').textContent = !snap.screen ? ''
      : !turns ? 'Everyone scans the code with their own phone and types their name. You all answer at the same time on your phones, and the questions show up here on the TV.'
        : snap.isScreen ? 'Scan the code with the phone you\'ll pass around and add everyone\'s names on it, or add players right here to play with the remote. Each player gets their own questions, one turn at a time.'
          : 'You take turns. Add everyone who\'ll share this device below, and hand it over when it\'s their turn.';
    $('lobbyCount').textContent = `(${snap.players.length})`;
    const list = $('lobbyPlayers');
    list.innerHTML = '';
    for (const p of snap.players) {
      const li = document.createElement('li');
      li.className = p.online ? '' : 'offline';
      li.textContent = p.name;
      const tag = text => { const t = document.createElement('span'); t.className = 'tag'; t.textContent = text; li.appendChild(t); };
      if (p.id === snap.you) tag('you');
      if (p.name === snap.hostName && !snap.screen) tag('host');
      else if (!snap.screen && p.device) tag(p.ready ? 'ready' : 'not ready');
      if (p.mutedChat) tag('🔇');
      // The host can mute someone's chat or take them out of the lobby.
      if (snap.host && !snap.screen && p.device && p.id !== snap.you) {
        for (const [label, act] of [[p.mutedChat ? 'Unmute' : 'Mute', () => roomPost('mute', { seat: p.id, on: !p.mutedChat })], ['Remove Player', () => roomPost('remove', { seat: p.id })]]) {
          const b = document.createElement('button');
          b.className = 'lb-mute';
          b.style.marginLeft = '8px';
          b.textContent = label;
          b.onclick = act;
          li.appendChild(b);
        }
      }
      if (p.on === 'screen') tag('on the TV');
      else if (p.on) tag(`on ${p.on}'s device`);
      // Players this device added can be taken off again before the start.
      if (snap.mine.includes(p.id) && p.id !== snap.you) {
        const x = document.createElement('button');
        x.className = 'ghost seat-x';
        x.textContent = '✕';
        x.title = `Take ${p.name} off`;
        x.style.cssText = 'margin-left:10px;padding:2px 10px';
        x.onclick = () => roomPost('seats/remove', { seat: p.id });
        li.appendChild(x);
      }
      list.appendChild(li);
    }
    $('seatBox').classList.toggle('hidden', !turns);
    $('seatLabel').firstChild.textContent = snap.isScreen ? 'Add a player who uses the remote' : 'Add a player on this device';
    $('startBtn').classList.toggle('hidden', !snap.host);
    // Lights up once someone's in and everyone is ready (the TV starts whenever it's set).
    const canStart = !!snap.players.length && (snap.screen || (snap.players.length > 1 && snap.allReady));
    $('startBtn').disabled = !canStart;
    $('startBtn').textContent = snap.screen ? 'Start the game' : snap.players.length < 2 ? 'Waiting on players to join...'
      : !snap.allReady ? 'Waiting on players to be ready...' : 'Players Ready, Start Game!';
    $('startBtn').toggleAttribute('data-tv-start', canStart);
    const me = snap.players.find(p => p.id === snap.you);
    const guest = !snap.host && !snap.isScreen && !snap.screen && !!me;
    $('lobbyReadyBtn').classList.toggle('hidden', !guest);
    $('readyHint').classList.toggle('hidden', !guest || (me && me.ready));
    if (guest) { $('lobbyReadyBtn').textContent = me.ready ? 'Not ready yet' : 'Ready!'; $('lobbyReadyBtn').className = me.ready ? 'ghost big' : 'primary big'; }
    $('waitHost').classList.toggle('hidden', snap.host || (guest && !me.ready));
    $('waitHost').textContent = `Waiting for ${snap.hostName || 'the host'} to start the game…`;
    S.lobbyChat.render(snap.chat || [], { muted: snap.muted });
  }

  function renderRoomFinal(snap) {
    stopTimer();
    if (S.shownFinale) return;
    S.shownFinale = true;
    (async () => {
      for (const c of snap.finale.callouts) await showCallout(c, 5000);
      const top = snap.finale.standings[0];
      showFinal(snap.finale.standings, top ? `${top.name} knows it all! 🏆` : 'Game over', false, snap.host);
    })();
  }

  // ---- drawing -----------------------------------------------------------------------------

  function renderQuestion(q, index, total, banner) {
    $('qProgress').textContent = `Q ${index + 1} / ${total}`;
    $('qGenre').textContent = q.genre;
    $('qDiff').textContent = q.difficulty;
    $('qDiff').className = `tag ${q.difficulty}`;
    $('turnBanner').classList.toggle('hidden', !banner);
    $('turnBanner').textContent = banner || '';
    $('qText').textContent = q.question;
    $('qStatus').textContent = '';
    const box = $('answers');
    box.innerHTML = '';
    box.classList.remove('revealed');
    q.answers.forEach((a, i) => {
      const b = document.createElement('button');
      b.innerHTML = '<span class="k"></span><span class="a"></span><span class="who"></span>';
      b.querySelector('.k').textContent = q.answers.length === 2 ? (a === 'True' ? '✓' : '✗') : KEYS[i];
      b.querySelector('.a').textContent = a;
      b.disabled = true;
      box.appendChild(b);
    });
  }

  function enableAnswers(onPick) {
    [...$('answers').children].forEach((b, i) => {
      b.disabled = false;
      b.onclick = () => {
        for (const x of $('answers').children) x.disabled = true;
        onPick(i);
      };
    });
  }

  function markMine(choice, lock = false) {
    [...$('answers').children].forEach((b, i) => {
      b.classList.toggle('mine', i === choice);
      if (lock) b.disabled = true;
    });
  }

  function markAnswers(correctIndex, choice, results = null) {
    $('answers').classList.add('revealed');
    [...$('answers').children].forEach((b, i) => {
      b.disabled = true;
      b.classList.toggle('right', i === correctIndex);
      b.classList.toggle('wrong', i === choice && i !== correctIndex);
      if (results) b.querySelector('.who').textContent = results.filter(r => r.choice === i).map(r => r.name).join(', ');
    });
  }

  function renderStrip(players, nowId, showDone = false) {
    const ul = $('scoreStrip');
    ul.innerHTML = '';
    for (const p of players.slice().sort((a, b) => b.score - a.score)) {
      const li = document.createElement('li');
      li.className = (p.id === nowId ? 'now' : '') + (showDone && p.done ? ' done' : '');
      li.innerHTML = '<span></span><b></b>';
      li.firstChild.textContent = p.name;
      li.lastChild.textContent = p.score.toLocaleString('en-US');
      ul.appendChild(li);
    }
  }

  let raf = null;
  const thinking = Blip.thinker();
  function runTimer(endsAt, total, onEnd) {
    stopTimer();
    const fill = $('qTimerFill');
    let lastSec = null;
    thinking.reset();
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      fill.style.transform = `scaleX(${left / total})`;
      $('qTimerFill').parentElement.classList.toggle('low', left < 5000);
      const sec = Math.ceil(left / 1000);
      // The thinking tune while people pick, or quiet ticks at the end if the
      // tune is turned off (the 🎵 button).
      if (Blip.tuneOn) thinking.step(left);
      else if (sec !== lastSec && sec <= 5 && sec > 0) Blip.tone(sec <= 2 ? 1320 : 990, 0.04, { type: 'square', volume: 0.04 });
      lastSec = sec;
      if (left <= 0) { raf = null; onEnd(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function stopTimer() { if (raf) cancelAnimationFrame(raf); raf = null; }

  function sound(correct) {
    if (correct) Blip.tune([[660, 0.08], [880, 0.08], [1320, 0.16]], { type: 'triangle' });
    else Blip.tone([300, 120], 0.35, { type: 'sawtooth', volume: 0.07 });
  }

  // A drink or a dare, big enough to read across the room.
  function showCallout(c, autoMs = 0) {
    return new Promise(resolve => {
      const card = $('calloutCard');
      card.classList.toggle('dare', c.kind === 'dare');
      $('calloutEmoji').textContent = c.kind === 'dare' ? '💋' : '🍺';
      $('calloutWho').textContent = c.name ? c.name.toUpperCase() : 'EVERYONE';
      $('calloutText').textContent = c.text;
      $('calloutView').classList.remove('hidden');
      Blip.tune(c.kind === 'dare' ? [[523, 0.1], [784, 0.2]] : [[392, 0.1], [523, 0.15]], { type: 'triangle', volume: 0.08 });
      let t = null;
      const done = () => { clearTimeout(t); $('calloutView').classList.add('hidden'); $('calloutOk').onclick = null; resolve(); };
      $('calloutOk').onclick = done;
      if (autoMs) t = setTimeout(done, autoMs);
    });
  }

  let initials = null;
  function showFinal(standings, title, canSave, isHost = true) {
    $('overTitle').textContent = title;
    const ol = $('finalList');
    ol.innerHTML = '';
    for (const p of standings) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><b></b>';
      li.firstChild.textContent = p.name;
      li.lastChild.textContent = p.score.toLocaleString('en-US');
      ol.appendChild(li);
    }
    $('overScore').classList.toggle('hidden', !canSave);
    $('saveScoreBtn').disabled = false;
    $('scoreMsg').textContent = '';
    $('againBtn').classList.toggle('hidden', !isHost);
    $('overView').classList.remove('hidden');
    Blip.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], { type: 'triangle' });
    if (canSave) setTimeout(() => initials.reset(), 50);
  }

  async function saveScore() {
    const who = initials.value();
    if (!who) { $('scoreMsg').textContent = 'Type your initials first.'; return; }
    $('saveScoreBtn').disabled = true;
    try {
      const g = S.game;
      const r = await ArcadeKit.saveScore('trivia', {
        initials: who, score: g.players[0].score, board: isAdult() ? 'adult' : 'solo',
        detail: `${g.questions.length} Qs · ${levelInfo(S.level).label}${g.settings.difficulty !== 'mixed' ? ' · ' + g.settings.difficulty : ''}`
      });
      initials.remember(who);
      $('overScore').classList.add('hidden');
      openScores(r.id);
      toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
    } catch (e) { $('scoreMsg').textContent = e.message; $('saveScoreBtn').disabled = false; }
  }

  function openScores(highlightId, board = isAdult() ? 'adult' : 'solo') {
    // Both boards are open to everyone; only playing the adult level needs the PIN.
    $('scoreBoardSeg').classList.remove('hidden');
    for (const b of $('scoreBoardSeg').children) b.setAttribute('aria-pressed', String(b.dataset.board === board));
    ArcadeKit.loadScores('trivia', board, $('scoreList'), highlightId, pinHeaders());
    $('scoresView').classList.remove('hidden');
  }

  function backToSetup() {
    stopTimer();
    $('overView').classList.add('hidden');
    if (S.room) { roomPost('leave'); leaveRoom(); }
    S.game = null;
    show('setup');
    renderLevels();
  }

  // ---- how to play --------------------------------------------------------------------------

  const help = Tutorial.create('trivia', [
    { emoji: '🧠', title: 'The goal', html: `<p>Answer multiple-choice questions. Right answers score points: <b>100</b> easy, <b>200</b> medium, <b>300</b> hard, plus up to half again for answering <b>fast</b>.</p><p>Most points at the end knows it all.</p>` },
    { emoji: '🎮', title: 'Ways to play', html: `<table>
        <tr><td>🙂 Solo</td><td>Just you. Get on the 🏆 board.</td></tr>
        <tr><td>📱 Multiplayer-Single device</td><td>Take turns; everyone gets their own questions.</td></tr>
        <tr><td>📱📱 Create a game lobby</td><td>Everyone answers on their own device at the same time. Fastest right answer scores most. Everyone else joins from 🔎 List Hosted Games.</td></tr>
      </table>` },
    { emoji: '🎚️', title: 'Pick what you like', html: `<p>Choose <b>genres</b> (or none for a mix), a <b>difficulty</b>, how many questions, and how long to answer.</p><p>Got an idea for a topic? Tap <b>💡 Suggest a topic</b>.</p>` },
    { emoji: '🔞', title: 'For adults', html: `<p><b>Cheeky</b>, <b>Spicy</b> and <b>Filthy</b> unlock for adults signed in with ARKS ID and get spicier as you go.</p><p>🍺 <b>Drinking</b>: wrong answers drink, three in a row gives drinks, last place finishes theirs.</p><p>💋 <b>Couples dares</b>: miss a question, do a dare. The heat matches the level.</p><div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>` }
  ]);

  // ---- wiring ---------------------------------------------------------------------------------

  const segs = { diffSeg: v => { S.difficulty = v; }, countSeg: v => { S.count = Number(v); }, secsSeg: v => { S.seconds = Number(v); } };
  for (const [id, set] of Object.entries(segs)) {
    for (const b of $(id).children) b.onclick = () => { set(b.dataset.v); for (const x of $(id).children) x.setAttribute('aria-pressed', String(x === b)); };
  }
  for (const b of $('modeSeg').children) b.onclick = () => setMode(b.dataset.mode);
  $('packSelect').onchange = () => { S.pack = $('packSelect').value; };
  $('addPlayerBtn').onclick = () => { if (S.names.length < 8) { S.names.push(''); renderNames(); } };
  $('goBtn').onclick = go;
  for (const b of $('whoSeg').children) b.onclick = () => setWho(b.dataset.who);
  $('joinBtn').onclick = joinLobby;
  $('detailsClose').onclick = closeDetails;
  $('joinName').onkeydown = e => { if (e.key === 'Enter') joinLobby(); };
  $('lobbyReadyBtn').onclick = () => { const me = S.snap && S.snap.players.find(p => p.id === S.snap.you); roomPost('lobby-ready', { ready: !(me && me.ready) }); };
  const sendChat = text => { const { code, playerId, token } = S.room; return api(`/api/trivia/rooms/${code}/chat`, { playerId, token, text }); };
  S.lobbyChat = LobbyUI.chat($('lobbyChat'), { send: sendChat });
  S.gameChat = LobbyUI.chat($('gameChat'), { send: sendChat });
  $('startBtn').onclick = () => { if (window.ArcadeStats) ArcadeStats.play(); roomPost('start'); };
  $('lobbyLeave').onclick = backToSetup;
  $('nextBtn').onclick = () => { if (S.room) roomPost('next'); else nextLocal(); };
  // A TV can't show a confirm box, so there it's "press again to quit".
  let quitArmed = null;
  $('quitBtn').onclick = () => {
    if (!TV) { if (confirm('Quit this game?')) backToSetup(); return; }
    if (quitArmed) { clearTimeout(quitArmed); quitArmed = null; $('quitBtn').textContent = 'Quit'; backToSetup(); return; }
    $('quitBtn').textContent = 'Press OK again to quit';
    quitArmed = setTimeout(() => { quitArmed = null; $('quitBtn').textContent = 'Quit'; }, 4000);
  };
  $('readyBtn').onclick = () => roomPost('ready');
  const addSeat = () => {
    const name = $('seatName').value.trim();
    $('seatName').value = '';
    roomPost('seats', { name });
  };
  $('seatAdd').onclick = addSeat;
  $('seatName').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addSeat(); } };
  if (TV) {
    // A controller's X, Y and shoulder buttons pick answers A to D.
    const PAD = { 2: 0, 3: 1, 4: 2, 5: 3 };
    ArcadeTV.onPad(({ button }) => {
      const b = $('answers').children[PAD[button]];
      if (b && !b.disabled && !$('play').classList.contains('hidden')) b.click();
    });
    // Adults' night ended (Back to family, or it ran out): family mode at
    // once. An adult game on the TV stops and the setup comes back.
    document.addEventListener('arcadetv:mode', e => {
      if (e.detail.adult) { renderLevels(); return; }
      S.pin = '';
      if (S.room && S.snap && levelInfo(S.snap.settings.level).adult) {
        roomPost('leave'); leaveRoom(); stopTimer();
        $('overView').classList.add('hidden');
        show('setup');
        toast('Back to family mode.');
      }
      if (isAdult()) S.level = 'kids';
      loadConfig();
    });
  }
  $('againBtn').onclick = () => {
    $('overView').classList.add('hidden');
    if (S.room) { S.shownFinale = false; S.shownReveal = null; roomPost('start'); } else startLocal().catch(e => toast(e.message));
  };
  $('menuBtn').onclick = backToSetup;
  $('saveScoreBtn').onclick = saveScore;
  $('scoresBtn').onclick = () => openScores();
  $('scoresClose').onclick = () => $('scoresView').classList.add('hidden');
  for (const b of $('scoreBoardSeg').children) b.onclick = () => openScores(null, b.dataset.board);
  $('helpBtn').onclick = () => help.open();
  $('suggestBtn').onclick = () => {
    for (const id of ['reqTopic', 'reqNote', 'reqBy']) $(id).value = '';
    $('reqMsg').textContent = '';
    $('requestForm').classList.remove('hidden');
    $('reqThanks').classList.add('hidden');
    $('requestView').classList.remove('hidden');
  };
  $('reqCancel').onclick = () => $('requestView').classList.add('hidden');
  $('reqSend').onclick = async () => {
    const topic = $('reqTopic').value.trim();
    if (!topic) { $('reqMsg').textContent = 'Type a topic first.'; return; }
    try {
      await api('/api/trivia/requests', { topic, note: $('reqNote').value.trim(), requestedBy: $('reqBy').value.trim() });
      $('requestForm').classList.add('hidden');
      $('reqThanks').classList.remove('hidden');
      setTimeout(() => $('requestView').classList.add('hidden'), 1800);
    } catch (e) { $('reqMsg').textContent = e.message; }
  };
  Blip.muteButton($('muteBtn'));
  Blip.tuneButton($('tuneBtn'));
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overScore .ini')], saveScore);

  // Back: from a game, its results or a room's lobby to the setup screen
  // (asking first while questions are left), and from there to the arcade.
  ArcadeBack.setup({
    atMenu: () => !$('setup').classList.contains('hidden'),
    back: backToSetup,
    busy: () => !$('play').classList.contains('hidden') && $('overView').classList.contains('hidden'),
    question: 'Quit this game? It ends here and won\'t be saved.'
  });

  // ---- boot --------------------------------------------------------------------------------------
  setMode(S.mode);
  renderNames();
  loadConfig();
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) openFromLink(joinParam.toUpperCase().slice(0, 4));
  try {
    const saved = JSON.parse(sessionStorage.getItem('trivia.room') || 'null');
    if (saved && saved.code) { S.room = saved; connect(); }
  } catch { /* nothing saved */ }
  // On a TV, How to play waits for the ? button instead of opening by itself.
  if (!TV) help.autoOpen();
})();
