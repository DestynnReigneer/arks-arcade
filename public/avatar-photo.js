'use strict';

// ARKS ID photos and team pictures as avatars (2026-11-01). Someone signed in
// through ARKS ID who picked a photo or a team picture there gets an avatar
// like "photo:<profile>:<version>:<icon>". This draws it as a picture served
// by the arcade itself (/api/arksid/photo/<profile>, which the arcade's server
// fetches from ARKS ID), and draws the icon instead if the picture can't load,
// for example for a guest, who isn't shown family photos. A page that already
// knows its visitor isn't signed in (profile.js has heard from the server)
// draws the icon straight away instead of asking for a picture it won't get.
//
// It lives here rather than in avatars.js because that file is shared with
// the other apps and has to stay an exact copy. Load it right after avatars.js.
(() => {
  if (typeof Avatars === 'undefined' || Avatars.photoReady) return;
  const RE = /^photo:([A-Za-z0-9]{1,40}):([0-9a-f]{8}):(.+)$/;
  const draw = Avatars.put;
  const signedOut = () => {
    try {
      const me = typeof ArcadeProfile !== 'undefined' && ArcadeProfile.arksId().me;
      return !!me && !me.signedIn;
    } catch { return false; }
  };
  Avatars.put = (el, id) => {
    const m = RE.exec(String(id || ''));
    if (!m) return draw(el, id);
    if (signedOut()) return draw(el, m[3]);
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover;border-radius:50%';
    img.onerror = () => draw(el, m[3]);
    img.src = `/api/arksid/photo/${m[1]}?v=${m[2]}`;
    el.replaceChildren(img);
    return el;
  };
  Avatars.photoReady = true;
})();
