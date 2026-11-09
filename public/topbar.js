'use strict';

// The top bar on every game page (2026-10-29), the same bar as the home page
// and as the maintainer's other apps: a way back to the arcade on the left,
// the arcade's name (or the owner's logo lockup) in the middle, and How to
// play and Admin on the right. It shrinks once the page scrolls. The game's
// own header stays under it, minus its back arrow, which the bar replaces.
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // On a TV (the ARKS TV app, or ?tv=1), every page gets the TV's sign-in and
  // its adults' night sign (tv.js). Know-It-All and the home page load it
  // themselves; the other games get it here.
  const tvWanted = () => {
    if (/(^|\s)ARKS-TV\//.test(navigator.userAgent)) return true;
    try {
      const q = new URLSearchParams(location.search).get('tv');
      return q === '1' || (q !== '0' && sessionStorage.getItem('arcade.tv') === '1');
    } catch { return false; }
  };
  if (!window.ArcadeTV && tvWanted()) {
    const core = document.createElement('script');
    core.src = 'tv-core.js';
    core.onload = () => { const tv = document.createElement('script'); tv.src = 'tv.js'; document.head.appendChild(tv); };
    document.head.appendChild(core);
  }
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@800&family=Rajdhani:wght@700&display=swap';
  document.head.appendChild(fonts);

  // A div, not a <header>: some games style every <header> on their page.
  const bar = document.createElement('div');
  bar.setAttribute('role', 'banner');
  bar.className = 'ah ah-fixed';
  bar.innerHTML =
    '<div class="ah-bar">' +
      '<div class="ah-side"><a class="ah-back" href="/" title="Back to the arcade"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg><span>Arcade</span></a></div>' +
      '<a class="ah-brand" href="/" aria-label="The arcade, home"><span class="ah-plain">ARCADE</span></a>' +
      '<div class="ah-side r"><button class="ah-ib help" type="button" title="How to play" aria-label="How to play">?</button>' +
        '<a class="ah-lock" href="admin.html" title="Admin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span>Admin</span></a></div>' +
    '</div>';
  const spacer = document.createElement('div');
  spacer.className = 'ah-spacer';
  document.body.prepend(bar, spacer);

  // Once the game's own header is on the page: the bar's back arrow replaces
  // the header's, and ? opens the game's own How to play.
  const help = bar.querySelector('.help');
  const hookUp = () => {
    document.querySelectorAll('header a[href="/"], #backToArcade').forEach(a => { a.hidden = true; a.style.display = 'none'; });
    const gameHelp = document.getElementById('helpBtn');
    if (gameHelp) help.addEventListener('click', () => gameHelp.click()); else help.hidden = true;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookUp); else hookUp();

  // Who's playing? (profile.js, loaded further down the page): with ARKS ID
  // on, a game opened straight from its address or a bookmark asks first, the
  // same as the home page, before the game can be used.
  // (ArcadeProfile is a top-level const, so it isn't on window: check by name.)
  const ask = () => { if (typeof ArcadeProfile !== 'undefined') ArcadeProfile.askIfNobody(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ask); else ask();

  // The owner's logos, from the server's brand folder, as on the home page.
  fetch('/api/custom').then(r => (r.ok ? r.json() : null)).then(c => {
    const brand = c && c.brand;
    if (!brand || !brand.avatar || !brand.wide) return;
    const box = bar.querySelector('.ah-brand');
    const helm = document.createElement('img');
    helm.className = 'helm'; helm.src = brand.avatar; helm.alt = '';
    const wide = document.createElement('img');
    wide.className = 'wide'; wide.src = brand.wide; wide.alt = '';
    const word = document.createElementNS(SVG_NS, 'svg');
    word.setAttribute('class', 'word');
    word.setAttribute('viewBox', '0 0 900 445');
    word.setAttribute('aria-hidden', 'true');
    word.innerHTML = '<defs><linearGradient id="topbarBlend" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff2ec4"/>' +
      '<stop offset=".5" stop-color="#8a3ffc"/><stop offset="1" stop-color="#00ffc2"/></linearGradient></defs>' +
      '<text x="0" y="308.6" fill="none" stroke="url(#topbarBlend)" stroke-width="1.3" vector-effect="non-scaling-stroke">ARCADE</text>';
    box.replaceChildren(helm, wide, word);
    // The name's capitals line up with the logo's letters (136.5 to 308.6 of 445).
    const fit = () => {
      const t = word.querySelector('text'), ctx = document.createElement('canvas').getContext('2d');
      ctx.font = '800 1000px Orbitron';
      const m = ctx.measureText('ARCADE');
      const size = (308.6 - 136.5) / ((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 1000);
      t.setAttribute('font-size', size.toFixed(1));
      t.setAttribute('y', (308.6 - m.actualBoundingBoxDescent * size / 1000).toFixed(1));
      const b = t.getBBox();
      word.setAttribute('viewBox', `${b.x} 0 ${b.width} 445`);
    };
    document.fonts.load('800 20px Orbitron').then(fit, fit);
  }).catch(() => { /* the plain name is fine */ });

  // Shrinks once the page scrolls a little.
  let queued = false;
  const frame = () => { queued = false; bar.classList.toggle('docked', window.scrollY > 24); };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(frame); } }, { passive: true });
  frame();
})();

