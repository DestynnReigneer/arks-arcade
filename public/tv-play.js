'use strict';

// Playing a game on the TV itself, with the remote or a game controller
// (2026-11-01). Loaded after tv.js by the games played on the screen: the
// cabinet games (Tumbler Rumble, Disco Drop, Roll Royale, Moonshot) and the
// classics (Snake, Dino Dash, Block Drop, Brick Breaker, Tower Defense,
// Sudoku, Chess). On a phone or a computer it only adds controller play.
//
// On a TV (html.tv, see tv.js) it:
//   - gives the page the TV play layout (html.tv-play, tv-play.css): the game
//     big on the right, everything else in a column on the left;
//   - shares the remote's arrows and OK between the highlight (menus, How to
//     play, the game-over panel) and the game: while a run is being played
//     the arrows and OK go to the game, and the highlight steps aside;
//   - adds a big Play button where the game's own "tap to start" would be;
//   - lets the remote pick initials like an arcade cabinet: up and down
//     change the letter, left and right move between the three, OK saves;
//   - tells ARKS ID a game is being played (ArcadeTV.played) while it is,
//     so adults' night doesn't end in the middle of a game.
//
// Everywhere, a game controller (the Gamepad API) is turned into the keys
// the game already knows. In the ARKS TV app the controller's A arrives as
// Enter and B as Back, and the D-pad as arrow keys, so those are left alone
// there; every other button, the sticks and the triggers come through here.
//
//   TvPlay.setup({
//     stage: $('zone'),               // the game itself: big, on the right
//     steering: () => mode === 'playing',   // the game has the arrows and OK
//     active: () => ...,              // a game is being played (default: steering)
//     begin: () => start(),           // what the TV's Play button does
//     ready: () => mode === 'idle',   // when the Play button shows
//     enter: ' ',                     // OK (Enter) means this key while steering
//     buttons: { 0: ' ', 2: ' ', 5: ' ', 9: 'p' },  // controller button -> key
//                                     // (A, 0, only counts outside the TV app)
//     navButtons: { 9: 'p' },         // buttons that keep their key in the menus too
//     dirs: true,                     // D-pad and left stick -> arrow keys
//     hint: 'What the remote and the controller do, in a sentence or two.',
//   });

