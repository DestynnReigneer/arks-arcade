'use strict';

// The feedback bug: a tiny pixel bug in the bottom-right corner of every page.
// Tap it and "Found a bug? Tell us." pops out for a few seconds; tap that and
// the feedback card opens. The card takes a paragraph or two, what kind of
// feedback it is and which game, an optional screenshot (snap this page, or
// upload one), and lets you draw on the screenshot with a pen, a box or an
// arrow before sending. It lands in the Comm Center inbox on the admin page
// (arcade/comm.js).
//
//   ArcadeFeedback.open()   opens the card directly (the home page's Send
//                           feedback button and the /feedback cheat code)
//
// "Snap this page" uses html-to-image, served by the arcade itself from
// /vendor, and only loaded the first time someone snaps.
(() => {
  const RED = '#e52521', GREEN = '#43b047', INK = '#ff2ec4';
  const MAX_W = 1280;            // a screenshot is scaled down to this width
  const TIP_MS = 4000;           // how long the bubble stays out

  const BUG = ['..L......L..', '...L....L...', '....KKKK....', '...KWKKWK...', 'L..KKKKKK..L', '.LTTTDTTTTL.',
    '..TDTTDTDT..', 'LLTTTDTTTTLL', '..TTDTTDTT..', '.LTTTDTTDTL.', 'L..TTDTTT..L', '....TTTT....'];
  const PAL = { T: RED, D: GREEN, K: '#12111c', W: '#ffffff', L: '#8fa3c7' };
  const GAMES = {
    wordless: 'Wordless', rambler: 'Rambler', spinsolve: 'Spin & Solve', chess: 'Chess', dino: 'Dino Dash',
    trivia: 'Know-It-All', partdeux: 'Uh-Oh: Part Deux', daredevil: 'Dare Devil', snake: 'Snake',
    bricks: 'Brick Breaker', blocks: 'Block Drop', towers: 'Tower Defense'
  };
  const KINDS = [['issue', '🐛 Something\'s broken'], ['feature', '💡 Feature idea'], ['message', '💬 Message']];
  // The game this page belongs to, if any: rambler.html is Rambler.
  const pageGame = () => {
    const id = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    return GAMES[id] ? id : '';
  };

  const css = `
  .fb-root, .fb-root * { box-sizing: border-box; }
  .fb-bug { position: fixed; right: 4px; bottom: 4px; width: 32px; height: 32px; padding: 10px; z-index: 900; border: 0; background: none;
    cursor: pointer; filter: drop-shadow(0 0 3px rgba(229,37,33,.6)); animation: fbWander 9s steps(1) infinite; -webkit-tap-highlight-color: transparent; }
  .fb-bug svg { width: 100%; height: 100%; display: block; }
  .fb-bug:hover, .fb-bug:focus-visible { animation-play-state: paused; outline: none; transform: scale(1.25); }
  @keyframes fbWander { 0%, 70% { translate: 0 0; } 74% { translate: -4px 0; } 78% { translate: -6px -2px; } 82% { translate: -3px -1px; } 86%, 100% { translate: 0 0; } }
  .fb-tip { position: fixed; right: 40px; bottom: 7px; z-index: 900; padding: 7px 11px; border-radius: 9px; background: #22103f; color: #f5eaff;
    border: 1px solid ${RED}; font: 600 13px/1.2 system-ui, sans-serif; white-space: nowrap; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.5);
    opacity: 0; transform: translateX(8px); pointer-events: none; transition: opacity .2s ease, transform .2s ease; }
  .fb-tip::after { content: ''; position: absolute; right: -6px; top: 50%; margin-top: -5px; border: 5px solid transparent; border-left-color: ${RED}; border-right: 0; }
  .fb-tip.show { opacity: 1; transform: none; pointer-events: auto; }
  @media (prefers-reduced-motion: reduce) { .fb-bug { animation: none; } .fb-tip { transition: none; } }

  .fb-veil { position: fixed; inset: 0; z-index: 2147482000; display: flex; align-items: center; justify-content: center; padding: 12px;
    background: rgba(5,4,10,.82); font: 15px/1.45 system-ui, sans-serif; color: #f5eaff; }
  .fb-card { width: 100%; max-width: 560px; max-height: 94vh; overflow-y: auto; background: #170a2e; border: 1px solid #3d2a63; border-radius: 14px; padding: 16px; }
  .fb-card h2 { margin: 0 0 4px; font-size: 18px; }
  .fb-card p { margin: 0 0 10px; color: #c9b8e6; font-size: 13px; }
  .fb-card textarea, .fb-card select, .fb-card input[type=text] { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #3d2a63;
    background: #0a0416; color: #f5eaff; font: inherit; }
  .fb-card textarea { min-height: 110px; resize: vertical; }
  .fb-card label { display: block; margin: 10px 0 4px; font-size: 12px; color: #c9b8e6; }
  .fb-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .fb-row > button { flex: 1 1 auto; }
  .fb-card button { padding: 10px 12px; border-radius: 10px; border: 1px solid #3d2a63; background: #22103f; color: #f5eaff; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  .fb-card button[aria-pressed="true"] { border-color: ${INK}; color: ${INK}; }
  .fb-card button.fb-send { background: ${INK}; border-color: ${INK}; color: #170a2e; }
  .fb-card button:disabled { opacity: .45; cursor: default; }
  .fb-shot { margin-top: 10px; }
  .fb-shot canvas { display: block; width: 100%; height: auto; border-radius: 8px; border: 1px solid #3d2a63; touch-action: none; cursor: crosshair; background: #000; }
  .fb-msg { min-height: 20px; margin-top: 8px; font-size: 13px; color: #ffd23f; }
  .fb-hidden { display: none !important; }`;

  function addStyles() {
    if (document.getElementById('fbCss')) return;
    const s = document.createElement('style');
    s.id = 'fbCss';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function bugSvg() {
    let rects = '';
    BUG.forEach((row, y) => [...row].forEach((ch, x) => {
      if (PAL[ch]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PAL[ch]}"/>`;
    }));
    return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // ---- the bug and its bubble ------------------------------------------------------
  let tip, tipTimer;
  function placeBug() {
    addStyles();
    const root = document.createElement('div');
    root.className = 'fb-root fb-corner';
    const bug = document.createElement('button');
    bug.type = 'button';
    bug.className = 'fb-bug';
    bug.setAttribute('aria-label', 'A little bug. Tap it.');
    bug.innerHTML = bugSvg();
    tip = document.createElement('button');
    tip.type = 'button';
    tip.className = 'fb-tip';
    tip.textContent = 'Found a bug? Tell us.';
    tip.tabIndex = -1;
    bug.onclick = () => {
      clearTimeout(tipTimer);
      tip.classList.add('show');
      tip.tabIndex = 0;
      tipTimer = setTimeout(hideTip, TIP_MS);
    };
    tip.onclick = () => { hideTip(); open(); };
    root.append(tip, bug);
    document.body.appendChild(root);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tip.classList.remove('show');
    tip.tabIndex = -1;
  }

  // ---- the card ----------------------------------------------------------------------
  let veil = null;
  const shot = { base: null, shapes: [], tool: 'pen', drawing: null };

  function open() {
    addStyles();
    if (veil) { veil.classList.remove('fb-hidden'); return; }
    veil = document.createElement('div');
    veil.className = 'fb-root fb-veil';
    veil.innerHTML = `
      <div class="fb-card" role="dialog" aria-modal="true" aria-labelledby="fbTitle">
        <h2 id="fbTitle">🐞 Tell us what happened</h2>
        <p>It goes straight to whoever runs this arcade. A screenshot helps, and you can draw on it to point at the problem.</p>
        <div class="fb-row" data-kinds></div>
        <label for="fbGamePick">Which game?</label>
        <select id="fbGamePick"><option value="">The whole arcade</option></select>
        <label for="fbText">What happened, and what did you expect instead?</label>
        <textarea id="fbText" maxlength="2000" placeholder="For example: I tapped Play again and nothing happened."></textarea>
        <div data-from-row>
          <label for="fbFromName">Your name (optional)</label>
          <input type="text" id="fbFromName" maxlength="30" autocomplete="off">
        </div>
        <div class="fb-row">
          <button type="button" data-snap>📸 Snap this page</button>
          <button type="button" data-upload>🖼️ Upload a picture</button>
          <input type="file" accept="image/png,image/jpeg" class="fb-hidden" data-file>
        </div>
        <div class="fb-shot fb-hidden">
          <canvas></canvas>
          <div class="fb-row">
            <button type="button" data-tool="pen" aria-pressed="true">✏️ Pen</button>
            <button type="button" data-tool="box" aria-pressed="false">⬜ Box</button>
            <button type="button" data-tool="arrow" aria-pressed="false">➡️ Arrow</button>
          </div>
          <div class="fb-row">
            <button type="button" data-undo>↶ Undo</button>
            <button type="button" data-clear>Clear drawing</button>
            <button type="button" data-drop>Remove picture</button>
          </div>
        </div>
        <div class="fb-msg" aria-live="polite"></div>
        <div class="fb-row">
          <button type="button" data-cancel>Cancel</button>
          <button type="button" class="fb-send" data-send>Send</button>
        </div>
      </div>`;
    document.body.appendChild(veil);
    const q = sel => veil.querySelector(sel);
    // What kind of feedback, and which game (the one this page is, if any).
    for (const [kind, label] of KINDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.kind = kind;
      b.textContent = label;
      b.setAttribute('aria-pressed', String(kind === 'issue'));
      b.onclick = () => { for (const x of q('[data-kinds]').children) x.setAttribute('aria-pressed', String(x === b)); };
      q('[data-kinds]').appendChild(b);
    }
    for (const [id, label] of Object.entries(GAMES)) q('#fbGamePick').add(new Option(label, id));
    q('#fbGamePick').value = pageGame();
    // A profile's name comes with its token; a guest can add one.
    const profile = typeof ArcadeProfile !== 'undefined' ? ArcadeProfile : null;
    if (profile && profile.token()) q('[data-from-row]').classList.add('fb-hidden');
    else if (profile) q('#fbFromName').value = profile.name();
    q('[data-cancel]').onclick = close;
    veil.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    q('[data-snap]').onclick = snap;
    q('[data-upload]').onclick = () => q('[data-file]').click();
    q('[data-file]').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); };
    for (const b of veil.querySelectorAll('[data-tool]')) {
      b.onclick = () => {
        shot.tool = b.dataset.tool;
        for (const x of veil.querySelectorAll('[data-tool]')) x.setAttribute('aria-pressed', String(x === b));
      };
    }
    q('[data-undo]').onclick = () => { shot.shapes.pop(); redraw(); };
    q('[data-clear]').onclick = () => { shot.shapes = []; redraw(); };
    q('[data-drop]').onclick = () => { shot.base = null; shot.shapes = []; q('.fb-shot').classList.add('fb-hidden'); };
    q('[data-send]').onclick = send;
    wireDrawing(q('canvas'));
    q('#fbText').focus();
  }

  function close() {
    if (!veil) return;
    veil.remove();
    veil = null;
    shot.base = null;
    shot.shapes = [];
  }

  const say = text => { if (veil) veil.querySelector('.fb-msg').textContent = text; };

  // ---- getting a picture -------------------------------------------------------------
  function loadLibrary() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/html-to-image/html-to-image.js';
      s.onload = () => resolve(window.htmlToImage);
      s.onerror = () => reject(new Error('Could not load the snapshot tool.'));
      document.head.appendChild(s);
    });
  }

  // A picture of what's on screen right now, with the card and the bug left
  // out. The whole page is drawn, then cut down to the part in view.
  async function snap() {
    say('Taking a picture of the page…');
    veil.classList.add('fb-hidden');
    try {
      const lib = await loadLibrary();
      const bg = getComputedStyle(document.body).backgroundColor;
      const full = await lib.toCanvas(document.body, {
        pixelRatio: 1,
        // Web fonts would have to be fetched from outside the arcade, which its
        // security rules don't allow; the picture uses the fonts on hand.
        skipFonts: true,
        // An image that can't be fetched (say, an optional custom picture
        // that isn't there) becomes a blank spot instead of failing the snap.
        imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#12111c',
        // Leave out the card and the bug, and any picture with no address yet
        // (an empty one would make the snapshot fail).
        filter: n => !(n.classList && n.classList.contains('fb-root')) && !(n.tagName === 'IMG' && !n.getAttribute('src'))
      });
      const top = document.body.getBoundingClientRect().top;
      const view = document.createElement('canvas');
      view.width = Math.min(innerWidth, full.width);
      view.height = Math.min(innerHeight, full.height);
      view.getContext('2d').drawImage(full, 0, -top, view.width, view.height, 0, 0, view.width, view.height);
      useImage(view);
      say('Got it. Draw on it to point at the problem, if that helps.');
    } catch (e) {
      say(`The snapshot didn't work (${e.message}). You can take a screenshot yourself and upload it instead.`);
    } finally {
      if (veil) veil.classList.remove('fb-hidden');
    }
  }

  // An uploaded file is drawn onto a canvas, which also re-encodes it, so only
  // a clean picture is ever sent.
  function upload(file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return say('Pick a PNG or JPEG picture.');
    if (file.size > 20 * 1024 * 1024) return say('That picture is too big. Try a smaller one.');
    // Read as a data: address, which the arcade's security rules allow.
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => { useImage(img); say('Got it. Draw on it to point at the problem, if that helps.'); };
      img.onerror = () => say('That picture could not be opened. Try another one.');
      img.src = reader.result;
    };
    reader.onerror = () => say('That picture could not be opened. Try another one.');
    reader.readAsDataURL(file);
  }

  function useImage(src) {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const scale = Math.min(1, MAX_W / w);
    const base = document.createElement('canvas');
    base.width = Math.round(w * scale);
    base.height = Math.round(h * scale);
    base.getContext('2d').drawImage(src, 0, 0, base.width, base.height);
    shot.base = base;
    shot.shapes = [];
    const canvas = veil.querySelector('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    veil.querySelector('.fb-shot').classList.remove('fb-hidden');
    redraw();
  }

  // ---- drawing -----------------------------------------------------------------------
  function wireDrawing(canvas) {
    const at = e => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
    };
    canvas.addEventListener('pointerdown', e => {
      if (!shot.base) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* keeps drawing without it */ }
      const p = at(e);
      shot.drawing = { tool: shot.tool, points: [p, p] };
      shot.shapes.push(shot.drawing);
      redraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (!shot.drawing) return;
      const p = at(e);
      if (shot.drawing.tool === 'pen') shot.drawing.points.push(p);
      else shot.drawing.points[1] = p;
      redraw();
    });
    const stop = () => { shot.drawing = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  function redraw() {
    if (!veil || !shot.base) return;
    const canvas = veil.querySelector('canvas');
    const g = canvas.getContext('2d');
    g.drawImage(shot.base, 0, 0);
    const line = Math.max(3, Math.round(canvas.width / 220));
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineWidth = line;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of shot.shapes) {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]];
      g.beginPath();
      if (s.tool === 'pen') {
        s.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      } else if (s.tool === 'box') {
        g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else {
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        const ang = Math.atan2(b.y - a.y, b.x - a.x), head = line * 5;
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
        g.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
        g.closePath();
        g.fill();
      }
    }
  }

  // ---- sending -----------------------------------------------------------------------
  async function send() {
    const text = veil.querySelector('#fbText').value.trim();
    if (!text) return say('Write a line or two about what happened first.');
    const btn = veil.querySelector('[data-send]');
    btn.disabled = true;
    say('Sending…');
    try {
      const picture = shot.base ? veil.querySelector('canvas').toDataURL('image/jpeg', 0.85) : null;
      const profile = typeof ArcadeProfile !== 'undefined' ? ArcadeProfile : null;
      const kind = veil.querySelector('[data-kinds] [aria-pressed="true"]').dataset.kind;
      const res = await fetch('/api/comm/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, message: text, picture,
          game: veil.querySelector('#fbGamePick').value || null,
          from: veil.querySelector('#fbFromName').value,
          profileToken: profile ? profile.token() : null,
          details: { page: location.pathname, screen: `${innerWidth}x${innerHeight}` }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sending did not work. Try again in a moment.');
      veil.querySelector('.fb-card').innerHTML =
        '<h2>📡 Thanks! Message received.</h2><p>Whoever runs this arcade will see it on the admin page.</p><div class="fb-row"><button type="button" data-done>Close</button></div>';
      veil.querySelector('[data-done]').onclick = close;
      veil.querySelector('[data-done]').focus();
    } catch (e) {
      say(e.message);
      btn.disabled = false;
    }
  }

  window.ArcadeFeedback = { open };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', placeBug);
  else placeBug();
})();
