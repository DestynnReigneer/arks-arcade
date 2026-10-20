'use strict';

// Tells the arcade which game is being played, by whom, and for how long, and
// reports crashes so they show up in Admin → Stats with a code. Time only
// counts while the page is on screen and someone has touched it in the last
// few minutes, so a phone left on the counter doesn't rack up hours.
//
// Games call ArcadeStats.play() when a round, run or match starts.

const ArcadeStats = (() => {
  const IDLE_MS = 5 * 60 * 1000;
  const BEAT_MS = 30 * 1000;
  const page = location.pathname.replace(/^\/+/, '').replace(/\.html$/, '');
  const game = !page || page === 'index' ? 'hub' : page;
  const tracked = game !== 'hub' && game !== 'admin';

  let visitId = null;
  let activeSince = document.visibilityState === 'visible' ? Date.now() : null;
  let lastInput = Date.now();
  let pendingMs = 0;
  let pendingPlays = 0;

  function who() {
    try {
      // profile.js declares ArcadeProfile with const, so it isn't on window.
      if (typeof ArcadeProfile === 'undefined') return { name: '', token: '' };
      const p = ArcadeProfile.get();
      return { name: p ? p.name : '', token: ArcadeProfile.token() || '' };
    } catch { return { name: '', token: '' }; }
  }

  function post(path, body, closing) {
    const url = '/api/stats/' + path;
    const json = JSON.stringify(body);
    try {
      if (closing && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return Promise.resolve(null);
    } catch { /* fall back to fetch */ }
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: !!closing })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  }

  // Add up on-screen, recently-touched time since the last check.
  function collect(now = Date.now()) {
    if (activeSince == null) return;
    const end = Math.min(now, lastInput + IDLE_MS);
    if (end > activeSince) pendingMs += end - activeSince;
    activeSince = now;
  }

  function flush(closing = false) {
    collect();
    if (!visitId || (!pendingMs && !pendingPlays && !closing)) return;
    post('beat', { id: visitId, activeMs: pendingMs, plays: pendingPlays, ...who() }, closing);
    pendingMs = 0;
    pendingPlays = 0;
  }

  if (tracked) {
    post('visit', { game, ...who() }).then(r => { if (r && r.id) visitId = r.id; });
    setInterval(() => flush(), BEAT_MS);
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
      window.addEventListener(ev, () => {
        const now = Date.now();
        // Coming back after a long idle: start counting again from now.
        if (activeSince != null && now - lastInput > IDLE_MS) { collect(now); activeSince = now; }
        lastInput = now;
      }, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { activeSince = Date.now(); lastInput = Date.now(); }
      else { flush(true); activeSince = null; }
    });
    window.addEventListener('pagehide', () => flush(true));
  }

  // ---- crashes ----------------------------------------------------------------------------
  const sent = new Set();
  let reports = 0;
  const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i];
  function report(message, location, stack) {
    message = String(message || '').slice(0, 500);
    if (!message || IGNORE.some(re => re.test(message))) return;
    // Only our own code: browser extensions throw too.
    if (/^(chrome|moz|safari)-extension:|^webkit-masked-url:/i.test(String(location || ''))) return;
    const key = message + '|' + location;
    if (sent.has(key) || reports >= 10) return;
    sent.add(key);
    reports++;
    post('error', { game, message, location: String(location || '').replace(location ? window.location.origin : '', ''), stack: String(stack || '').slice(0, 4000), name: who().name });
  }
  window.addEventListener('error', e => {
    if (!e.message) return;   // a missing image or script, not a crash
    if (e.filename && !e.filename.startsWith(window.location.origin)) return;
    report(e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '', e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    const stack = r && r.stack ? String(r.stack) : '';
    const at = (/(https?:\/\/[^\s)]+:\d+:\d+)/.exec(stack) || [])[1] || '';
    if (at && !at.startsWith(window.location.origin)) return;
    report(r && r.message ? r.message : String(r), at, stack);
  });

  return {
    game,
    play() { pendingPlays++; },
    report: (message, detail) => report(message, 'reported', detail)
  };
})();
// Games check window.ArcadeStats, so a page without this script still works.
window.ArcadeStats = ArcadeStats;