// Back, one screen at a time (2026-11-02). Inside a game, the top bar's back
// arrow and the phone's or browser's own Back (and the TV remote's Back, which
// the TV app turns into the browser's Back) go one screen back: from a game
// being played to that game's menu, and from the menu to the arcade. Leaving
// a game that's still going asks first.
//
// Each game says where it is once its script has loaded:
//
//   ArcadeBack.setup({
//     atMenu: () => true while on the game's first screen (its menu or setup),
//     back:   () => go one screen back (usually to the menu),
//     busy:   () => true if going back would end a game in progress,
//     pause:  () => optional, called before asking, so the game waits,
//     question: 'Leave this game?'   // optional, what to ask (or a function)
//   });
//
// How it works: whenever the game isn't on its menu, there's one extra entry
// in the browser's history for this page. Back uses that entry up, and this
// takes the game one screen back. If it's still not on the menu after that,
// the entry is put back, so the next Back works the same way. When the game
// goes back to its menu by itself (a "Back to setup" button), the entry is
// taken away again, so Back from the menu leaves for the arcade.
window.ArcadeBack = (() => {
  let cfg = null;
  let pushed = false;     // our extra history entry is there
  let skipPops = 0;       // history.back() calls we made ourselves
  let asking = false;
  const MARK = 'arcadeBack';
  const ours = s => !!(s && s[MARK]);
  const atMenu = () => { try { return !cfg || !!cfg.atMenu(); } catch { return true; } };

  function label() {
    const link = document.querySelector('.ah-back');
    if (!link) return;
    const inside = cfg && !atMenu();
    const span = link.querySelector('span');
    const text = inside ? 'Back' : 'Arcade';
    if (span && span.textContent !== text) span.textContent = text;
    const title = inside ? 'Back to this game\'s menu' : 'Back to the arcade';
    if (link.title !== title) { link.title = title; link.setAttribute('aria-label', title); }
  }

  // Keeps the extra history entry in step with the screen.
  function sync() {
    if (!cfg) return;
    const menu = atMenu();
    if (!menu && !pushed) {
      history.pushState({ ...(history.state || {}), [MARK]: 1 }, '');
      pushed = true;
    } else if (menu && pushed && !asking) {
      pushed = false;
      if (ours(history.state)) { skipPops++; history.back(); }
    }
    label();
  }

  // A yes-or-no question on the page itself. On a TV, the TV's own card
  // (the remote can answer it); elsewhere a card in the arcade's colors.
  function ask(text) {
    if (window.ArcadeTV && window.ArcadeTV.on) return window.ArcadeTV.confirm(text, { yes: 'Leave', no: 'Keep playing' });
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = 'ab-confirm';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,4,10,.78);backdrop-filter:blur(3px)';
      root.innerHTML = `
        <div style="width:100%;max-width:360px;background:#1e0e39;color:#f5eaff;border:2px solid #ff2ec4;border-radius:16px;padding:20px;box-shadow:0 0 30px rgba(255,46,196,.3);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center">
          <h2 data-q style="margin:0 0 14px;font-size:18px;line-height:1.35"></h2>
          <button data-stay style="display:block;width:100%;padding:12px;border:0;border-radius:10px;background:#00ffc2;color:#14082b;font-weight:800;font-size:15px;cursor:pointer">Keep playing</button>
          <button data-leave style="display:block;width:100%;margin-top:8px;padding:11px;border:1px solid #ff2ec4;border-radius:10px;background:transparent;color:#f5eaff;font-size:14px;font-weight:700;cursor:pointer">Leave</button>
        </div>`;
      root.querySelector('[data-q]').textContent = text;
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
      const done = ok => { root.remove(); document.removeEventListener('keydown', key, true); resolve(ok); };
      root.querySelector('[data-stay]').onclick = () => done(false);
      root.querySelector('[data-leave]').onclick = () => done(true);
      root.addEventListener('click', e => { if (e.target === root) done(false); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(root);
      root.querySelector('[data-stay]').focus();
    });
  }

  // One screen back. Our history entry has already been used up by now.
  async function stepBack() {
    if (asking || !cfg) return;
    let busy = false;
    try { busy = !!(cfg.busy && cfg.busy()); } catch { busy = false; }
    if (busy) {
      // Stay put while asking: the entry goes back, so a second Back while
      // the question is up doesn't leave the page.
      if (!pushed) { history.pushState({ ...(history.state || {}), [MARK]: 1 }, ''); pushed = true; }
      asking = true;
      try { if (cfg.pause) cfg.pause(); } catch { /* the question still comes up */ }
      let ok = false;
      const q = typeof cfg.question === 'function' ? cfg.question() : cfg.question;
      try { ok = await ask(q || 'Leave this game? It ends here and won\'t be saved.'); } finally { asking = false; }
      if (!ok) { label(); return; }
    }
    try { cfg.back(); } catch (e) { console.error(e); }
    // The screen may change a moment later (a fade, a server reply).
    sync();
    setTimeout(sync, 60);
  }

  // Back from here: use our history entry up if it's there (popstate then
  // calls stepBack), otherwise go back a screen straight away.
  function back() {
    if (!cfg || atMenu()) { location.href = '/'; return; }
    if (pushed && ours(history.state)) history.back();
    else stepBack();
  }

  window.addEventListener('popstate', () => {
    if (skipPops) { skipPops--; return; }
    if (!cfg || !pushed) return;
    pushed = false;
    // A Back while the question is up just answers it "keep playing".
    if (asking) { const stay = document.querySelector('.ab-confirm [data-stay], .tv-confirm .tv-btn'); if (stay) stay.click(); return; }
    stepBack();
  });

  // The top bar's back arrow: one screen back inside a game, the arcade from
  // its menu (the link's own address).
  document.addEventListener('click', e => {
    const link = e.target.closest && e.target.closest('.ah-back');
    if (!link || !cfg || atMenu() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    back();
  });

  // A remote or keyboard Back key that reaches the page. Escape counts only
  // on a TV, and only when the game didn't use it (to pause) and no dialog is up.
  window.addEventListener('keydown', e => {
    if (!cfg || e.defaultPrevented || e.repeat) return;
    const tv = document.documentElement.classList.contains('tv');
    if (!(e.key === 'GoBack' || e.key === 'BrowserBack' || (tv && e.key === 'Escape'))) return;
    if (document.querySelector('.ab-confirm, .tv-overlay') || atMenu()) return;
    e.preventDefault();
    back();
  });

  function setup(options) {
    cfg = options;
    // A reload while in a game leaves our old entry behind; step off it so a
    // single Back from the menu still leaves for the arcade.
    if (ours(history.state)) {
      if (atMenu()) { skipPops++; history.back(); } else pushed = true;
    }
    sync();
    // Screens change in many ways (buttons, timers, a friend's move), so
    // check after anything on the page changes, and now and then. (Checking
    // is cheap: a few class names. The history only changes when the screen does.)
    new MutationObserver(() => sync()).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-state'] });
    setInterval(sync, 400);
  }

  return { setup, sync, back, get inside() { return !!cfg && !atMenu(); } };
})();

