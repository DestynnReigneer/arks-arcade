'use strict';

// Know-It-All: multiple-choice trivia. Solo or take turns on one phone (all
// in the browser), or everyone on their own phone in a room run by the
// server. Adult levels add raunchier questions, a drinking mode and
// couples dares.

(() => {
  const { $, toast, api } = ArcadeKit;
  const KEYS = ['A', 'B', 'C', 'D'];

  const S = {
    config: null, level: 'kids', drinking: false, couples: false, genres: new Set(), pack: '',
    difficulty: 'mixed', count: 10, seconds: 20, mode: 'solo', names: ['', ''],
    pin: (() => { try { return sessionStorage.getItem('trivia.adultPin') || ''; } catch { return ''; } })(),
    adultOk: (() => { try { return sessionStorage.getItem('trivia.adultOk') === 'yes'; } catch { return false; } })(),
    game: null,      // a solo / one-phone game
    room: null, es: null, snap: null, skew: 0, shownReveal: null, shownFinale: false
  };
  const pinHeaders = () => (S.pin ? { 'X-Adult-Pin': S.pin } : {});
  const levelInfo = id => (S.config ? S.config.levels.find(l => l.id === id) : null) || { id: 'kids', label: 'Family', adult: false, genres: [] };
  const isAdult = () => levelInfo(S.level).adult;
  const unlocked = () => (S.config && S.config.adultRequiresPin ? !!S.pin : S.adultOk);
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
      if (l.adult && !unlocked()) b.insertAdjacentHTML('beforeend', '<div class="l-lock">🔞 Adults only</div>');
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

  function unlockAdult() {
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
      const done = ok => { $('pinView').classList.add('hidden'); $('pinOk').onclick = $('pinCancel').onclick = $('pinInput').onkeydown = null; resolve(ok); };
      const tryPin = async () => {
        const pin = $('pinInput').value.trim();
        const r = await api('/api/trivia/unlock', { pin }).catch(() => ({ ok: false }));
        if (!r.ok) { $('pinMsg').textContent = 'That PIN is not right.'; return; }
        S.pin = pin;
        try { sessionStorage.setItem('trivia.adultPin', pin); } catch { /* unavailable */ }
        done(true);
      };
      $('pinOk').onclick = tryPin;
      $('pinInput').onkeydown = e => { if (e.key === 'Enter') tryPin(); };
      $('pinCancel').onclick = () => done(false);
    });
  }

  function setMode(mode) {
    S.mode = mode;
    for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    for (const m of ['solo', 'local', 'host', 'join']) $(`${m}Setup`).classList.toggle('hidden', m !== mode);
    $('goBtn').textContent = mode === 'host' ? 'Get a game code' : mode === 'join' ? 'Join the game' : 'Let\'s play';
    $('countHint').textContent = mode === 'local' ? '(each)' : '';
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
      if (S.mode === 'solo' || S.mode === 'local') return await startLocal();
      if (S.mode === 'host') {
        const r = await api('/api/trivia/rooms', { name: $('hostName').value, settings: settings() }, pinHeaders());
        return enterRoom(r);
      }
      const code = $('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { $('setupMsg').textContent = 'Type the 4-letter code.'; return; }
      try {
        enterRoom(await api(`/api/trivia/rooms/${code}/join`, { name: $('joinName').value }, pinHeaders()));
      } catch (e) {
        // An adult room: unlock, then try again.
        if (!/PIN/.test(e.message) || !(await unlockAdultFor())) throw e;
        enterRoom(await api(`/api/trivia/rooms/${code}/join`, { name: $('joinName').value }, pinHeaders()));
      }
    } catch (e) { $('setupMsg').textContent = e.message; }
  }
  async function unlockAdultFor() {
    if (!S.config) await loadConfig();
    return unlockAdult();
  }

  // ---- solo and one-phone games ------------------------------------------------------

  async function startLocal() {
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
    $('overView').classList.add('hidden');
    const q = snap.question;
    const key = `${q.index}`;
    if ($('qText').dataset.key !== key) {
      renderQuestion(q, q.index, q.total, null);
      $('qText').dataset.key = key;
    }
    renderStrip(snap.players.map(p => ({ ...p, done: p.answered })), null, snap.phase === 'question');
    $('nextBtn').classList.toggle('hidden', !snap.host);
    $('nextBtn').textContent = snap.phase === 'question' ? 'Reveal now →' : 'Next question →';
    if (snap.phase === 'question') {
      if (snap.yourChoice == null) {
        enableAnswers(choice => { markMine(choice); roomPost('answer', { choice }); });
        $('qStatus').textContent = '';
      } else {
        markMine(snap.yourChoice, true);
        const n = snap.players.filter(p => p.answered).length;
        $('qStatus').textContent = `🔒 Locked in! Waiting for the others (${n}/${snap.players.length})`;
      }
      const total = snap.settings.seconds * 1000;
      runTimer(snap.endsAt - S.skew, total, () => {});
    } else if (snap.phase === 'reveal') {
      stopTimer();
      const rv = snap.reveal;
      const me = rv.results.find(r => r.id === snap.you);
      markAnswers(rv.correctIndex, me ? me.choice : null, rv.results);
      if (S.shownReveal !== key) {
        S.shownReveal = key;
        if (me) sound(me.correct);
        $('qStatus').innerHTML = !me ? '' : me.choice == null ? '⏰ Out of time!' : me.correct ? `✅ Right! <span class="pts">+${me.points}</span>` : '❌ Not quite.';
        (async () => { for (const c of rv.callouts) await showCallout(c, 4500); })();
      }
    }
  }

  function renderLobby(snap) {
    show('lobby');
    $('lobbyCode').textContent = snap.code;
    const s = snap.settings;
    $('lobbyLevel').textContent = `${s.levelLabel} · ${s.count} questions · ${s.seconds}s each` +
      (s.drinking ? ' · 🍺 Drinking' : '') + (s.couples ? ' · 💋 Dares' : '');
    $('lobbyCount').textContent = `(${snap.players.length})`;
    const list = $('lobbyPlayers');
    list.innerHTML = '';
    for (const p of snap.players) {
      const li = document.createElement('li');
      li.className = p.online ? '' : 'offline';
      li.textContent = p.name;
      if (p.id === snap.you) li.insertAdjacentHTML('beforeend', '<span class="tag">you</span>');
      if (p.name === snap.hostName) li.insertAdjacentHTML('beforeend', '<span class="tag">host</span>');
      list.appendChild(li);
    }
    $('startBtn').classList.toggle('hidden', !snap.host);
    $('waitHost').classList.toggle('hidden', snap.host);
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
  function runTimer(endsAt, total, onEnd) {
    stopTimer();
    const fill = $('qTimerFill');
    let lastSec = null;
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      fill.style.transform = `scaleX(${left / total})`;
      $('qTimerFill').parentElement.classList.toggle('low', left < 5000);
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec && sec <= 5 && sec > 0) Blip.tone(sec <= 2 ? 1320 : 990, 0.04, { type: 'square', volume: 0.04 });
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
    $('scoreBoardSeg').classList.toggle('hidden', !unlocked());
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
        <tr><td>📱 Share a phone</td><td>Take turns; everyone gets their own questions.</td></tr>
        <tr><td>📡 Host / 🔗 Join</td><td>Everyone answers on their own phone at the same time. Fastest right answer scores most.</td></tr>
      </table>` },
    { emoji: '🎚️', title: 'Pick what you like', html: `<p>Choose <b>genres</b> (or none for a mix), a <b>difficulty</b>, how many questions, and how long to answer.</p><p>Got an idea for a topic? Tap <b>💡 Suggest a topic</b>.</p>` },
    { emoji: '🔞', title: 'For grown-ups', html: `<p><b>Cheeky</b>, <b>Spicy</b> and <b>Filthy</b> unlock with the adult PIN and get raunchier as you go.</p><p>🍺 <b>Drinking</b>: wrong answers drink, three in a row gives drinks, last place finishes theirs.</p><p>💋 <b>Couples dares</b>: miss a question, do a dare. The heat matches the level.</p><div class="tut-tip">Tap <b>?</b> at the top any time to see this again.</div>` }
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
  $('joinCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('startBtn').onclick = () => roomPost('start');
  $('lobbyLeave').onclick = backToSetup;
  $('nextBtn').onclick = () => { if (S.room) roomPost('next'); else nextLocal(); };
  $('quitBtn').onclick = () => { if (confirm('Quit this game?')) backToSetup(); };
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
  initials = ArcadeKit.wireInitials([...document.querySelectorAll('#overScore .ini')], saveScore);

  // ---- boot --------------------------------------------------------------------------------------
  setMode('solo');
  renderNames();
  loadConfig();
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) { setMode('join'); $('joinCode').value = joinParam.toUpperCase().slice(0, 4); }
  try {
    const saved = JSON.parse(sessionStorage.getItem('trivia.room') || 'null');
    if (saved && saved.code) { S.room = saved; connect(); }
  } catch { /* nothing saved */ }
  help.autoOpen();
})();
