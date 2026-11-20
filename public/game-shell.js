'use strict';

// The parts every single-player arcade game shares: the end of a run (the
// shared end window, end-window.js, which saves the score by itself), the
// high-score list (with a tab per board), a personal best kept on the device,
// and an on-screen pause. Snake, Brick Breaker, Block Drop, Tower Defense and
// the 3D cabinet games use it; each game only draws and plays.
//
//   const shell = GameShell.create({
//     game: 'snake', boards: { classic: 'Classic', wrap: 'Wrap' },
//     onAgain: reset,
//     onSetup: toSetup,               // Back to setup (left out when a game has nothing to set up)
//   });
//   shell.over({ score, board: 'classic', detail: '42 apples', title: 'Game over', delay: 600 });
//   (lost: the game's own line when the run ends without a personal best; cardDetail: a line for the
//   end window when it should read differently from the detail kept on the board)
//   shell.openScores('classic');      // the header's 🏆
//   shell.best('classic')            // this device's best on that board

const GameShell = (() => {
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // format: how a score reads (a time, say); lowerIsBetter: the best score is the smallest (a race time).
  function create({ game, boards, onAgain, onSetup, againLabel, format, lowerIsBetter = false }) {
    const fmt = format || (n => n.toLocaleString('en-US'));
    const boardIds = Object.keys(boards);
    const bestKey = board => `${game}.best.${board}`;
    const best = board => { try { return Number(localStorage.getItem(bestKey(board))) || 0; } catch { return 0; } };

    // ---- the end of a run ---------------------------------------------------------------------
    // extra: one more button (Tower Defense's Next level). saving: a save the game already
    // started itself (Tower Defense's All levels board), shown instead of saving again.
    function showOver({ score, board = boardIds[0], detail = '', cardDetail, title, lost, delay = 0, extra, saving }) {
      // Only in the browser tests (navigator.webdriver): a run that ends with this score instead.
      if (navigator.webdriver && window.ShellTest && Number.isFinite(window.ShellTest.score)) score = window.ShellTest.score;
      score = Math.max(0, Math.round(score));
      const was = best(board), isBest = lowerIsBetter ? score > 0 && (!was || score < was) : score > was;
      if (isBest) { try { localStorage.setItem(bestKey(board), String(score)); } catch { /* private mode */ } }
      const where = board === 'all' && boards.all ? 'on the All levels board' : boardIds.length > 1 ? `on ${boards[board]}` : 'on the board';
      const save = saving ? () => saving.then(r => ({ rank: r.rank, id: r.id, where }))
        : score > 0 ? async who => {
          const r = await ArcadeKit.saveScore(game, { ...who, score, board, detail: detail || '' });
          return { rank: r.rank, id: r.id, where };
        } : null;
      ArcadeEnd.show({
        title: title || (isBest && score > 0 ? 'New personal best! 🎉' : lost || 'Game over'),
        score: fmt(score), detail: cardDetail !== undefined ? cardDetail : detail, delay, save,
        noSave: 'Score... and well, get on the board.',
        scores: ArcadeEnd.sharedBoard(game, boards, board, format),
        again: () => onAgain(), againLabel,
        setup: onSetup ? () => onSetup() : null,
        extra
      });
      document.body.dataset.state = 'over';
    }
    function hideOver() { ArcadeEnd.clear(); }
    // Only in the browser tests: end the run now, as the game would.
    if (navigator.webdriver) window.ShellTest = Object.assign(window.ShellTest || {}, { over: o => showOver(o) });

    // ---- high scores, from the header's 🏆 -------------------------------------------------------
    const scores = el(`
      <div class="overlay hidden" role="dialog" aria-label="High scores">
        <div class="card-panel">
          <h2>🏆 High scores</h2>
          <div class="seg board-tabs"></div>
          <ul class="scores"></ul>
          <p class="hint center my-best"></p>
          <div class="stack"><button class="ghost close-btn">Close</button></div>
        </div>
      </div>`);
    document.body.appendChild(scores);
    const tabs = scores.querySelector('.board-tabs');
    if (boardIds.length < 2) tabs.remove();
    function openScores(board = boardIds[0], highlightId) {
      tabs.innerHTML = '';
      for (const id of boardIds) {
        const b = document.createElement('button');
        b.textContent = boards[id];
        b.setAttribute('aria-pressed', String(id === board));
        b.onclick = () => openScores(id);
        tabs.appendChild(b);
      }
      const mine = best(board);
      scores.querySelector('.my-best').textContent = mine ? `Your best on this device: ${fmt(mine)}` : '';
      ArcadeKit.loadScores(game, board, scores.querySelector('.scores'), highlightId, undefined, fmt);
      scores.classList.remove('hidden');
    }
    scores.querySelector('.close-btn').addEventListener('click', () => scores.classList.add('hidden'));
    scores.addEventListener('click', e => { if (e.target === scores) scores.classList.add('hidden'); });

    return { over: showOver, hideOver, openScores, best, get isOver() { return ArcadeEnd.has; } };
  }

  // Swipes on an element: calls onSwipe('up' | 'down' | 'left' | 'right') and
  // onTap() for a short press that didn't move.
  function swipes(target, { onSwipe, onTap, min = 24 } = {}) {
    let start = null;
    target.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    target.addEventListener('pointerup', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const far = Math.max(Math.abs(dx), Math.abs(dy));
      if (far >= min) onSwipe && onSwipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      else if (performance.now() - start.t < 400) onTap && onTap();
      start = null;
    });
    target.addEventListener('pointercancel', () => { start = null; });
  }

  // A canvas that fills its box sharply on any screen. draw(ctx, w, h) gets
  // CSS pixels; aspect is width / height (null = fill the box). maxHeight can
  // be a number or a function (checked on every resize).
  //
  // No scrolling while you play (2026-11-13): the board is never taller than the
  // room between its top and the bottom of the screen, after whatever sits under it
  // (the thumb buttons), so the whole game fits without scrolling.
  // fitScreen: 'phone' fits the board to the screen only under 900px wide (a game
  // whose controls under the board are too tall to share a laptop's height).
  function fitCanvas(canvas, { aspect = null, maxHeight = Infinity, fitScreen = true } = {}) {
    const ctx = canvas.getContext('2d');
    const box = canvas.parentElement;
    const size = { w: 0, h: 0 };
    function room() {
      const top = box.getBoundingClientRect().top + window.scrollY;
      let below = 0;
      const across = box.getBoundingClientRect();
      for (let n = box.nextElementSibling; n; n = n.nextElementSibling) {
        const cs = getComputedStyle(n);
        if (n.tagName === 'SCRIPT' || cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute') continue;
        // Something beside the board (a phone turned sideways) doesn't take its height.
        const r = n.getBoundingClientRect();
        if (r.left >= across.right || r.right <= across.left) continue;
        below += n.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      }
      const frame = box.offsetHeight - box.clientHeight;   // the stage's own border
      const bodyEnd = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;   // the page's own bottom padding
      // The height you can really see (a browser bar can cover the bottom of the page
      // without making it shorter; topbar.js says more), unless someone has zoomed in.
      const vv = window.visualViewport;
      const seen = vv && Math.abs(vv.scale - 1) < 0.01 ? Math.min(window.innerHeight, vv.height) : window.innerHeight;
      return seen - top - below - frame - bodyEnd - 8;
    }
    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      let w = box.clientWidth;
      let h = aspect ? w / aspect : box.clientHeight;
      // On the TV the box is the whole right side of the screen (tv-play.css):
      // as tall as that, not a share of the window like on a phone.
      const asked = typeof maxHeight === 'function' ? maxHeight() : maxHeight;
      const fits = fitScreen === true || (fitScreen === 'phone' && window.innerWidth < 900);
      const mh = box.closest('.tv-stage') ? box.clientHeight : fits ? Math.max(220, Math.min(asked, room())) : asked;
      if (h > mh) { h = mh; if (aspect) w = h * aspect; }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size.w = w; size.h = h;
    }
    new ResizeObserver(resize).observe(box);
    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    // Starting and ending a game shows and hides things around the board.
    new MutationObserver(() => requestAnimationFrame(resize)).observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
    resize();
    return { ctx, size, resize };
  }

  return { create, swipes, fitCanvas };
})();
