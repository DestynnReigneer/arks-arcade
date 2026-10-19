(function() {
  const MAX_GUESSES = 6;
  const MAX_HINTS = 3;
  const THEME_KEY = 'wordless_theme_v2';
  const DIFFICULTY_KEY = 'wordless_difficulty';

  // Difficulty picks the answer by length: short words for little kids, long
  // ones for show-offs. Each has its own leaderboard, so a five-year-old's
  // Easy win never has to sit under somebody's Ludicrous score.
  // Must match DIFFICULTIES in server.js.
  const DIFFICULTIES = {
    easy:      { label: 'Easy',      emoji: '🐣', min: 3, max: 4,  blurb: 'Short words, 3–4 letters' },
    normal:    { label: 'Normal',    emoji: '🙂', min: 5, max: 6,  blurb: '5–6 letters' },
    hard:      { label: 'Hard',      emoji: '🔥', min: 7, max: 8,  blurb: '7–8 letters' },
    ludicrous: { label: 'Ludicrous', emoji: '🤯', min: 9, max: 10, blurb: '9–10 letters. Good luck.' }
  };

  // Must match SCORING constants in db.js
  const SCORING = {
    BASE: 1000,
    GUESS_PENALTY: 120,
    HINT_PENALTY: 150,
    SPEED_BONUS_MAX: 300,
    SPEED_BONUS_PER_SEC: 3
  };

  function computeScoreClient({ won, guesses, hintsUsed, elapsedMs }) {
    if (!won) return 0;
    const guessPenalty = Math.max(0, guesses - 1) * SCORING.GUESS_PENALTY;
    const hintPenalty = Math.max(0, hintsUsed) * SCORING.HINT_PENALTY;
    const elapsedSec = Math.max(0, elapsedMs) / 1000;
    const speedBonus = Math.max(0, Math.round(SCORING.SPEED_BONUS_MAX - elapsedSec * SCORING.SPEED_BONUS_PER_SEC));
    const raw = SCORING.BASE - guessPenalty - hintPenalty + speedBonus;
    return Math.max(0, Math.round(raw / 10) * 10);
  }

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* unavailable */ }
  }

  // ---- State ----
  let themes = [];
  let currentTheme = null;
  let difficulty = DIFFICULTIES[safeStorageGet(DIFFICULTY_KEY)] ? safeStorageGet(DIFFICULTY_KEY) : 'normal';
  let answer = "";
  let wordLen = 5;
  let guesses = [];
  let guessSlots = [];
  let revealedSlots = [];
  let revealedLetters = [];
  let hintsRemaining = MAX_HINTS;
  let hintsUsed = 0;
  let gameOver = false;
  let startTime = 0;
  let lastResult = null;

  // ---- DOM refs ----
  const board = document.getElementById('board');
  const keyboardEl = document.getElementById('keyboard');
  const messageEl = document.getElementById('message');
  const newGameBtn = document.getElementById('newGameBtn');
  const themeSelect = document.getElementById('themeSelect');
  const suggestThemeBtn = document.getElementById('suggestThemeBtn');
  const subtitleEl = document.getElementById('subtitle');
  const titleEmojiEl = document.getElementById('titleEmoji');
  const hintBtn = document.getElementById('hintBtn');
  const hintCountEl = document.getElementById('hintCount');
  const leaderboardBtn = document.getElementById('leaderboardBtn');

  const initialsOverlay = document.getElementById('initialsOverlay');
  const finalScoreValue = document.getElementById('finalScoreValue');
  const finalScoreDetail = document.getElementById('finalScoreDetail');
  const initialBoxes = Array.from(document.querySelectorAll('.initial-box'));
  const saveScoreBtn = document.getElementById('saveScoreBtn');
  const skipScoreBtn = document.getElementById('skipScoreBtn');

  const leaderboardOverlay = document.getElementById('leaderboardOverlay');
  const leaderboardThemeFilter = document.getElementById('leaderboardThemeFilter');
  const leaderboardDifficultyFilter = document.getElementById('leaderboardDifficultyFilter');
  const difficultyOverlay = document.getElementById('difficultyOverlay');
  const difficultyChoices = document.getElementById('difficultyChoices');
  const difficultyBtn = document.getElementById('difficultyBtn');
  const difficultyLabel = document.getElementById('difficultyLabel');
  const leaderboardList = document.getElementById('leaderboardList');
  const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');

  const themeRequestOverlay = document.getElementById('themeRequestOverlay');
  const themeRequestForm = document.getElementById('themeRequestForm');
  const requestTopicInput = document.getElementById('requestTopicInput');
  const requestNoteInput = document.getElementById('requestNoteInput');
  const requestByInput = document.getElementById('requestByInput');
  const themeRequestError = document.getElementById('themeRequestError');
  const themeRequestThanks = document.getElementById('themeRequestThanks');
  const closeThemeRequestBtn = document.getElementById('closeThemeRequestBtn');

  const KEY_ROWS = [
    // Delete top right, Enter bottom right: where thumbs expect them.
    [..."qwertyuiop".split(""), "back"],
    "asdfghjkl".split(""),
    [..."zxcvbnm".split(""), "enter"]
  ];

  // ---- API helpers ----
  async function apiGet(url, headers) {
    const res = await fetch(url, headers ? { headers } : undefined);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.json();
  }
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  // ---- Adult themes ----
  // Hidden until unlocked with the arcade's adult PIN (or a one-tap "I'm an
  // adult" when no PIN is set). Remembered for this browser tab only.
  const adult = {
    on: (() => { try { return sessionStorage.getItem('wordless.adult') === 'on'; } catch { return false; } })(),
    pin: (() => { try { return sessionStorage.getItem('wordless.adultPin') || ''; } catch { return ''; } })(),
    requiresPin: false
  };
  const adultQuery = sep => (adult.on ? `${sep}adult=1` : '');
  const adultHeaders = () => (adult.on && adult.pin ? { 'X-Adult-Pin': adult.pin } : undefined);

  function setAdult(on, pin = '') {
    adult.on = on;
    adult.pin = on ? pin : '';
    try {
      if (on) { sessionStorage.setItem('wordless.adult', 'on'); sessionStorage.setItem('wordless.adultPin', adult.pin); }
      else { sessionStorage.removeItem('wordless.adult'); sessionStorage.removeItem('wordless.adultPin'); }
    } catch { /* private mode */ }
    document.getElementById('adultBtn').classList.toggle('on', on);
  }

  // ---- Theme select / skin ----
  function populateThemeSelect() {
    themeSelect.innerHTML = "";
    const builtinGroup = document.createElement('optgroup');
    builtinGroup.label = "Built-in";
    const customGroup = document.createElement('optgroup');
    customGroup.label = "Custom";
    const adultGroup = document.createElement('optgroup');
    adultGroup.label = "🔞 Adult";
    themes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.emoji} ${t.label}`;
      (t.adult ? adultGroup : t.builtin ? builtinGroup : customGroup).appendChild(opt);
    });
    themeSelect.appendChild(builtinGroup);
    if (customGroup.children.length) themeSelect.appendChild(customGroup);
    if (adultGroup.children.length) themeSelect.appendChild(adultGroup);
  }

  function applyThemeSkin(theme) {
    const root = document.documentElement;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--font', theme.font);
    document.title = `Wordless — ${theme.label}`;
    titleEmojiEl.textContent = theme.emoji;
    subtitleEl.textContent = `Guess the ${theme.subject} in 6 tries`;
  }

  function setTheme(id) {
    const theme = themes.find(t => t.id === id) || themes.find(t => t.id === 'classic') || themes[0];
    currentTheme = theme;
    themeSelect.value = theme.id;
    safeStorageSet(THEME_KEY, theme.id);
    applyThemeSkin(theme);
  }

  async function refreshThemes() {
    try {
      themes = await apiGet('/api/themes' + adultQuery('?'), adultHeaders());
    } catch (e) {
      // A PIN changed since this tab unlocked: quietly go back to family mode.
      if (!adult.on) throw e;
      setAdult(false);
      themes = await apiGet('/api/themes');
    }
    populateThemeSelect();
  }

  async function openAdult() {
    if (adult.on) {
      setAdult(false);
      await refreshThemes();
      if (currentTheme && currentTheme.adult) { setTheme('classic'); newGame(); }
      else themeSelect.value = currentTheme.id;
      showMessage('Adult themes hidden.');
      return;
    }
    const pinInput = document.getElementById('adultPinInput');
    pinInput.value = '';
    pinInput.classList.toggle('hidden', !adult.requiresPin);
    document.getElementById('adultError').textContent = '';
    document.getElementById('adultHint').textContent = adult.requiresPin
      ? 'Naughty themes for grown-ups. Enter the adult PIN.'
      : 'Naughty themes for grown-ups. Are you 18 or older?';
    document.getElementById('adultOkBtn').textContent = adult.requiresPin ? 'Unlock' : "I'm an adult";
    document.getElementById('adultOverlay').classList.remove('hidden');
    if (adult.requiresPin) pinInput.focus();
  }

  async function confirmAdult() {
    const pin = document.getElementById('adultPinInput').value.trim();
    const err = document.getElementById('adultError');
    try {
      if (adult.requiresPin) {
        const r = await apiPost('/api/adult-check', { pin });
        if (!r.ok) { err.textContent = 'That PIN is not right.'; return; }
      }
      setAdult(true, pin);
      document.getElementById('adultOverlay').classList.add('hidden');
      await refreshThemes();
      themeSelect.value = currentTheme.id;
      const first = themes.find(t => t.adult);
      showMessage(first ? 'Adult themes unlocked — pick one from the Theme menu. 😈' : 'Unlocked, but no adult themes have been made yet.');
    } catch (e) {
      err.textContent = e.message;
    }
  }

  // ---- Board / keyboard ----
  // Words in the difficulty's length range. A theme with none that length
  // falls back to its closest lengths, so a small theme still plays.
  function pickAnswer() {
    const { min, max } = DIFFICULTIES[difficulty];
    const words = currentTheme.words;
    const distance = w => w.length < min ? min - w.length : w.length > max ? w.length - max : 0;
    const best = Math.min(...words.map(distance));
    const pool = words.filter(w => distance(w) === best);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function renderDifficultyChoices() {
    difficultyChoices.innerHTML = '';
    Object.entries(DIFFICULTIES).forEach(([id, d]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'difficulty-choice' + (id === difficulty ? ' current' : '');
      btn.innerHTML = `<span class="d-emoji"></span><span><div class="d-name"></div><div class="d-blurb"></div></span>`;
      btn.querySelector('.d-emoji').textContent = d.emoji;
      btn.querySelector('.d-name').textContent = d.label;
      btn.querySelector('.d-blurb').textContent = d.blurb;
      btn.addEventListener('click', () => chooseDifficulty(id));
      difficultyChoices.appendChild(btn);
    });
  }

  function openDifficulty() {
    renderDifficultyChoices();
    difficultyOverlay.classList.remove('hidden');
  }

  function chooseDifficulty(id) {
    difficulty = id;
    safeStorageSet(DIFFICULTY_KEY, id);
    difficultyLabel.textContent = DIFFICULTIES[id].label;
    difficultyOverlay.classList.add('hidden');
    newGame();
  }

  function computeTileSize(cols) {
    const available = Math.min(window.innerWidth - 24, 600);
    const gap = 6;
    const size = Math.floor((available - (cols - 1) * gap) / cols);
    return Math.max(30, Math.min(60, size));
  }

  function buildBoard() {
    board.innerHTML = "";
    const size = computeTileSize(wordLen);
    board.style.setProperty('--cols', wordLen);
    board.style.setProperty('--tile-size', size + 'px');
    for (let r = 0; r < MAX_GUESSES; r++) {
      const row = document.createElement('div');
      row.className = 'board-row';
      row.id = `row-${r}`;
      for (let c = 0; c < wordLen; c++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.id = `tile-${r}-${c}`;
        row.appendChild(tile);
      }
      board.appendChild(row);
    }
  }

  window.addEventListener('resize', () => {
    if (!wordLen) return;
    board.style.setProperty('--tile-size', computeTileSize(wordLen) + 'px');
  });

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    KEY_ROWS.forEach(rowKeys => {
      const row = document.createElement('div');
      row.className = 'key-row';
      rowKeys.forEach(k => {
        const btn = document.createElement('button');
        btn.className = 'key' + (k === 'enter' || k === 'back' ? ' wide' : '');
        btn.textContent = k === 'back' ? '⌫' : (k === 'enter' ? 'Enter' : k);
        btn.id = `key-${k}`;
        btn.addEventListener('click', () => handleKey(k === 'back' ? 'Backspace' : (k === 'enter' ? 'Enter' : k)));
        row.appendChild(btn);
      });
      keyboardEl.appendChild(row);
    });
  }

  function buildSlotsFromRevealed() {
    const slots = new Array(wordLen).fill('');
    for (let i = 0; i < wordLen; i++) {
      if (revealedSlots[i]) slots[i] = revealedLetters[i];
    }
    return slots;
  }

  function newGame() {
    answer = pickAnswer();
    wordLen = answer.length;
    guesses = [];
    revealedSlots = new Array(wordLen).fill(false);
    revealedLetters = new Array(wordLen).fill('');
    guessSlots = new Array(wordLen).fill('');
    hintsRemaining = MAX_HINTS;
    hintsUsed = 0;
    gameOver = false;
    lastResult = null;
    startTime = Date.now();
    messageEl.textContent = "";
    newGameBtn.style.display = "none";
    initialsOverlay.classList.add('hidden');
    buildBoard();
    buildKeyboard();
    updateRowDisplay(0);
    updateHintUI();
  }

  function showMessage(msg, persist) {
    messageEl.textContent = msg;
    if (!persist) {
      setTimeout(() => { if (!gameOver) messageEl.textContent = ""; }, 1400);
    }
  }

  function shakeRow(r) {
    const row = document.getElementById(`row-${r}`);
    row.classList.add('shake');
    setTimeout(() => row.classList.remove('shake'), 400);
  }

  function updateRowDisplay(r) {
    for (let c = 0; c < wordLen; c++) {
      const tile = document.getElementById(`tile-${r}-${c}`);
      if (!tile) continue;
      const ch = guessSlots[c] || "";
      tile.textContent = ch;
      tile.classList.toggle('filled', !!ch);
      tile.classList.toggle('hinted', revealedSlots[c]);
    }
  }

  function evaluateGuess(guess) {
    const result = new Array(wordLen).fill('absent');
    const answerArr = answer.split("");
    const guessArr = guess.split("");
    const used = new Array(wordLen).fill(false);

    for (let i = 0; i < wordLen; i++) {
      if (guessArr[i] === answerArr[i]) {
        result[i] = 'correct';
        used[i] = true;
        revealedSlots[i] = true;
        revealedLetters[i] = answerArr[i];
      }
    }
    for (let i = 0; i < wordLen; i++) {
      if (result[i] === 'correct') continue;
      const idx = answerArr.findIndex((a, j) => a === guessArr[i] && !used[j]);
      if (idx !== -1) {
        result[i] = 'present';
        used[idx] = true;
      }
    }
    return result;
  }

  function updateKeyColors(guess, result) {
    const rank = { absent: 0, present: 1, correct: 2 };
    for (let i = 0; i < wordLen; i++) {
      const keyEl = document.getElementById(`key-${guess[i]}`);
      if (!keyEl) continue;
      const current = keyEl.dataset.state || 'absent';
      if (!keyEl.dataset.state || rank[result[i]] > rank[current]) {
        keyEl.dataset.state = result[i];
        keyEl.classList.remove('correct', 'present', 'absent');
        keyEl.classList.add(result[i]);
      }
    }
  }

  function updateHintUI() {
    hintCountEl.textContent = hintsRemaining;
    const noCandidates = revealedSlots.every(Boolean);
    hintBtn.disabled = gameOver || hintsRemaining <= 0 || noCandidates;
  }

  function useHint() {
    if (gameOver || hintsRemaining <= 0) return;
    const candidates = [];
    for (let i = 0; i < wordLen; i++) if (!revealedSlots[i]) candidates.push(i);
    if (candidates.length === 0) return;
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    revealedSlots[idx] = true;
    revealedLetters[idx] = answer[idx];
    guessSlots[idx] = answer[idx];
    hintsRemaining--;
    hintsUsed++;
    updateRowDisplay(guesses.length);
    updateHintUI();
    showMessage(`Hint: letter ${idx + 1} is ${answer[idx].toUpperCase()}`);
  }

  function submitGuess() {
    const r = guesses.length;
    if (guessSlots.includes('')) {
      shakeRow(r);
      showMessage("Not enough letters");
      return;
    }
    const guess = guessSlots.join('');
    const result = evaluateGuess(guess);

    for (let c = 0; c < wordLen; c++) {
      const tile = document.getElementById(`tile-${r}-${c}`);
      setTimeout(() => tile.classList.add(result[c]), c * 250);
    }

    updateKeyColors(guess, result);
    guesses.push(guess);
    updateHintUI();

    const isWin = guess === answer;
    const isLastGuess = guesses.length === MAX_GUESSES;

    setTimeout(() => {
      if (isWin) {
        endGame(true);
      } else if (isLastGuess) {
        endGame(false);
      } else {
        guessSlots = buildSlotsFromRevealed();
        updateRowDisplay(guesses.length);
      }
    }, wordLen * 250 + 200);
  }

  function handleKey(key) {
    if (gameOver) return;
    const r = guesses.length;
    if (r >= MAX_GUESSES) return;

    if (key === 'Enter') {
      submitGuess();
    } else if (key === 'Backspace') {
      for (let i = wordLen - 1; i >= 0; i--) {
        if (!revealedSlots[i] && guessSlots[i] !== '') {
          guessSlots[i] = '';
          break;
        }
      }
      updateRowDisplay(r);
    } else if (/^[a-z]$/i.test(key)) {
      const idx = guessSlots.findIndex((v, i) => !revealedSlots[i] && v === '');
      if (idx === -1) return;
      guessSlots[idx] = key.toLowerCase();
      updateRowDisplay(r);
      const tile = document.getElementById(`tile-${r}-${idx}`);
      tile.classList.add('pop');
      setTimeout(() => tile.classList.remove('pop'), 100);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!initialsOverlay.classList.contains('hidden')) return;
    if (!leaderboardOverlay.classList.contains('hidden')) return;
    if (!themeRequestOverlay.classList.contains('hidden')) return;
    if (!difficultyOverlay.classList.contains('hidden')) return;
    if (!document.getElementById('adultOverlay').classList.contains('hidden')) return;
    handleKey(e.key);
  });

  newGameBtn.addEventListener('click', newGame);
  hintBtn.addEventListener('click', useHint);
  difficultyBtn.addEventListener('click', openDifficulty);
  document.getElementById('adultBtn').addEventListener('click', openAdult);
  document.getElementById('adultOkBtn').addEventListener('click', confirmAdult);
  document.getElementById('adultCancelBtn').addEventListener('click', () => document.getElementById('adultOverlay').classList.add('hidden'));
  document.getElementById('adultPinInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAdult(); });
  themeSelect.addEventListener('change', (e) => { setTheme(e.target.value); newGame(); });

  // ---- End of game / scoring / initials ----
  function endGame(won) {
    gameOver = true;
    const elapsedMs = Date.now() - startTime;
    const guessesUsed = guesses.length;
    const score = computeScoreClient({ won, guesses: guessesUsed, hintsUsed, elapsedMs });
    lastResult = { won, guesses: guessesUsed, hintsUsed, elapsedMs, score, word: answer, themeId: currentTheme.id, difficulty };

    if (won) {
      showMessage("🎉 You got it! " + answer.toUpperCase(), true);
    } else {
      showMessage("😔 Out of tries — it was " + answer.toUpperCase(), true);
    }
    newGameBtn.style.display = "inline-block";
    updateHintUI();
    setTimeout(openInitialsOverlay, 650);
  }

  function openInitialsOverlay() {
    finalScoreValue.textContent = lastResult.score;
    const secs = Math.round(lastResult.elapsedMs / 1000);
    finalScoreDetail.textContent = `${DIFFICULTIES[lastResult.difficulty].label} · ` + (lastResult.won
      ? `${lastResult.guesses} guess${lastResult.guesses === 1 ? '' : 'es'} · ${lastResult.hintsUsed} hint${lastResult.hintsUsed === 1 ? '' : 's'} · ${secs}s`
      : `Not solved — word was ${lastResult.word.toUpperCase()}`);
    initialBoxes.forEach(b => { b.value = ''; b.classList.remove('error'); });
    initialsOverlay.classList.remove('hidden');
    initialBoxes[0].focus();
  }

  initialBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase();
      initialBoxes.forEach(b => b.classList.remove('error'));
      if (box.value && i < initialBoxes.length - 1) initialBoxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        initialBoxes[i - 1].focus();
      }
      e.stopPropagation();
    });
  });

  skipScoreBtn.addEventListener('click', () => {
    initialsOverlay.classList.add('hidden');
  });

  saveScoreBtn.addEventListener('click', async () => {
    const initials = initialBoxes.map(b => b.value.trim()).join('');
    if (!initials) {
      initialBoxes.forEach(b => b.classList.add('error'));
      initialBoxes[0].focus();
      return;
    }
    try {
      const { id } = await apiPost('/api/leaderboard', {
        initials,
        themeId: lastResult.themeId,
        won: lastResult.won,
        guesses: lastResult.guesses,
        hintsUsed: lastResult.hintsUsed,
        word: lastResult.word,
        elapsedMs: lastResult.elapsedMs,
        difficulty: lastResult.difficulty
      });
      initialsOverlay.classList.add('hidden');
      await openLeaderboard(lastResult.themeId, id, lastResult.difficulty);
    } catch (e) {
      showMessage(e.message, true);
    }
  });

  // ---- Leaderboard ----
  function populateLeaderboardFilter(selectedId) {
    leaderboardThemeFilter.innerHTML = "";
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Themes';
    leaderboardThemeFilter.appendChild(allOpt);
    themes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.emoji} ${t.label}`;
      leaderboardThemeFilter.appendChild(opt);
    });
    leaderboardThemeFilter.value = selectedId || 'all';
  }

  function populateDifficultyFilter(selected) {
    leaderboardDifficultyFilter.innerHTML = "";
    Object.entries(DIFFICULTIES).forEach(([id, d]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${d.emoji} ${d.label}`;
      leaderboardDifficultyFilter.appendChild(opt);
    });
    leaderboardDifficultyFilter.value = selected;
  }

  function renderLeaderboard(rows, highlightId) {
    leaderboardList.innerHTML = "";
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = "No scores yet — be the first!";
      leaderboardList.appendChild(empty);
      return;
    }
    rows.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'lb-row' + (i === 0 ? ' top1' : i === 1 ? ' top2' : i === 2 ? ' top3' : '');
      const level = (DIFFICULTIES[row.difficulty] || DIFFICULTIES.normal).label;
      const metaText = row.won
        ? `${level} · ${row.themeEmoji} ${row.themeLabel} · ${row.guesses}g · ${row.hintsUsed}h`
        : `${level} · ${row.themeEmoji} ${row.themeLabel} · DNF`;
      div.innerHTML = `
        <div class="lb-rank">#${i + 1}</div>
        <div class="lb-initials">${escapeHtml(row.initials)}</div>
        <div class="lb-meta">${escapeHtml(metaText)}</div>
        <div class="lb-score">${row.score}</div>
      `;
      if (row.id === highlightId) {
        div.style.outline = '2px solid var(--accent)';
      }
      leaderboardList.appendChild(div);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function openLeaderboard(themeId, highlightId, level) {
    populateLeaderboardFilter(themeId);
    populateDifficultyFilter(level || leaderboardDifficultyFilter.value || difficulty);
    try {
      const rows = await apiGet(`/api/leaderboard?theme=${encodeURIComponent(leaderboardThemeFilter.value)}` +
        `&difficulty=${encodeURIComponent(leaderboardDifficultyFilter.value)}&limit=25` + adultQuery('&'), adultHeaders());
      renderLeaderboard(rows, highlightId);
    } catch (e) {
      leaderboardList.innerHTML = `<div class="lb-empty">${escapeHtml(e.message)}</div>`;
    }
    leaderboardOverlay.classList.remove('hidden');
  }

  leaderboardBtn.addEventListener('click', () => openLeaderboard(currentTheme ? currentTheme.id : 'all', null, difficulty));
  closeLeaderboardBtn.addEventListener('click', () => leaderboardOverlay.classList.add('hidden'));
  leaderboardThemeFilter.addEventListener('change', () => openLeaderboard(leaderboardThemeFilter.value));
  leaderboardDifficultyFilter.addEventListener('change', () => openLeaderboard(leaderboardThemeFilter.value));

  // ---- Suggest a theme (kid-facing request, no direct creation power) ----
  suggestThemeBtn.addEventListener('click', () => {
    themeRequestForm.reset();
    themeRequestForm.classList.remove('hidden');
    themeRequestThanks.classList.add('hidden');
    themeRequestError.textContent = '';
    themeRequestOverlay.classList.remove('hidden');
    requestTopicInput.focus();
  });
  closeThemeRequestBtn.addEventListener('click', () => themeRequestOverlay.classList.add('hidden'));

  themeRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    themeRequestError.textContent = '';
    const topic = requestTopicInput.value.trim();
    const note = requestNoteInput.value.trim();
    const requestedBy = requestByInput.value.trim();

    if (!topic) {
      themeRequestError.textContent = 'Please enter a theme idea.';
      return;
    }

    try {
      await apiPost('/api/theme-requests', { topic, note, requestedBy });
      themeRequestForm.classList.add('hidden');
      themeRequestThanks.classList.remove('hidden');
      setTimeout(() => themeRequestOverlay.classList.add('hidden'), 1800);
    } catch (e) {
      themeRequestError.textContent = e.message;
    }
  });

  // ---- Init ----
  (async function init() {
    try { adult.requiresPin = !!(await apiGet('/api/arcade-info')).adultRequiresPin; } catch { /* assume no PIN */ }
    setAdult(adult.on, adult.pin);
    await refreshThemes();
    const savedId = safeStorageGet(THEME_KEY);
    const initial = themes.find(t => t.id === savedId) || themes.find(t => t.id === 'classic') || themes[0];
    setTheme(initial.id);
    difficultyLabel.textContent = DIFFICULTIES[difficulty].label;
    // Ask before the first game; picking one starts it.
    openDifficulty();
  })();
})();
