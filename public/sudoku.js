'use strict';

// Sudoku: the page. The server (sudoku/routes.js) makes the day's puzzles,
// keeps the answers, runs the clock and decides the time; this page draws the
// board, takes taps and keys, and remembers your progress on this device.
// Playing as a profile, the progress is also saved on the arcade (a moment
// after you stop tapping, and when you leave the page), so it follows you to
// another device. It's never used for the time: the finish sends the board.

(() => {
  const { $, toast, api } = ArcadeKit;
  const LEVELS = [['family', 'Family'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
  const LABEL = Object.fromEntries(LEVELS);
  const store = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  // On a TV the arcade is signed in as the TV, not as whoever has the
  // remote, so a run there is a guest's and goes on the board under the
  // initials picked on the screen.
  const token = () => (typeof ArcadeProfile !== 'undefined' && !TvPlay.on ? ArcadeProfile.token() : null);

  let level = LABEL[recall('sudoku.level')] ? recall('sudoku.level') : 'easy';
  let today = null;               // the server's date, from /levels
  let run = null;                 // what the server said about this puzzle (see view() in routes.js)
  let syncedAt = 0;               // when `run` arrived, for the ticking clock
  let givens = [];                // 81 numbers, 0 for a square to fill
  let grid = [];                  // 81 numbers on the board now
  let notes = [];                 // 81 bit masks of pencil marks (bit 1..9)
  let marks = {};                 // index -> 'wrong' | 'hinted'
  let sel = -1;
  let notesMode = false;
  let undo = [];
  let busy = false;
  let pausedForHelp = false;
  const checked = new Map();      // "index:value" -> right?, so a number is only checked once

  // ---- the board ------------------------------------------------------------------------
  const cells = [];
  for (let i = 0; i < 81; i++) {
    const b = document.createElement('button');
    b.className = 'sd-cell';
    b.type = 'button';
    b.setAttribute('role', 'gridcell');
    b.addEventListener('click', () => select(i));
    $('board').appendChild(b);
    cells.push(b);
  }
  const pads = [];
  for (let d = 1; d <= 9; d++) {
    const b = document.createElement('button');
    b.className = 'sd-num';
    b.type = 'button';
    b.innerHTML = `${d}<small></small>`;
    b.setAttribute('aria-label', `Number ${d}`);
    b.addEventListener('click', () => press(d));
    $('pad').appendChild(b);
    pads.push(b);
  }
  const row = i => Math.floor(i / 9), col = i => i % 9, box = i => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);
  const isPeer = (a, b) => a !== b && (row(a) === row(b) || col(a) === col(b) || box(a) === box(b));
  const PEERS = [...Array(81)].map((_, i) => [...Array(81).keys()].filter(j => isPeer(i, j)));

  function paint() {
    const v = sel >= 0 ? grid[sel] : 0;
    const same = $('sameHighlight').checked;
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
      const c = cells[i], val = grid[i];
      counts[val]++;
      c.className = 'sd-cell' + (givens[i] ? ' given' : '') + (marks[i] ? ` ${marks[i]}` : '') +
        (i === sel ? ' sel' : sel >= 0 && isPeer(i, sel) ? ' peer' : '') +
        (same && v && val === v && i !== sel ? ' same' : '');
      if (val) {
        c.textContent = val;
      } else if (notes[i]) {
        const box = document.createElement('div');
        box.className = 'sd-notes';
        for (let d = 1; d <= 9; d++) {
          const s = document.createElement('span');
          if (notes[i] & (1 << d)) { s.textContent = d; if (same && d === v) s.className = 'hit'; }
          box.appendChild(s);
        }
        c.replaceChildren(box);
      } else c.textContent = '';
      const where = `row ${row(i) + 1}, column ${col(i) + 1}`;
      c.setAttribute('aria-label', val ? `${where}: ${val}${givens[i] ? ', given' : ''}${marks[i] === 'wrong' ? ', wrong' : ''}` : `${where}: empty`);
    }
    pads.forEach((b, k) => {
      const left = 9 - counts[k + 1];
      b.classList.toggle('done', left <= 0);
      b.querySelector('small').textContent = left > 0 ? left : '';
    });
  }

  function select(i) {
    if (!playing()) return;
    sel = i;
    paint();
  }

  // ---- filling in -----------------------------------------------------------------------
  function press(d) {
    if (!playing() || sel < 0 || givens[sel]) return;
    Blip.unlock();
    if (notesMode) {
      if (grid[sel]) return;
      remember([sel]);
      notes[sel] ^= (1 << d);
      Blip.tone(660, 0.03, { type: 'sine', volume: 0.04 });
    } else {
      const placing = grid[sel] !== d;
      // Placing a number also rubs it out of the pencil marks it now rules out.
      const touched = placing ? [sel, ...PEERS[sel].filter(p => notes[p] & (1 << d))] : [sel];
      remember(touched);
      grid[sel] = placing ? d : 0;
      delete marks[sel];
      if (placing) {
        notes[sel] = 0;
        for (const p of PEERS[sel]) notes[p] &= ~(1 << d);
        Blip.tone(520, 0.05, { type: 'triangle', volume: 0.05 });
        if ($('liveMistakes').checked) liveCheck(sel, d);
      }
    }
    changed();
  }

  function erase() {
    if (!playing() || sel < 0 || givens[sel] || (!grid[sel] && !notes[sel])) return;
    remember([sel]);
    grid[sel] = 0; notes[sel] = 0; delete marks[sel];
    changed();
  }

  // Undo keeps what each square looked like before every change.
  function remember(list) {
    undo.push(list.map(i => ({ i, v: grid[i], n: notes[i], m: marks[i] })));
    if (undo.length > 300) undo.shift();
  }
  function stepBack() {
    if (!playing()) return;
    const last = undo.pop();
    if (!last) { toast('Nothing to undo.'); return; }
    for (const { i, v, n, m } of last) { grid[i] = v; notes[i] = n; if (m) marks[i] = m; else delete marks[i]; }
    sel = last[0].i;
    changed();
  }

  function changed() {
    save();
    paint();
    if (grid.every(Boolean)) finish();
  }

  // ---- your progress: on this device, and on the arcade for profiles ----------------------
  const progressKey = id => `sudoku.progress.${id}`;
  const currentKey = (day, lv) => `sudoku.current.${day}.${lv}`;
  const SYNC_AFTER_MS = 1500;     // a pause in tapping this long, then it's sent
  let version = 0, sentVersion = 0, sendTimer = null;
  const unsent = () => version !== sentVersion;
  // `unsent` in the device copy means the arcade hasn't got these changes yet
  // (no signal, or the page closed first), so this device's copy wins next time.
  function keep(unsentToo) {
    if (!run) return;
    store(progressKey(run.runId), JSON.stringify({ grid: grid.join(''), notes, marks, unsent: !!unsentToo }));
  }
  function save() {
    if (!run) return;
    version++;
    keep(run.syncs);
    if (run.syncs) { clearTimeout(sendTimer); sendTimer = setTimeout(send, SYNC_AFTER_MS); }
  }
  const progressBody = () => ({ grid: grid.join(''), notes, marks, profileToken: token() });
  async function send() {
    clearTimeout(sendTimer); sendTimer = null;
    if (!run || !run.syncs || run.finished || !unsent() || !token()) return;
    const v = version, id = run.runId;
    try {
      await api(`/api/sudoku/run/${id}/progress`, progressBody());
      if (!run || run.runId !== id) return;
      sentVersion = v;
      if (v === version) keep(false);
    } catch { /* kept on this device; sent again after the next change or on leaving */ }
  }
  // Puts saved progress on the board (the givens always stay as they are).
  function apply(saved) {
    grid = givens.slice();
    notes = new Array(81).fill(0);
    marks = {};
    if (!saved || !/^[0-9]{81}$/.test(saved.grid)) return;
    saved.grid.split('').map(Number).forEach((v, i) => { if (!givens[i]) grid[i] = v; });
    if (Array.isArray(saved.notes) && saved.notes.length === 81) notes = saved.notes.map(n => n | 0);
    if (saved.marks && typeof saved.marks === 'object') marks = { ...saved.marks };
  }
  const sameAsBoard = p => !!p && p.grid === grid.join('') && JSON.stringify(p.notes) === JSON.stringify(notes) &&
    JSON.stringify(p.marks || {}) === JSON.stringify(marks);
  function load(state) {
    givens = state.puzzle.split('').map(Number);
    let local = null;
    try { local = JSON.parse(recall(progressKey(state.runId), 'null')); } catch { /* start clean */ }
    // The arcade's copy is the newest, unless this device has changes it never got to send.
    const server = state.syncs ? state.progress || null : null;
    const useLocal = !!local && (!server || !!local.unsent);
    apply(useLocal ? local : server);
    clearTimeout(sendTimer);
    version = sentVersion = 0;
    if (useLocal && local.unsent && state.syncs) { version = 1; sendTimer = setTimeout(send, 300); }
    // Clear out older days' saved progress so it doesn't pile up.
    try {
      for (let k = localStorage.length - 1; k >= 0; k--) {
        const key = localStorage.key(k) || '';
        const m = /^sudoku\.current\.(\d{4}-\d{2}-\d{2})\./.exec(key);
        if (m && m[1] < state.day) { store(progressKey(recall(key)), null); store(key, null); }
      }
    } catch { /* unavailable */ }
    store(currentKey(state.day, state.level), state.runId);
    if (!useLocal) store(progressKey(state.runId), JSON.stringify({ grid: grid.join(''), notes, marks, unsent: false }));
    undo = [];
    checked.clear();
    sel = -1;
  }

  // ---- talking to the server ----------------------------------------------------------------
  const runApi = (path, body = {}) => api(`/api/sudoku/run/${run.runId}${path}`, body);
  function took(state) {
    run = state;
    syncedAt = Date.now();
    tick();
    return state;
  }
  const playing = () => !!run && !run.paused && !run.finished && !busy;

  async function openLevel(lv) {
    level = lv;
    store('sudoku.level', lv);
    paintLevels();
    $('over').classList.add('hidden');
    document.body.dataset.state = 'ready';
    run = null;
    givens = new Array(81).fill(0); grid = givens.slice(); notes = new Array(81).fill(0); marks = {}; sel = -1;
    paint();
    tick();
    // Picking up where you left off on this device, if this level was started today.
    const had = today && recall(currentKey(today, lv));
    if (had) {
      try {
        const state = await api(`/api/sudoku/run/${had}`);
        if (lv !== level) return;
        load(state);
        took(state);
        showState();
        return;
      } catch { store(currentKey(today, lv), null); }
    }
    cover(`Today's ${LABEL[lv]} puzzle`,
      `Everyone gets the same ${LABEL[lv]} puzzle today. The clock starts when you ${TvPlay.on ? 'press OK on' : 'tap'} Start, and you can pause it whenever you need to.`, 'Start', begin);
  }

  async function begin() {
    if (busy) return;
    busy = true;
    try {
      const state = await api('/api/sudoku/start', { level, profileToken: token() });
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
    closePicker();
    paint();
    if (run.finished) { $('cover').classList.add('hidden'); showOver(); return; }
    if (run.paused) {
      cover('Paused', 'The clock has stopped, and the board is hidden until you come back.', 'Keep going', () => setPaused(false));
    } else {
      $('cover').classList.add('hidden');
      document.body.dataset.state = 'playing';
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
      const r = took(await runApi(on ? '/pause' : '/resume'));
      // Carrying on: another device may have moved on while this one was away.
      if (!on && r.syncs && r.progress && !unsent() && !sameAsBoard(r.progress)) {
        apply(r.progress);
        keep(false);
        undo = [];
        sel = -1;
        paint();
      }
      if (!quiet) showState();
    } catch (e) { if (!quiet) toast(e.message); }
  }
  function paintPause() {
    $('pauseBtn').textContent = run && run.paused ? '▶' : '⏸';
    $('pauseBtn').title = run && run.paused ? 'Keep going (P)' : 'Pause (P)';
  }

  async function liveCheck(i, d) {
    const key = `${i}:${d}`;
    let right = checked.get(key);
    if (right === undefined) {
      try {
        const r = await runApi('/cell', { index: i, value: d });
        took(r);
        right = r.right;
        checked.set(key, right);
      } catch (e) { toast(e.message); return; }
    }
    if (grid[i] !== d) return;
    if (right) delete marks[i]; else { marks[i] = 'wrong'; Blip.tone(180, 0.12, { type: 'square', volume: 0.04 }); }
    save();
    paint();
  }

  async function checkBoard() {
    if (!playing()) return;
    busy = true;
    try {
      const r = await runApi('/check', { grid: grid.join('') });
      took(r);
      for (const k of Object.keys(marks)) if (marks[k] === 'wrong') delete marks[k];
      for (const i of r.wrong) marks[i] = 'wrong';
      toast(r.wrong.length ? `${r.wrong.length} number${r.wrong.length === 1 ? ' is' : 's are'} wrong. They're marked in red with a little ✕.`
        : 'Everything you\'ve filled in so far is right. Nice!', 3500);
    } catch (e) { toast(e.message); }
    busy = false;
    save();
    paint();
  }

  async function hint() {
    if (!playing()) return;
    busy = true;
    try {
      const r = await runApi('/hint', { grid: grid.join('') });
      took(r);
      remember([r.index]);
      grid[r.index] = r.value; notes[r.index] = 0; marks[r.index] = 'hinted';
      for (const p of PEERS[r.index]) notes[p] &= ~(1 << r.value);
      sel = r.index;
      toast(r.fixing ? `That square should be a ${r.value}. It's fixed now.` : `Here's a ${r.value} for you.`);
    } catch (e) { toast(e.message); }
    busy = false;
    changed();
  }

  async function finish() {
    if (!run || run.finished || busy) return;
    busy = true;
    try {
      const r = await runApi('/finish', { grid: grid.join('') });
      took(r);
      busy = false;
      Blip.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]], { type: 'triangle', volume: 0.06 });
      if (window.Fx) Fx.burst({ count: 160, coins: 20 });
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
  const initials = ArcadeKit.wireInitials(iniBoxes, () => saveTime(), { guest: TvPlay.on });
  function profile() {
    try { return token() ? ArcadeProfile.get() : null; } catch { return null; }
  }
  function helpLine(r) {
    const bits = [];
    if (r.hints) bits.push(`${r.hints} hint${r.hints === 1 ? '' : 's'}`);
    if (r.checks) bits.push(`${r.checks} board check${r.checks === 1 ? '' : 's'}`);
    if (r.mistakes) bits.push(`${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'} shown`);
    return bits.length ? bits.join(', ') : '';
  }
  function showOver() {
    document.body.dataset.state = 'over';
    $('overTitle').textContent = `${LABEL[run.level]} puzzle solved! 🎉`;
    $('overTime').textContent = clock(run.timeMs);
    const help = helpLine(run);
    $('overDetail').textContent = help
      ? `${clock(run.timeMs - run.penaltyMs)} solving, plus ${clock(run.penaltyMs)} for help (${help}).`
      : 'No help used. That\'s a clean solve!';
    const p = profile();
    $('savePart').classList.toggle('hidden', run.saved);
    $('iniRow').classList.toggle('hidden', !!p);
    $('saveHint').textContent = p ? `Saving as ${p.name}.` : 'Type your initials to put your time on today\'s board and see where you stack up.';
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
    // A profile sends its initials too, in case its sign-in has run out on
    // the server; then the time goes on the board under the initials.
    const ini = p ? ArcadeProfile.initials() : initials.value();
    if (!p && !ini) { $('saveMsg').textContent = 'Type your initials first.'; return; }
    $('saveBtn').disabled = true;
    try {
      const r = await api(`/api/sudoku/run/${run.runId}/save`, { initials: ini, profileToken: token() });
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
    const next = LEVELS[(LEVELS.findIndex(([id]) => id === level) + 1) % LEVELS.length][0];
    openLevel(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---- fastest times -------------------------------------------------------------------------
  let boardLevel = level, boardScope = 'day';
  function tabs(box, items, current, onPick) {
    box.innerHTML = '';
    for (const [id, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(id === current));
      b.onclick = () => onPick(id);
      box.appendChild(b);
    }
  }
  async function openScores(lv = level, scope = boardScope, highlightId) {
    boardLevel = lv; boardScope = scope;
    tabs($('scoreLevels'), LEVELS, lv, id => openScores(id, boardScope));
    tabs($('scoreScope'), [['day', 'Today'], ['all', 'All time']], scope, id => openScores(boardLevel, id));
    $('scoreNote').textContent = scope === 'day'
      ? 'Today\'s puzzle is the same for everyone. Only your first finish of the day counts, and a new puzzle arrives at midnight.'
      : 'The fastest times on this level from every day so far.';
    $('scores').classList.remove('hidden');
    const list = $('scoreList');
    list.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const rows = await api(`/api/sudoku/board?level=${lv}&scope=${scope}&limit=20`);
      // The shared list drawing wants a score; ours is a time, shown as a clock.
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

  // ---- levels and settings ---------------------------------------------------------------------
  function paintLevels() {
    tabs($('levelSeg'), LEVELS, level, id => { if (id !== level) openLevel(id); });
  }
  function setNotes(on) {
    notesMode = on;
    $('notesBtn').setAttribute('aria-pressed', String(on));
    $('notesBtn').querySelector('small').textContent = on ? 'Notes on' : 'Notes off';
    document.body.classList.toggle('notes', on);
  }
  $('liveMistakes').checked = recall('sudoku.liveMistakes') === 'on';
  $('liveMistakes').addEventListener('change', e => store('sudoku.liveMistakes', e.target.checked ? 'on' : 'off'));
  $('sameHighlight').checked = recall('sudoku.same', 'on') === 'on';
  $('sameHighlight').addEventListener('change', e => { store('sudoku.same', e.target.checked ? 'on' : 'off'); paint(); });

  // ---- controls -----------------------------------------------------------------------------------
  $('undoBtn').addEventListener('click', stepBack);
  $('eraseBtn').addEventListener('click', erase);
  $('notesBtn').addEventListener('click', () => setNotes(!notesMode));
  $('hintBtn').addEventListener('click', hint);
  $('checkBtn').addEventListener('click', checkBoard);
  $('pauseBtn').addEventListener('click', () => { if (run && !run.finished) setPaused(!run.paused); });
  window.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || help.isOpen) return;
    if (!$('scores').classList.contains('hidden')) { if (e.key === 'Escape') $('scores').classList.add('hidden'); return; }
    const k = e.key;
    if (k === 'p' || k === 'P') { e.preventDefault(); if (run && !run.finished) setPaused(!run.paused); return; }
    if (!playing()) return;
    if (/^[1-9]$/.test(k)) { e.preventDefault(); press(Number(k)); return; }
    if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); erase(); return; }
    if (k === 'n' || k === 'N') { e.preventDefault(); setNotes(!notesMode); return; }
    if ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); stepBack(); return; }
    const move = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[k];
    if (move) {
      e.preventDefault();
      if (sel < 0) { select(40); return; }
      const r = row(sel), c = col(sel);
      const nr = (r + (move === -9 ? 8 : move === 9 ? 1 : 0)) % 9, nc = (c + (move === -1 ? 8 : move === 1 ? 1 : 0)) % 9;
      select(nr * 9 + nc);
    }
  });
  // Leaving the page (another app, another tab, closing it) pauses the clock.
  function away() {
    if (!run || run.finished) return;
    // Whatever hasn't reached the arcade yet goes now, before the page closes.
    if (run.syncs && unsent() && token()) {
      clearTimeout(sendTimer);
      try {
        fetch(`/api/sudoku/run/${run.runId}/progress`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(progressBody()) })
          .then(r => { if (r.ok) { sentVersion = version; keep(false); } }).catch(() => {});
      } catch { /* best effort */ }
    }
    if (run.paused) return;
    run.paused = true;
    try { fetch(`/api/sudoku/run/${run.runId}/pause`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* best effort */ }
    showState();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });
  window.addEventListener('pagehide', away);
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));
  Blip.music('sudoku');

  // ---- how to play ------------------------------------------------------------------------------------
  const help = Tutorial.create('sudoku', [
    {
      emoji: '🧩', title: 'Fill the grid',
      html: `<p>The board has 9 rows, 9 columns and 9 boxes (the 3 by 3 squares with thicker lines around them).</p>
        <p>Put a number from 1 to 9 in every empty square so that <b>no row, column or box has the same number twice</b>. The white numbers were there from the start and can't be changed.</p>`
    },
    {
      emoji: '👆', title: 'Tapping in numbers',
      html: `<p>Tap a square, then tap a number on the pad under the board. Tap the same number again, or <b>Erase</b>, to take it out. <b>Undo</b> takes back your last move.</p>
        <p>The little number under each button says how many of that number are still missing.</p>
        <table>
          <tr><td>⌨️ Keyboard</td><td><b>Arrow keys</b> to move, <b>1-9</b> to fill, <b>Delete</b> to erase, <b>N</b> for notes, <b>P</b> to pause.</td></tr>
        </table>`
    },
    {
      emoji: '✏️', title: 'Pencil marks',
      html: `<p>Not sure yet? Turn on <b>Notes</b> and the numbers you tap go in small, as reminders of what a square could be. Tap one again to rub it out.</p>
        <p>When you put a real number in a square, it's rubbed out of the notes in the same row, column and box for you.</p>`
    },
    {
      emoji: '📅', title: 'One puzzle a day',
      html: `<p>Every level has a new puzzle each day at midnight, and it's the <b>same puzzle for everyone</b>, so the family can race each other.</p>
        <table>
          <tr><td>👪 Family</td><td>Lots of numbers to start with. Every square can be worked out by spotting the one number it's missing. Great for kids.</td></tr>
          <tr><td>🙂 Easy</td><td>Fewer numbers to start with, and you'll sometimes need to look for the one place a number can go in a row, column or box.</td></tr>
          <tr><td>🤔 Medium</td><td>Those tricks get stuck partway, so you'll need pencil marks to find pairs of numbers that rule out others.</td></tr>
          <tr><td>🔥 Hard</td><td>Even pairs aren't enough. Expect to think hard and use plenty of notes.</td></tr>
        </table>`
    },
    {
      emoji: '⏱️', title: 'The clock and the boards',
      html: `<p>The clock starts when you tap <b>Start</b> and the arcade keeps the time, not your phone. <b>Pause</b> (or leaving the page) stops it and hides the board until you come back.</p>
        <p>Finish the puzzle to put your time on the 🏆 board for today, and the all-time board for that level. Only your <b>first finish of the day</b> counts, because a second go at the same puzzle would be easy. If you're playing as a profile, the puzzle follows you: open it on another device and your clock, your numbers and your pencil marks carry on from where you left them.</p>`
    },
    {
      emoji: '💡', title: 'Getting help costs time',
      html: `<table>
          <tr><td>💡 Hint</td><td>Fills in one square for you (or fixes a wrong one). Adds <b>30 seconds</b>.</td></tr>
          <tr><td>✔️ Check</td><td>Marks every wrong number on the board in red with a little ✕. Adds <b>15 seconds</b>.</td></tr>
          <tr><td>🚨 Show my mistakes as I go</td><td>A setting under the pad, off to start with. When it's on, a wrong number turns red right away, and each one adds <b>10 seconds</b>.</td></tr>
        </table>
        <div class="tut-tip">Help is never off-limits. It just adds time, so the fastest times are the ones solved on your own.</div>`
    }
  ], { onClose: () => { if (pausedForHelp) { pausedForHelp = false; setPaused(false); } } });
  // Reading How to play mid-puzzle pauses the clock, and closing it carries on.
  $('helpBtn').addEventListener('click', () => {
    if (run && !run.paused && !run.finished) { pausedForHelp = true; setPaused(true); }
    help.open();
  });

  // ---- on the TV --------------------------------------------------------------------------------------
  // The grid on the right, big. While the puzzle is being played the arrows
  // move between the squares, as they do on a keyboard, and OK opens the
  // number picker next to the board: the numbers, Erase, Notes, Undo, Hint
  // and Check, picked with the arrows and OK. The pad and tools under the
  // board on a phone make way for it.
  const picker = document.createElement('div');
  picker.className = 'sd-picker hidden';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Pick a number');
  const pickerOpen = () => !picker.classList.contains('hidden');
  function closePicker() { picker.classList.add('hidden'); }
  function openPicker() {
    if (!playing()) return;
    if (sel < 0) select(40);
    if (givens[sel]) { toast('That number was there from the start, so it can\'t be changed.'); return; }
    picker.replaceChildren();
    const title = document.createElement('p');
    title.className = 'sd-picker-title';
    title.textContent = `Row ${row(sel) + 1}, column ${col(sel) + 1}${notesMode ? ': pencil marks' : ''}`;
    const nums = document.createElement('div');
    nums.className = 'sd-picker-nums';
    const counts = new Array(10).fill(0);
    for (const v of grid) counts[v]++;
    let first = null;
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${d}<small></small>`;
      b.querySelector('small').textContent = 9 - counts[d] > 0 ? `${9 - counts[d]} left` : '';
      b.setAttribute('aria-label', `Number ${d}`);
      b.addEventListener('click', () => { press(d); if (!notesMode) closePicker(); else openPicker(); });
      nums.appendChild(b);
      if (d === (grid[sel] || 5)) first = b;
    }
    const tools = document.createElement('div');
    tools.className = 'sd-picker-tools';
    const tool = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      tools.appendChild(b);
      return b;
    };
    tool('⌫ Erase', () => { erase(); closePicker(); });
    tool(notesMode ? '✏️ Notes are on' : '✏️ Notes are off', () => { setNotes(!notesMode); openPicker(); });
    tool('↶ Undo', () => { stepBack(); closePicker(); });
    tool('💡 Hint (+30s)', () => { closePicker(); hint(); });
    tool('✔️ Check (+15s)', () => { closePicker(); checkBoard(); });
    tool('Back to the board', closePicker);
    picker.append(title, nums, tools);
    picker.classList.remove('hidden');
    if (first) first.focus();
  }
  if (TvPlay.on) {
    document.body.appendChild(picker);
    for (const c of cells) c.tabIndex = -1;
    $('pad').classList.add('tv-hide');
    $('tools').classList.add('tv-hide');
    // OK on the board opens the picker (window capture: before anything else sees it).
    window.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.repeat || pickerOpen() || help.isOpen || !playing() || !$('scores').classList.contains('hidden')) return;
      if (e.target.closest && e.target.closest('input, textarea, select, button, a')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openPicker();
    }, true);
  }
  TvPlay.setup({
    stage: document.querySelector('.sd-wrap'),
    steering: () => playing() && !pickerOpen(),
    active: () => playing(),
    start: () => (!$('cover').classList.contains('hidden') ? $('coverBtn') : null),
    buttons: { 0: 'Enter', 2: 'Delete', 3: 'n', 9: 'p' },
    dirs: true,
    hint: 'The arrows on the remote move around the board, and OK opens the numbers for the square you\'re on, with Erase, Notes, Undo, Hint and Check. On a game controller, X erases, Y turns notes on and off, and Start pauses.'
  });

  // ---- start -----------------------------------------------------------------------------------------
  setNotes(false);
  paintLevels();
  paint();
  api('/api/sudoku/levels').then(info => { today = info.day; }).catch(() => {}).finally(() => openLevel(level));
  help.autoOpen();
})();