const TvPlay = (() => {
  const root = document.documentElement;
  const inApp = /(^|\s)ARKS-TV\/[0-9A-Za-z.+_-]+/.test(navigator.userAgent);
  const tvOn = () => root.classList.contains('tv');
  if (tvOn()) root.classList.add('tv-play');

  const ARROWS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  const CODES = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
  const codeOf = key => CODES[key] || (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key);
  const isField = t => !!(t && t.closest && t.closest('input, textarea, select'));
  const shown = e => !!e && e.isConnected && !e.closest('[hidden], .hidden') && e.getClientRects().length > 0;

  // A key press made up here, for a key the game already understands.
  // While the game steers it goes to the page itself, not to whatever might
  // still hold the highlight.
  function sendKey(type, key, extra = {}) {
    const a = document.activeElement;
    const target = a && a !== document.body && !root.classList.contains('tv-steering') ? a : document.body;
    target.dispatchEvent(new KeyboardEvent(type, { key, code: codeOf(key), bubbles: true, cancelable: true, ...extra }));
  }

  // ---- initials, picked with the arrows like an arcade cabinet ------------------------------
  // The three boxes still take typing on a keyboard. On a TV the on-screen
  // keyboard stays away (inputmode none), and the arrows pick the letters.
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function iniBoxes(box) {
    const row = box.closest('.initials');
    return row ? [...row.querySelectorAll('input.ini')] : [box];
  }
  function spin(box, step) {
    const at = LETTERS.indexOf((box.value || '').toUpperCase());
    const next = at < 0 ? (step > 0 ? 0 : LETTERS.length - 1) : (at + step + LETTERS.length) % LETTERS.length;
    box.value = LETTERS[next];
    try { box.setSelectionRange(1, 1); } catch { /* not a text box */ }
  }
  // Window capture runs before tv.js and the game, so on a letter box the
  // arrows only ever change letters.
  window.addEventListener('keydown', e => {
    const box = e.target;
    if (!tvOn() || !box || !box.matches || !box.matches('.initials input.ini') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!ARROWS[e.key]) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const boxes = iniBoxes(box), i = boxes.indexOf(box);
    if (e.key === 'ArrowUp') spin(box, 1);
    else if (e.key === 'ArrowDown') spin(box, -1);
    else if (e.key === 'ArrowLeft') { if (boxes[i - 1]) boxes[i - 1].focus(); }
    else if (e.key === 'ArrowRight') {
      // Past the last letter is the Save button (the next button after the row).
      if (boxes[i + 1]) boxes[i + 1].focus();
      else {
        const all = [...document.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')].filter(shown);
        const after = all.find(b => box.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (after) after.focus();
      }
    }
  }, true);
  document.addEventListener('focusin', e => {
    const box = e.target;
    if (!tvOn() || !box.matches || !box.matches('.initials input.ini')) return;
    box.setAttribute('inputmode', 'none');
    const row = box.closest('.initials');
    // A first visit: start on A so there's a letter to change.
    if (!box.value && row && ![...row.querySelectorAll('input.ini')].some(b => b.value)) box.value = 'A';
    if (row && !row.nextElementSibling?.classList.contains('tv-ini-hint')) {
      const hint = document.createElement('p');
      hint.className = 'hint tv-ini-hint';
      hint.textContent = 'Press up and down to change a letter, left and right to move between them, and OK to save.';
      row.after(hint);
    }
  });

  // ---- a game on the TV -------------------------------------------------------------------------
  let opts = null;
  let steeringWas = null;

  function setup(o) {
    opts = { dirs: false, buttons: {}, navButtons: null, ...o };
    const tv = tvOn();
    if (tv) layout();
    startPads();
    if (!tv) return;
    root.setAttribute('data-tv-nav', '');
    setInterval(tick, 100);
    // And straight away when the page changes (a dialog opens or closes, the
    // game-over panel appears), before tv.js or a controller press can act
    // on the screen that was there a moment ago.
    new MutationObserver(tick).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'disabled'] });
    // While a game is being played, ARKS ID hears about it now and then
    // (tv.js passes it on at most once a minute), so adults' night doesn't
    // run out mid-game. Menus, How to play and the scores don't count.
    setInterval(() => { if (!document.hidden && active()) played(); }, 20000);
    tick();
  }

  // The game on the right, the rest of the page in a column on the left.
  let goBtn = null;
  function layout() {
    const stage = opts.stage;
    if (stage) {
      const box = document.createElement('div');
      box.className = 'tv-stage';
      stage.before(box);
      box.appendChild(stage);
      // The remote's highlight never lands on the game itself: OK and the
      // arrows reach it directly while it's being played.
      for (const e of [stage, ...stage.querySelectorAll('[tabindex="0"]')]) if (e.getAttribute('tabindex') === '0') e.setAttribute('tabindex', '-1');
    }
    // The phone's thumb buttons and the keyboard notes make way for the TV's own.
    for (const e of document.querySelectorAll('.pad, .keys-hint')) e.classList.add('tv-hide');
    const anchor = opts.goAfter || document.querySelector('body > .options') || document.querySelector('body > .hud') || document.querySelector('header.top');
    if (opts.begin && anchor) {
      goBtn = document.createElement('button');
      goBtn.type = 'button';
      goBtn.className = 'primary big tv-go';
      goBtn.textContent = opts.goLabel || '▶ Play';
      goBtn.addEventListener('click', () => { if (!opts.ready || opts.ready()) opts.begin(); });
      anchor.after(goBtn);
    }
    if (opts.hint && anchor) {
      const p = document.createElement('p');
      p.className = 'hint tv-keys';
      p.textContent = opts.hint;
      (goBtn || anchor).after(p);
    }
    // Pages sized when they loaded measure themselves again.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  const steering = () => !!(opts && opts.steering && opts.steering());
  const active = () => !!(opts && (opts.active || opts.steering || (() => false))());
  const played = () => { if (window.ArcadeTV && ArcadeTV.played) ArcadeTV.played(); };
  let activeWas = false;

  // Where the highlight starts when a screen changes: the letters on the
  // game-over panel, then the Play button, then Play again.
  function startPoint() {
    if (opts.start) { const s = opts.start(); if (s) return s; }
    const ini = [...document.querySelectorAll('.initials input.ini')].find(shown);
    if (ini) return ini;
    if (goBtn && shown(goBtn)) return goBtn;
    const again = [...document.querySelectorAll('.over-top .primary, .over-panel .primary')].find(shown);
    return again || null;
  }

  function tick() {
    if (!opts) return;
    // (Only real changes: this runs on every change to the page.)
    const hideGo = !(opts.ready ? opts.ready() : false);
    if (goBtn && goBtn.hidden !== hideGo) goBtn.hidden = hideGo;
    // A game starting counts as playing straight away.
    const a = active();
    if (a && !activeWas) played();
    activeWas = a;
    const s = steering();
    if (s !== steeringWas) {
      steeringWas = s;
      root.classList.toggle('tv-steering', s);
      // While the game has the arrows, nothing on the page holds the
      // highlight, so OK can't press a button by mistake.
      // (A box or a switch too: keys meant for the game would go to it.)
      if (s && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    }
    const want = s ? null : startPoint();
    for (const e of document.querySelectorAll('[data-tv-start]')) if (e !== want) e.removeAttribute('data-tv-start');
    if (want && !want.hasAttribute('data-tv-start')) want.setAttribute('data-tv-start', '');
    // tv.js moves the highlight (data-tv-nav); not while the game steers,
    // unless a dialog (How to play, the scores) is open on top of it.
    const dialog = [...document.querySelectorAll('.tut-overlay, .overlay, .tv-overlay, [role="dialog"][aria-modal="true"]')].some(d => shown(d) && getComputedStyle(d).position === 'fixed');
    root.toggleAttribute('data-tv-nav', !s || dialog);
    // A new screen with nothing highlighted: the highlight goes to where it starts.
    const now = document.activeElement;
    if (!s && !dialog && want && (!now || now === document.body || !shown(now))) {
      want.focus({ preventScroll: true });
      want.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  // Every key press first brings the page up to date (is the game steering,
  // is a dialog open), before tv.js or the game sees it.
  window.addEventListener('keydown', () => { if (opts && tvOn()) tick(); }, true);

  // The remote's arrows and OK: in the menus they belong to the highlight
  // (tv.js), so the game doesn't also start or steer; while the game
  // steers, OK can stand for the game's own key. Registered after tv.js, so
  // it has already moved the highlight.
  document.addEventListener('keydown', e => {
    if (!opts || !tvOn() || isField(e.target)) return;
    if (root.hasAttribute('data-tv-nav')) {
      if (ARROWS[e.key] || e.key === 'Enter') e.stopPropagation();
      return;
    }
    if (e.isTrusted && e.key === 'Enter' && opts.enter && opts.enter !== 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      sendKey('keydown', opts.enter, { repeat: e.repeat });
    }
  }, true);
  document.addEventListener('keyup', e => {
    if (!opts || !tvOn() || !e.isTrusted || e.key !== 'Enter' || !opts.enter || opts.enter === 'Enter') return;
    e.stopImmediatePropagation();
    sendKey('keyup', opts.enter);
  }, true);

  // ---- a game controller --------------------------------------------------------------------------
  // Buttons by the standard layout: 0 A, 1 B, 2 X, 3 Y, 4 L1, 5 R1, 6 L2
  // (left trigger), 7 R2 (right trigger), 8 Select, 9 Start, 12-15 the D-pad.
  const PAD_DIRS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
  const held = new Map();       // "pad:button" -> the key sent for it
  let stickSendsKeys = false;   // the TV app already turns the stick into arrow keys
  let lastStickKey = 0;
  const pressedOf = b => !!b && (b.pressed || b.value > 0.5);

  function readPads() {
    let pads = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; } catch { pads = []; }
    const nav = tvOn() && root.hasAttribute('data-tv-nav');
    const seen = new Set();
    for (const pad of pads) {
      const want = new Map();
      // Buttons.
      pad.buttons.forEach((b, i) => {
        if (!pressedOf(b)) return;
        if (PAD_DIRS[i]) {
          // In the TV app the D-pad arrives as arrow keys already; in a
          // browser tv.js moves the highlight with it in the menus.
          if (opts.dirs && !inApp && !nav) want.set(`b${i}`, PAD_DIRS[i]);
          return;
        }
        if (nav) {
          // In the menus, X, R1 and the right trigger press the highlighted
          // button too, unless the game gave them a job there (navButtons).
          if (opts.navButtons && opts.navButtons[i]) want.set(`b${i}`, opts.navButtons[i]);
          else if (i === 2 || i === 5 || i === 7) want.set(`b${i}`, 'press');
          return;
        }
        // A is the TV app's OK (Enter), so only a browser sees it here.
        if (opts.buttons[i] && !(i === 0 && inApp)) want.set(`b${i}`, opts.buttons[i]);
      });
      // The left stick works like the D-pad, a firm push to go.
      if ((opts.dirs || nav) && !stickSendsKeys && pad.axes && pad.axes.length >= 2) {
        const [x, y] = pad.axes;
        const was = k => held.has(`${pad.index}:${k}`);
        const push = (v, k, sign) => { const on = sign * v > (was(k) ? 0.35 : 0.6); if (on) want.set(k, k === 'sx-' ? 'ArrowLeft' : k === 'sx+' ? 'ArrowRight' : k === 'sy-' ? 'ArrowUp' : 'ArrowDown'); };
        push(x, 'sx-', -1); push(x, 'sx+', 1); push(y, 'sy-', -1); push(y, 'sy+', 1);
      }
      for (const [slot, key] of want) {
        const id = `${pad.index}:${slot}`;
        seen.add(id);
        if (held.has(id)) continue;
        held.set(id, key);
        if (slot.startsWith('s')) lastStickKey = performance.now();
        if (key === 'press') pressFocused();
        else sendKey('keydown', key);
      }
    }
    for (const [id, key] of [...held]) {
      if (seen.has(id)) continue;
      held.delete(id);
      if (key !== 'press') sendKey('keyup', key);
    }
    requestAnimationFrame(readPads);
  }
  // If real arrow keys turn up right as the stick is pushed, the TV app is
  // already turning the stick into keys, and doing it here too would move twice.
  window.addEventListener('keydown', e => {
    if (inApp && e.isTrusted && ARROWS[e.key] && performance.now() - lastStickKey < 120 && [...held.keys()].some(k => /:s[xy]/.test(k))) stickSendsKeys = true;
  }, true);

  // What OK does to the highlighted thing, the way tv.js does it.
  function pressFocused() {
    const a = document.activeElement;
    if (!a || a === document.body) return;
    if (a.tagName === 'SELECT') {
      if (a.options.length) { a.selectedIndex = (a.selectedIndex + 1) % a.options.length; a.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (a.click) a.click();
  }

  let padsStarted = false;
  function startPads() {
    if (padsStarted || !navigator.getGamepads) return;
    padsStarted = true;
    requestAnimationFrame(readPads);
  }

  return { setup, get on() { return tvOn(); }, inApp, sendKey };
})();
window.TvPlay = TvPlay;
