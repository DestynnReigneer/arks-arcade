'use strict';

// Notifications on this device (arcade/push.js on the server, sw.js in the
// browser). They only work when the arcade signs in with ARKS ID, someone is
// signed in, and the browser can do it. An iPhone or iPad can only once the
// arcade is on its Home Screen. The profile card's switch (profile.js) is the
// one place that turns them on and off.
//
//   ArcadePush.status()   where this device stands: { state, sub, wanted }, state
//                         being 'none' (can't here), 'tip' (an iPhone that needs
//                         the Home Screen first), 'blocked', 'off' or 'on'
//   ArcadePush.turnOn(wanted) / turnOff(sub)   the profile card's switch uses these
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
  const OOPS = 'Something went wrong, wait a moment and try again.';
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || OOPS); return d; });

  let reg = null;
  const worker = async () => reg || (reg = await navigator.serviceWorker.register('sw.js'));

  // Where this device stands, for the profile card's switch.
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
        // Hand it over again: it keeps the sign-in service's copy fresh.
        post('/api/push/subscribe', { subscription: sub.toJSON() }).catch(() => {});
        return { state: 'on', sub, wanted };
      }
      await sub.unsubscribe().catch(() => {});
    }
    return { state: Notification.permission === 'denied' ? 'blocked' : 'off', wanted };
  }
  // Throws an Error whose message can be shown as it is; `blocked` is set when the browser said no for good.
  async function turnOn(wanted) {
    try {
      // The device asks "Allow notifications?" here.
      const r = await worker();
      const s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
      try { await post('/api/push/subscribe', { subscription: s.toJSON() }); }
      catch (e) { await s.unsubscribe().catch(() => {}); throw e; }
      return s;
    } catch (e) {
      if (Notification.permission === 'denied') throw Object.assign(new Error('blocked'), { blocked: true });
      // A plain Error is the arcade's own message; the browser's own errors get ours.
      throw new Error(e && e.name === 'NotAllowedError' ? 'Notifications weren\'t allowed. Tap the switch again and choose Allow.'
        // Said no without asking: a private or incognito window can't get notifications.
        : e && e.name === 'AbortError' ? 'Notifications don\'t work in incognito. Open the Arcade in a regular window and try again.'
          : e && e.name === 'Error' && e.message ? e.message : OOPS);
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

  return { clear, status, turnOn, turnOff, apple };
})();
