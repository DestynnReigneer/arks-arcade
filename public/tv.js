'use strict';

// The arcade on a TV. Loaded on every page (after tv-core.js); it does
// nothing unless the page is on a TV: the ARKS TV app's user agent, or ?tv=1
// in the address to try the layout on a computer.
//
// On a TV it:
//   - switches on the TV layout (html.tv, styled by tv.css): big text, safe
//     margins, nothing that needs a mouse;
//   - moves a clearly visible highlight between buttons with the remote's
//     arrows, and Enter (OK) presses the highlighted one, on pages that ask
//     for it with <html data-tv-nav>;
//   - with ARKS ID on, sets the TV up the first time ("Set up this TV": a
//     pairing code and a QR code for a grown-up's phone), shows a small sign
//     on every screen while adults' night is on, and keeps Back to family
//     within reach.
//
// Pages use window.ArcadeTV: on, adult(), unlock(), backToFamily(), played(),
// onPad(fn) for a controller's X, Y and shoulder buttons, and the
// 'arcadetv:mode' event on document when adults' night starts or ends.
// Also adultPass() (adults' night, then the pass that goes where the adult
// PIN would) and confirm(text) (a yes-or-no card the remote can answer,
// because the TV app can't show the browser's own confirm box).

const ArcadeTV = (() => {
  const Core = window.TvCore;
  let remembered = null;
  try { remembered = sessionStorage.getItem('arcade.tv'); } catch { /* no storage */ }
  const want = Core.wantsTv(navigator.userAgent, location.search, remembered);
  try { if (want.remember) sessionStorage.setItem('arcade.tv', want.remember); } catch { /* no storage */ }
  const inApp = Core.isTvAgent(navigator.userAgent);
  const api = { on: want.on, inApp, state: { on: false, signedIn: false, tv: null, adultMode: null } };
  if (!want.on) {
    return Object.assign(api, {
      adult: () => false, unlock: async () => false, adultPass: async () => '', backToFamily() {}, played() {}, onPad() {},
      confirm: async text => window.confirm(text), ready: Promise.resolve(api.state)
    });
  }
  document.documentElement.classList.add('tv');
  // Pages loaded without tv.css in their head get it now.
  if (!document.querySelector('link[href="tv.css"]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'tv.css';
    document.head.appendChild(css);
  }
  const whenBody = fn => (document.body ? fn() : document.addEventListener('DOMContentLoaded', fn));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---- the highlight and the arrows ------------------------------------------------------

  const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const BARS = '.ah, #tvBar';
  const MODALS ='[role="dialog"], [aria-modal="true"], .overlay, .modal, .apf, .tv-overlay, .tut-overlay';
  const shown = e => {
    if (!e || !e.isConnected) return false;
    if (e.closest('[inert], [hidden], .hidden')) return false;
    if (e.checkVisibility && !e.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const usable = e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && shown(e);
  const focusablesIn = root => [...root.querySelectorAll(FOCUSABLE)].filter(usable);
  // The open dialog on top, if any: the arrows stay inside it.
  function scope() {
    const open = [...document.querySelectorAll(MODALS)].filter(m => shown(m) && focusablesIn(m).length);
    return open.length ? open[open.length - 1] : document.body;
  }
  // Where the highlight starts: a button the page marked (data-tv-start),
  // otherwise the first one outside the bars at the top and bottom.
  function startOf(root) {
    const marked = [...root.querySelectorAll('[data-tv-start]')].find(usable);
    if (marked) return marked;
    const all = focusablesIn(root);
    return all.find(e => !e.closest(`${BARS}, header, [role="banner"]`)) || all[0] || null;
  }
  function focusOn(e) {
    if (!e) return;
    e.focus({ preventScroll: true });
    e.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  const textual = e => e && (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|search|email|url|tel|password|number)$/.test(e.type || 'text')));

  function move(dir) {
    const root = scope();
    const cur = document.activeElement;
    if (!cur || cur === document.body || !root.contains(cur) || !usable(cur)) return focusOn(startOf(root));
    const list = focusablesIn(root);
    const boxes = list.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, e }; });
    const from = boxes.find(b => b.e === cur);
    if (!from) return focusOn(startOf(root));
    // The bars pinned to the top and bottom of the screen sit over the page,
    // so the page's own buttons come first; the bars are reached past the
    // last row (or the first one).
    const pinned = b => !!b.e.closest(BARS);
    const onPage = pinned(from) ? null : Core.pick(from, boxes.filter(b => !pinned(b)), dir);
    const barOf = sel => boxes.find(b => b.e.closest(sel));
    const next = onPage || Core.pick(from, boxes, dir) ||
      (pinned(from) ? null : dir === 'down' ? barOf('#tvBar') : dir === 'up' ? barOf('.ah') : null);
    if (next) focusOn(next.e);
  }

  // Enter presses what's highlighted. Buttons and links do that on their
  // own; checkboxes, menus and other clickable things need a hand.
  function activate(e) {
    if (!e || e === document.body) return false;
    if (e.tagName === 'SELECT') {
      const n = e.options.length;
      if (n) { e.selectedIndex = (e.selectedIndex + 1) % n; e.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    }
    if (e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio')) { e.click(); return true; }
    if (e.tagName === 'BUTTON' || e.tagName === 'A' || textual(e) || e.tagName === 'TEXTAREA') return false;
    e.click();
    return true;
  }

  const navOn = () => document.documentElement.hasAttribute('data-tv-nav');
  document.addEventListener('keydown', ev => {
    if (!navOn() || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const t = ev.target;
    const dir = Core.DIRS[ev.key];
    if (dir) {
      // In a text box, left and right move through the words until the end.
      if (textual(t) && (dir === 'left' || dir === 'right')) {
        let atEdge = true;
        try { atEdge = dir === 'left' ? t.selectionStart === 0 && t.selectionEnd === 0 : t.selectionEnd === t.value.length; } catch { atEdge = true; }
        if (!atEdge) return;
      }
      ev.preventDefault();
      move(dir);
    } else if (ev.key === 'Enter' && !ev.repeat) {
      if (activate(t)) ev.preventDefault();
    }
  }, true);

  // Where the highlight last was, as "the nth button inside #something", so a
  // game that draws its buttons again (a hand of cards, a row of tiles) keeps
  // the highlight in the same place instead of sending it back to the start.
  let lastAt = null;
  function placeOf(e) {
    const steps = [];
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      if (n.id) return { id: n.id, steps };
      const p = n.parentElement;
      if (!p) return null;
      steps.unshift([...p.children].indexOf(n));
    }
    return null;
  }
  function atPlace(at) {
    let n = at && document.getElementById(at.id);
    for (const i of at ? at.steps : []) {
      if (!n || !n.children.length) return null;
      n = n.children[Math.min(i, n.children.length - 1)];
    }
    return n && n.matches(FOCUSABLE) ? n : null;
  }
  document.addEventListener('focusin', e => { if (e.target !== document.body) lastAt = placeOf(e.target); });

  // When the screen changes under the highlight (a dialog opens, a button
  // goes away), it stays where it was if that spot is still there, or moves
  // to the new screen's starting point by itself.
  function settle() {
    if (!navOn() || document.hidden) return;
    const root = scope();
    const cur = document.activeElement;
    if (!cur || cur === document.body || !root.contains(cur) || !usable(cur)) {
      const back = atPlace(lastAt);
      const s = back && root.contains(back) && usable(back) ? back : startOf(root);
      if (s) s.focus({ preventScroll: true });
      if (s) s.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }
  setInterval(settle, 250);
  document.addEventListener('focusout', e => { if (!e.relatedTarget) requestAnimationFrame(settle); });

  // ---- a game controller ----------------------------------------------------------------
  // In the TV app, A is OK and B is Back already, and the D-pad sends arrow
  // keys. In a plain browser (trying ?tv=1), A, B and the D-pad are handled
  // here too. X, Y and the shoulder buttons go to the page (onPad).
  const padListeners = [];
  const PAD_DIRS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  let padLoop = null;
  const held = new Map();
  function readPads() {
    padLoop = null;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    for (const pad of pads) {
      pad.buttons.forEach((b, i) => {
        const key = `${pad.index}:${i}`;
        if (!b.pressed) { held.delete(key); return; }
        if (held.has(key)) return;
        held.set(key, true);
        if (!inApp && navOn() && i === 0) { const a = document.activeElement; if (!activate(a) && a && a.click) a.click(); return; }
        if (!inApp && navOn() && PAD_DIRS[i]) { move(PAD_DIRS[i]); return; }
        for (const fn of padListeners) fn({ pad: pad.index, button: i });
      });
    }
    if (pads.length) padLoop = requestAnimationFrame(readPads);
  }
  window.addEventListener('gamepadconnected', () => { if (!padLoop) padLoop = requestAnimationFrame(readPads); });

  // ---- signing the TV in, and adults' night (with ARKS ID) -------------------------------

  const state = api.state;
  const getJson = (url, opts) => fetch(url, { cache: 'no-store', ...opts }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again in a moment.');
    return data;
  });
  const post = url => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const adultOn = () => !!(state.adultMode && state.adultMode.until > Date.now());

  function setMode(adultMode) {
    const was = adultOn();
    state.adultMode = adultMode || null;
    renderBar();
    if (was !== adultOn()) document.dispatchEvent(new CustomEvent('arcadetv:mode', { detail: { adult: adultOn() } }));
  }

  // A full-screen card on top of everything.
  function overlay(cls) {
    const o = el('div', `tv-overlay ${cls}`);
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    document.body.appendChild(o);
    return o;
  }
  const hostOf = url => { try { return new URL(url).host; } catch { return url; } };
  // The big code, the QR code, and how to type it in instead.
  function codeCard(o, { title, line, code, qr, enterUrl }) {
    o.replaceChildren();
    const card = el('div', 'tv-card');
    card.append(el('h2', null, title), el('p', 'tv-line', line));
    const row = el('div', 'tv-code-row');
    const img = el('img', 'tv-qr');
    img.src = qr;
    img.alt = 'QR code to scan with a phone';
    const side = el('div', 'tv-code-side');
    side.append(el('div', 'tv-code', Core.splitCode(code)),
      el('p', 'tv-type', `No camera handy? On the phone, go to ${hostOf(enterUrl)}/tv and type ${Core.splitCode(code)}.`));
    row.append(img, side);
    const status = el('p', 'tv-status');
    const btns = el('div', 'tv-btns');
    card.append(row, status, btns);
    o.appendChild(card);
    return { status, btns };
  }

  // "Set up this TV": shown until a grown-up approves it on their phone.
  async function pairing() {
    const o = overlay('tv-pair');
    let timer = null;
    const again = async () => {
      clearTimeout(timer);
      let started;
      try { started = await post('/api/tv/pair'); } catch (e) {
        o.replaceChildren(el('div', 'tv-card'));
        const card = o.firstChild;
        card.append(el('h2', null, 'Set up this TV'), el('p', 'tv-line', e.message));
        const retry = el('button', 'tv-btn', 'Try again');
        retry.dataset.tvStart = '';
        retry.onclick = again;
        card.appendChild(retry);
        timer = setTimeout(again, 15000);
        return;
      }
      const ui = codeCard(o, {
        title: 'Set up this TV',
        line: 'Scan this with a grown-up\'s phone. Their phone asks them to name this TV and type their PIN there, never on the TV.',
        code: started.userCode, qr: started.qr, enterUrl: started.enterUrl
      });
      ui.status.textContent = 'Waiting for a grown-up\'s phone…';
      const fresh = el('button', 'tv-btn', 'Get a new code');
      fresh.onclick = again;
      ui.btns.appendChild(fresh);
      const poll = async () => {
        let r = null;
        try { r = await getJson('/api/tv/pair'); } catch { r = { status: 'pending' }; }
        if (r.status === 'approved') {
          ui.status.textContent = `All set. This TV is now ${r.tv && r.tv.name ? r.tv.name : 'signed in'}.`;
          setTimeout(() => location.reload(), 900);
          return;
        }
        if (r.status === 'expired') { again(); return; }
        timer = setTimeout(poll, 2000);
      };
      timer = setTimeout(poll, 2000);
    };
    again();
  }

  // Adults' night: a code for a grown-up's phone. Resolves true once it's on.
  let unlocking = null;
  function unlock() {
    if (adultOn()) return Promise.resolve(true);
    if (!state.on || !state.tv) {
      toast(state.on ? 'Set up this TV first.' : 'Adults\' night needs the arcade to sign in through ARKS ID.');
      return Promise.resolve(false);
    }
    if (unlocking) return unlocking;
    unlocking = new Promise(resolve => {
      const o = overlay('tv-unlock');
      let timer = null, done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        o.remove();
        unlocking = null;
        if (ok) toast('Adults\' night is on.');
        resolve(ok);
      };
      const start = async () => {
        clearTimeout(timer);
        let u;
        try { u = await post('/api/tv/unlock'); } catch (e) { toast(e.message); finish(false); return; }
        if (u.adultMode) { setMode(u.adultMode); finish(true); return; }
        const ui = codeCard(o, {
          title: '🔞 Adults\' night',
          line: 'A grown-up scans this with their own phone and types their PIN there to unlock adult levels on this TV. It goes back to family by itself after 30 minutes without a game, or at 4 AM.',
          code: u.userCode, qr: u.qr, enterUrl: u.enterUrl
        });
        ui.status.textContent = 'Waiting for a grown-up\'s phone…';
        const cancel = el('button', 'tv-btn', 'Cancel');
        cancel.dataset.tvStart = '';
        cancel.onclick = () => finish(false);
        ui.btns.appendChild(cancel);
        const endsAt = Date.now() + u.expiresIn * 1000;
        const poll = async () => {
          if (done) return;
          if (Date.now() > endsAt) { start(); return; }
          try { const s = await getJson('/api/tv/state?waiting=1'); Object.assign(state, s, { adultMode: state.adultMode }); setMode(s.adultMode); } catch { /* try again */ }
          if (adultOn()) { finish(true); return; }
          timer = setTimeout(poll, 2000);
        };
        timer = setTimeout(poll, 2000);
      };
      start();
    });
    return unlocking;
  }

  // The pass that goes wherever the adult PIN would: adults' night first (a
  // QR code for a grown-up's phone), then the arcade hands one out. '' if not.
  async function adultPass() {
    if (!adultOn() && !(await unlock())) return '';
    try {
      const data = await post('/api/arksid/adult-pass');
      return data.pass || '';
    } catch (e) { toast(e.message); return ''; }
  }

  // A yes-or-no question the remote can answer. Resolves true for yes.
  function confirmOnTv(text, { yes = 'Yes', no = 'No' } = {}) {
    return new Promise(resolve => {
      const o = overlay('tv-confirm');
      const card = el('div', 'tv-card');
      card.append(el('h2', null, text));
      const btns = el('div', 'tv-btns');
      const done = ok => { o.remove(); resolve(ok); };
      const n = el('button', 'tv-btn', no);
      n.dataset.tvStart = '';
      n.onclick = () => done(false);
      const y = el('button', 'tv-btn', yes);
      y.onclick = () => done(true);
      btns.append(n, y);
      card.appendChild(btns);
      o.appendChild(card);
      requestAnimationFrame(() => n.focus());
    });
  }

  // Back to family: at once on this TV, and ARKS ID is told.
  function backToFamily() {
    setMode(null);
    post('/api/tv/lock').catch(() => { /* it's family here either way */ });
  }

  // A game is being played (a question, a move). The server passes it on at
  // most once a minute; this keeps it from even asking more often.
  let playedAt = 0;
  function played() {
    if (!state.tv || Date.now() - playedAt < 50000) return;
    playedAt = Date.now();
    post('/api/tv/activity').then(r => setMode(r.adultMode)).catch(() => { /* next time */ });
  }

  // ---- the bar at the bottom: this TV, and adults' night -----------------------------------
  let bar = null;
  const timeOf = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function renderBar() {
    if (!document.body) return;
    if (!state.on || !state.tv) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = el('div');
      bar.id = 'tvBar';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    bar.hidden = false;
    bar.replaceChildren();
    const adult = adultOn();
    bar.classList.toggle('adult', adult);
    if (adult) {
      const m = state.adultMode;
      bar.append(el('span', 'tv-sign', `🔞 Adults' night until ${timeOf(m.until)}${m.by && m.by.name ? ` · unlocked by ${m.by.name}` : ''}`));
      const back = el('button', 'tv-btn small', '👪 Back to family');
      back.id = 'tvFamily';
      back.onclick = backToFamily;
      bar.appendChild(back);
    } else {
      bar.append(el('span', 'tv-name', `📺 ${state.tv.name} · family mode`));
      const night = el('button', 'tv-btn small', '🔞 Adults\' night');
      night.id = 'tvAdults';
      night.onclick = () => unlock();
      bar.appendChild(night);
    }
  }

  function toast(text) {
    whenBody(() => {
      const t = el('div', 'tv-toast', text);
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    });
  }

  // Check in with the arcade's server: right away, then once a minute (more
  // often while an unlock code is showing, above). Adult levels show only
  // while the latest check says adults' night is on.
  async function check() {
    try {
      const s = await getJson('/api/tv/state');
      state.on = !!s.on; state.signedIn = !!s.signedIn; state.tv = s.tv || null;
      setMode(s.adultMode);
      return s;
    } catch {
      setMode(null);
      return null;
    }
  }
  api.ready = check().then(s => {
    whenBody(() => {
      renderBar();
      if (s && s.on && !s.signedIn) pairing();
    });
    return state;
  });
  setInterval(() => { if (!document.hidden && state.on) check(); }, 60000);
  // A time in adults' night that has passed counts as over, without waiting for the next check.
  setInterval(() => { if (state.adultMode && !adultOn()) setMode(null); }, 5000);

  return Object.assign(api, {
    adult: adultOn, unlock, adultPass, confirm: confirmOnTv, backToFamily, played,
    onPad: fn => padListeners.push(fn), toast, focusStart: () => focusOn(startOf(scope()))
  });
})();
window.ArcadeTV = ArcadeTV;
