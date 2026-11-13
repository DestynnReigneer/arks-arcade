/* mist.js: slow clouds of color drifting behind a page, through a logo, over a picture
   and through the lines of a menu button. One file, copied as-is into each app.

   How to use it (all optional, each one on its own):
     <script src="mist.js" defer></script>
     <body data-mist="whisper-medium">        page background: whisper-fast, whisper-medium or slow-glow
     <span class="mist-mask" style="--mist-src:url(logo.svg)"></span>   the picture's shape, filled with mist
     <span class="mist-tint" style="--mist-src:url(helm.svg)"><img src="helm.svg" alt=""></span>   mist washed over a picture
     <span class="mist-waffle"></span>          the nine-square menu symbol, its lines filled with mist
     <svg class="mist-stroke">...<text>...</text></svg>   outlined text whose outline is filled with mist

   Everything moves on one clock, pauses while the tab is hidden, and holds still when the
   device asks for less motion. The background moves only with transform, which the
   graphics chip does without repainting the page. */
(function () {
  'use strict';
  const PINK = [255, 46, 196], TEAL = [0, 255, 194], VIOLET = [138, 63, 252];
  // Each cloud wanders on two sine waves per direction at unrelated speeds, so it never
  // visibly repeats and never turns in a circle.
  const CLOUDS = [
    { c: PINK,   fx: [0.071, 0.113], fy: [0.089, 0.047], p: [0.0, 1.7, 2.9, 0.4] },
    { c: TEAL,   fx: [0.059, 0.131], fy: [0.077, 0.101], p: [2.1, 0.3, 1.1, 3.6] },
    { c: VIOLET, fx: [0.083, 0.041], fy: [0.061, 0.127], p: [4.0, 2.2, 0.7, 1.9] },
  ];
  const at = (k, t) => [50 + 38 * Math.sin(t * k.fx[0] + k.p[0]) + 22 * Math.sin(t * k.fx[1] + k.p[1]),
                        50 + 38 * Math.sin(t * k.fy[0] + k.p[2]) + 22 * Math.sin(t * k.fy[1] + k.p[3])];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  // The three page backgrounds: strength is the clouds' opacity, speed multiplies the clock.
  const PRESETS = { 'whisper-fast': [0.28, 2.4], 'whisper-medium': [0.28, 1.2], 'slow-glow': [0.6, 0.6] };

  const CSS = `
.mist-bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.mist-bg i { position: absolute; left: 50%; top: 50%; width: 90vmax; height: 90vmax; margin: -45vmax 0 0 -45vmax; border-radius: 50%; will-change: transform; }
.mist-bg i:nth-child(1) { background: radial-gradient(circle, ${rgba(PINK, .55)} 0%, ${rgba(PINK, .18)} 35%, ${rgba(PINK, 0)} 65%); }
.mist-bg i:nth-child(2) { background: radial-gradient(circle, ${rgba(TEAL, .42)} 0%, ${rgba(TEAL, .14)} 35%, ${rgba(TEAL, 0)} 65%); }
.mist-bg i:nth-child(3) { background: radial-gradient(circle, ${rgba(VIOLET, .6)} 0%, ${rgba(VIOLET, .2)} 35%, ${rgba(VIOLET, 0)} 65%); }
.mist-mask, .mist-waffle { display: inline-block; position: relative; flex: none; }
.mist-mask .mist-ink, .mist-waffle .mist-ink, .mist-tint .mist-ink { position: absolute; inset: 0;
  -webkit-mask: var(--mist-src) center / 100% 100% no-repeat; mask: var(--mist-src) center / 100% 100% no-repeat; }
.mist-mask .mist-ink { background-color: #7a2fd0; }
.mist-waffle .mist-ink { background-color: #5a2aa8; }
.mist-waffle .mist-glow { position: absolute; inset: 0; filter: blur(2.5px); opacity: .7; }
.mist-tint { display: inline-block; position: relative; flex: none; }
.mist-tint > img { display: block; width: 100%; height: 100%; }
.mist-tint .mist-ink { opacity: .75; mix-blend-mode: color; }
`;

  // The waffle: its outline (4-unit corners in a 30-unit box) and nine sharp squares,
  // lines only. The outline is about 1px on screen and the squares 0.72 of that.
  function waffleSrc(px) {
    const s = 30, sw = Math.max(1, s / px) * 1.05, thin = sw * 0.72, grid = 19, gap = 2.3;
    const cell = (grid - gap * 2) / 3, start = (s - grid) / 2;
    let sq = '';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      sq += `<rect x="${(start + c * (cell + gap)).toFixed(3)}" y="${(start + r * (cell + gap)).toFixed(3)}" width="${cell.toFixed(3)}" height="${cell.toFixed(3)}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><g fill="none" stroke="#fff">` +
      `<rect stroke-width="${sw.toFixed(2)}" x="${sw / 2}" y="${sw / 2}" width="${s - sw}" height="${s - sw}" rx="4"/>` +
      `<g stroke-width="${thin.toFixed(2)}">${sq}</g></g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  const inks = [];      // elements painted with the moving clouds
  const strokes = [];   // SVG circles inside outlined text
  let blobs = [], bgSpeed = 1;
  let uid = 0;

  function setUp(root) {
    root.querySelectorAll('.mist-waffle:not([data-mist-ready])').forEach(el => {
      el.dataset.mistReady = '1';
      const px = el.getBoundingClientRect().width || 30;
      el.style.setProperty('--mist-src', waffleSrc(px));
      el.innerHTML = '<span class="mist-glow"><span class="mist-ink"></span></span><span class="mist-ink"></span>';
      inks.push(...el.querySelectorAll('.mist-ink'));
    });
    root.querySelectorAll('.mist-mask:not([data-mist-ready]), .mist-tint:not([data-mist-ready])').forEach(el => {
      el.dataset.mistReady = '1';
      const ink = document.createElement('span'); ink.className = 'mist-ink'; el.appendChild(ink); inks.push(ink);
    });
    root.querySelectorAll('svg.mist-stroke:not([data-mist-ready])').forEach(svg => {
      svg.dataset.mistReady = '1';
      const vb = (svg.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
      const NS = 'http://www.w3.org/2000/svg', pid = 'mistp' + (++uid);
      let defs = svg.querySelector('defs');
      if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
      const r = Math.max(vb[2], vb[3]) * 0.45;
      let html = `<pattern id="${pid}" patternUnits="userSpaceOnUse" x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}">` +
        `<rect width="${vb[2]}" height="${vb[3]}" fill="#7a2fd0"/>`;
      CLOUDS.forEach((k, i) => {
        defs.insertAdjacentHTML('beforeend', `<radialGradient id="${pid}g${i}"><stop offset="0" stop-color="${rgba(k.c, 1)}"/>` +
          `<stop offset=".45" stop-color="${rgba(k.c, .8)}"/><stop offset="1" stop-color="${rgba(k.c, 0)}"/></radialGradient>`);
        html += `<circle r="${r}" fill="url(#${pid}g${i})"/>`;
      });
      defs.insertAdjacentHTML('beforeend', html + '</pattern>');
      const pat = defs.querySelector('#' + pid);
      pat.querySelectorAll('circle').forEach((c, i) => strokes.push({ c, k: CLOUDS[i], w: vb[2], h: vb[3] }));
      svg.querySelectorAll('text, path, rect:not(pattern rect)').forEach(n => { if (!n.closest('defs')) n.setAttribute('stroke', `url(#${pid})`); });
    });
  }

  function background() {
    const preset = PRESETS[document.body.dataset.mist];
    if (!preset || document.querySelector('.mist-bg')) return;
    const bg = document.createElement('div'); bg.className = 'mist-bg'; bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<i></i><i></i><i></i>';
    bg.style.opacity = preset[0]; bgSpeed = preset[1];
    // The clouds sit just under the page. If the page paints its background on <body>
    // (and <html> has one of its own), body's would cover them, so it moves down to
    // <html> and body goes see-through. Nothing looks different except the mist showing.
    const b = getComputedStyle(document.body), h = document.documentElement.style;
    if (b.backgroundImage !== 'none' || b.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      for (const p of ['backgroundColor', 'backgroundImage', 'backgroundAttachment', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']) h[p] = b[p];
      document.body.style.background = 'transparent';
    }
    document.body.prepend(bg); blobs = [...bg.children];
  }

  function paint(fast, slow) {
    if (inks.length) {
      const img = CLOUDS.map(k => { const [x, y] = at(k, fast);
        return `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, ${rgba(k.c, 1)} 0%, ${rgba(k.c, .8)} 22%, ${rgba(k.c, 0)} 48%)`; }).join(',');
      for (const n of inks) n.style.backgroundImage = img;
    }
    for (const s of strokes) { const [x, y] = at(s.k, fast);
      s.c.setAttribute('cx', (x / 100 * s.w).toFixed(1)); s.c.setAttribute('cy', (y / 100 * s.h).toFixed(1)); }
    blobs.forEach((b, i) => { const [x, y] = at(CLOUDS[i], slow);
      b.style.transform = `translate(${((x - 50) * 0.9).toFixed(2)}vw, ${((y - 50) * 0.9).toFixed(2)}vh)`; });
  }

  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  let fast = 7, slow = 3, last = null, running = false;
  function frame(now) {
    if (document.hidden || (still && still.matches)) { running = false; last = null; return; }
    if (last !== null) { const d = Math.min(0.1, (now - last) / 1000); fast += d * 4; slow += d * bgSpeed; }
    last = now; paint(fast, slow); requestAnimationFrame(frame);
  }
  function go() { paint(fast, slow); if (!running && !document.hidden && !(still && still.matches)) { running = true; requestAnimationFrame(frame); } }

  function start() {
    // A page with a strict style policy links mist.css (the same rules) instead.
    if (!document.querySelector('link[href$="mist.css"]')) {
      const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    }
    background(); setUp(document); go();
    document.addEventListener('visibilitychange', go);
    if (still && still.addEventListener) still.addEventListener('change', go);
    // Pieces added later (a top bar built by script, a menu opened) join in on their own,
    // checked at most once a frame however busy the page is.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; setUp(document); background(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  window.Mist = { refresh: () => setUp(document) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
