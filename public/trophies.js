'use strict';

// The trophy page (2026-11-10): every leaderboard in the arcade, your own
// place on each (the Trophy Shelf), and your closest climb. The server works
// it all out (GET /api/trophies, arcade/trophies.js); this only draws it.
// Grown-up boards come back locked until the adult PIN (or, with ARKS ID, a
// grown-up's pass from the PIN pad) is sent along.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const GROUPS = [['all', 'Every game'], ['mine', 'Only mine'], ['word', 'Word and puzzle'], ['cabinet', 'Cabinet'], ['classic', 'Classic'], ['party', 'Party']];
  const PIN_KEY = 'trophies.adultPin', OK_KEY = 'trophies.adultOk';
  const store = {
    get: k => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
    set: (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* unavailable */ } }
  };

  let data = null;
  let group = 'all';
  const open = new Set();          // boards opened, "game/board"
  const todayOn = new Set();       // daily games showing their Today boards

  // ---- how a value reads -------------------------------------------------------------------------
  const show = (v, unit) => {
    if (unit === 'time') { const s = Math.round(v / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    if (unit === 'lap') return `${(v / 1000).toFixed(2)} s`;
    return Number(v).toLocaleString('en-US');
  };
  const secs = ms => { const s = Math.max(1, Math.round(ms / 1000)); return `${s} second${s === 1 ? '' : 's'}`; };
  const behind = (gap, unit) => {
    if (unit === 'time') return secs(gap);
    if (unit === 'lap') return `${(gap / 1000).toFixed(2)} seconds`;
    if (unit === 'points') return `${gap.toLocaleString('en-US')} point${gap === 1 ? '' : 's'}`;
    return String(gap);
  };
  const toPass = (gap, unit, name) => {
    if (unit === 'time') return `${secs(gap)} faster to pass ${name}.`;
    if (unit === 'lap') return `${(gap / 1000).toFixed(2)} seconds faster to pass ${name}.`;
    if (unit === 'points') return `${(gap + 1).toLocaleString('en-US')} more points to pass ${name}.`;
    return `${gap + 1} more to pass ${name}.`;
  };
  const when = at => {
    if (!at) return '';
    const d = new Date(at), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const ago = Math.round((day(now) - day(d)) / 86400000);
    if (ago <= 0) return 'today';
    if (ago === 1) return 'yesterday';
    if (ago < 7) return `${ago} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const avatar = (id, size = 22) => {
    if (typeof ArcadeProfile !== 'undefined' && id) return ArcadeProfile.avatarEl(id, size);
    return el('span', '', '');
  };

  // ---- loading -----------------------------------------------------------------------------------
  async function load() {
    const headers = {};
    const token = typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null;
    if (token) headers['X-Profile-Token'] = token;
    if (store.get(PIN_KEY)) headers['X-Adult-Pin'] = store.get(PIN_KEY);
    if (store.get(OK_KEY)) headers['X-Adult-Ok'] = 'yes';
    try {
      const res = await fetch('/api/trophies', { headers });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'The boards didn\'t load. Try again in a moment.');
      data = d;
      $('loadMsg').hidden = true;
      paint();
    } catch (e) {
      $('loadMsg').hidden = false;
      $('loadMsg').textContent = e.message || 'The boards didn\'t load. Try again in a moment.';
    }
  }

  // ---- drawing -----------------------------------------------------------------------------------
  function paint() {
    const you = data.you;
    $('shelfName').textContent = you ? `${you.name}'s Trophy Shelf` : '';
    $('guestNote').hidden = !!you;
    $('shelf').hidden = !you;
    $('sGold').textContent = data.shelf.gold;
    $('sTop3').textContent = data.shelf.top3;
    $('sOn').textContent = data.shelf.on;

    const c = $('closeCall');
    c.textContent = '';
    c.hidden = !data.closest;
    if (data.closest) {
      const x = data.closest;
      const txt = el('div');
      txt.append(el('div', 'tr-label', 'Your closest climb'),
        el('div', '', `${behind(x.gap, x.unit)} behind ${x.name} in ${x.gameLabel}, ${x.boardLabel}.`));
      const a = el('a', 'tr-btn', 'Go get it');
      a.href = x.href;
      c.append(el('span', 'big', '🎯'), txt, a);
    }

    const anyLocked = data.games.some(g => g.boards.some(b => b.locked));
    $('unlockRow').hidden = !anyLocked;

    const host = $('games');
    host.textContent = '';
    for (const g of data.games) {
      const mine = g.boards.filter(b => b.you);
      if (group === 'mine' ? !mine.length : (group !== 'all' && g.group !== group)) continue;
      const day = g.daily && todayOn.has(g.id);
      const card = el('section', 'tr-game');
      card.dataset.game = g.id;
      const head = el('header');
      head.append(el('span', 'e', g.emoji), el('h2', '', g.label));
      if (g.daily) {
        const seg = el('div', 'tr-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', `${g.label}: which scores`);
        for (const [key, label] of [['all', 'Overall'], ['day', 'Today']]) {
          const b = el('button', '', label);
          b.type = 'button';
          b.setAttribute('aria-pressed', String((key === 'day') === day));
          b.onclick = () => { if (key === 'day') todayOn.add(g.id); else todayOn.delete(g.id); paint(); };
          seg.append(b);
        }
        head.append(seg);
      }
      const best = mine.map(b => (day && b.today ? b.today.you : b.you)).filter(Boolean).sort((a, b) => a.rank - b.rank)[0];
      head.append(el('span', 'mine', best ? `your best: #${best.rank}` : you ? 'not on a board yet' : ''));
      card.append(head);
      for (const b of g.boards) card.append(boardRow(g, b, day));
      host.append(card);
    }
    if (!host.children.length) host.append(el('p', 'tr-note', group === 'mine' ? 'You\'re not on any boards yet. Play a game and get your first score!' : 'No boards match that.'));
  }

  function boardRow(g, b, day) {
    const view = day && b.today ? b.today : b;
    const key = `${g.id}/${b.id}`;
    const row = el('div', 'tr-board');
    row.dataset.board = b.id;
    const btn = el('button');
    btn.type = 'button';
    const name = el('span', 'bn', b.label);
    const top = view.rows[0];
    const empty = day ? 'Nobody has a score here today. Be first!' : 'Nobody has a score here yet. Be first!';
    const leader = b.locked ? 'For grown-ups. Unlock it with the adult PIN.'
      : top ? `${top.name} leads with ${show(top.value, b.unit)}` : empty;
    name.append(el('small', b.locked ? 'locked' : '', leader));
    const r = view.you;
    const rank = el('span', 'tr-rank' + (r && r.rank <= 3 ? ` r${r.rank}` : ''), b.locked ? '🔞' : r ? `You #${r.rank}` : 'Not yet');
    btn.append(name, rank, el('span', 'tr-caret', '▸'));
    const isOpen = open.has(key);
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.onclick = () => {
      if (b.locked) { unlock(); return; }
      if (open.has(key)) open.delete(key); else open.add(key);
      paint();
    };
    row.append(btn);
    if (isOpen && !b.locked) {
      row.classList.add('open');
      const t = el('div', 'tr-table');
      if (!view.rows.length) t.append(el('div', 'tr-empty', empty));
      const ol = el('ol');
      for (const x of view.rows) {
        const li = el('li', x.you ? 'you' : '');
        const who = el('span', 'who');
        who.append(avatar(x.avatar), el('b', '', x.name), el('small', '', when(x.at)));
        const sc = el('span', 'sc', show(x.value, b.unit));
        if (x.detail) sc.append(el('small', '', x.detail));
        li.append(el('span', 'pos', `#${x.rank}`), who, sc);
        ol.append(li);
      }
      t.append(ol);
      const foot = el('div', 'foot');
      const line = !data.you ? '' : r && r.rank === 1 ? 'You hold this one!'
        : r && r.ahead ? toPass(Math.abs(r.ahead.value - r.value), b.unit, r.ahead.name) : 'Play a round to get on this board.';
      foot.append(el('span', '', line));
      const play = el('a', 'tr-btn', `▶ Play ${g.label}`);
      play.href = g.href;
      foot.append(play);
      t.append(foot);
      row.append(t);
    }
    return row;
  }

  // ---- unlocking the grown-up boards ---------------------------------------------------------------
  function unlock() {
    const view = $('pinView');
    $('pinMsg').textContent = '';
    const needsPin = data.adultRequiresPin;
    $('pinInput').hidden = !needsPin;
    $('pinYes').hidden = needsPin;
    $('pinText').textContent = needsPin ? 'Type the adult PIN to see them.' : 'These boards are for grown-ups (18+).';
    view.classList.remove('hidden');
    const done = () => { view.classList.add('hidden'); load(); };
    if (needsPin) {
      $('pinInput').value = '';
      PinPad.attach($('pinInput'), async pin => {
        const res = await fetch('/api/trophies/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
          .then(r => r.json().then(d => ({ ok: r.ok && d.ok, error: d.error }))).catch(() => ({ ok: false }));
        if (!res.ok) { $('pinMsg').textContent = res.error || 'Incorrect PIN.'; PinPad.clear($('pinInput')); return; }
        store.set(PIN_KEY, pin);
        done();
      });
      $('pinInput').focus();
    }
    $('pinYes').onclick = () => { store.set(OK_KEY, 'yes'); done(); };
    $('pinCancel').onclick = () => view.classList.add('hidden');
  }

  // ---- the filters -------------------------------------------------------------------------------
  const f = $('filters');
  for (const [id, label] of GROUPS) {
    const b = el('button', 'tr-pill', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === group));
    b.onclick = () => { group = id; f.querySelectorAll('.tr-pill').forEach(p => p.setAttribute('aria-pressed', String(p === b))); if (data) paint(); };
    f.append(b);
  }
  $('unlockBtn').onclick = unlock;
  $('pickProfile').onclick = () => { if (typeof ArcadeProfile !== 'undefined') ArcadeProfile.open(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('pinView').classList.add('hidden'); });

  if (typeof ArcadeProfile !== 'undefined') ArcadeProfile.onChange(() => load());
  load();
})();
