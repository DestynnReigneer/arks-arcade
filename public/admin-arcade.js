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

  function token() {
    if (window.ADMIN_TOKEN) return window.ADMIN_TOKEN;
    try { return localStorage.getItem('wordless_admin_token') || ''; } catch { return ''; }
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Admin-Token': token() },
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
      <div class="fb-controls">
        <select></select>
        <input type="text" maxlength="500" placeholder="Note to self (optional)">
        <button data-act="save">Save</button>
        <button data-act="delete" class="danger">Delete</button>
      </div>`;
    card.querySelector('.fb-kind').textContent = KIND_LABELS[item.kind] || item.kind;
    card.querySelector('.fb-from').textContent =
      `from ${item.from || 'anonymous'}${item.game ? ' · ' + GAME_LABELS[item.game] : ''}`;
    card.querySelector('.fb-when').textContent = when(item.createdAt);
    card.querySelector('.fb-msg').textContent = item.message;

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
      $('pinStatus').textContent = !s.set
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

  // ---- home page games -------------------------------------------------------

  const GAME_EMOJI = { wordless: '🔤', rambler: '🔠', spinsolve: '🎡', chess: '♞', dino: '🦖', trivia: '🧠', partdeux: '🚨', daredevil: '😈', snake: '🐍', bricks: '🧱', blocks: '🟪', towers: '🏰' };
  let home = null;

  async function loadHomeGames() {
    try { home = await api('/home-games'); renderHomeGames(); } catch (e) { $('homeGames').textContent = e.message; }
  }

  function renderHomeGames() {
    const box = $('homeGames');
    box.innerHTML = '';
    home.order.forEach((id, i) => {
      const hidden = home.hidden.includes(id);
      const row = document.createElement('div');
      row.className = 'theme-row';
      row.style.opacity = hidden ? '0.5' : '1';
      row.innerHTML = `<span></span>
        <span style="display:flex;gap:6px">
          <button class="small-btn" data-act="up" title="Move up">▲</button>
          <button class="small-btn" data-act="down" title="Move down">▼</button>
          <button class="small-btn" data-act="hide"></button>
        </span>`;
      row.firstChild.textContent = `${i + 1}. ${GAME_EMOJI[id] || ''} ${GAME_LABELS[id] || id}${hidden ? ' (hidden)' : ''}`;
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
    saveHomeGames({ order, hidden: home.hidden });
  }

  function toggleHidden(id) {
    const hidden = home.hidden.includes(id) ? home.hidden.filter(x => x !== id) : [...home.hidden, id];
    saveHomeGames({ order: home.order, hidden });
  }

  // ---- wiring --------------------------------------------------------------

  function refresh() {
    loadFeedback();
    loadPosts();
    loadHomeGames();
    loadPin();
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderQuickPosts();
    $('postBtn').onclick = postAnnouncement;
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