// The end of a game pops up over the page instead of opening above the board
// and pushing everything down (the maintainer's call, 2026-11-07). Any game's
// end panel (.over-panel, or #overPanel) is lifted out of the page while it
// shows, with the page dimmed behind it. "Look at the game" puts it away so the
// final screen can be looked at, and a Results button brings it back. Nothing
// changes for the games themselves: they show and hide their panel as before.
// On a TV the panel keeps its place in the TV layout.
window.ArcadeEnd = (() => {
  if (document.documentElement.classList.contains('tv')) return null;
  const dim = document.createElement('div');
  dim.className = 'end-dim'; dim.hidden = true;
  const pill = document.createElement('button');
  pill.type = 'button'; pill.className = 'end-pill'; pill.textContent = '🏁 Results'; pill.hidden = true;
  document.body.append(dim, pill);
  let peeking = null;

  const panels = () => [...document.querySelectorAll('.over-panel, #overPanel')];
  const open = p => !p.classList.contains('hidden') && !p.hidden;
  function sync() {
    if (document.documentElement.classList.contains('tv')) return;
    let shown = null;
    // Only touch a class when it changes: this runs on every class change on the page.
    const set = (e, c, on) => { if (e.classList.contains(c) !== on) e.classList.toggle(c, on); };
    panels().forEach(p => {
      set(p, 'end-pop', true);
      if (!p.querySelector('.end-peek')) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ghost end-peek'; b.textContent = 'Look at the game';
        b.addEventListener('click', () => { peeking = p; sync(); });
        p.append(b);
      }
      if (open(p)) shown = p;
    });
    if (!shown) peeking = null;
    const up = shown && peeking !== shown;
    panels().forEach(p => set(p, 'end-away', p === peeking));
    if (dim.hidden !== !up) dim.hidden = !up;
    const pillOff = !(shown && peeking === shown);
    if (pill.hidden !== pillOff) pill.hidden = pillOff;
  }
  pill.addEventListener('click', () => { peeking = null; sync(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dim.hidden) { const p = panels().find(open); if (p) { peeking = p; sync(); } } });
  new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  sync();
  return { sync };
})();
