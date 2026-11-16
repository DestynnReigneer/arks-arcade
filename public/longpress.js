'use strict';

// Press and hold for more options, the same in every ARKS app.
//
//   LongPress.attach(element, () => ({
//     title: 'Sudoku, today\'s Easy Challenge',      // optional, shown at the top
//     items: [
//       { icon: '▶️', label: 'Resume', run: () => { location.href = '...'; } },
//       { icon: '🚪', label: 'Leave this game', danger: true,
//         ask: 'Leave this game? ...', yes: 'Leave', run: async () => { ... } }
//     ]
//   }));
//
// How it opens: holding a finger on the element for half a second (the device buzzes
// once where it can), a right-click on a computer, or the keyboard's menu key or
// Shift+F10 on a focused element. The tap that ends a hold doesn't also press the
// element. A plain tap still does what it always did.
//
// The menu is a sheet from the bottom on a phone and a small card by the pointer on a
// computer. An item with `ask` asks inside the same card before it runs (the safe
// answer has the focus). Escape, a tap outside, or Back closes it.

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

  const css = `
.lp-veil{position:fixed;inset:0;z-index:2147482000;background:rgba(5,4,10,.55);backdrop-filter:blur(2px);opacity:0;transition:opacity .16s}
.lp-veil.in{opacity:1}
.lp-card{position:fixed;z-index:2147482001;min-width:240px;max-width:min(360px,calc(100vw - 24px));background:#1e0e39;color:#f5eaff;border:1px solid rgba(255,46,196,.55);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.5),0 0 24px rgba(255,46,196,.18);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:8px;transform:scale(.96);opacity:0;transition:transform .16s,opacity .16s}
.lp-card.in{transform:none;opacity:1}
.lp-card.sheet{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:none;transform:translateY(24px)}
.lp-card.sheet.in{transform:none}
.lp-title{font-size:13px;color:#c9a8dd;padding:8px 12px 10px;border-bottom:1px solid rgba(245,234,255,.1);margin-bottom:4px;line-height:1.35}
.lp-item{display:flex;align-items:center;gap:12px;width:100%;min-height:48px;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:16px;font-weight:600;text-align:left;cursor:pointer}
.lp-item:hover,.lp-item:focus-visible{background:rgba(245,234,255,.08);outline:none}
.lp-item.danger{color:#ff7ab8}
.lp-item .lp-i{width:24px;text-align:center;font-size:18px}
.lp-q{padding:10px 12px 12px;font-size:16px;line-height:1.4}
.lp-row{display:flex;gap:8px;padding:0 4px 4px}
.lp-row button{flex:1;min-height:46px;border-radius:10px;font:inherit;font-size:15px;font-weight:800;cursor:pointer}
.lp-safe{border:0;background:#00ffc2;color:#14082b}
.lp-go{border:1px solid #ff2ec4;background:transparent;color:#f5eaff}
.lp-hold{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
@media (prefers-reduced-motion:reduce){.lp-veil,.lp-card{transition:none}}`;

  function addStyle() {
    if (document.getElementById('lp-style')) return;
    const s = document.createElement('style');
    s.id = 'lp-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function close() {
    if (!open) return;
    const { veil, card, back, key } = open;
    open = null;
    document.removeEventListener('keydown', key, true);
    veil.classList.remove('in'); card.classList.remove('in');
    setTimeout(() => { veil.remove(); card.remove(); }, 170);
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  function show(menu, at, from) {
    close();
    if (!menu || !menu.items || !menu.items.length) return;
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
    card.appendChild(list);
    const items = () => {
      list.replaceChildren();
      for (const it of menu.items) {
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
    };
    const run = async it => { close(); try { await it.run(); } catch (e) { console.error(e); } };
    const confirm = it => {
      list.replaceChildren();
      const q = document.createElement('div');
      q.className = 'lp-q';
      q.textContent = it.ask;
      const row = document.createElement('div');
      row.className = 'lp-row';
      const safe = document.createElement('button');
      safe.type = 'button'; safe.className = 'lp-safe'; safe.textContent = it.no || 'Never mind';
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'lp-go'; go.textContent = it.yes || it.label;
      safe.onclick = close;
      go.onclick = () => run(it);
      row.append(safe, go);
      list.append(q, row);
      safe.focus();
    };
    items();
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    veil.addEventListener('click', () => { if (!quiet()) close(); });
    const hush = e => { if (quiet()) { e.preventDefault(); e.stopPropagation(); } };
    card.addEventListener('click', hush, true);
    document.body.append(veil, card);
    // A phone gets a sheet along the bottom; a computer a card by the pointer.
    if (innerWidth < 600 || !at) card.classList.add('sheet');
    else {
      const r = card.getBoundingClientRect();
      card.style.left = Math.max(12, Math.min(at.x, innerWidth - r.width - 12)) + 'px';
      card.style.top = Math.max(12, Math.min(at.y, innerHeight - r.height - 12)) + 'px';
    }
    open = { veil, card, back: from, key };
    requestAnimationFrame(() => { veil.classList.add('in'); card.classList.add('in'); });
    const first = card.querySelector('.lp-item');
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
