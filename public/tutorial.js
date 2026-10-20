'use strict';

// A short step-by-step "how to play", shared by every game in the arcade.
// It opens by itself the first time someone visits a game, and from the
// game's ? button any time after. Steps are written by us, never by players,
// so their HTML is trusted.
//
//   const help = Tutorial.create('shortfuse', [{ emoji, title, html }, ...]);
//   help.autoOpen();          // first visit only
//   help.open(2);             // jump to a step

const Tutorial = (() => {
  function seenKey(id) { return `tutorial.${id}.seen`; }

  function hasSeen(id) {
    try { return localStorage.getItem(seenKey(id)) === 'yes'; } catch { return false; }
  }

  function markSeen(id) {
    try { localStorage.setItem(seenKey(id), 'yes'); } catch { /* private mode */ }
  }

  function create(id, steps, { onClose } = {}) {
    let root = null;
    let index = 0;

    function build() {
      root = document.createElement('div');
      root.className = 'tut-overlay';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.innerHTML = `
        <div class="tut-card">
          <button class="tut-x" type="button" aria-label="Close">✕</button>
          <div class="tut-emoji"></div>
          <h2 class="tut-title"></h2>
          <div class="tut-body"></div>
          <div class="tut-dots"></div>
          <div class="tut-nav">
            <button class="tut-back" type="button">Back</button>
            <button class="tut-next" type="button">Next</button>
          </div>
          <button class="tut-share" type="button">📱 Open this game on another phone</button>
          <div class="tut-qr" hidden><img alt="QR code for this game" width="150" height="150"><div class="tut-qr-link"></div></div>
        </div>`;
      root.querySelector('.tut-x').onclick = close;
      root.querySelector('.tut-back').onclick = () => show(index - 1);
      root.querySelector('.tut-next').onclick = () => (index === steps.length - 1 ? close() : show(index + 1));
      root.addEventListener('click', e => { if (e.target === root) close(); });
      root.querySelector('.tut-share').onclick = showQr;
      document.addEventListener('keydown', e => {
        if (!root || root.hidden) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowRight') show(Math.min(steps.length - 1, index + 1));
        if (e.key === 'ArrowLeft') show(Math.max(0, index - 1));
      });
      const dots = root.querySelector('.tut-dots');
      steps.forEach((_, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'tut-dot';
        d.setAttribute('aria-label', `Step ${i + 1}`);
        d.onclick = () => show(i);
        dots.appendChild(d);
      });
      document.body.appendChild(root);
    }

    // A QR code for this game's page, so another phone can open it. The
    // address is the one this page was opened on, or (on localhost) the
    // server's LAN address.
    async function showQr() {
      const box = root.querySelector('.tut-qr');
      if (!box.hidden) { box.hidden = true; return; }
      let base = location.origin;
      if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
        try { base = (await (await fetch('/api/arcade-info')).json()).publicUrl || base; } catch { /* keep origin */ }
      }
      const link = base + location.pathname;
      box.querySelector('img').src = '/api/qr?text=' + encodeURIComponent(link);
      box.querySelector('.tut-qr-link').textContent = link.replace(/^https?:\/\//, '');
      box.hidden = false;
    }

    function show(i) {
      index = Math.max(0, Math.min(steps.length - 1, i));
      const step = steps[index];
      root.querySelector('.tut-emoji').textContent = step.emoji || '';
      root.querySelector('.tut-title').textContent = step.title;
      root.querySelector('.tut-body').innerHTML = step.html;
      root.querySelector('.tut-back').style.visibility = index === 0 ? 'hidden' : 'visible';
      root.querySelector('.tut-next').textContent = index === steps.length - 1 ? "Let's play!" : 'Next';
      [...root.querySelectorAll('.tut-dot')].forEach((d, n) => d.classList.toggle('on', n === index));
    }

    function open(at = 0) {
      if (!root) build();
      root.hidden = false;
      show(at);
      root.querySelector('.tut-next').focus();
    }

    function close() {
      if (!root) return;
      root.hidden = true;
      markSeen(id);
      if (onClose) onClose();
    }

    function autoOpen() {
      if (!hasSeen(id)) open(0);
    }

    return { open, close, autoOpen, get isOpen() { return !!root && !root.hidden; } };
  }

  return { create, hasSeen };
})();
