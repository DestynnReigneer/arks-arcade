'use strict';

// QR codes for joining games from another phone. The address in the code is
// whatever address this page was opened on, so it works on the LAN, through
// a reverse proxy, or in Docker. Only when the page is open as "localhost"
// (on the server itself) do we ask the server for its LAN address instead.

const ArcadeQR = (() => {
  let basePromise = null;
  const isLocal = host => /^(localhost|127\.|\[::1\]|::1)/.test(host);

  function base() {
    if (!isLocal(location.hostname)) return Promise.resolve(location.origin);
    if (!basePromise) {
      basePromise = fetch('/api/arcade-info').then(r => r.json())
        .then(info => info.publicUrl || location.origin).catch(() => location.origin);
    }
    return basePromise;
  }

  async function url(path) { return `${await base()}/${path.replace(/^\//, '')}`; }

  // Puts the QR code for `path` in an <img>, and the link text in `label`.
  async function show(img, path, label) {
    const link = await url(path);
    img.src = `/api/qr?text=${encodeURIComponent(link)}`;
    img.alt = 'QR code to scan';
    img.classList.remove('hidden');
    img.hidden = false;
    if (label) label.textContent = link.replace(/^https?:\/\//, '');
    return link;
  }

  // A game's join link: rambler.html?join=ABCD
  const forGame = (img, page, code, label) => show(img, `${page}?join=${encodeURIComponent(code)}`, label);

  // The QR button in a lobby on a device (the maintainer, 2026-11-15): tap it, show
  // your screen, and a friend scans it to join. One button per lobby, put right
  // after `anchor`; calling it again for the same lobby just keeps it.
  //   ArcadeQR.lobbyButton(anchor, 'chess.html', code)
  function lobbyButton(anchor, page, code) {
    if (!anchor || !code) return;
    let btn = anchor.parentNode.querySelector(':scope > .qr-show');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-show';
      btn.textContent = '📷 Show QR code';
      btn.style.cssText = 'display:block;margin:10px auto;padding:10px 18px;border-radius:12px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer';
      btn.addEventListener('click', () => open(btn.dataset.page, btn.dataset.code));
      anchor.after(btn);
    }
    btn.dataset.page = page;
    btn.dataset.code = code;
  }
  // The big code, over the page, with nothing else to read.
  function open(page, code) {
    if (document.querySelector('.qr-big')) return;
    const o = document.createElement('div');
    o.className = 'qr-big';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', 'QR code to join');
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;background:rgba(5,4,10,.9)';
    const img = document.createElement('img');
    img.width = img.height = 280;
    img.style.cssText = 'width:min(280px,80vw);height:auto;aspect-ratio:1;background:#fff;padding:12px;border-radius:16px';
    const line = document.createElement('p');
    line.textContent = 'Scan to join';
    line.style.cssText = 'margin:0;color:#fff;font-size:20px;font-weight:800';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.cssText = 'padding:10px 26px;border-radius:12px;border:1px solid #fff;background:transparent;color:#fff;font:inherit;font-weight:700;cursor:pointer';
    const done = () => { o.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') done(); };
    close.addEventListener('click', done);
    o.addEventListener('click', e => { if (e.target === o) done(); });
    document.addEventListener('keydown', esc);
    o.append(img, line, close);
    document.body.appendChild(o);
    forGame(img, page, code).then(() => { img.alt = 'QR code to scan'; });
    close.focus();
  }

  return { base, url, show, forGame, lobbyButton };
})();
