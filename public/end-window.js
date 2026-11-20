'use strict';

// The end of a game (2026-11-19): one window, the same in every game, from the
// preview the maintainer approved. A card over a dim layer that leaves the top
// bar usable, with:
//
//   - ✕ Close in the corner; after it, nothing floats over the game. The top
//     bar's ☰ gets a small dot and a first item, 🏁 Last game's results, that
//     brings the same card back (a TV, which has no ☰, says "Press OK to see
//     your results" along the bottom instead);
//   - the game's own end line, the big score, one detail line, and the save
//     line: the score saves by itself ("Saved as Kim · #3 for today"), or a
//     plain line when there's nothing to save. Nobody types anything;
//   - ▶ Play again, 🏆 High scores (inside the card) and ⚙️ Back to setup, plus
//     at most one extra button a game adds (Next level, Rematch);
//   - the game behind gets no keys or taps while the card is up. Enter is Play
//     again (unless another button has the focus), Escape closes the top layer.
//   - On a TV the card asks "Who played?" with the family's pictures and Guest,
//     and the score goes under the person picked (arcade/board-who.js checks it).
//
// A game calls it when a run ends:
//
//   ArcadeEnd.show({
//     title: 'Three outs!',              // the game's own end line
//     score: 42,                          // a number, or text such as a time ('1:02.35')
//     detail: '3 home runs · level 2',
//     save: async who => ({ rank, where: 'for today', id }),   // posts the score with who's fields
//     saved: { name, avatar, rank, where },  // or: the game already saved it itself
//     noSave: 'Pop one lock to get on the board.',   // the line when there's nothing to save
//     scores: { tabs: [{ id, label }], tab, load: async (tabId, savedId) => rows },
//     again: () => start(), setup: () => toSetup(),  // either can be left out when a game has none
//     extra: { label: 'Next level: Medium', run: () => next() },
//     delay: 600,                         // wait this long first (a new game cancels it)
//   });
//   ArcadeEnd.clear()     // a new game started, or back to setup: forget the results
//   ArcadeEnd.close()     // put the card away (the results stay in ☰)
//
// rows: [{ id, name, avatar, score (text), detail }]; ArcadeEnd.boardRows(list, fmt)
// turns the arcade's usual board answer (initials, profileName, profileAvatar) into them.

