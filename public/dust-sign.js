'use strict';

// The "Pardon our dust" sign for games the admin has turned off: a wooden
// plank hanging from a nail on a string. The home page hangs it on the
// game's tile; a game page that's turned off shows it in place of the game,
// so an old link or bookmark doesn't drop anyone into a half-working game.
//
//   DustSign.el()            a new sign element
//   DustSign.message(id)     "Chess is getting some work done. Check back soon!"
//
// On a game page (not the home page) it checks /api/arcade-info by itself.
(() => {
  const LABELS = {
    wordless: 'Wordless', rambler: 'Rambler', spinsolve: 'Spin & Solve', chess: 'Chess', dino: 'Dino Dash',
    trivia: 'Know-It-All', partdeux: 'Uh-Oh: Part Deux', daredevil: 'Dare Devil', snake: 'Snake',
    bricks: 'Brick Breaker', blocks: 'Block Drop', towers: 'Tower Defense'
  };

  const css = `
  .dust-sign { position: absolute; left: 50%; top: 6px; transform: translateX(-50%); width: 210px; height: 128px; z-index: 2; pointer-events: none; }
  .dust-sign .nail { position: absolute; left: 50%; top: 0; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #e8e8ee, #8a8a96 60%, #3a3a44); box-shadow: 0 1px 2px rgba(0,0,0,.6); z-index: 3; }
  .dust-sign svg { position: absolute; left: 0; top: 4px; width: 210px; height: 50px; overflow: visible; }
  .dust-sign .plank { position: absolute; left: 10px; right: 10px; top: 40px; padding: 12px 10px 11px; border-radius: 7px;
    transform: rotate(-4deg); transform-origin: 50% 0;
    background:
      repeating-linear-gradient(176deg, rgba(0,0,0,0) 0 7px, rgba(60,30,10,.18) 7px 8px, rgba(0,0,0,0) 8px 15px),
      linear-gradient(180deg, #b77a43, #9a6233 55%, #84522a);
    border: 2px solid #5b3418; box-shadow: 0 6px 14px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,220,170,.35);
    text-align: center; color: #2e1806; text-shadow: 0 1px 0 rgba(255,214,160,.35); }
  .dust-sign .plank::before, .dust-sign .plank::after { content: ''; position: absolute; top: 7px; width: 6px; height: 6px; border-radius: 50%;
    background: #4a2a12; box-shadow: inset 0 1px 1px rgba(0,0,0,.6); }
  .dust-sign .plank::before { left: 8px; } .dust-sign .plank::after { right: 8px; }
  .dust-sign b { display: block; font: 800 15px/1.1 Orbitron, var(--font, system-ui), sans-serif; letter-spacing: .06em; }
  .dust-sign span { display: block; margin-top: 4px; font: 700 12px/1.2 var(--font, system-ui), sans-serif; letter-spacing: .08em; text-transform: uppercase; }
  .dust-page { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px;
    background: #170a2e; color: #f5eaff; font-family: var(--font, system-ui), sans-serif; text-align: center; }
  .dust-page .dust-box { position: relative; padding-top: 150px; max-width: 340px; }
  .dust-page p { margin: 0 0 16px; font-size: 16px; line-height: 1.5; }
  .dust-page a { display: inline-block; padding: 11px 18px; border-radius: 10px; background: #ff2ec4; color: #170a2e; font-weight: 700; text-decoration: none; }`;

  function addStyles() {
    if (document.getElementById('dustSignCss')) return;
    const s = document.createElement('style');
    s.id = 'dustSignCss';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // The string runs from the nail to the two holes in the tilted plank.
  function el() {
    addStyles();
    const sign = document.createElement('div');
    sign.className = 'dust-sign';
    sign.setAttribute('aria-hidden', 'true');
    sign.innerHTML = '<div class="nail"></div>' +
      '<svg viewBox="0 0 210 50"><path d="M105 2 L24 50 M105 2 L184 39" stroke="#c9b48a" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' +
      '<div class="plank"><b>PARDON OUR DUST</b><span>Under construction</span></div>';
    return sign;
  }

  const message = id => `${LABELS[id] || 'This game'} is getting some work done. Check back soon!`;

  // A game page that's turned off: cover it with the sign and a way home.
  async function guardPage() {
    const id = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    if (!LABELS[id]) return;
    try {
      const info = await (await fetch('/api/arcade-info')).json();
      if (!info.games || !(info.games.closed || []).includes(id)) return;
      addStyles();
      const page = document.createElement('div');
      page.className = 'dust-page';
      page.innerHTML = '<div class="dust-box"><p></p><a href="./">Back to the arcade</a></div>';
      page.querySelector('.dust-box').prepend(el());
      page.querySelector('p').textContent = message(id);
      document.body.appendChild(page);
    } catch { /* can't tell, so let them play */ }
  }

  window.DustSign = { el, message };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guardPage);
  else guardPage();
})();
