'use strict';

// The parts every single-player arcade game shares: the game-over panel with
// "save your score", the high-score list (with a tab per board), a personal
// best kept on the device, and an on-screen pause. Snake, Brick Breaker,
// Block Drop and Tower Defense use it; each game only draws and plays.
//
//   const shell = GameShell.create({
//     game: 'snake', boards: { classic: 'Classic', wrap: 'Wrap' },
//     mount: $('stage'),              // the over panel goes right after this
//     onAgain: reset,
//   });
//   shell.over({ score, board: 'classic', detail: '42 apples', title: 'Game over' });
//   shell.openScores('classic');
//   shell.best('classic')            // this device's best on that board

const GameShell = (() => {
  const { toast } = ArcadeKit;

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function create({ game, boards, mount, onAgain, againLabel = 'Play again' }) {
    const boardIds = Object.keys(boards);
    const bestKey = board => `${game}.best.${board}`;
    const best = board => { try { return Number(localStorage.getItem(bestKey(board))) || 0; } catch { return 0; } };

    // ---- game over ---------------------------------------------------------------------
    const over = el(`
      <div class="panel center hidden over-panel" role="dialog" aria-live="polite">
        <div class="over-top"><button class="primary again-btn"></button></div>
        <h2 class="over-title">Game over</h2>
        <div class="final-score"></div>
        <div class="over-detail hint"></div>
        <div class="save-part">
          <p class="hint save-hint">Get on the board and see where you stack up.</p>
          <div class="initials">
            <input maxlength="1" class="ini" autocomplete="off" aria-label="First initial"><input maxlength="1" class="ini" autocomplete="off" aria-label="Second initial"><input maxlength="1" class="ini" autocomplete="off" aria-label="Third initial">
          </div>
          <button class="primary big save-btn">Save score</button>
          <div class="msg"></div>
        </div>
        <div class="stack">
          <button class="ghost scores-btn">🏆 High scores</button>
        </div>
      </div>`);
    mount.after(over);
    const q = sel => over.querySelector(sel);
    q('.again-btn').textContent = againLabel;
    const initials = ArcadeKit.wireInitials([...over.querySelectorAll('.ini')], () => save());
    let pending = null;

    function profile() {
      try { return typeof ArcadeProfile !== 'undefined' && ArcadeProfile.token() ? ArcadeProfile.get() : null; } catch { return null; }
    }

    async function save() {
      if (!pending) return;
      const p = profile();
      const who = p ? 'P' : initials.value();
      if (!who) { q('.msg').textContent = 'Type your initials first.'; return; }
      q('.save-btn').disabled = true;
      try {
        const r = await ArcadeKit.saveScore(game, { initials: who, score: pending.score, board: pending.board, detail: pending.detail || '' });
        if (!p) initials.remember(who);
        q('.save-part').classList.add('hidden');
        toast(r.rank === 1 ? '🏆 New #1!' : `Saved: #${r.rank}`);
        openScores(pending.board, r.id);
        pending = null;
      } catch (e) {
        q('.msg').textContent = e.message;
        q('.save-btn').disabled = false;
      }
    }
    q('.save-btn').addEventListener('click', save);
    q('.again-btn').addEventListener('click', () => { hideOver(); onAgain(); });
    q('.scores-btn').addEventListener('click', () => openScores(pending ? pending.board : boardIds[0]));

    function showOver({ score, board = boardIds[0], detail = '', title }) {
      score = Math.max(0, Math.round(score));
      const isBest = score > best(board);
      if (isBest) { try { localStorage.setItem(bestKey(board), String(score)); } catch { /* private mode */ } }
      q('.over-title').textContent = title || (isBest && score > 0 ? 'New personal best! 🎉' : 'Game over');
      q('.final-score').textContent = score.toLocaleString('en-US');
      q('.over-detail').textContent = detail;
      pending = score > 0 ? { score, board, detail } : null;
      const p = profile();
      q('.save-part').classList.toggle('hidden', !pending);
      q('.initials').classList.toggle('hidden', !!p);
      q('.save-hint').textContent = p ? `Saving as ${p.name}.` : 'Get on the board and see where you stack up.';
      q('.save-btn').disabled = false;
      q('.msg').textContent = '';
      over.classList.remove('hidden');
      document.body.dataset.state = 'over';
      setTimeout(() => over.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
    function hideOver() { over.classList.add('hidden'); }

    // ---- high scores ----------------------------------------------------------------------
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
      scores.querySelector('.my-best').textContent = mine ? `Your best on this device: ${mine.toLocaleString('en-US')}` : '';
      ArcadeKit.loadScores(game, board, scores.querySelector('.scores'), highlightId);
      scores.classList.remove('hidden');
    }
    scores.querySelector('.close-btn').addEventListener('click', () => scores.classList.add('hidden'));
    scores.addEventListener('click', e => { if (e.target === scores) scores.classList.add('hidden'); });

    return { over: showOver, hideOver, openScores, best, get isOver() { return !over.classList.contains('hidden'); } };
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
  function fitCanvas(canvas, { aspect = null, maxHeight = Infinity } = {}) {
    const ctx = canvas.getContext('2d');
    const box = canvas.parentElement;
    const size = { w: 0, h: 0 };
    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      let w = box.clientWidth;
      let h = aspect ? w / aspect : box.clientHeight;
      const mh = typeof maxHeight === 'function' ? maxHeight() : maxHeight;
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
    resize();
    return { ctx, size, resize };
  }

  return { create, swipes, fitCanvas };
})();
