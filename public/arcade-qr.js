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
    img.alt = `QR code for ${link}`;
    img.classList.remove('hidden');
    img.hidden = false;
    if (label) label.textContent = link.replace(/^https?:\/\//, '');
    return link;
  }

  // A game's join link: rambler.html?join=ABCD
  const forGame = (img, page, code, label) => show(img, `${page}?join=${encodeURIComponent(code)}`, label);

  return { base, url, show, forGame };
})();
