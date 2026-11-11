'use strict';

// "Who's playing?" for the whole arcade. The choice lives on this device
// (localStorage) and every game reads it: names fill themselves in, and
// scores are credited to the profile with its signed token. Guests just
// get a name. Needs avatars.js loaded first. Brings its own styles.

const ArcadeProfile = (() => {
  // Back after signing out shouldn't show a saved copy of a signed-in page:
  // a page the browser kept in memory is loaded fresh instead.
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  const KEY = 'arcade.profile';
  const API = '/api/profiles';
  const listeners = [];

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  }
  function set(p) {
    try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
    // Rambler keeps coins and streaks per player; it follows the arcade profile.
    try {
      if (p && p.id) localStorage.setItem('rambler.playerId', p.id);
      else localStorage.removeItem('rambler.playerId');
    } catch { /* unavailable */ }
    for (const fn of listeners) fn(p);
  }
  const name = () => (get() || {}).name || '';
  const token = () => (get() || {}).token || null;
  // The initials this profile chose, or the first three letters of its name.
  const initials = () => (get() || {}).initials || name().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const onChange = fn => listeners.push(fn);

  // ---- ARKS ID (optional, see arcade/arksid.js) ----------------------------------------
  // When this arcade signs in through ARKS ID, "who's playing" comes from it:
  // a signed-in person gets their linked profile and its token, and guest
  // play is only offered on a device no family member owns.
  const Id = { on: false, me: null };
  // On a TV (the ARKS TV app, or ?tv=1 to try it), nobody signs in as a
  // person: the TV sets itself up with a pairing code instead (tv.js). So no
  // quick stops at ARKS ID, and no "Who's playing?" picker.
  const onTv = (() => {
    if (/(^|\s)ARKS-TV\//.test(navigator.userAgent)) return true;
    try {
      const q = new URLSearchParams(location.search).get('tv');
      return q === '1' || (q !== '0' && sessionStorage.getItem('arcade.tv') === '1');
    } catch { return false; }
  })();
  Id.tv = onTv;
  Id.ready = fetch('/api/arksid/me', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { on: false })).catch(() => ({ on: false })).then(me => {
    Id.on = !!me.on; Id.me = me;
    if (!Id.on) return Id;
    const cur = get();
    if (me.signedIn) {
      set({ id: me.profile.id, name: me.profile.name, avatar: me.profile.avatar, hasPin: false, token: me.token,
        boardShow: me.profile.boardShow, initials: me.profile.initials, arksid: true, role: me.role, adult: me.adult });
    } else {
      if (cur && (!cur.guest || (me.deviceChecked && !me.guestAllowed))) set(null);
      if (onTv) return Id;
      // At most once an hour: a quiet stop at ARKS ID (silent sign-in). If this
      // device is signed in there, say from the family's other app, it comes
      // back signed in here too, with no tap. If not, it comes straight back.
      let silentAt = 0;
      try { silentAt = Number(localStorage.getItem('arksid.silentAt')) || 0; } catch { silentAt = Date.now(); }
      if (Date.now() - silentAt > 60 * 60 * 1000) {
        try { localStorage.setItem('arksid.silentAt', String(Date.now())); } catch { /* no storage: don't loop */ }
        Id.leaving = true;
        location.replace('/auth/signin?silent=1&return=' + encodeURIComponent(location.pathname + location.search + location.hash));
        return Id;
      }
      // Once per visit: a quick stop at ARKS ID to learn whose device this is,
      // so guest play can be offered (or not). It comes straight back.
      let tried = false;
      try { tried = sessionStorage.getItem('arksid.deviceTried') === '1'; sessionStorage.setItem('arksid.deviceTried', '1'); } catch { tried = true; }
      if (!me.deviceChecked && !tried) Id.leaving = true;
      if (Id.leaving) location.replace('/auth/device?return=' + encodeURIComponent(location.pathname + location.search + location.hash));
    }
    return Id;
  });
  const here = () => encodeURIComponent(location.pathname + location.search + location.hash);
  // The ARKS ID account page in a small window. It closes itself after Save,
  // and then this page asks for the fresh account and reloads, so a new avatar
  // or name shows straight away. If the window can't open (a popup blocker),
  // the page goes there instead.
  function openAccount() {
    const url = Id.me.accountUrl + '?popup=1';
    const w = window.open(url, 'arksid', 'popup,width=560,height=820');
    if (!w) { location.href = Id.me.accountUrl; return; }
    const watch = setInterval(() => {
      if (!w.closed) return;
      clearInterval(watch);
      fetch('/api/arksid/me?fresh=1', { cache: 'no-store' }).catch(() => null).then(() => location.reload());
    }, 500);
  }
  async function signOut() {
    let next = '/';
    try { next = (await (await fetch('/auth/signout', { method: 'POST' })).json()).next || '/'; } catch { /* go home */ }
    set(null);
    location.href = next;
  }

  async function api(path, body) {
    const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // A small avatar element.
  function avatarEl(id, size = 36) {
    const el = document.createElement('span');
    el.style.cssText = `display:inline-block;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex:none;vertical-align:middle`;
    Avatars.put(el, id || Avatars.DEFAULT);
    return el;
  }

  // ---- the picker ---------------------------------------------------------------------
  let root = null;
  const CSS = `
    .apf{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(16,6,32,.85);backdrop-filter:blur(3px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5eaff}
    .apf-card{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:#22103f;border:1px solid #3d2a63;border-radius:18px;padding:18px}
    .apf h2{margin:0 0 4px;font-size:20px;text-align:center}.apf p{margin:4px 0 12px;font-size:13px;color:#c9a8dd;text-align:center;line-height:1.45}
    .apf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;margin:10px 0}
    .apf-tile{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border-radius:14px;border:2px solid transparent;background:#2c1350;color:inherit;cursor:pointer;font:inherit;font-size:13px;font-weight:700}
    .apf-tile:hover,.apf-tile.on{border-color:#ffc72c}.apf-tile .lock{font-size:11px;opacity:.7;font-weight:600}
    .apf-row{display:flex;gap:8px;margin-top:10px}.apf-row>*{flex:1}
    .apf .apf-btn{padding:11px;border-radius:10px;border:1px solid #3d2a63;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}
    .apf button.apf-main{background:#ffc72c;color:#1a0f05;border-color:#ffc72c}
    .apf input{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #3d2a63;background:#0a0416;color:#fff;font:inherit;font-size:15px;margin:6px 0}
    .apf-msg{min-height:18px;color:#ff7a7a;font-size:13px;text-align:center;margin:6px 0}
    .apf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.apf-tabs button{padding:5px 10px;border-radius:999px;border:1px solid #3d2a63;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
    .apf-tabs button.on{border-color:#ffc72c;color:#ffc72c}
    .apf-fbl{display:grid;gap:8px;margin:8px 0}
    .apf-fb{display:grid;gap:4px;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid #3d2a63;background:#2c1350;color:inherit;font:inherit;font-size:14px;cursor:pointer;white-space:pre-wrap;overflow-wrap:anywhere}
    .apf-fb .apf-sub{text-align:left;margin:0}
    .apf-fbtext{padding:10px 12px;border-radius:12px;background:#2c1350;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px}
    .apf-rep{padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border-left:3px solid #ff2ec4;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
    .apf-rep.admin{border-left-color:#00ffc2}
    .apf-ta{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #3d2a63;background:#0a0416;color:#fff;font:inherit;font-size:15px;margin-top:6px}
    .apf-av{display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:8px;margin:6px 0 10px}
    .apf-av button{padding:3px;border-radius:50%;border:3px solid transparent;background:none;cursor:pointer;aspect-ratio:1}.apf-av button.on{border-color:#ffc72c}
    .apf label{display:block;font-size:12px;color:#c9a8dd;margin-top:8px}
    .apf label.apf-pick{display:flex;align-items:center;gap:8px;font-size:14px;color:#f5eaff;margin-top:6px}
    .apf label.apf-pick input[type=radio]{width:auto;margin:0}.apf label.apf-pick input[data-ini]{width:70px;margin:0;text-transform:uppercase;letter-spacing:.2em;text-align:center}.apf-sub{font-size:12px;color:#9483ae;text-align:center;margin-top:10px}
  `;

  function ensure() {
    if (root) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'apf';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="apf-card"></div>';
    // Tapping outside the card closes it, but only once someone is playing.
    root.addEventListener('click', e => { if (e.target === root && canClose()) close(); });
    // Keys typed in the card stay in the card, so a game's own keys (arrows,
    // space, Enter) don't play it behind the card.
    for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, e => e.stopPropagation());
    document.body.appendChild(root);
  }
  const card = () => root.querySelector('.apf-card');
  // Nobody picked yet (no profile, no guest, not signed in): the card stays
  // until they pick, so nobody plays as no one (found by the maintainer,
  // 2026-11-01: Close let them straight into the arcade).
  const canClose = () => !!get();
  const closeRow = () => (canClose() ? '<div class="apf-row"><button class="apf-btn" data-close>Close</button></div>' : '');
  const wireClose = c => { const b = c.querySelector('[data-close]'); if (b) b.onclick = () => close(get()); };
  let resolveOpen = null;

  // While the card is open, the page behind it is out of reach: everything
  // else is marked inert (no clicks, no keyboard focus, hidden from screen
  // readers), Tab cycles inside the card, and when it closes, focus goes back
  // to whatever had it before. Without this, Tab and Enter could start a game
  // behind the card (found in review, 2026-11-01).
  let isOpen = false, returnFocus = null, inerted = [];
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const focusables = () => [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.hidden && el.offsetParent !== null);
  function shutOutPage() {
    for (const el of document.body.children) {
      if (el === root || el.inert || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      el.inert = true;
      inerted.push(el);
    }
  }
  function letPageBack() {
    for (const el of inerted) el.inert = false;
    inerted = [];
  }
  function focusCard() {
    if (!isOpen || root.contains(document.activeElement)) return;
    const first = focusables()[0];
    if (first) first.focus(); else { card().tabIndex = -1; card().focus(); }
  }
  function trapKeys(e) {
    if (!isOpen) return;
    // Escape never closes it: someone has to pick who's playing first.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    const i = list.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
  }
  document.addEventListener('keydown', trapKeys, true);
  // Anything that still grabs focus outside the card (something added to the
  // page after it opened) sends it straight back.
  document.addEventListener('focusin', e => { if (isOpen && !root.contains(e.target)) focusCard(); }, true);
  // The card's contents change from screen to screen; keep focus in it.
  let watching = null;

  function close(result = null) {
    if (root) root.style.display = 'none';
    if (isOpen) {
      isOpen = false;
      letPageBack();
      if (watching) { watching.disconnect(); watching = null; }
      const back = returnFocus;
      returnFocus = null;
      if (back && back.isConnected && typeof back.focus === 'function') back.focus();
    }
    if (resolveOpen) { resolveOpen(result); resolveOpen = null; }
  }

  // Opens the picker. Resolves with the chosen profile, or null.
  function open() {
    ensure();
    if (!isOpen) {
      returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      isOpen = true;
      shutOutPage();
      watching = new MutationObserver(() => { shutOutPage(); requestAnimationFrame(focusCard); });
      watching.observe(document.body, { childList: true });
      new MutationObserver((list, obs) => { if (!isOpen) return obs.disconnect(); requestAnimationFrame(focusCard); })
        .observe(card(), { childList: true });
    }
    root.style.display = 'flex';
    showList();
    requestAnimationFrame(focusCard);
    return new Promise(r => { resolveOpen = r; });
  }

  // The same check on every page (2026-11-01): if nobody is playing yet (no
  // profile, no guest), ask before anything can be used. The home page always
  // asks; a game page asks when this arcade signs in through ARKS ID, so
  // opening a game's address directly or from a bookmark doesn't skip it.
  // It waits until ARKS ID has said who's signed in, so someone just back from
  // signing in isn't asked again.
  function askIfNobody({ always = false, delay = 0 } = {}) {
    return Id.ready.then(() => {
      if (Id.leaving || Id.tv || get() || (!always && !Id.on)) return;
      setTimeout(() => { if (!get() && !Id.leaving) open(); }, delay);
    });
  }

  async function showList() {
    const c = card();
    await Id.ready;
    if (Id.on) return showArksId();
    c.innerHTML = '<h2>Who\'s playing?</h2><p>Pick your profile, or play as a guest.</p><div class="apf-grid"></div><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-guest>👤 Play as a guest</button><button class="apf-btn" data-new>➕ New profile</button></div>' +
      (get() && get().id ? '<div class="apf-row"><button class="apf-btn" data-manage>⚙️ My profile: avatar, PIN &amp; name on boards</button></div>' +
        '<div class="apf-row"><button class="apf-btn" data-myfb>📬 My feedback</button></div>' : '') +
      closeRow();
    c.querySelector('[data-guest]').onclick = showGuest;
    c.querySelector('[data-new]').onclick = showNew;
    wireClose(c);
    if (c.querySelector('[data-manage]')) c.querySelector('[data-manage]').onclick = showManage;
    if (c.querySelector('[data-myfb]')) c.querySelector('[data-myfb]').onclick = () => showMyFeedback('open');
    const grid = c.querySelector('.apf-grid');
    let list = [];
    try { list = await api(''); } catch (e) { c.querySelector('.apf-msg').textContent = e.message; }
    if (!list.length) grid.innerHTML = '<div class="apf-sub" style="grid-column:1/-1">No profiles yet. Tap ➕ New profile to ask for one.</div>';
    const current = get();
    for (const p of list) {
      const b = document.createElement('button');
      b.className = 'apf-tile' + (current && current.id === p.id ? ' on' : '');
      b.appendChild(avatarEl(p.avatar, 56));
      const n = document.createElement('span');
      n.textContent = p.name;
      b.appendChild(n);
      if (p.hasPin) b.insertAdjacentHTML('beforeend', '<span class="lock">🔒 PIN</span>');
      b.onclick = () => (p.hasPin ? showPin(p) : choose(p, ''));
      grid.appendChild(b);
    }
  }

  // "Who's playing?" when this arcade signs in through ARKS ID.
  function showArksId() {
    const c = card(), me = Id.me, cur = get();
    if (me.signedIn && cur && cur.arksid) {
      c.innerHTML = '<h2>Who&#39;s playing?</h2><div class="apf-grid"></div><p data-who></p>' +
        '<div class="apf-row"><a class="apf-btn" data-account>⚙️ Change my avatar</a><button class="apf-btn" data-out>Sign out</button></div>' +
        '<div class="apf-row"><button class="apf-btn" data-myfb>📬 My feedback</button></div>' +
        closeRow();
      const tile = document.createElement('div');
      tile.className = 'apf-tile on';
      tile.style.gridColumn = '1/-1';
      tile.appendChild(avatarEl(cur.avatar, 56));
      const n = document.createElement('span');
      n.textContent = cur.name;
      tile.appendChild(n);
      c.querySelector('.apf-grid').appendChild(tile);
      c.querySelector('[data-who]').textContent = `You're signed in with ARKS ID as ${cur.name}. Your name, your avatar, your PIN and whether the high-score boards show your name or initials are all set on your ARKS ID account page.`;
      c.querySelector('[data-account]').href = me.accountUrl;
      c.querySelector('[data-account]').onclick = e => { e.preventDefault(); openAccount(); };
      c.querySelector('[data-out]').onclick = signOut;
      c.querySelector('[data-myfb]').onclick = () => showMyFeedback('open');
      wireClose(c);
      return;
    }
    const guest = me.guestAllowed;
    c.innerHTML = '<h2>Who&#39;s playing?</h2><p data-lead></p><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn apf-main" data-in>Sign in with ARKS ID</button></div>' +
      (guest ? '<div class="apf-row"><button class="apf-btn" data-guest>👤 Play as a guest</button><button class="apf-btn" data-join>✨ Make an account</button></div>' : '') +
      closeRow();
    c.querySelector('[data-lead]').textContent = guest
      ? 'Sign in with your ARKS ID to keep your scores, or play as a guest. If you don\'t have an account, consider creating one.'
      : 'Sign in with your ARKS ID to play. This device belongs to an ARKS ID account, playing as a guest is turned off here.';
    c.querySelector('[data-in]').onclick = () => { location.href = '/auth/signin?return=' + here(); };
    if (guest) {
      c.querySelector('[data-guest]').onclick = showGuest;
      // A guest who already picked a name and avatar keeps them.
      c.querySelector('[data-join]').onclick = () => makeAccount(cur && cur.guest ? cur : {}, c);
    }
    wireClose(c);
  }

  // ---- My feedback (2026-11-01) ----
  // What this profile sent with the bug, as threads with the admin: how far
  // along each one is, the replies, and fixing or deleting your own copy.
  // The profile's token goes in the body, never in an address.
  const FB_STATUS = { new: '🆕 New', pending: '👀 Seen', 'in-progress': '🔧 Pending', completed: '✅ Fixed', canceled: '🚫 Won\'t fix' };
  const mineCall = (path, body = {}) => fetch('/api/comm/mine' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token(), ...body }) }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'That didn\'t work.'); return d; });
  async function showMyFeedback(view) {
    const c = card();
    c.innerHTML = '<h2>My feedback</h2><p>What you sent with the little bug, and how far along it is. Fixed ones move to the Archive.</p>' +
      '<div class="apf-tabs"><button data-v="open">Open</button><button data-v="archive">Archive</button></div><div class="apf-msg"></div><div class="apf-fbl"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-back>Back</button></div>';
    c.querySelectorAll('[data-v]').forEach(b => { b.classList.toggle('on', b.dataset.v === view); b.onclick = () => showMyFeedback(b.dataset.v); });
    c.querySelector('[data-back]').onclick = showList;
    const list = c.querySelector('.apf-fbl');
    try {
      const { items } = await mineCall('', { view });
      if (!items.length) list.innerHTML = '<div class="apf-sub">' + (view === 'archive' ? 'Nothing is fixed yet.' : 'You don\'t have any open feedback. Tap the little bug in the corner to send some.') + '</div>';
      for (const f of items) {
        const b = document.createElement('button');
        b.className = 'apf-fb';
        const top = document.createElement('span'); top.className = 'apf-sub'; top.textContent = `${FB_STATUS[f.status] || f.status} · #${f.id}${f.replyCount ? ` · ${f.replyCount} ${f.replyCount === 1 ? 'reply' : 'replies'}` : ''}`;
        const tx = document.createElement('span'); tx.textContent = f.message;
        b.append(top, tx);
        b.onclick = () => showMyThread(f.id, view);
        list.appendChild(b);
      }
    } catch (e) { c.querySelector('.apf-msg').textContent = e.message; }
  }
  async function showMyThread(id, view) {
    const c = card();
    c.innerHTML = '<h2>Feedback #' + id + '</h2><p data-status></p><div class="apf-fbtext"></div><div class="apf-fbl" data-reps></div>' +
      '<textarea class="apf-ta" maxlength="5000" rows="3" placeholder="Reply to the admin"></textarea><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn apf-main" data-send>Send reply</button></div>' +
      '<div class="apf-row"><button class="apf-btn" data-edit>✏️ Edit what I wrote</button><button class="apf-btn" data-del>🗑️ Delete my copy</button></div>' +
      '<div class="apf-row"><button class="apf-btn" data-back>Back</button></div>';
    c.querySelector('[data-back]').onclick = () => showMyFeedback(view);
    const msg = c.querySelector('.apf-msg'), ta = c.querySelector('.apf-ta');
    let t;
    try { t = (await mineCall('/' + id)).thread; } catch (e) { msg.textContent = e.message; return; }
    c.querySelector('[data-status]').textContent = FB_STATUS[t.status] || t.status;
    c.querySelector('.apf-fbtext').textContent = t.message;
    const reps = c.querySelector('[data-reps]');
    if (!t.replies.length) reps.innerHTML = '<div class="apf-sub">No replies yet.</div>';
    for (const r of t.replies) {
      const d = document.createElement('div'); d.className = 'apf-rep' + (r.fromAdmin ? ' admin' : '');
      d.textContent = `${r.fromAdmin ? 'Admin' : 'You'}: ${r.body}`;
      reps.appendChild(d);
    }
    c.querySelector('[data-send]').onclick = async () => {
      if (!ta.value.trim()) return (msg.textContent = 'Write your reply first.');
      try { await mineCall(`/${id}/reply`, { body: ta.value }); showMyThread(id, view); } catch (e) { msg.textContent = e.message; }
    };
    const edit = c.querySelector('[data-edit]');
    if (['completed', 'canceled'].includes(t.status)) edit.remove();
    else edit.onclick = async () => {
      if (edit.dataset.on !== '1') { edit.dataset.on = '1'; ta.value = t.message; ta.placeholder = 'What you wrote'; edit.textContent = '💾 Save what I wrote'; c.querySelector('[data-send]').hidden = true; return; }
      try { await mineCall(`/${id}/edit`, { message: ta.value }); showMyThread(id, view); } catch (e) { msg.textContent = e.message; }
    };
    const del = c.querySelector('[data-del]');
    del.onclick = async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete it for you'; return; }
      try { await mineCall(`/${id}/delete`); showMyFeedback(view); } catch (e) { msg.textContent = e.message; }
    };
  }

  async function choose(p, pin) {
    const r = await api(`/${p.id}/use`, { pin });
    const chosen = {
      id: r.profile.id, name: r.profile.name, avatar: r.profile.avatar, hasPin: r.profile.hasPin, token: r.token,
      boardShow: r.profile.boardShow, initials: r.profile.initials
    };
    set(chosen);
    close(chosen);
  }

  function showPin(p) {
    const c = card();
    c.innerHTML = '<h2></h2><p>Enter your PIN.</p><input type="password" inputmode="numeric" maxlength="6" autocomplete="off"><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-back>Back</button></div>';
    c.querySelector('h2').textContent = `Hi, ${p.name}!`;
    const input = c.querySelector('input');
    PinPad.attach(input, async pin => {
      try { await choose(p, pin); } catch (e) { c.querySelector('.apf-msg').textContent = e.message; PinPad.clear(input); }
    }, { profile: true });
    c.querySelector('[data-back]').onclick = showList;
    setTimeout(() => input.focus(), 30);
  }

  // To ARKS ID's Create an account form, with this guest's name and avatar
  // already filled in (the arcade's server hands them over).
  async function makeAccount(g, c) {
    const msg = c.querySelector('.apf-msg');
    if (msg) msg.textContent = '';
    try {
      const res = await fetch('/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: g.name || '', avatar: g.avatar || '', return: location.pathname + location.search + location.hash }) });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error);
      location.href = data.url;
    } catch (e) {
      if (msg) msg.textContent = (e && e.message) || 'The sign-up page didn\'t open. Try again in a moment.';
    }
  }

  function showGuest() {
    const c = card();
    const was = get();
    const chosen = { value: was && was.guest && was.avatar ? was.avatar : 'emoji:👾' };
    c.innerHTML = '<h2>Playing as a guest</h2><p>Type a name, or leave it blank to be "Guest" with a number. Then pick an avatar for fun.</p><input maxlength="16" placeholder="Your name (optional)"><label>Avatar</label><div data-av></div><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn apf-main" data-ok>Play</button></div>' +
      (Id.on ? '<p class="apf-sub" data-join-note></p><div class="apf-row"><button class="apf-btn" data-join>✨ Make an account with these</button></div>' : '');
    const input = c.querySelector('input');
    if (was && was.guest && !/^Guest\b/.test(was.name)) input.value = was.name;
    avatarPicker(c.querySelector('[data-av]'), chosen);
    if (Id.on) {
      c.querySelector('[data-join-note]').textContent = 'With an ARKS ID account your scores count and follow you to the other family apps. Your name and avatar come along to the sign-up page.';
      c.querySelector('[data-join]').onclick = () => makeAccount({ name: input.value.trim(), avatar: chosen.value }, c);
    }
    const go = async () => {
      let n = input.value.trim().replace(/\s+/g, ' ').slice(0, 16);
      if (!n) { try { n = (await api('/guest', {})).name; } catch { n = 'Guest'; } }
      const g = { guest: true, name: n, avatar: chosen.value };
      set(g);
      close(g);
    };
    c.querySelector('[data-ok]').onclick = go;
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    c.querySelector('[data-back]').onclick = showList;
    setTimeout(() => input.focus(), 30);
  }

  // Avatar picker, shared by "new profile" and "my profile".
  function avatarPicker(box, chosenRef) {
    box.innerHTML = '<div class="apf-tabs"></div><div class="apf-av"></div>';
    const tabs = box.querySelector('.apf-tabs');
    const grid = box.querySelector('.apf-av');
    const showSet = set => {
      for (const t of tabs.children) t.classList.toggle('on', t.dataset.id === set.id);
      grid.innerHTML = '';
      for (const item of set.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = item.name;
        b.className = item.id === chosenRef.value ? 'on' : '';
        Avatars.put(b, item.id);
        b.onclick = () => { chosenRef.value = item.id; for (const x of grid.children) x.classList.remove('on'); b.classList.add('on'); };
        grid.appendChild(b);
      }
    };
    for (const set of Avatars.SETS) {
      const t = document.createElement('button');
      t.type = 'button';
      t.dataset.id = set.id;
      t.textContent = set.label;
      t.onclick = () => showSet(set);
      tabs.appendChild(t);
    }
    const start = Avatars.SETS.find(s => s.items.some(i => i.id === chosenRef.value)) || Avatars.SETS[0];
    showSet(start);
  }

  function showNew() {
    const c = card();
    const chosen = { value: Avatars.DEFAULT };
    c.innerHTML = '<h2>New profile</h2><p>A grown-up approves new profiles in the admin page. You can play as a guest until then.</p>' +
      '<label>Your name</label><input data-name maxlength="16" placeholder="e.g. Sam">' +
      '<label>Pick an avatar</label><div data-av></div>' +
      '<label>PIN (optional, 6 digits) to keep your profile yours</label><input data-pin type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="Leave blank for no PIN">' +
      '<div class="apf-msg"></div><div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn apf-main" data-ok>Create profile</button></div>';
    avatarPicker(c.querySelector('[data-av]'), chosen);
    c.querySelector('[data-back]').onclick = showList;
    c.querySelector('[data-ok]').onclick = async () => {
      try {
        await api('', { name: c.querySelector('[data-name]').value, avatar: chosen.value, pin: c.querySelector('[data-pin]').value.trim() });
        c.innerHTML = '<h2>🙌 Sent!</h2><p>Once a grown-up approves it in the admin page, your profile shows up here. Play as a guest until then.</p><div class="apf-row"><button class="apf-btn apf-main" data-back>OK</button></div>';
        c.querySelector('[data-back]').onclick = showList;
      } catch (e) { c.querySelector('.apf-msg').textContent = e.message; }
    };
  }

  function showManage() {
    const me = get();
    const c = card();
    const chosen = { value: me.avatar };
    c.innerHTML = '<h2></h2><label>Avatar</label><div data-av></div><div class="apf-row"><button class="apf-btn" data-save-av>Save avatar</button></div>' +
      '<label>On the high-score boards, show</label>' +
      '<label class="apf-pick"><input type="radio" name="apfShow" value="name"> My name, <b data-myname></b></label>' +
      '<label class="apf-pick"><input type="radio" name="apfShow" value="initials"> My initials <input data-ini maxlength="3" autocomplete="off" spellcheck="false" placeholder="ABC"></label>' +
      '<p class="apf-sub" style="text-align:left;margin:2px 0 0">You can change this any time, and your past scores switch to match.</p>' +
      '<div class="apf-row"><button class="apf-btn" data-save-board>Save</button></div>' +
      '<label>PIN</label><p data-pin-note style="text-align:left;margin:4px 0"></p>' +
      (me.hasPin ? '<input data-current type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="Current PIN">' : '') +
      '<input data-pin type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="New PIN (6 digits)">' +
      '<div class="apf-row"><button class="apf-btn" data-set-pin>Set PIN</button>' + (me.hasPin ? '<button class="apf-btn" data-clear-pin>Remove PIN</button>' : '') + '</div>' +
      '<div class="apf-msg"></div><div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn" data-out>Sign out</button></div>';
    c.querySelector('h2').textContent = me.name;
    c.querySelector('[data-pin-note]').textContent = me.hasPin
      ? 'Your profile PIN exists. To change it or remove it, type your current PIN.'
      : "Your profile doesn't have a PIN yet. Add a 6-digit one so nobody else can play as you.";
    avatarPicker(c.querySelector('[data-av]'), chosen);
    const msg = t => { c.querySelector('.apf-msg').textContent = t; };
    c.querySelector('[data-myname]').textContent = me.name;
    const ini = c.querySelector('[data-ini]');
    ini.value = initials();
    ini.oninput = () => {
      ini.value = ini.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      c.querySelector('input[value="initials"]').checked = true;
    };
    c.querySelector(`input[value="${me.boardShow === 'initials' ? 'initials' : 'name'}"]`).checked = true;
    c.querySelector('[data-save-board]').onclick = async () => {
      try {
        const boardShow = c.querySelector('input[name="apfShow"]:checked').value;
        if (boardShow === 'initials' && !ini.value) throw new Error('Type 1 to 3 letters for your initials.');
        const res = await fetch(`${API}/${me.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: me.token, boardShow, initials: ini.value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        set({ ...get(), boardShow: data.profile.boardShow, initials: data.profile.initials });
        msg(boardShow === 'initials' ? `The boards show ${data.profile.initials} now.` : `The boards show ${me.name} now.`);
      } catch (e) { msg(e.message); }
    };
    c.querySelector('[data-save-av]').onclick = async () => {
      try {
        const res = await fetch(`${API}/${me.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: me.token, avatar: chosen.value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        set({ ...get(), avatar: data.profile.avatar });
        msg('Avatar saved.');
      } catch (e) { msg(e.message); }
    };
    const pinChange = async pin => {
      try {
        const current = c.querySelector('[data-current]') ? c.querySelector('[data-current]').value.trim() : '';
        const r = await api(`/${me.id}/pin`, { token: me.token, pin, current });
        set({ ...me, hasPin: r.profile.hasPin, token: r.token });
        showManage();
        card().querySelector('.apf-msg').textContent = pin ? 'PIN saved.' : 'PIN removed.';
      } catch (e) { msg(e.message); }
    };
    c.querySelector('[data-set-pin]').onclick = () => pinChange(c.querySelector('[data-pin]').value.trim());
    if (c.querySelector('[data-clear-pin]')) c.querySelector('[data-clear-pin]').onclick = () => pinChange('');
    c.querySelector('[data-back]').onclick = showList;
    c.querySelector('[data-out]').onclick = () => { set(null); showList(); };
  }

  // Fill the usual name boxes on a game page with the player's name.
  function fillNames(ids = ['hostName', 'joinName', 'nameInput']) {
    const n = name();
    if (!n) return;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = n;
    }
  }
  document.addEventListener('DOMContentLoaded', () => fillNames());

  return { get, set, name, token, initials, onChange, open, askIfNobody, avatarEl, fillNames, openAccount, arksId: () => Id };
})();
