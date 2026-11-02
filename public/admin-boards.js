'use strict';

// Admin: take a single score off any game's board, and put it back
// (arcade/score-admin.js). Remove takes two taps, so a slip of the finger
// doesn't take anything off; nothing is ever deleted, and Put back is one tap.

(() => {
  const API = '/api/admin/scores';
  const $ = id => document.getElementById(id);
  let games = [];
  let armed = null;   // the Remove button waiting for its second tap

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const say = (text, ok = true) => { $('boardsMsg').textContent = text; $('boardsMsg').className = 'status-msg ' + (ok ? 'ok' : 'error'); };
  const clock = ms => {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };
  const game = () => games.find(g => g.id === $('boardsGame').value);
  const valueOf = (unit, v) => (unit === 'time' ? clock(v) : `${Number(v).toLocaleString('en-US')} pts`);
  const nice = d => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const when = t => (t ? new Date(t.replace(' ', 'T') + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  function fillGames() {
    const sel = $('boardsGame'), was = sel.value;
    sel.innerHTML = '';
    for (const g of games) sel.add(new Option(g.label, g.id));
    if (games.some(g => g.id === was)) sel.value = was;
    fillBoards();
  }
  function fillBoards() {
    const g = game();
    const sel = $('boardsBoard'), was = sel.value;
    sel.innerHTML = '';
    for (const b of g ? g.boards : []) sel.add(new Option(b.label, b.id));
    if (g && g.boards.some(b => b.id === was)) sel.value = was;
    sel.disabled = !g || g.boards.length < 2;
    $('boardsDayWrap').classList.toggle('hidden', !g || !g.daily);
  }

  function row(r, unit, removed) {
    const el = document.createElement('div');
    el.className = 'row';
    const who = r.name ? `${r.name} (${r.initials})` : r.initials;
    // A daily board's day is already local; created_at is saved in UTC.
    const saved = r.createdAt ? new Date(r.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const bits = [r.day ? nice(r.day) : saved, r.detail].filter(Boolean);
    if (removed) bits.push(`taken off ${when(r.removedAt)}${r.removedBy ? ` by ${r.removedBy}` : ''}`);
    el.innerHTML = '<span class="num"></span><div class="grow"><div class="who"></div><div class="muted"></div></div><span class="num val"></span><button type="button"></button>';
    el.querySelector('.num').textContent = removed ? '' : `#${r.rank}`;
    el.querySelector('.who').textContent = who;
    el.querySelector('.muted').textContent = bits.join(' · ');
    el.querySelector('.val').textContent = valueOf(unit, r.value);
    const btn = el.querySelector('button');
    if (removed) {
      btn.textContent = 'Put back';
      btn.onclick = () => act(`/${$('boardsGame').value}/${r.id}/restore`, `${who}'s score is back on the board.`);
    } else {
      btn.textContent = 'Remove';
      btn.className = 'danger';
      btn.onclick = () => {
        if (armed !== btn) {
          disarm();
          armed = btn;
          btn.textContent = 'Tap again to remove';
          btn.timer = setTimeout(disarm, 4000);
          return;
        }
        disarm();
        act(`/${$('boardsGame').value}/${r.id}/remove`, `${who}'s score is off the board. It's in the list below if you want it back.`);
      };
    }
    return el;
  }
  function disarm() {
    if (!armed) return;
    clearTimeout(armed.timer);
    armed.textContent = 'Remove';
    armed = null;
  }

  async function act(path, done) {
    try {
      await api(path, { method: 'POST', body: {} });
      say(done);
      await load({ keepMsg: true });
    } catch (e) { say(e.message, false); }
  }

  async function load({ keepMsg = false } = {}) {
    const g = game();
    if (!g) return;
    if (!keepMsg) say('');
    disarm();
    const day = g.daily ? $('boardsDay').value : '';
    const q = new URLSearchParams({ board: $('boardsBoard').value || '', scope: day ? 'day' : 'all', ...(day ? { day } : {}) });
    const list = $('boardsList'), gone = $('boardsRemoved');
    list.textContent = 'Loading…';
    try {
      const r = await api(`/${g.id}?${q}`);
      list.innerHTML = '';
      gone.innerHTML = '';
      if (!r.rows.length) list.innerHTML = '<p class="admin-note">There are no scores on this board yet.</p>';
      for (const x of r.rows) list.appendChild(row(x, r.unit, false));
      if (r.rows.length >= 100) list.insertAdjacentHTML('beforeend', '<p class="admin-note">This shows the best 100. Pick a day to see the rest of that day\'s scores.</p>');
      if (!r.removed.length) gone.innerHTML = '<p class="admin-note">Nothing has been taken off this board.</p>';
      for (const x of r.removed) gone.appendChild(row(x, r.unit, true));
    } catch (e) { list.textContent = ''; say(e.message, false); }
  }

  async function open() {
    try {
      games = (await api('')).games;
      fillGames();
      await load();
    } catch (e) { say(e.message, false); }
  }

  $('boardsGame').addEventListener('change', () => { fillBoards(); load(); });
  $('boardsBoard').addEventListener('change', () => load());
  $('boardsDay').addEventListener('change', () => load());
  document.addEventListener('admin-tab', e => { if (e.detail === 'tabBoards') open(); });
})();
