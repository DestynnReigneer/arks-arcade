'use strict';

// Press and hold for more options, the same in every ARKS app.
//
// Part of the shared kit: every app has this exact file in public/longpress.js, with
// its looks in public/longpress.css, which this file loads itself (next to wherever
// the page loaded this script from). A page only needs <script src="longpress.js">.
//
//   LongPress.attach(element, () => ({
//     title: 'Sudoku, today\'s Easy Challenge',      // optional, shown at the top
//     items: [
//       { icon: '▶️', label: 'Resume', run: () => { location.href = '...'; } },
//       { icon: '🚪', label: 'Leave this game', danger: true,
//         ask: 'Leave this game? ...', yes: 'Leave', run: async () => { ... } },
//       { sep: true },                                   // a thin line between groups
//       { row: 'Jump to today\'s puzzle', choices: [      // a row of small buttons
//         { label: 'Easy', run: () => { ... } }, ... ] }
//     ]
//   }));
//
// Every menu ends with a Cancel button, since closing the menu is what it does.
//
// How it opens: holding a finger on the element for half a second (the device buzzes
// once where it can), a right-click on a computer, or the keyboard's menu key or
// Shift+F10 on a focused element. The tap that ends a hold doesn't also press the
// element. A plain tap still does what it always did.
//
// On a touch screen, or any screen under 600px wide, the menu opens right under the
// thing that was held (above it when there's no room below), so a finger doesn't
// cover it. With a mouse it opens by the pointer. Either way it stays inside the part
// of the screen that can be seen, which on a phone with Chrome's tab row showing is
// shorter than the window, and it's placed again when its question replaces its list.
// An item with `ask` asks inside the same card before it runs (the safe answer,
// Cancel, has the focus). Up and Down move between the choices. Escape, a tap outside, or Back
// closes it, and the focus goes back where it was. Back works because opening the menu adds
// a step to the browser's history, which closing it takes off again.

