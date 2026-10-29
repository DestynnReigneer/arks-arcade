'use strict';

// The top bar on every game page (2026-10-29), the same bar as the home page
// and as the maintainer's other apps: a way back to the arcade on the left,
// the arcade's name (or the owner's logo lockup) in the middle, and How to
// play and Admin on the right. It shrinks once the page scrolls. The game's
// own header stays under it, minus its back arrow, which the bar replaces.
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
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