window.ArcadeEnd = (() => {
  const root = document.documentElement;
  const tv = () => root.classList.contains('tv');
  const P = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile : null);
  const NO_NAME = 'Sign in with ARKS ID to put your score on the board.';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (cls, text, fn) => { const b = el('button', 'ew-btn ' + cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

  // ---- the parts on the page --------------------------------------------------------------
  const layer = el('div', 'ew-layer');
  layer.hidden = true;
  const card = el('div', 'ew-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Results');
  layer.appendChild(card);
  const hint = el('div', 'ew-tvhint', 'Press OK to see your results');
  hint.hidden = true;
  const mount = () => document.body.append(layer, hint);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  let cfg = null;          // the last game's results (what show() was given)
  let view = null;         // null (closed), 'main' or 'scores'
  let save = null;         // { state: 'saving' | 'saved' | 'none' | 'pick' | 'error', ... }
  let tab = null;
  let gen = 0;             // goes up with every new game, so late answers and timers are dropped
  let timer = null;
  let openedAt = 0;
  let players = null;      // the TV's "Who played?" list
  let pick = 0;

  // ---- who the score goes under -----------------------------------------------------------
  // Signed in, the profile (the server checks its token); a guest, the name they play under.
  function boardWho() {
    const p = P();
    if (!p || tv()) return null;
    const token = p.token() || null;
    const name = p.name() || '';
    if (!token && !name) return null;
    const me = p.get() || {};
    return { profileToken: token, name, avatar: me.avatar || undefined };
  }
  // The TV is signed in as itself: it names who played, from the family's approved profiles.
  // Asked every time a game ends (so someone approved since shows up), and only once the TV is
  // signed in (it has its own profile token); a TV that isn't set up, or an arcade without ARKS ID,
  // offers Guest only. If the arcade doesn't answer, the last list it gave is used.
  async function tvPlayers() {
    let list = [];
    const signedIn = !!(P() && P().token());
    if (signedIn) {
      try {
        const r = await fetch('/api/tv/players', { cache: 'no-store' });
        if (r.ok) list = (await r.json()).players || [];
        else if (players) return players;
      } catch { if (players) return players; /* otherwise Guest is always there */ }
    }
    const got = [...list.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })), { id: null, name: 'Guest' }];
    if (signedIn) players = got;
    return got;
  }

  function avatar(av, size) {
    const p = P();
    if (p && p.avatarEl && av) { try { return p.avatarEl(av, size); } catch { /* the plain dot */ } }
    const dot = el('span', 'ew-av');
    dot.style.width = dot.style.height = size + 'px';
    return dot;
  }

  // ---- showing and hiding -----------------------------------------------------------------
  function show(opts) {
    clearTimeout(timer);
    const mine = ++gen;
    const go = () => {
      timer = null;
      if (mine !== gen) return;
      cfg = { ...opts };
      tab = cfg.scores ? (cfg.scores.tab || (cfg.scores.tabs && cfg.scores.tabs[0] && cfg.scores.tabs[0].id) || null) : null;
      startSave(mine);
      open('main', true);
    };
    if (opts && opts.delay > 0) timer = setTimeout(go, opts.delay); else go();
  }

  function startSave(mine) {
    if (cfg.saved) { save = { state: 'saved', ...cfg.saved }; return; }
    if (!cfg.save) { save = { state: 'none', text: cfg.noSave || '' }; return; }
    if (tv()) { save = { state: 'pick' }; pick = 0; tvPlayers().then(() => { if (mine === gen && view) render(); }); return; }
    const who = boardWho();
    if (!who) { save = { state: 'none', text: NO_NAME }; return; }
    doSave(who, { name: who.name, avatar: who.avatar }, mine);
  }

  async function doSave(who, as, mine) {
    save = { state: 'saving', name: as.name, avatar: as.avatar };
    const fn = cfg.save;
    try {
      const r = (await fn(who)) || {};
      if (mine !== gen) return;
      save = { state: 'saved', name: r.name || as.name, avatar: r.avatar !== undefined ? r.avatar : as.avatar, rank: r.rank, where: r.where, id: r.id, text: r.text };
    } catch (e) {
      if (mine !== gen) return;
      save = { state: 'error', text: (e && e.message) || 'The score couldn\'t be saved.' };
    }
    if (view) render();
  }

  // Where the dim starts: under the top bar, so Back, 🏆 and ☰ still work. A TV covers it all.
  function place() {
    const bar = document.querySelector('.ah');
    let top = 0;
    if (bar && !tv() && getComputedStyle(bar).display !== 'none') top = Math.max(0, Math.round(bar.getBoundingClientRect().bottom));
    layer.style.setProperty('--ew-top', top + 'px');
  }

  function open(which, fromGame = false) {
    if (!cfg) return;
    closeMenu();
    view = which;
    place();
    layer.hidden = false;
    // Only when the game opened it: a key still held from playing mustn't press a button.
    openedAt = fromGame ? performance.now() : 0;
    document.body.dataset.endWindow = 'open';
    render();
    sync();
    focusStart();
  }

  function close() {
    if (!view) return;
    view = null;
    layer.hidden = true;
    delete document.body.dataset.endWindow;
    sync();
  }

  // A new game, or back to setup: the results go, and so does anything still on its way.
  function clear() {
    gen++;
    clearTimeout(timer);
    timer = null;
    cfg = null;
    save = null;
    close();
    sync();
  }

  function closeTop() {
    if (view === 'scores') { view = 'main'; render(); focusStart(); } else close();
  }

  // The ☰'s dot, its menu item (topbar.js asks `has`) and the TV's line along the bottom.
  function sync() {
    const waiting = !!cfg && !view;
    const waffle = document.querySelector('.ah-waffle');
    if (waffle) waffle.classList.toggle('ew-dot', waiting && !tv());
    hint.hidden = !(waiting && tv());
  }

  function closeMenu() {
    const back = document.querySelector('.ah-menu-back.open');
    if (back) back.click();
  }

  // ---- drawing the card -------------------------------------------------------------------
  // Drawn again when the save line changes; the focus (the TV's highlight) stays on the same button,
  // or goes back to where it starts if that button is gone.
  function render() {
    const a = document.activeElement;
    const had = a && a !== document.body && card.contains(a);
    const key = had ? `${a.className}|${a.dataset.i || ''}|${a.textContent}` : null;
    draw();
    if (!had && a && a !== document.body) return;
    const same = key && [...card.querySelectorAll('button')].find(b => `${b.className}|${b.dataset.i || ''}|${b.textContent}` === key);
    if (same) same.focus({ preventScroll: true }); else focusStart();
  }
  function draw() {
    card.replaceChildren();
    card.classList.toggle('ew-scores-view', view === 'scores');
    const x = el('button', 'ew-x', '✕');
    x.type = 'button'; x.title = 'Close'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', closeTop);
    card.appendChild(x);
    if (view === 'scores') return renderScores();

    const left = el('div', 'ew-left');
    left.appendChild(el('div', 'ew-title', cfg.title || 'Game over'));
    if (cfg.score !== undefined && cfg.score !== null && cfg.score !== '') {
      left.appendChild(el('div', 'ew-score', typeof cfg.score === 'number' ? cfg.score.toLocaleString('en-US') : String(cfg.score)));
    }
    if (cfg.detail) left.appendChild(el('div', 'ew-detail', cfg.detail));
    const line = saveLine();
    if (line) left.appendChild(line);

    const right = el('div', 'ew-right');
    if (cfg.again) right.appendChild(button('ew-play', cfg.againLabel || '▶ Play again', playAgain));
    // A game with no Play again (a daily puzzle) has its extra button in the first place.
    if (cfg.extra) right.appendChild(button(cfg.again ? 'ew-extra' : 'ew-play', cfg.extra.label, runExtra));
    const row = el('div', 'ew-row');
    if (cfg.scores) row.appendChild(button('ew-hs', '🏆 High scores', () => { view = 'scores'; render(); focusStart(); }));
    if (cfg.setup) row.appendChild(button('ew-setup', '⚙️ Back to setup', () => { const fn = cfg.setup; clear(); fn(); }));
    if (row.children.length) right.appendChild(row);
    card.append(left, right);
  }

  function saveLine() {
    if (!save) return null;
    if (save.state === 'pick') return whoPlayed();
    const s = el('div', 'ew-saved');
    if (save.state === 'saved') {
      s.appendChild(avatar(save.avatar, 18));
      const where = save.where || 'on the board';
      s.appendChild(el('span', '', save.text || `Saved as ${save.name || 'Guest'}${save.rank ? ` · #${save.rank} ${where}` : ''}`));
      return s;
    }
    if (save.state === 'saving') {
      s.classList.add('ew-wait');
      s.appendChild(avatar(save.avatar, 18));
      s.appendChild(el('span', '', `Saving as ${save.name || 'Guest'}…`));
      return s;
    }
    if (!save.text) return null;
    s.classList.add('ew-plain');
    s.textContent = save.text;
    return s;
  }

  // The TV: whose score is this? Arrows move, OK saves under that person.
  function whoPlayed() {
    const box = el('div', 'ew-who-box');
    box.appendChild(el('div', 'ew-detail', 'Who played?'));
    const row = el('div', 'ew-who');
    const list = players || [{ id: null, name: 'Guest' }];
    list.forEach((p, i) => {
      const b = el('button', 'ew-person');
      b.type = 'button';
      b.dataset.i = String(i);
      b.append(p.id ? avatar(p.avatar, 44) : el('span', 'ew-av ew-guest', '🙂'), el('span', '', p.name));
      b.addEventListener('click', () => {
        pick = i;
        const who = p.id ? { profileToken: (P() && P().token()) || null, playedBy: p.id } : { profileToken: null, name: 'Guest' };
        doSave(who, { name: p.name, avatar: p.avatar }, gen);
        render();
        focusStart();
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    box.appendChild(el('div', 'ew-small', '← → to pick, OK to save'));
    return box;
  }

  async function renderScores() {
    const back = el('button', 'ew-back', '‹ Back to my score');
    back.type = 'button';
    back.addEventListener('click', () => { view = 'main'; render(); focusStart(); });
    card.appendChild(back);
    card.appendChild(el('div', 'ew-title ew-hs-title', '🏆 High scores'));
    const sc = cfg.scores;
    if (sc.tabs && sc.tabs.length > 1) {
      const tabs = el('div', 'ew-tabs');
      for (const t of sc.tabs) {
        const b = el('button', t.id === tab ? 'on' : '', t.label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(t.id === tab));
        b.addEventListener('click', () => { tab = t.id; render(); const on = card.querySelector('.ew-tabs .on'); if (on) on.focus({ preventScroll: true }); });
        tabs.appendChild(b);
      }
      card.appendChild(tabs);
    }
    const list = el('ol', 'ew-list');
    list.appendChild(el('li', 'ew-empty', 'Loading…'));
    card.appendChild(list);
    if (cfg.again) card.appendChild(button('ew-play', cfg.againLabel || '▶ Play again', playAgain));
    const mine = gen, which = tab, savedId = save && save.id;
    let rows;
    try { rows = await sc.load(which, savedId); } catch (e) { rows = e; }
    if (mine !== gen || view !== 'scores' || which !== tab || !list.isConnected) return;
    list.replaceChildren();
    if (rows instanceof Error || !Array.isArray(rows)) { list.appendChild(el('li', 'ew-empty', rows && rows.message ? rows.message : 'The scores couldn\'t be loaded.')); return; }
    if (!rows.length) { list.appendChild(el('li', 'ew-empty', 'No scores yet. Be the first!')); return; }
    rows.slice(0, 20).forEach((r, i) => {
      const li = el('li', r.id != null && r.id === savedId ? 'me' : '');
      li.append(el('b', '', `#${i + 1}`), avatar(r.avatar, 22), el('span', 'ew-n', r.name || ''), el('span', 'ew-d', r.detail || ''), el('span', 'ew-p', r.score));
      list.appendChild(li);
    });
  }

  function runExtra() {
    if (!cfg || !cfg.extra) return;
    const fn = cfg.extra.run;
    clear();
    fn();
  }
  function playAgain() {
    if (cfg && !cfg.again && cfg.extra) return runExtra();
    if (!cfg || !cfg.again) return;
    const fn = cfg.again;
    clear();
    fn();
  }

  // The arcade's usual board rows -> the card's rows.
  function boardRows(rows, fmt) {
    return (rows || []).map(r => ({
      id: r.id, name: r.profileName || r.name || r.initials || '', avatar: r.profileAvatar || r.avatar || null,
      detail: r.detail || '', score: fmt ? fmt(r.score) : Number(r.score).toLocaleString('en-US')
    }));
  }
  // The shared board (/api/scores/<game>), one tab per board.
  function sharedBoard(game, boards, board, fmt) {
    const ids = Object.keys(boards);
    return {
      tabs: ids.map(id => ({ id, label: boards[id] })), tab: board || ids[0],
      load: async id => {
        const r = await fetch(`/api/scores/${game}?board=${encodeURIComponent(id || '')}&limit=20`);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'The scores couldn\'t be loaded.');
        return boardRows(data, fmt);
      }
    };
  }

  // ---- the keys and the focus ----------------------------------------------------------------
  const focusables = () => [...card.querySelectorAll('button')].filter(b => !b.disabled && b.getClientRects().length);
  function focusStart() {
    const want = card.querySelector('.ew-person[data-i="' + pick + '"]') || card.querySelector('.ew-play') || focusables()[0];
    if (want) want.focus({ preventScroll: true });
  }
  function move(dir) {
    const list = focusables();
    const cur = document.activeElement;
    if (!list.includes(cur)) return focusStart();
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, e }; };
    const boxes = list.map(box);
    const from = boxes.find(b => b.e === cur);
    let next = window.TvCore && window.TvCore.pick ? window.TvCore.pick(from, boxes, dir) : null;
    if (!next) {
      const i = list.indexOf(cur), step = dir === 'down' || dir === 'right' ? 1 : -1;
      const n = list[i + step];
      next = n ? { e: n } : null;
    }
    if (next) next.e.focus({ preventScroll: true });
  }
  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const elsewhere = t => !!(t && t.closest && t.closest('.ab-confirm, .tv-overlay, .tut-overlay, .ah-menu'));
  const dialogUp = () => !!document.querySelector('.ab-confirm, .tv-overlay, .ah-menu') ||
    [...document.querySelectorAll('.tut-overlay')].some(o => !o.classList.contains('hidden') && !o.hidden && o.getClientRects().length);

  // Window capture runs before every game's own keys, so nothing reaches the game behind.
  function onKey(e) {
    if (!view) {
      // Closed, with the results waiting in ☰ (or along the bottom on a TV): the game is over, so its
      // keys don't start a new one. Enter or Space (OK on a TV) brings the results back instead.
      if (!cfg || dialogUp() || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = document.activeElement;
      const onPage = a && a !== document.body && !card.contains(a) && a.closest && a.closest('button, a, input, textarea, select, [contenteditable]');
      if (onPage) return;
      const reopen = e.key === 'Enter' || (e.key === ' ' && !tv());
      const steer = !tv() && (DIRS[e.key] || e.key === 'w' || e.key === 'W');
      if (!reopen && !steer) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (reopen && e.type === 'keydown' && !e.repeat) open('main');
      return;
    }
    if (elsewhere(e.target)) return;
    e.stopImmediatePropagation();
    // (Space never presses a button here; Enter does, through its keypress, so that one is left alone.)
    if (e.type !== 'keydown') { if (e.key === ' ') e.preventDefault(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeTop(); return; }
    if (e.key === ' ') { e.preventDefault(); return; }
    if (e.key === 'Enter') {
      // A key held down from the game, or pressed the moment the card came up, does nothing.
      if (e.repeat || performance.now() - openedAt < 400) { e.preventDefault(); return; }
      const a = document.activeElement;
      if (a && card.contains(a) && a.tagName === 'BUTTON' && !a.classList.contains('ew-play')) return;   // the button presses itself
      e.preventDefault();
      if (view === 'main' && save && save.state === 'pick') { const first = card.querySelector('.ew-person'); if (first) first.click(); return; }
      playAgain();
      return;
    }
    if (DIRS[e.key]) { e.preventDefault(); move(DIRS[e.key]); return; }
    if (e.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list[list.length - 1] : list[i - 1]) : (i < 0 || i === list.length - 1 ? list[0] : list[i + 1]);
      e.preventDefault();
      next.focus({ preventScroll: true });
    }
  }
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, onKey, true);

  // Taps and clicks: the card's own reach its buttons and stop there; the dim takes the rest.
  // The top bar (Back, 🏆, ☰, ?) keeps working.
  // Where a tap plays the game: the boards, stages and thumb pads.
  const STAGE = 'canvas, #stage, .stage, .dino-stage, .cab-stage, .cab-pad, #zone, #popBtn, .pad, .tv-stage';
  const POINTER = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'contextmenu'];
  for (const type of POINTER) {
    window.addEventListener(type, e => {
      // Closed, with the results waiting: a tap on the finished game does nothing (it would start a new one).
      if (!view) {
        if (cfg && e.target && e.target.closest && e.target.closest(STAGE)) {
          e.stopImmediatePropagation();
          if (e.cancelable && type !== 'touchstart') e.preventDefault();
        }
        return;
      }
      const t = e.target;
      if (t && t.closest && (card.contains(t) || t.closest('.ah, .ah-menu, .ah-menu-back, .ab-confirm, .tv-overlay, .tut-overlay, #toast, .fb-root'))) return;
      e.stopImmediatePropagation();
      if (e.cancelable && type !== 'touchstart') e.preventDefault();
    }, { capture: true, passive: false });
    layer.addEventListener(type, e => e.stopPropagation());
  }

  // Opening ☰ or How to play while the card is up puts the card away first.
  document.addEventListener('click', e => {
    if (!view || !e.target.closest) return;
    if (e.target.closest('.ah-waffle, .ah .help')) close();
  }, true);

  window.addEventListener('resize', () => { if (view) place(); });
  // The top bar grows and shrinks (it docks as the page scrolls), with a short animation.
  if (window.ResizeObserver) {
    const watch = () => { const bar = document.querySelector('.ah'); if (bar) new ResizeObserver(() => { if (view) place(); }).observe(bar); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  }
  window.addEventListener('scroll', () => { if (view) place(); }, { passive: true });

  return {
    show, clear, close, closeTop,
    reopen: () => open('main'),
    boardRows, sharedBoard, boardWho, NO_NAME,
    get isOpen() { return !!view; },
    get has() { return !!cfg; },
    get view() { return view; },
    get pending() { return !!timer; }
  };
})();
