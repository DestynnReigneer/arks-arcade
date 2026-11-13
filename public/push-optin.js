'use strict';

// "Know when it's your turn": the card that turns notifications on for this
// phone (arcade/push.js on the server, sw.js in the browser). It only shows
// when the arcade signs in with ARKS ID, someone is signed in, and the browser
// can do it. An iPhone or iPad can only once the arcade is on its Home Screen,
// so there the card says how.
//
//   ArcadePush.status()   where this phone stands: { state, sub, wanted }, state
//                         being 'none' (can't here), 'tip' (an iPhone that needs
//                         the Home Screen first), 'blocked', 'off' or 'on'
//   ArcadePush.turnOn(wanted) / turnOff(sub)   the profile card's switch uses these
//   ArcadePush.card(box)  draws the old card into box (or hides it)
//   ArcadePush.clear(tag) takes away a notification that's showing for tag
window.ArcadePush = (() => {
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const apple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const toBytes = b64 => {
    const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  };
  const same = (a, b) => !!a && !!b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong. Give it a moment and try again.'); return d; });

  let reg = null;
  const worker = async () => reg || (reg = await navigator.serviceWorker.register('sw.js'));

  async function card(box) {
    box.classList.add('hidden');
    let info = null, key = null;
    try {
      info = await (await fetch('/api/arksid/me')).json();
      key = await (await fetch('/api/push/key')).json();
    } catch { return; }
    if (!info || !info.on || !info.signedIn || !key || !key.on) return;
    if (!supported()) {
      if (apple() && !installed()) draw(box, 'tip');
      return;
    }
    const r = await worker().catch(() => null);
    if (!r) return;
    const sub = await r.pushManager.getSubscription().catch(() => null);
    const wanted = toBytes(key.publicKey);
    if (sub && Notification.permission === 'granted') {
      if (same(sub.options && sub.options.applicationServerKey, wanted)) {
        // Hand it over again: it keeps the sign-in service's copy fresh.
        post('/api/push/subscribe', { subscription: sub.toJSON() }).catch(() => {});
        return draw(box, 'on', { sub });
      }
      await sub.unsubscribe().catch(() => {});
    }
    draw(box, Notification.permission === 'denied' ? 'blocked' : 'off', { wanted });
  }

  function draw(box, state, { sub, wanted, error } = {}) {
    box.textContent = '';
    box.classList.remove('hidden');
    const h = document.createElement('h2'), p = document.createElement('p'), err = document.createElement('p');
    p.className = 'hint'; err.className = 'hint push-err'; err.setAttribute('aria-live', 'polite');
    if (error) err.textContent = error;
    h.textContent = '🔔 Get a heads-up when it\'s your turn';
    box.append(h, p);
    if (state === 'tip') {
      p.textContent = 'iPhones and iPads only show notifications for apps on the Home Screen. Tap the Share button, choose Add to Home Screen, then open the Arcade from its new icon.';
      return;
    }
    if (state === 'blocked') {
      p.textContent = 'Your phone is blocking notifications from the Arcade. To get them, open your browser\'s settings, allow notifications for this site.';
      return;
    }
    const btn = document.createElement('button');
    if (state === 'on') {
      p.textContent = 'You\'re all set. This phone will let you know when it\'s your turn or when someone starts a game with you.';
      btn.className = 'ghost'; btn.textContent = 'Turn them off';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await post('/api/push/unsubscribe', { endpoint: sub.endpoint });
          await sub.unsubscribe();
          draw(box, 'off', { wanted: sub.options.applicationServerKey });
        } catch (e) { btn.disabled = false; err.textContent = e.message; }
      });
    } else {
      p.textContent = 'Want your phone to let you know when it\'s your move?';
      btn.className = 'primary'; btn.textContent = 'Turn on notifications';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          // The phone asks "Allow notifications?" here.
          const r = await worker();
          const s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
          try { await post('/api/push/subscribe', { subscription: s.toJSON() }); }
          catch (e) { await s.unsubscribe().catch(() => {}); throw e; }
          draw(box, 'on', { sub: s });
        } catch (e) {
          if (Notification.permission === 'denied') return draw(box, 'blocked');
          btn.disabled = false;
          // A plain Error is the arcade's own message; the browser's own errors get ours.
          err.textContent = e && e.name === 'NotAllowedError' ? 'Your phone said no that time. Tap the button again and choose Allow.'
            // Said no without asking: a private or incognito window can't get notifications.
            : e && e.name === 'AbortError' ? 'Notifications don\'t work in a private or incognito window. Open the Arcade in a regular window and try again.'
            : e && e.name === 'Error' && e.message ? e.message : 'Something went wrong. Give it a moment and try again.';
        }
      });
    }
    box.append(btn, err);
  }

  // The same checks as the card, as an answer instead of a drawing.
  async function status() {
    let info = null, key = null;
    try {
      info = await (await fetch('/api/arksid/me')).json();
      key = await (await fetch('/api/push/key')).json();
    } catch { return { state: 'none' }; }
    if (!info || !info.on || !info.signedIn || !key || !key.on) return { state: 'none' };
    if (!supported()) return { state: apple() && !installed() ? 'tip' : 'none' };
    const r = await worker().catch(() => null);
    if (!r) return { state: 'none' };
    const sub = await r.pushManager.getSubscription().catch(() => null);
    const wanted = toBytes(key.publicKey);
    if (sub && Notification.permission === 'granted') {
      if (same(sub.options && sub.options.applicationServerKey, wanted)) {
        post('/api/push/subscribe', { subscription: sub.toJSON() }).catch(() => {});
        return { state: 'on', sub, wanted };
      }
      await sub.unsubscribe().catch(() => {});
    }
    return { state: Notification.permission === 'denied' ? 'blocked' : 'off', wanted };
  }
  // Throws an Error whose message can be shown as it is; `blocked` is set when the phone said no for good.
  async function turnOn(wanted) {
    try {
      const r = await worker();
      const s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
      try { await post('/api/push/subscribe', { subscription: s.toJSON() }); }
      catch (e) { await s.unsubscribe().catch(() => {}); throw e; }
      return s;
    } catch (e) {
      if (Notification.permission === 'denied') throw Object.assign(new Error('blocked'), { blocked: true });
      throw new Error(e && e.name === 'NotAllowedError' ? 'Your phone said no that time. Tap the switch again and choose Allow.'
        : e && e.name === 'AbortError' ? 'Notifications don\'t work in a private or incognito window. Open the Arcade in a regular window and try again.'
          : e && e.name === 'Error' && e.message ? e.message : 'Something went wrong. Give it a moment and try again.');
    }
  }
  async function turnOff(sub) {
    await post('/api/push/unsubscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }

  async function clear(tag) {
    if (!supported()) return;
    try {
      const r = await navigator.serviceWorker.getRegistration();
      if (r) (await r.getNotifications({ tag })).forEach(n => n.close());
    } catch { /* nothing showing */ }
  }

  return { card, clear, status, turnOn, turnOff, apple };
})();
