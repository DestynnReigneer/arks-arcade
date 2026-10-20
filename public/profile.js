'use strict';

// "Who's playing?" for the whole arcade. The choice lives on this device
// (localStorage) and every game reads it: names fill themselves in, and
// scores are credited to the profile with its signed token. Guests just
// get a name. Needs avatars.js loaded first. Brings its own styles.

const ArcadeProfile = (() => {
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
  const initials = () => name().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const onChange = fn => listeners.push(fn);

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
    .apf{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(5,4,10,.85);backdrop-filter:blur(3px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f4ecd0}
    .apf-card{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:#1e1a30;border:1px solid #3d3958;border-radius:18px;padding:18px}
    .apf h2{margin:0 0 4px;font-size:20px;text-align:center}.apf p{margin:4px 0 12px;font-size:13px;color:#c9b98a;text-align:center;line-height:1.45}
    .apf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;margin:10px 0}
    .apf-tile{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border-radius:14px;border:2px solid transparent;background:#171623;color:inherit;cursor:pointer;font:inherit;font-size:13px;font-weight:700}
    .apf-tile:hover,.apf-tile.on{border-color:#ffc72c}.apf-tile .lock{font-size:11px;opacity:.7;font-weight:600}
    .apf-row{display:flex;gap:8px;margin-top:10px}.apf-row>*{flex:1}
    .apf button.apf-btn{padding:11px;border-radius:10px;border:1px solid #3d3958;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer}
    .apf button.apf-main{background:#ffc72c;color:#1a0f05;border-color:#ffc72c}
    .apf input{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #3d3958;background:#12111c;color:#fff;font:inherit;font-size:15px;margin:6px 0}
    .apf-msg{min-height:18px;color:#ff7a7a;font-size:13px;text-align:center;margin:6px 0}
    .apf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.apf-tabs button{padding:5px 10px;border-radius:999px;border:1px solid #3d3958;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
    .apf-tabs button.on{border-color:#ffc72c;color:#ffc72c}
    .apf-av{display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:8px;margin:6px 0 10px}
    .apf-av button{padding:3px;border-radius:50%;border:3px solid transparent;background:none;cursor:pointer;aspect-ratio:1}.apf-av button.on{border-color:#ffc72c}
    .apf label{display:block;font-size:12px;color:#c9b98a;margin-top:8px}.apf-sub{font-size:12px;color:#8f8367;text-align:center;margin-top:10px}
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
    root.addEventListener('click', e => { if (e.target === root) close(); });
    document.body.appendChild(root);
  }
  const card = () => root.querySelector('.apf-card');
  let resolveOpen = null;
  function close(result = null) {
    if (root) root.style.display = 'none';
    if (resolveOpen) { resolveOpen(result); resolveOpen = null; }
  }

  // Opens the picker. Resolves with the chosen profile, or null.
  function open() {
    ensure();
    root.style.display = 'flex';
    showList();
    return new Promise(r => { resolveOpen = r; });
  }

  async function showList() {
    const c = card();
    c.innerHTML = '<h2>Who\'s playing?</h2><p>Pick your profile, or play as a guest.</p><div class="apf-grid"></div><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-guest>👤 Play as a guest</button><button class="apf-btn" data-new>➕ New profile</button></div>' +
      (get() && get().id ? '<div class="apf-row"><button class="apf-btn" data-manage>⚙️ My profile: avatar &amp; PIN</button></div>' : '') +
      '<div class="apf-row"><button class="apf-btn" data-close>Close</button></div>';
    c.querySelector('[data-guest]').onclick = showGuest;
    c.querySelector('[data-new]').onclick = showNew;
    c.querySelector('[data-close]').onclick = () => close(get());
    if (c.querySelector('[data-manage]')) c.querySelector('[data-manage]').onclick = showManage;
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

  async function choose(p, pin) {
    const r = await api(`/${p.id}/use`, { pin });
    const chosen = { id: r.profile.id, name: r.profile.name, avatar: r.profile.avatar, hasPin: r.profile.hasPin, token: r.token };
    set(chosen);
    close(chosen);
  }

  function showPin(p) {
    const c = card();
    c.innerHTML = '<h2></h2><p>Enter your PIN.</p><input type="password" inputmode="numeric" maxlength="8" autocomplete="off"><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn apf-main" data-ok>Let\'s go</button></div>';
    c.querySelector('h2').textContent = `Hi, ${p.name}!`;
    const input = c.querySelector('input');
    const go = async () => { try { await choose(p, input.value.trim()); } catch (e) { c.querySelector('.apf-msg').textContent = e.message; } };
    c.querySelector('[data-ok]').onclick = go;
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    c.querySelector('[data-back]').onclick = showList;
    setTimeout(() => input.focus(), 30);
  }

  function showGuest() {
    const c = card();
    c.innerHTML = '<h2>Playing as a guest</h2><p>Type a name, or leave it blank to be "Guest" with a number.</p><input maxlength="16" placeholder="Your name (optional)"><div class="apf-msg"></div>' +
      '<div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn apf-main" data-ok>Play</button></div>';
    const input = c.querySelector('input');
    const go = async () => {
      let n = input.value.trim().replace(/\s+/g, ' ').slice(0, 16);
      if (!n) { try { n = (await api('/guest', {})).name; } catch { n = 'Guest'; } }
      const g = { guest: true, name: n, avatar: 'emoji:👾' };
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
      '<label>PIN (optional, 4–8 digits) to keep your profile yours</label><input data-pin type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="Leave blank for no PIN">' +
      '<div class="apf-msg"></div><div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn apf-main" data-ok>Ask for it</button></div>';
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
      '<label>PIN</label><p style="text-align:left;margin:4px 0"></p><input data-pin type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="New PIN (4–8 digits)">' +
      '<div class="apf-row"><button class="apf-btn" data-set-pin>Set PIN</button>' + (me.hasPin ? '<button class="apf-btn" data-clear-pin>Remove PIN</button>' : '') + '</div>' +
      '<div class="apf-msg"></div><div class="apf-row"><button class="apf-btn" data-back>Back</button><button class="apf-btn" data-out>Sign out</button></div>';
    c.querySelector('h2').textContent = me.name;
    c.querySelector('p').textContent = me.hasPin ? 'Your profile has a PIN. Change it or remove it here.' : 'No PIN yet. Add one so nobody else can play as you.';
    avatarPicker(c.querySelector('[data-av]'), chosen);
    const msg = t => { c.querySelector('.apf-msg').textContent = t; };
    c.querySelector('[data-save-av]').onclick = async () => {
      try {
        const res = await fetch(`${API}/${me.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: me.token, avatar: chosen.value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        set({ ...me, avatar: data.profile.avatar });
        msg('Avatar saved.');
      } catch (e) { msg(e.message); }
    };
    const pinChange = async pin => {
      try {
        const r = await api(`/${me.id}/pin`, { token: me.token, pin });
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

  return { get, set, name, token, initials, onChange, open, avatarEl, fillNames };
})();
