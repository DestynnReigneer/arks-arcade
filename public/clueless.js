'use strict';

// Clueless: the page. The server (clueless/routes.js) makes the day's
// crosswords, keeps the letters, runs the clock and decides the time; this
// page draws the grid and the clues, takes taps and keys, and remembers your
// progress on this device. It never has the answers until you've finished
// (or until it asks the server to reveal a square, which costs time).
//
// On a TV (tv.js), the remote's arrows move the highlight from square to
// square, OK picks the square it's on (OK again switches between across and
// down), and the keyboard on the screen types into the picked square.
// Arrowing back up from the keyboard lands on the picked square.

(() => {
  const { $, toast, api } = ArcadeKit;
  const TV = !!(window.ArcadeTV && ArcadeTV.on);
  const LEVELS = [['mini', 'Family mini · 5×5'], ['big', 'Grown-ups · 7×7']];
  const LABEL = { mini: 'Family mini', big: 'Grown-ups' };
  const store = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const token = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);

  let level = LABEL[recall('clueless.level')] ? recall('clueless.level') : 'mini';
  let today = null;               // the server's date, from /levels
  let penalties = null;           // what help costs, from /levels
  let run = null;                 // what the server said about this puzzle (see view() in routes.js)
  let syncedAt = 0;               // when `run` arrived, for the ticking clock
  let P = null;                   // the puzzle: size, blocks, numbers, across, down
  let letters = [];               // what's typed in each square ('' for empty)
  let pencil = [];                // true where a letter was typed in pencil
  let marks = {};                 // index -> 'wrong' | 'right' | 'revealed'
  let words = [];                 // every clue: { dir, num, cells, clue, el }
  let wordAt = { across: [], down: [] };   // square -> index into words
  let sel = -1;
  let dir = 'across';
  let pencilMode = false;
  let busy = false;
  let pausedForHelp = false;
  let lastTried = '';             // the full grid last sent to Finish, so a wrong one isn't sent twice

  // ---- drawing -------------------------------------------------------------------------
  const cells = [];
  function build() {
    const grid = $('grid');
    grid.replaceChildren();
    cells.length = 0;
    const n = P ? P.size : 5;
    grid.style.setProperty('--n', n);
    $('wrap').style.setProperty('--n', n);
    for (let i = 0; i < n * n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'gridcell');
      const block = !P || P.blocks[i] === '#';
      b.className = 'cl-cell' + (block && P ? ' block' : '');
      if (P && !block) {
        if (P.numbers[i]) { const s = document.createElement('span'); s.className = 'num'; s.textContent = P.numbers[i]; b.appendChild(s); }
        const t = document.createElement('span'); t.className = 'ltr'; b.appendChild(t);
        b.addEventListener('click', () => tapSquare(i));
        // Coming back to the grid from the keyboard or the tools: back to your square.
        if (TV) b.addEventListener('focus', e => {
          if (!playing() || i === sel || sel < 0) return;
          if (!(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#grid'))) cells[sel].focus();
        });
      } else {
        b.disabled = true;
        b.tabIndex = -1;
      }
      grid.appendChild(b);
      cells.push(b);
    }
    // The clue lists.
    words = [];
    wordAt = { across: [], down: [] };
    for (const d of ['across', 'down']) {
      const list = $(`${d}List`);
      list.replaceChildren();
      for (const w of (P ? P[d] : [])) {
        const li = document.createElement('li');
        li.innerHTML = '<b></b><span></span>';
        li.firstChild.textContent = w.num;
        li.lastChild.textContent = w.clue;
        const k = words.push({ dir: d, num: w.num, cells: w.cells, clue: w.clue, el: li }) - 1;
        for (const c of w.cells) wordAt[d][c] = k;
        li.addEventListener('click', () => { if (playing()) { dir = d; sel = firstEmpty(words[k]); paint(); } });
        list.appendChild(li);
      }
    }
  }

  const white = i => !!P && i >= 0 && i < P.size * P.size && P.blocks[i] !== '#';
  const current = () => (sel >= 0 ? words[wordAt[dir][sel]] : null);
  const firstEmpty = w => w.cells.find(c => !letters[c]) ?? w.cells[0];

  function paint() {
    const w = current();
    const inWord = new Set(w ? w.cells : []);
    for (let i = 0; i < cells.length; i++) {
      if (!white(i)) continue;
      const c = cells[i];
      c.className = 'cl-cell' + (inWord.has(i) ? ' word' : '') + (i === sel ? ' sel' : '') +
        (pencil[i] && letters[i] ? ' pencil' : '') + (marks[i] ? ` ${marks[i]}` : '');
      c.querySelector('.ltr').textContent = letters[i] || '';
      const where = `${P.numbers[i] ? `${P.numbers[i]}, ` : ''}row ${Math.floor(i / P.size) + 1}, column ${i % P.size + 1}`;
      c.setAttribute('aria-label', `${where}: ${letters[i] || 'empty'}${marks[i] === 'wrong' ? ', wrong' : marks[i] === 'revealed' ? ', revealed' : ''}`);
    }
    // The clue bar and the lists.
    const other = sel >= 0 ? words[wordAt[dir === 'across' ? 'down' : 'across'][sel]] : null;
    for (const x of words) {
      x.el.classList.toggle('on', x === w);
      x.el.classList.toggle('cross', x === other);
      x.el.classList.toggle('done', x.cells.every(c => letters[c]));
    }
    if (w) {
      $('clueTag').textContent = `${w.num}${w.dir === 'across' ? 'A' : 'D'}`;
      $('clueText').textContent = w.clue;
      if (playing()) {
        const box = w.el.parentElement;
        // Keep the clue in view in its list without scrolling the page.
        if (box.scrollHeight > box.clientHeight) box.scrollTop = w.el.offsetTop - box.offsetTop - 20;
      }
    } else if (P) {
      $('clueTag').textContent = '';
      $('clueText').textContent = 'Tap a square to see its clue.';
    }
    $('dirBtn').querySelector('small').textContent = dir === 'across' ? 'Across' : 'Down';
  }

  // ---- moving around -------------------------------------------------------------------
  function select(i, d = dir) {
    if (!white(i)) return;
    if (wordAt[d][i] === undefined) d = d === 'across' ? 'down' : 'across';
    sel = i; dir = d;
    paint();
  }
  function tapSquare(i) {
    if (!playing()) return;
    closeMenus();
    // Tapping the square you're on switches between across and down.
    if (i === sel) {
      const flip = dir === 'across' ? 'down' : 'across';
      if (wordAt[flip][i] !== undefined) dir = flip;
      paint();
      return;
    }
    select(i);
  }
  function toggleDir() {
    if (!playing() || sel < 0) return;
    const flip = dir === 'across' ? 'down' : 'across';
    if (wordAt[flip][sel] !== undefined) { dir = flip; paint(); }
  }
  // The next (or previous) clue, in the order of the lists: all across, then all down.
  function stepClue(by) {
    if (!playing() || !words.length) return;
    const w = current();
    let k = w ? words.indexOf(w) : -1;
    for (let tries = 0; tries < words.length; tries++) {
      k = (k + by + words.length) % words.length;
      const next = words[k];
      // Skip finished words when there's anything left to fill.
      if (next.cells.some(c => !letters[c]) || letters.every((l, i) => !white(i) || l)) {
        dir = next.dir; sel = firstEmpty(next); paint(); return;
      }
    }
  }
  function move(dr, dc) {
    if (!playing()) return;
    const want = dc ? 'across' : 'down';
    if (sel < 0) { select(words.length ? words[0].cells[0] : -1, want); return; }
    if (dir !== want && wordAt[want][sel] !== undefined) { dir = want; paint(); return; }
    let r = Math.floor(sel / P.size), c = sel % P.size;
    for (;;) {
      r += dr; c += dc;
      if (r < 0 || c < 0 || r >= P.size || c >= P.size) return;
      if (white(r * P.size + c)) { select(r * P.size + c, want); return; }
    }
  }

  // ---- typing ----------------------------------------------------------------------------
  function type(ch) {
    if (!playing() || sel < 0) return;
    Blip.unlock();
    if (marks[sel] !== 'revealed') {
      letters[sel] = ch;
      pencil[sel] = pencilMode;
      delete marks[sel];
      Blip.tone(pencilMode ? 440 : 600, 0.03, { type: 'triangle', volume: 0.04 });
    }
    // On to the next empty square in this word, or the next word that needs filling.
    const w = current();
    const at = w.cells.indexOf(sel);
    const after = w.cells.slice(at + 1).find(c => !letters[c]);
    const before = w.cells.slice(0, at).find(c => !letters[c]);
    if (after !== undefined) sel = after;
    else if (at + 1 < w.cells.length && before === undefined) sel = w.cells[at + 1];
    else if (before !== undefined) sel = before;
    else stepClue(1);
    changed();
  }
  function erase() {
    if (!playing() || sel < 0) return;
    const w = current();
    let i = sel;
    if (!letters[i] || marks[i] === 'revealed') {
      const at = w.cells.indexOf(i);
      if (at > 0) i = w.cells[at - 1];
      sel = i;
    }
    if (marks[i] !== 'revealed') { letters[i] = ''; pencil[i] = false; delete marks[i]; }
    changed();
  }

  function changed() {
    save();
    paint();
    const full = letters.every((l, i) => !white(i) || l);
    const g = gridText();
    if (full && g !== lastTried) finish();
  }
  const gridText = () => letters.map((l, i) => (white(i) ? l || '.' : '#')).join('');

  // ---- this device's copy of your progress --------------------------------------------------
  const progressKey = id => `clueless.progress.${id}`;
  const currentKey = (day, lv) => `clueless.current.${day}.${lv}`;
  function save() {
    if (!run) return;
    store(progressKey(run.runId), JSON.stringify({ letters, pencil, marks }));
  }
  function load(state) {
    P = state.puzzle;
    const n = P.size * P.size;
    letters = new Array(n).fill('');
    pencil = new Array(n).fill(false);
    marks = {};
    try {
      const saved = JSON.parse(recall(progressKey(state.runId), 'null'));
      if (saved && Array.isArray(saved.letters) && saved.letters.length === n) {
        letters = saved.letters.map((l, i) => (white(i) && /^[A-Z]$/.test(l) ? l : ''));
        if (Array.isArray(saved.pencil)) pencil = saved.pencil.map(Boolean);
        if (saved.marks && typeof saved.marks === 'object') marks = saved.marks;
      }
    } catch { /* start clean */ }
    applyRevealed(state.revealed);
    // Clear out older days' saved progress so it doesn't pile up.
    try {
      for (let k = localStorage.length - 1; k >= 0; k--) {
        const key = localStorage.key(k) || '';
        const m = /^clueless\.current\.(\d{4}-\d{2}-\d{2})\./.exec(key);
        if (m && m[1] < state.day) { store(progressKey(recall(key)), null); store(key, null); }
      }
    } catch { /* unavailable */ }
    store(currentKey(state.day, state.level), state.runId);
    lastTried = '';
    build();
    sel = -1;
    dir = 'across';
    if (words.length) select(firstEmpty(words[0]), 'across');
  }
  function applyRevealed(map) {
    for (const [i, l] of Object.entries(map || {})) { letters[i] = l; pencil[i] = false; marks[i] = 'revealed'; }
  }

  // ---- talking to the server ----------------------------------------------------------------
  const runApi = (path, body = {}) => api(`/api/clueless/run/${run.runId}${path}`, body);
  function took(state) {
    run = state;
    syncedAt = Date.now();
    tick();
    return state;
  }
  const playing = () => !!run && !run.paused && !run.finished && !busy;

  async function openLevel(lv) {
    level = lv;
    store('clueless.level', lv);
    paintLevels();
    $('over').classList.add('hidden');
    document.body.dataset.state = 'ready';
    run = null; P = null; letters = []; marks = {}; sel = -1;
    build();
    $('clueTag').textContent = '';
    $('clueText').textContent = 'Tap Start to see the first clue.';
    tick();
    // Picking up where you left off on this device, if this one was started today.
    const had = today && recall(currentKey(today, lv));
    if (had) {
      try {
        const state = await api(`/api/clueless/run/${had}`);
        if (lv !== level) return;
        load(state);
        took(state);
        showState();
        return;
      } catch { store(currentKey(today, lv), null); }
    }
    const blurb = lv === 'mini'
      ? 'A quick 5 by 5 crossword with family-friendly clues. Everyone gets the same one today, so you can race each other.'
      : 'A bigger 7 by 7 crossword with trickier clues. Everyone gets the same one today, so you can race each other.';
    cover(`Today's ${LABEL[lv]}`, `${blurb} The clock starts when you tap Start, and you can pause it whenever you need to.`, 'Start', begin);
  }

  async function begin() {
    if (busy) return;
    busy = true;
    try {
      const state = await api('/api/clueless/start', { level, profileToken: token() });
      if (state.level !== level) return;
      today = state.day;
      load(state);
      took(state);
      busy = false;
      if (state.paused) await setPaused(false);
      showState();
      if (window.ArcadeStats) ArcadeStats.play();
      Blip.unlock();
    } catch (e) {
      toast(e.message, 4000);
    } finally { busy = false; }
  }

  function showState() {
    paint();
    if (run.finished) { $('cover').classList.add('hidden'); showOver(); return; }
    if (run.paused) {
      cover('Paused', 'The clock has stopped, and the grid is hidden until you come back.', 'Keep going', () => setPaused(false));
    } else {
      $('cover').classList.add('hidden');
      document.body.dataset.state = 'playing';
      // On a TV the highlight starts on your square, and a puzzle counts as a game being played.
      if (TV) {
        ArcadeTV.played();
        if (sel < 0 && words.length) select(firstEmpty(words[0]));
        if (sel >= 0) requestAnimationFrame(() => cells[sel].focus());
      }
    }
    paintPause();
  }

  function cover(title, text, button, onTap) {
    $('coverTitle').textContent = title;
    $('coverText').textContent = text;
    $('coverBtn').textContent = button;
    $('coverBtn').onclick = onTap;
    $('cover').classList.remove('hidden');
  }

  async function setPaused(on, { quiet = false } = {}) {
    if (!run || run.finished || !!run.paused === on) return;
    try {
      took(await runApi(on ? '/pause' : '/resume'));
      if (!quiet) showState();
    } catch (e) { if (!quiet) toast(e.message); }
  }
  function paintPause() {
    $('pauseBtn').textContent = run && run.paused ? '▶' : '⏸';
    $('pauseBtn').title = run && run.paused ? 'Keep going' : 'Pause';
  }

  const secs = ms => `${Math.round(ms / 1000)} seconds`;
  async function checkIt(scope) {
    closeMenus();
    if (!playing()) return;
    if (scope !== 'puzzle' && sel < 0) { toast('Tap a square first.'); return; }
    busy = true;
    try {
      const r = await runApi('/check', { scope, index: sel, dir, grid: gridText() });
      took(r);
      const wrong = new Set(r.wrong);
      for (const i of r.checked) {
        if (marks[i] === 'revealed') continue;
        if (wrong.has(i)) marks[i] = 'wrong';
        else if (letters[i]) marks[i] = 'right';
      }
      const what = scope === 'puzzle' ? 'the puzzle' : scope === 'word' ? 'this word' : 'this square';
      toast(r.wrong.length
        ? `${r.wrong.length} letter${r.wrong.length === 1 ? ' is' : 's are'} wrong in ${what}, marked in red with a slash. That added ${secs(r.cost)}.`
        : `Everything filled in so far in ${what} is right. That added ${secs(r.cost)}.`, 3500);
      if (r.wrong.length) Blip.tone(180, 0.12, { type: 'square', volume: 0.04 });
    } catch (e) { toast(e.message); }
    busy = false;
    save();
    paint();
  }

  async function revealIt(scope) {
    closeMenus();
    if (!playing()) return;
    if (sel < 0) { toast('Tap a square first.'); return; }
    busy = true;
    try {
      const r = await runApi('/reveal', { scope, index: sel, dir });
      took(r);
      applyRevealed(r.letters);
      toast(r.cost ? `Revealed. That added ${secs(r.cost)}.` : 'That was already revealed, so nothing was added.', 3000);
    } catch (e) { toast(e.message); }
    busy = false;
    changed();
  }

  async function finish() {
    if (!run || run.finished || busy) return;
    busy = true;
    const g = gridText();
    lastTried = g;
    try {
      const r = await runApi('/finish', { grid: g });
      took(r);
      busy = false;
      if (r.answers) letters = letters.map((l, i) => (white(i) ? r.answers[i] : ''));
      pencil = pencil.map(() => false);
      Blip.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]], { type: 'triangle', volume: 0.06 });
      if (window.Fx) { Fx.burst({ count: 160, coins: 20 }); Fx.banner('Solved!', clock(r.timeMs)); }
      showState();
    } catch (e) {
      busy = false;
      toast(e.message, 4500);
    }
  }

  // ---- the clock ---------------------------------------------------------------------------------
  const clock = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };
  function tick() {
    let play = 0, pen = 0;
    if (run) {
      play = run.finished ? run.timeMs - run.penaltyMs : run.playMs + (run.paused ? 0 : Date.now() - syncedAt);
      pen = run.penaltyMs;
    }
    $('clock').textContent = clock(play + pen);
    $('penalty').textContent = pen ? `+${clock(pen)}` : '0:00';
    $('dayLabel').textContent = run ? new Date(`${run.day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today';
    Blip.musicPlaying(!!run && !run.paused && !run.finished);
  }
  setInterval(tick, 500);

  // ---- solved ----------------------------------------------------------------------------------
  const iniBoxes = [...document.querySelectorAll('#iniRow .ini')];
  const initials = ArcadeKit.wireInitials(iniBoxes, () => saveTime());
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }
  function helpLine(r) {
    const bits = [];
    if (r.checks) bits.push(`${r.checks} check${r.checks === 1 ? '' : 's'}`);
    if (r.reveals) bits.push(`${r.reveals} letter${r.reveals === 1 ? '' : 's'} revealed`);
    return bits.join(', ');
  }
  function showOver() {
    document.body.dataset.state = 'over';
    sel = -1;
    marks = Object.fromEntries(Object.entries(marks).filter(([, m]) => m === 'revealed'));
    paint();
    $('overTitle').textContent = `${LABEL[run.level]} solved! 🎉`;
    $('overTime').textContent = clock(run.timeMs);
    const help = helpLine(run);
    $('overDetail').textContent = help
      ? `${clock(run.timeMs - run.penaltyMs)} solving, plus ${clock(run.penaltyMs)} for help (${help}).`
      : 'No help used. That\'s a clean solve!';
    const p = profile();
    // A TV has no keyboard for initials: the time goes on the board from your own phone.
    const noBoard = TV && !p;
    $('savePart').classList.toggle('hidden', run.saved);
    $('iniRow').classList.toggle('hidden', !!p || noBoard);
    $('saveBtn').classList.toggle('hidden', noBoard);
    $('saveHint').textContent = noBoard ? 'Times solved on the TV don\'t go on the board, because there\'s no keyboard for initials. Solve it on your own phone to get on it.'
      : p ? `Saving as ${p.name}.` : 'Type your initials to put your time on today\'s board and see where you stack up.';
    $('saveMsg').textContent = '';
    $('saveBtn').disabled = false;
    $('rankLine').textContent = run.saved ? 'Your time is on the board.' : '';
    if (!p && !run.saved) initials.reset();
    $('over').classList.remove('hidden');
    setTimeout(() => $('over').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }
  async function saveTime() {
    if (!run || !run.finished || run.saved) return;
    const p = profile();
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      const r = await api(`/api/clueless/run/${run.runId}/save`, { initials: ini, profileToken: token() });
      if (!p) initials.remember(ini);
      run.saved = true;
      $('savePart').classList.add('hidden');
      $('rankLine').textContent = r.allRank === 1 ? `That's the fastest ${LABEL[run.level]} time ever! 🏆`
        : `You're #${r.dayRank} on today's ${LABEL[run.level]} board, and #${r.allRank} of all time.`;
      toast(r.dayRank === 1 ? '🏆 Fastest today!' : `Saved: #${r.dayRank} today`);
      openScores(run.level, 'day', r.id);
    } catch (e) {
      $('saveMsg').textContent = e.message;
      $('saveBtn').disabled = false;
    }
  }
  $('saveBtn').addEventListener('click', saveTime);
  $('otherLevelBtn').addEventListener('click', () => {
    openLevel(level === 'mini' ? 'big' : 'mini');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---- fastest times -------------------------------------------------------------------------
  let boardLevel = level, boardScope = 'day';
  function tabs(box, items, now, onPick) {
    box.innerHTML = '';
    for (const [id, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(id === now));
      b.onclick = () => onPick(id);
      box.appendChild(b);
    }
  }
  async function openScores(lv = level, scope = boardScope, highlightId) {
    boardLevel = lv; boardScope = scope;
    tabs($('scoreLevels'), Object.entries(LABEL), lv, id => openScores(id, boardScope));
    tabs($('scoreScope'), [['day', 'Today'], ['all', 'All time']], scope, id => openScores(boardLevel, id));
    $('scoreNote').textContent = scope === 'day'
      ? 'Today\'s crossword is the same for everyone. Only your first finish of the day counts, and a new one arrives at midnight.'
      : 'The fastest times on this crossword from every day so far.';
    $('scores').classList.remove('hidden');
    const list = $('scoreList');
    list.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const rows = await api(`/api/clueless/board?level=${lv}&scope=${scope}&limit=20`);
      ArcadeKit.renderScores(list, rows.map(r => ({ ...r, score: 0, detail: scope === 'all' ? niceDay(r.day) : helpLine(r) || 'no help' })), highlightId);
      list.querySelectorAll('li .pts').forEach((el, k) => { el.textContent = clock(rows[k].timeMs); });
      if (!rows.length) list.firstChild.textContent = scope === 'day' ? 'Nobody has finished this one today. Be the first!' : 'No times yet. Be the first!';
    } catch (e) {
      list.innerHTML = '<li class="empty"></li>';
      list.firstChild.textContent = e.message;
    }
  }
  const niceDay = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  $('scoresBtn').addEventListener('click', () => openScores(level, 'day'));
  $('overScoresBtn').addEventListener('click', () => openScores(level, 'day'));
  $('scoresClose').addEventListener('click', () => $('scores').classList.add('hidden'));
  $('scores').addEventListener('click', e => { if (e.target === $('scores')) $('scores').classList.add('hidden'); });

  // ---- levels, tools and the keyboard ------------------------------------------------------------
  function paintLevels() {
    tabs($('levelSeg'), LEVELS, level, id => { if (id !== level) openLevel(id); });
  }
  function setPencil(on) {
    pencilMode = on;
    $('pencilBtn').setAttribute('aria-pressed', String(on));
    $('pencilBtn').querySelector('small').textContent = on ? 'Pencil on' : 'Pencil off';
  }
  function closeMenus() {
    for (const [btn, menu] of [['checkBtn', 'checkMenu'], ['revealBtn', 'revealMenu']]) {
      $(menu).classList.add('hidden');
      $(btn).setAttribute('aria-expanded', 'false');
    }
  }
  function toggleMenu(btn, menu) {
    const open = $(menu).classList.contains('hidden');
    closeMenus();
    if (!open || !playing()) return;
    $(menu).classList.remove('hidden');
    $(btn).setAttribute('aria-expanded', 'true');
  }
  $('checkBtn').addEventListener('click', e => { e.stopPropagation(); toggleMenu('checkBtn', 'checkMenu'); });
  $('revealBtn').addEventListener('click', e => { e.stopPropagation(); toggleMenu('revealBtn', 'revealMenu'); });
  document.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => checkIt(b.dataset.check)));
  document.querySelectorAll('[data-reveal]').forEach(b => b.addEventListener('click', () => revealIt(b.dataset.reveal)));
  document.addEventListener('click', e => { if (!e.target.closest('.cl-menu-wrap')) closeMenus(); });
  $('pencilBtn').addEventListener('click', () => setPencil(!pencilMode));
  $('dirBtn').addEventListener('click', toggleDir);
  $('currentClue').addEventListener('click', toggleDir);
  $('prevClue').addEventListener('click', () => stepClue(-1));
  $('nextClue').addEventListener('click', () => stepClue(1));
  $('pauseBtn').addEventListener('click', () => { if (run && !run.finished) setPaused(!run.paused); });

  // The keyboard on the page, for phones.
  for (const row of ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM⌫']) {
    const r = document.createElement('div');
    r.className = 'row';
    for (const k of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cl-key' + (k === '⌫' ? ' wide' : '');
      b.textContent = k;
      b.setAttribute('aria-label', k === '⌫' ? 'Erase' : k);
      b.dataset.key = k;
      b.addEventListener('click', () => (k === '⌫' ? erase() : type(k)));
      r.appendChild(b);
    }
    $('keys').appendChild(r);
  }

  // A laptop's keyboard.
  window.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || help.isOpen) return;
    if (!$('scores').classList.contains('hidden')) { if (e.key === 'Escape') $('scores').classList.add('hidden'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') { closeMenus(); return; }
    if (!playing()) return;
    // On a TV the arrows move the highlight (which picks the square), and OK
    // presses what it's on: a square, a key on the screen, a tool.
    if (TV && ['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && e.target.closest && e.target.closest('button, a')) return;
    if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); type(k.toUpperCase()); return; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); erase(); return; }
    if (k === ' ') { e.preventDefault(); toggleDir(); return; }
    if (k === 'Tab' || k === 'Enter') { e.preventDefault(); stepClue(e.shiftKey ? -1 : 1); return; }
    const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (arrow) { e.preventDefault(); move(...arrow); }
  });

  // Leaving the page (another app, another tab, closing it) pauses the clock.
  function away() {
    if (!run || run.paused || run.finished) return;
    run.paused = true;
    try { fetch(`/api/clueless/run/${run.runId}/pause`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* best effort */ }
    showState();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });
  window.addEventListener('pagehide', away);
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('clueless');

  // ---- how to play ------------------------------------------------------------------------------------
  const help = Tutorial.create('clueless', [
    {
      emoji: '📰', title: 'A crossword a day',
      html: `<p>Every day there are two small crosswords, and they're the <b>same for everyone</b>, so the family can race each other.</p>
        <table>
          <tr><td>👪 Family mini</td><td>A 5 by 5 grid with clues written for kids. Usually a few minutes.</td></tr>
          <tr><td>🧠 Grown-ups</td><td>A 7 by 7 grid with longer words and some trickier clues.</td></tr>
        </table>
        <p>New ones arrive at midnight.</p>`
    },
    {
      emoji: '👆', title: 'Filling it in',
      html: `<p>Tap a square and type. The word you're on is highlighted, and its clue shows in the bar above the grid. <b>Tap the same square again</b> (or the clue bar) to switch between across and down.</p>
        <p>On a phone, use the keyboard under the grid; the ⌫ key erases. The ‹ and › arrows beside the clue jump to the previous or next clue, and you can tap any clue in the lists at the bottom too.</p>
        <table>
          <tr><td>⌨️ Keyboard</td><td>Type letters, <b>arrows</b> to move, <b>Space</b> to switch direction, <b>Tab</b> for the next clue, <b>Backspace</b> to erase.</td></tr>
        </table>`
    },
    {
      emoji: '✏️', title: 'Pencil',
      html: `<p>Not sure about a word? Turn on <b>Pencil</b> and the letters you type go in gray, as a reminder to come back to them. Typing over them with Pencil off makes them normal again.</p>`
    },
    {
      emoji: '⏱️', title: 'The clock and the boards',
      html: `<p>The clock starts when you tap <b>Start</b>, and the arcade keeps the time, not your phone. <b>Pause</b> (or leaving the page) stops it and hides the grid until you come back.</p>
        <p>As soon as every square is filled, the arcade checks it. If it's all right, you're done and your time can go on the 🏆 board for today and for all time. Only your <b>first finish of the day</b> counts, because a second go at the same puzzle would be easy.</p>`
    },
    {
      emoji: '💡', title: 'Getting help costs time',
      html: `<table>
          <tr><td>✔️ Check</td><td>Marks wrong letters in red with a slash: one square adds <b>5 seconds</b>, a word <b>10</b>, the whole puzzle <b>20</b>.</td></tr>
          <tr><td>👁️ Reveal</td><td>Fills in the right letter for a square or a whole word, with a gold corner. Each letter revealed adds <b>15 seconds</b>.</td></tr>
        </table>
        <div class="tut-tip">Help is never off-limits. It just adds time, so the fastest times are the ones solved on your own.</div>`
    }
  ], { onClose: () => { if (pausedForHelp) { pausedForHelp = false; setPaused(false); } } });
  $('helpBtn').addEventListener('click', () => {
    if (run && !run.paused && !run.finished) { pausedForHelp = true; setPaused(true); }
    help.open();
  });

  // Back: the puzzle being worked on is paused (the clock stops and your
  // progress is kept, so nothing needs asking), and from the paused puzzle,
  // or one that's done, Back goes to the arcade.
  ArcadeBack.setup({ atMenu: () => !run || !!run.paused || !!run.finished, back: () => setPaused(true) });

  // ---- start -----------------------------------------------------------------------------------------
  setPencil(false);
  paintLevels();
  build();
  api('/api/clueless/levels').then(info => {
    today = info.day;
    penalties = info.penalties;
    const s = ms => `+${Math.round(ms / 1000)}s`;
    $('costCheckSquare').textContent = s(penalties.checkSquare);
    $('costCheckWord').textContent = s(penalties.checkWord);
    $('costCheckPuzzle').textContent = s(penalties.checkPuzzle);
    document.querySelectorAll('.cost-reveal').forEach((el, k) => { el.textContent = k ? `${s(penalties.reveal)} a letter` : s(penalties.reveal); });
  }).catch(() => {}).finally(() => openLevel(level));
  // On a TV, How to play waits for the ? button instead of opening by itself.
  if (!TV) help.autoOpen();
})();