const LongPress = (() => {
  const HOLD_MS = 500, SLOP = 10;
  let open = null;
  // Letting go after a hold makes the device send a tap where the finger was, which
  // would land on the menu that just opened (closing it, or picking an item). Taps on
  // the menu are ignored until the finger is up and that tap has passed.
  let quietUntil = 0;
  const quiet = () => Date.now() < quietUntil;
  document.addEventListener('pointerup', () => { if (quietUntil === Infinity) quietUntil = Date.now() + 400; }, true);
  document.addEventListener('pointercancel', () => { if (quietUntil === Infinity) quietUntil = Date.now() + 400; }, true);

  // The looks come from longpress.css, a file next to this one, because some apps
  // don't allow a style tag written by a script. It's asked for as soon as the page
  // loads, so it's there long before anyone has held a finger down for half a second.
  const cssHref = (() => {
    const me = document.currentScript && document.currentScript.src;
    return me ? me.replace(/longpress\.js(\?.*)?$/, 'longpress.css') : '/longpress.css';
  })();
  function addStyle() {
    let l = document.getElementById('lp-style');
    if (l) return l;
    l = document.createElement('link');
    l.id = 'lp-style';
    l.rel = 'stylesheet';
    l.href = cssHref;
    l.addEventListener('load', () => { if (open) open.again(); });
    document.head.appendChild(l);
    return l;
  }
  addStyle();

  // The history step the open menu added. Back takes it off, which closes the menu.
  let entry = false;
  window.addEventListener('popstate', () => { if (entry) { entry = false; close(true); } });
  // Takes the menu's history step off when the menu closes some other way, and waits for
  // that before anything else navigates, so the page isn't left with an extra step.
  function dropEntry() {
    if (!entry) return Promise.resolve();
    entry = false;
    return new Promise(res => {
      let t = 0;
      const done = () => { window.removeEventListener('popstate', done); clearTimeout(t); res(); };
      t = setTimeout(done, 400);
      window.addEventListener('popstate', done);
      history.back();
    });
  }

  // keep: leave the history step alone (Back already took it off, or another menu is
  // about to open in its place).
  function close(keep) {
    if (!open) return keep === true ? Promise.resolve() : dropEntry();
    const { veil, card, back, key, again } = open;
    open = null;
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', again);
    veil.classList.remove('in'); card.classList.remove('in');
    setTimeout(() => { veil.remove(); card.remove(); }, 170);
    if (back && back.isConnected) back.focus({ preventScroll: true });
    return keep === true ? Promise.resolve() : dropEntry();
  }

  // How much of the window can be seen: Chrome's tab row on a phone covers the bottom
  // of the page without making the window shorter.
  function seen() {
    const vv = window.visualViewport;
    const h = vv && vv.scale === 1 && vv.height > 0 ? Math.min(innerHeight, vv.height) : innerHeight;
    return { w: innerWidth, h };
  }
  const near = () => innerWidth < 600 || window.matchMedia('(pointer: coarse)').matches;

  // Under the row (or above it), or by the pointer, and always on screen.
  function place(card, at, from) {
    const { w, h } = seen();
    const pad = 12;
    const wide = innerWidth < 600;
    // A short screen (a phone turned sideways) gets a wide menu in two columns.
    const short = !wide && h < 500 && card.querySelectorAll('.lp-item').length > 4;
    card.classList.toggle('wide', wide);
    card.classList.toggle('short', short);
    card.style.width = wide ? (w - pad * 2) + 'px' : short ? Math.min(w - pad * 2, 560) + 'px' : '';
    // Measured without the opening animation's scale, which would make it look smaller.
    const r = { width: card.offsetWidth, height: card.offsetHeight };
    let x, y;
    if (from && (near() || !at)) {
      const b = from.getBoundingClientRect();
      x = wide ? pad : b.left;
      y = b.bottom + 6 + r.height <= h - pad ? b.bottom + 6 : b.top - 6 - r.height;
    } else {
      x = at ? at.x : pad;
      y = at ? at.y : pad;
    }
    card.style.left = Math.max(pad, Math.min(x, w - r.width - pad)) + 'px';
    card.style.top = Math.max(pad, Math.min(y, h - r.height - pad)) + 'px';
    card.style.maxHeight = (h - pad * 2) + 'px';
    card.style.overflowY = 'auto';
  }

  function show(menu, at, from) {
    close(true);
    if (!menu || !menu.items || !menu.items.length) { dropEntry(); return; }
    if (!entry) { try { history.pushState({ lpMenu: 1 }, ''); entry = true; } catch { /* Back just leaves */ } }
    addStyle();
    const veil = document.createElement('div');
    veil.className = 'lp-veil';
    const card = document.createElement('div');
    card.className = 'lp-card';
    card.setAttribute('role', 'menu');
    if (menu.title) {
      const t = document.createElement('div');
      t.className = 'lp-title';
      t.textContent = menu.title;
      card.appendChild(t);
    }
    const list = document.createElement('div');
    list.className = 'lp-list';
    card.appendChild(list);
    const items = () => {
      list.replaceChildren();
      for (const it of menu.items) {
        if (it.sep) {
          const d = document.createElement('div');
          d.className = 'lp-sep';
          list.appendChild(d);
          continue;
        }
        if (it.row) {
          const box = document.createElement('div');
          box.className = 'lp-chips';
          const t = document.createElement('div');
          t.className = 'lp-chips-t';
          t.textContent = it.row;
          const row = document.createElement('div');
          row.className = 'lp-chips-row';
          for (const c of it.choices || []) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.textContent = c.label;
            b.onclick = () => run(c);
            row.appendChild(b);
          }
          box.append(t, row);
          list.appendChild(box);
          continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lp-item' + (it.danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        b.innerHTML = '<span class="lp-i" aria-hidden="true"></span><span></span>';
        b.firstChild.textContent = it.icon || '';
        b.lastChild.textContent = it.label;
        b.onclick = () => (it.ask ? confirm(it) : run(it));
        list.appendChild(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'lp-cancel';
      cancel.textContent = 'Cancel';
      cancel.onclick = () => close();
      list.appendChild(cancel);
    };
    const run = async it => { await close(); try { await it.run(); } catch (e) { console.error(e); } };
    const confirm = it => {
      list.replaceChildren();
      const q = document.createElement('div');
      q.className = 'lp-q';
      q.textContent = it.ask;
      const row = document.createElement('div');
      row.className = 'lp-row';
      const safe = document.createElement('button');
      safe.type = 'button'; safe.className = 'lp-safe'; safe.textContent = it.no || 'Cancel';
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'lp-go'; go.textContent = it.yes || it.label;
      safe.onclick = close;
      go.onclick = () => run(it);
      row.append(safe, go);
      list.append(q, row);
      place(card, at, from);
      safe.focus();
    };
    items();
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [...card.querySelectorAll('button')];
      if (!all.length) return;
      e.preventDefault(); e.stopPropagation();
      const k = all.indexOf(document.activeElement);
      all[(k + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
    };
    document.addEventListener('keydown', key, true);
    veil.addEventListener('click', () => { if (!quiet()) close(); });
    const hush = e => { if (quiet()) { e.preventDefault(); e.stopPropagation(); } };
    card.addEventListener('click', hush, true);
    document.body.append(veil, card);
    place(card, at, from);
    // Focus goes back to what had it, or to the first thing in the row that can take it.
    const had = document.activeElement;
    const back = from && from.contains(had) && had !== document.body ? had
      : from && (from.matches('a[href],button') ? from : from.querySelector('a[href],button'));
    // Placed again when the screen changes size or the device turns.
    const again = () => { if (open && open.card === card) place(card, null, from && from.isConnected ? from : null); };
    window.addEventListener('resize', again);
    open = { veil, card, back, key, again };
    requestAnimationFrame(() => { veil.classList.add('in'); card.classList.add('in'); });
    const first = card.querySelector('.lp-item, .lp-chips-row button');
    if (first) first.focus({ preventScroll: true });
  }

  function attach(el, getMenu) {
    el.classList.add('lp-hold');
    let timer = null, start = null, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;   // a mouse uses the right-click
      fired = false;
      start = { x: e.clientX, y: e.clientY };
      cancel();
      timer = setTimeout(() => {
        timer = null; fired = true; quietUntil = Infinity;
        if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* no buzz here */ }
        show(getMenu(), start, el);
      }, HOLD_MS);
    });
    el.addEventListener('pointermove', e => {
      if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
    });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, cancel);
    // The tap that ends a hold doesn't also press the link or button under it.
    el.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
    // A right-click, the keyboard's menu key, and the phone's own long-press menu
    // on a link all arrive as contextmenu.
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (fired) return;
      cancel();
      const r = el.getBoundingClientRect();
      const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + 16, y: r.bottom };
      show(getMenu(), at, el);
    });
  }

  return { attach, show, close, get isOpen() { return !!open; } };
})();
window.LongPress = LongPress;
