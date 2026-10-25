'use strict';

// Admin for the arcade as a whole: the Comm Center inbox, home-page
// announcements, and the adult PIN. Shares the admin password admin.js unlocks.

(() => {
  const API = '/api/comm/admin';
  const $ = id => document.getElementById(id);

  const STATUS_LABELS = {
    new: '🆕 New', pending: '⏳ Pending', 'in-progress': '🔧 In progress',
    completed: '✅ Completed', canceled: '🚫 Canceled'
  };
  const KIND_LABELS = { feature: '💡 Feature idea', issue: '🐛 Issue', message: '💬 Message' };
  const GAME_LABELS = { wordless: 'Wordless', rambler: 'Rambler', spinsolve: 'Spin & Solve', chess: 'Chess', dino: 'Dino Dash', trivia: 'Know-It-All', partdeux: 'Uh-Oh: Part Deux', daredevil: 'Dare Devil', snake: 'Snake', bricks: 'Brick Breaker', blocks: 'Block Drop', towers: 'Tower Defense' };

  // One-tap posts. Gaming culture is half the fun of the board.
  const QUICK_POSTS = [
    { emoji: '🍀', title: 'GLHF', body: 'Good luck, have fun!' },
    { emoji: '🤝', title: 'GG', body: 'Good game, everyone. See you on the leaderboard.' },
    { emoji: '🛠️', title: 'Patch notes', body: 'New fixes and features just landed in the arcade.' },
    { emoji: '🌙', title: 'Servers closing soon', body: 'Last round, everybody. Time for bed.' },
    { emoji: '🏁', title: 'Tournament night!', body: 'Highest score tonight gets bragging rights until next time.' }
  ];

  const state = { filter: 'all' };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new Error((data && data.error) || `Failed (${res.status})`);
    return data;
  }

  function say(el, text, good = true) {
    el.textContent = text;
    el.style.color = good ? '#6ee7a8' : '#ff9a9a';
    if (text) setTimeout(() => { el.textContent = ''; }, 5000);
  }

  const when = iso => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ---- inbox ------------------------------------------------------------------

  async function loadFeedback() {
    const host = $('feedbackList');
    try {
      const { statuses, items } = await api('/feedback');
      renderFeedbackTabs(statuses, items);
      const shown = state.filter === 'all' ? items : items.filter(i => i.status === state.filter);
      host.innerHTML = '';
      if (!shown.length) {
        host.innerHTML = '<div class="empty-note">Nothing here.</div>';
        return;
      }
      shown.forEach(item => host.appendChild(feedbackCard(item, statuses)));
    } catch (e) {
      host.textContent = e.message;
    }
  }

  function renderFeedbackTabs(statuses, items) {
    const host = $('feedbackTabs');
    host.innerHTML = '';
    for (const key of ['all', ...statuses]) {
      const count = key === 'all' ? items.length : items.filter(i => i.status === key).length;
      const b = document.createElement('button');
      b.textContent = `${key === 'all' ? 'All' : STATUS_LABELS[key]} (${count})`;
      b.setAttribute('aria-pressed', String(state.filter === key));
      b.onclick = () => { state.filter = key; loadFeedback(); };
      host.appendChild(b);
    }
  }

  function feedbackCard(item, statuses) {
    const card = document.createElement('div');
    card.className = 'fb-card';
    card.innerHTML = `
      <div class="fb-head"><span class="fb-kind"></span><span class="fb-from"></span><span class="fb-when"></span></div>
      <div class="fb-msg"></div>
      <div class="fb-extra"></div>
      <div class="fb-controls">
        <select></select>
        <input type="text" maxlength="500" placeholder="Note to self (optional)">
        <button data-act="save">Save</button>
        <button data-act="copy">📋 Copy for chat</button>
        <button data-act="delete" class="danger">Delete</button>
      </div>`;
    card.querySelector('.fb-kind').textContent = KIND_LABELS[item.kind] || item.kind;
    card.querySelector('.fb-from').textContent =
      `from ${item.from || 'anonymous'}${item.game ? ' · ' + GAME_LABELS[item.game] : ''}`;
    card.querySelector('.fb-when').textContent = when(item.createdAt);
    card.querySelector('.fb-msg').textContent = item.message;
    // From the feedback card: where it was sent from, the device, the errors
    // the page saw, and maybe a screenshot (tap it to open the viewer).
    const extra = card.querySelector('.fb-extra');
    const d = item.details || {};
    const facts = [item.page && `Page: ${item.page}`, d.device && `Device: ${d.device}`, (d.window || d.screen) && `Window: ${d.window || d.screen}`,
      d.app ? `Arcade ${d.app.version}, ${d.app.commit}` : d.version && `Arcade ${d.version}`].filter(Boolean);
    if (facts.length) {
      const line = document.createElement('div');
      line.className = 'fb-facts';
      line.textContent = facts.join(' · ');
      extra.appendChild(line);
    }
    if (item.hasPicture) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fb-thumb';
      b.setAttribute('aria-label', 'Open the screenshot full screen');
      const img = document.createElement('img');
      img.className = 'fb-pic';
      img.alt = 'Screenshot sent with this message';
      img.loading = 'lazy';
      img.src = `${API}/feedback/${item.id}/picture`;
      b.appendChild(img);
      b.onclick = () => openViewer(item.id);
      extra.appendChild(b);
    }
    // Each error the page saw gets a Search the web button.
    if ((d.errors || []).length) {
      const ul = document.createElement('ul');
      ul.className = 'fb-errs';
      d.errors.forEach(err => {
        const li = document.createElement('li');
        const msg = document.createElement('span');
        msg.textContent = err.message;
        const s = document.createElement('button');
        s.type = 'button';
        s.textContent = '🔎 Search the web';
        s.onclick = () => openSearch(err.message);
        li.append(msg, s);
        ul.appendChild(li);
      });
      extra.appendChild(ul);
    }
    const det = document.createElement('details');
    det.className = 'fb-diag';
    const sum = document.createElement('summary');
    sum.textContent = 'Diagnostics for a Claude session';
    const pre = document.createElement('pre');
    pre.textContent = chatBlock(item);
    det.append(sum, pre);
    extra.appendChild(det);
    card.querySelector('[data-act="copy"]').onclick = async e => {
      const text = chatBlock(item);
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = '✓ Copied';
      } catch {
        // The clipboard needs HTTPS or localhost: select the block instead.
        det.open = true;
        const r = document.createRange();
        r.selectNodeContents(pre);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        e.target.textContent = 'Selected, press Ctrl+C';
      }
      setTimeout(() => { e.target.textContent = '📋 Copy for chat'; }, 1800);
    };

    const select = card.querySelector('select');
    for (const s of statuses) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = STATUS_LABELS[s] || s;
      select.appendChild(o);
    }
    select.value = item.status;
    const note = card.querySelector('input');
    note.value = item.note || '';

    card.querySelector('[data-act="save"]').onclick = async () => {
      try {
        await api(`/feedback/${item.id}`, { method: 'PATCH', body: { status: select.value, note: note.value } });
        say($('feedbackMsg'), 'Saved.');
        loadFeedback();
      } catch (e) { say($('feedbackMsg'), e.message, false); }
    };
    card.querySelector('[data-act="delete"]').onclick = async () => {
      if (!confirm('Delete this message for good?')) return;
      try {
        await api(`/feedback/${item.id}`, { method: 'DELETE' });
        loadFeedback();
      } catch (e) { say($('feedbackMsg'), e.message, false); }
    };
    return card;
  }

  // Everything the bug sent, as one plain-text block made for pasting into a
  // chat with an AI helper: who, when, what they wrote, then the details.
  function chatBlock(item) {
    const d = item.details || {}, app = d.app || {}, srv = d.server || {};
    const yes = (v, a, b) => (v === true ? a : v === false ? b : 'unknown');
    return [
      `Arcade feedback #${item.id}`,
      `Kind: ${KIND_LABELS[item.kind] || item.kind}`,
      `From: ${item.from || 'a guest'}`,
      `About: ${item.game ? GAME_LABELS[item.game] : 'the arcade in general'}`,
      `Sent: ${srv.receivedAt ? new Date(srv.receivedAt).toString().slice(0, 33) : item.createdAt}`,
      `Status: ${STATUS_LABELS[item.status] || item.status}`,
      '',
      'What they wrote:',
      ...item.message.split('\n').map(l => '> ' + l),
      '',
      `App: Arcade ${app.version || d.version || '?'}, commit ${app.commit || 'unknown'}`,
      `Page: ${d.page || item.page || '?'}${d.view ? ` (${d.view})` : ''}`,
      `Device: ${[d.device, d.platform, d.screen && d.screen + ' screen', d.window && d.window + ' window', d.pixelRatio && 'pixel ratio ' + d.pixelRatio, yes(d.touch, 'touch', 'mouse')].filter(Boolean).join(', ')}`,
      `Browser: ${d.userAgent || srv.userAgent || 'unknown'}`,
      `Language and time zone: ${d.language || '?'}, ${d.timeZone || '?'}${d.localTime ? ` (their clock: ${d.localTime})` : ''}`,
      `Preferences: ${d.colorScheme || '?'} color scheme, reduced motion ${yes(d.reducedMotion, 'on', 'off')}`,
      `Network: ${yes(d.online, 'online', 'offline')}${d.connection ? ', ' + d.connection : ''}`,
      `Page open for: ${d.openForSeconds != null ? d.openForSeconds + ' s' : '?'}${d.loadMs != null ? `, loaded in ${d.loadMs} ms` : ''}`,
      `Screenshot: ${item.hasPicture ? 'yes, on the admin page' : 'none'}`,
      '',
      'JavaScript errors on the page (last 10):',
      ...((d.errors || []).length ? d.errors.map(e => `- ${e.at} ${e.message}${e.source ? ` (${e.source})` : ''}`) : ['- none']),
      '',
      'Failed requests to the arcade (last 10):',
      ...((d.requests || []).length ? d.requests.map(r => `- ${r.at} ${r.method} ${r.path} → ${r.status || 'no answer'} in ${r.ms} ms`) : ['- none'])
    ].join('\n');
  }

  // The picture viewer: full screen, zoom with the buttons, the wheel or a
  // pinch, drag to look around, or open the picture in its own tab.
  let viewer = null;
  function openViewer(id) {
    const src = `${API}/feedback/${id}/picture`;
    let zoom = 1, fit = 1;
    viewer = document.createElement('div');
    viewer.className = 'fbv';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', `Feedback #${id} screenshot`);
    viewer.innerHTML = '<div class="fbv-bar"><button type="button" data-z="out" aria-label="Zoom out">−</button><span class="fbv-zoom"></span>' +
      '<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="fit">Fit</button>' +
      '<button type="button" data-z="one">Actual size</button><a target="_blank" rel="noopener">Open in a new tab</a>' +
      '<span class="fbv-sp"></span><button type="button" data-z="close" class="fbv-close">Close</button></div><div class="fbv-stage"><img alt=""></div>';
    viewer.querySelector('a').href = src;
    document.body.appendChild(viewer);
    const stage = viewer.querySelector('.fbv-stage'), img = viewer.querySelector('img');
    img.alt = `Screenshot sent with feedback #${id}`;
    const setZoom = z => {
      zoom = Math.min(8, Math.max(0.1, z));
      img.style.width = Math.round(img.naturalWidth * zoom) + 'px';
      viewer.querySelector('.fbv-zoom').textContent = Math.round(zoom * 100) + '%';
    };
    img.onload = () => {
      fit = Math.min(1, (stage.clientWidth - 20) / img.naturalWidth, (stage.clientHeight - 20) / img.naturalHeight);
      setZoom(fit);
    };
    img.src = src;
    viewer.addEventListener('click', e => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      const z = b.dataset.z;
      if (z === 'close') return closeViewer();
      setZoom(z === 'in' ? zoom * 1.25 : z === 'out' ? zoom / 1.25 : z === 'fit' ? fit : 1);
    });
    stage.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    // Drag with one finger or the mouse to look around; pinch with two to zoom.
    const pts = {};
    let drag = null, pinch = null;
    stage.addEventListener('pointerdown', e => {
      pts[e.pointerId] = e;
      stage.setPointerCapture(e.pointerId);
      const ids = Object.keys(pts);
      if (ids.length === 1) { drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; stage.classList.add('drag'); }
      if (ids.length === 2) { const a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoom }; drag = null; }
    });
    stage.addEventListener('pointermove', e => {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = e;
      const ids = Object.keys(pts);
      if (pinch && ids.length === 2) { const a = pts[ids[0]], b = pts[ids[1]]; setZoom(pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d); }
      else if (drag) { stage.scrollLeft = drag.l - (e.clientX - drag.x); stage.scrollTop = drag.t - (e.clientY - drag.y); }
    });
    const lift = e => {
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
      if (!Object.keys(pts).length) { drag = null; stage.classList.remove('drag'); }
    };
    stage.addEventListener('pointerup', lift);
    stage.addEventListener('pointercancel', lift);
    viewer.querySelector('[data-z="close"]').focus();
  }
  function closeViewer() { if (viewer) { viewer.remove(); viewer = null; } }

  // Search the web, in two steps: first the error message alone is cleaned
  // (addresses, emails, IPs, this server's own name, ids and long numbers
  // become placeholders), then shown in a box you can edit. Nothing goes to
  // the search engine until you press Search.
  function cleanForSearch(msg) {
    const host = location.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(msg)
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'")\]]+/gi, '<address>')   // web addresses
      .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '<email>')           // email addresses
      .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<ip address>')    // IP addresses
      .replace(host ? new RegExp(`\\b${host}\\b`, 'gi') : /$^/, '<address>') // this server's name
      .replace(/\b[us]_[0-9a-f]{6,}\b/gi, '<id>')                      // account and session ids
      .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi, '<id>')           // long hex ids
      .replace(/\b\d{5,}\b/g, '<number>')                              // long numbers
      .replace(/\s+/g, ' ').trim();
  }
  function openSearch(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'fbv fbs';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<form class="fbs-card"><h2>Search the web</h2>' +
      '<p>This is exactly what will be searched. Web addresses, IP addresses, this server\'s name, ids and long numbers have been swapped for placeholders, so nothing about your network goes out. You can change the words before searching.</p>' +
      '<textarea rows="3" maxlength="400" aria-label="Search for"></textarea>' +
      '<div class="fbs-row"><button type="button" data-cancel>Cancel</button><button type="submit" class="fbs-go">Search</button></div></form>';
    document.body.appendChild(wrap);
    const q = wrap.querySelector('textarea');
    q.value = cleanForSearch(msg);
    const close = () => wrap.remove();
    wrap.querySelector('[data-cancel]').onclick = close;
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const words = q.value.trim();
      if (!words) return;
      window.open('https://www.google.com/search?q=' + encodeURIComponent(words), '_blank', 'noopener');
      close();
    };
    q.focus();
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (viewer) closeViewer();
    const s = document.querySelector('.fbs');
    if (s) s.remove();
  });

  // ---- announcements -------------------------------------------------------

  async function loadPosts() {
    const host = $('postList');
    try {
      const posts = await fetch('/api/comm/posts?limit=30').then(r => r.json());
      host.innerHTML = '';
      if (!posts.length) {
        host.innerHTML = '<div class="empty-note">Nothing posted yet.</div>';
        return;
      }
      for (const p of posts) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<span class="grow"><span class="t"></span><div class="muted"></div></span><button class="danger">Remove</button>`;
        row.querySelector('.t').textContent = `${p.emoji} ${p.title}`;
        row.querySelector('.muted').textContent = `${when(p.createdAt)} · ${p.kind}`;
        row.querySelector('button').onclick = async () => {
          try {
            await api(`/posts/${p.id}`, { method: 'DELETE' });
            loadPosts();
          } catch (e) { say($('postMsg'), e.message, false); }
        };
        host.appendChild(row);
      }
    } catch (e) {
      host.textContent = e.message;
    }
  }

  function renderQuickPosts() {
    const host = $('quickPosts');
    host.innerHTML = '';
    for (const q of QUICK_POSTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${q.emoji} ${q.title}`;
      b.title = 'Fill the form with this';
      b.onclick = () => {
        $('postEmoji').value = q.emoji;
        $('postTitle').value = q.title;
        $('postBody').value = q.body;
      };
      host.appendChild(b);
    }
  }

  async function postAnnouncement() {
    try {
      await api('/posts', {
        method: 'POST',
        body: {
          emoji: $('postEmoji').value, title: $('postTitle').value,
          body: $('postBody').value, game: $('postGame').value || null
        }
      });
      $('postTitle').value = '';
      $('postBody').value = '';
      say($('postMsg'), 'Posted. It is on the home page now.');
      loadPosts();
    } catch (e) { say($('postMsg'), e.message, false); }
  }

  // ---- adult PIN -----------------------------------------------------------

  async function loadPin() {
    try {
      const s = await api('/adult-pin');
      $('pinStatus').textContent = s.source === 'arksid'
        ? 'This arcade signs in through ARKS ID, so adult levels open for grown-ups’ ARKS ID accounts (adult or admin) and there is no adult PIN.'
        : !s.set
        ? 'No PIN set: anyone can switch on adult content with a confirmation tap.'
        : s.source === 'env' ? 'A PIN is set (from ADULT_PIN in .env).' : 'A PIN is set (from this page).';
    } catch (e) { $('pinStatus').textContent = e.message; }
  }

  async function savePin(pin) {
    try {
      await api('/adult-pin', { method: 'POST', body: { pin } });
      $('pinInput').value = '';
      say($('pinMsg'), pin ? 'PIN saved.' : 'PIN removed.');
      loadPin();
    } catch (e) { say($('pinMsg'), e.message, false); }
  }

  // ---- send a clip ----------------------------------------------------------

  async function loadClips() {
    try {
      const [media, people] = await Promise.all([fetch('/api/custom').then(r => r.json()), fetch('/api/profiles').then(r => r.json())]);
      const pick = $('clipPick');
      const to = $('clipTo');
      pick.innerHTML = '';
      to.innerHTML = '';
      for (const c of media.clips) pick.add(new Option(`${c.name} (${c.type})`, c.name));
      to.add(new Option('Everyone', 'everyone'));
      for (const p of people) to.add(new Option(p.name, p.id));
      const none = !media.clips.length;
      $('clipSendBtn').disabled = none;
      if (none) pick.add(new Option('No clips on the server yet', ''));
    } catch (e) { say($('clipMsg'), e.message, false); }
  }
  async function sendClip() {
    try {
      const r = await fetch('/api/custom/admin/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip: $('clipPick').value, to: $('clipTo').value })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That did not work.');
      say($('clipMsg'), d.sent === 1 ? 'Sent. It plays the next time their screen is open.' : `Sent to ${d.sent} people. It plays the next time each of their screens is open.`);
    } catch (e) { say($('clipMsg'), e.message, false); }
  }

  // ---- home page games -------------------------------------------------------

  const GAME_EMOJI = { wordless: '🔤', rambler: '🔠', spinsolve: '🎡', chess: '♞', dino: '🦖', trivia: '🧠', partdeux: '🚨', daredevil: '😈', snake: '🐍', bricks: '🧱', blocks: '🟪', towers: '🏰' };
  let home = null;

  async function loadHomeGames() {
    try { home = await api('/home-games'); renderHomeGames(); } catch (e) { $('homeGames').textContent = e.message; }
  }

  function renderHomeGames() {
    const box = $('homeGames');
    box.innerHTML = '';
    const sortRow = document.createElement('label');
    sortRow.className = 'theme-row';
    sortRow.style.justifyContent = 'flex-start';
    sortRow.style.gap = '8px';
    sortRow.innerHTML = '<input type="checkbox"> <span>Put each person\'s most-played games first</span>';
    const sortBox = sortRow.querySelector('input');
    sortBox.checked = home.sort === 'played';
    sortBox.onchange = () => saveHomeGames({ ...home, sort: sortBox.checked ? 'played' : 'fixed' });
    box.appendChild(sortRow);
    home.order.forEach((id, i) => {
      const hidden = home.hidden.includes(id);
      const closed = home.closed.includes(id);
      const row = document.createElement('div');
      row.className = 'theme-row';
      row.style.opacity = hidden || closed ? '0.5' : '1';
      row.innerHTML = `<span></span>
        <span style="display:flex;gap:6px">
          <button class="small-btn" data-act="up" title="Move up">▲</button>
          <button class="small-btn" data-act="down" title="Move down">▼</button>
          <button class="small-btn" data-act="close"></button>
          <button class="small-btn" data-act="hide"></button>
        </span>`;
      row.firstChild.textContent = `${i + 1}. ${GAME_EMOJI[id] || ''} ${GAME_LABELS[id] || id}${closed ? ' (turned off)' : ''}${hidden ? ' (hidden)' : ''}`;
      const closeBtn = row.querySelector('[data-act="close"]');
      closeBtn.textContent = closed ? '🚧 Turn on' : '✅ Turn off';
      closeBtn.title = closed ? 'Open this game again' : 'Show the "Pardon our dust" sign instead of the game';
      closeBtn.onclick = () => saveHomeGames({ ...home, closed: closed ? home.closed.filter(x => x !== id) : [...home.closed, id] });
      const up = row.querySelector('[data-act="up"]');
      const down = row.querySelector('[data-act="down"]');
      up.disabled = i === 0;
      down.disabled = i === home.order.length - 1;
      row.querySelector('[data-act="hide"]').textContent = hidden ? '👁 Show' : '🙈 Hide';
      up.onclick = () => move(i, -1);
      down.onclick = () => move(i, 1);
      row.querySelector('[data-act="hide"]').onclick = () => toggleHidden(id);
      box.appendChild(row);
    });
  }

  async function saveHomeGames(next) {
    try {
      home = await api('/home-games', { method: 'POST', body: next });
      renderHomeGames();
      say($('homeGamesMsg'), 'Saved. The home page shows the new order now.');
    } catch (e) { say($('homeGamesMsg'), e.message, false); }
  }

  function move(i, by) {
    const order = home.order.slice();
    const [id] = order.splice(i, 1);
    order.splice(i + by, 0, id);
    saveHomeGames({ ...home, order });
  }

  function toggleHidden(id) {
    const hidden = home.hidden.includes(id) ? home.hidden.filter(x => x !== id) : [...home.hidden, id];
    saveHomeGames({ ...home, hidden });
  }

  // ---- wiring --------------------------------------------------------------

  function refresh() {
    loadFeedback();
    loadPosts();
    loadHomeGames();
    loadClips();
    loadPin();
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderQuickPosts();
    $('postBtn').onclick = postAnnouncement;
    $('clipSendBtn').onclick = sendClip;
    $('savePinBtn').onclick = () => {
      const pin = $('pinInput').value.trim();
      if (!pin) return say($('pinMsg'), 'Type a PIN first, or use Remove PIN.', false);
      savePin(pin);
    };
    $('clearPinBtn').onclick = () => {
      if (confirm('Remove the adult PIN? Anyone could then turn on adult content with one tap.')) savePin('');
    };
    document.addEventListener('admin-tab', e => { if (e.detail === 'tabArcade') refresh(); });

    // admin.js reveals #adminContent once the password is accepted.
    const content = $('adminContent');
    const ready = () => !content.classList.contains('hidden');
    if (ready()) refresh();
    else {
      const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); refresh(); } });
      obs.observe(content, { attributes: true, attributeFilter: ['class'] });
    }
  });
})();
