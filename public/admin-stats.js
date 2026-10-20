'use strict';

// Admin → Stats: what gets played, how often, for how long, by whom and
// when, a log of every visit, and the error log with codes. The server sends
// the visits as compact rows and everything is added up here, so the charts,
// the log and the filters always agree.

(() => {
  const $ = id => document.getElementById(id);
  const token = () => window.ADMIN_TOKEN || (() => { try { return localStorage.getItem('wordless_admin_token') || ''; } catch { return ''; } })();
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/stats' + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Admin-Token': token() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const GAMES = {
    hub: ['🏠', 'Home page'], wordless: ['🔤', 'Wordless'], rambler: ['🔠', 'Rambler'], spinsolve: ['🎡', 'Spin & Solve'],
    chess: ['♞', 'Chess'], dino: ['🦖', 'Dino Dash'], trivia: ['🧠', 'Know-It-All'], partdeux: ['🚨', 'Uh-Oh: Part Deux'],
    daredevil: ['😈', 'Dare Devil'], snake: ['🐍', 'Snake'], bricks: ['🧱', 'Brick Breaker'], blocks: ['🟪', 'Block Drop'],
    towers: ['🏰', 'Tower Defense'], admin: ['🛠️', 'Admin']
  };
  const gameName = id => (GAMES[id] ? `${GAMES[id][0]} ${GAMES[id][1]}` : id || 'The arcade');
  const DEVICE_EMOJI = { phone: '📱', tablet: '📲', desktop: '🖥️' };
  const RANGES = [['today', 'Today', 1], ['7', '7 days', 7], ['30', '30 days', 30], ['90', '90 days', 90], ['all', 'All time', 0]];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

  let range = '7';
  let data = null;       // { games, players, devices, visits: [[start, sec, gi, pi, di, plays]] }
  let logShown = 100;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function dur(sec, precise = false) {
    sec = Math.round(sec);
    if (sec < 60) return `${sec}s`;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}h ${m}m`;
    return precise && s ? `${m}m ${s}s` : `${m}m`;
  }
  const hourLabel = h => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  const timeOf = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayOf = ms => new Date(ms).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const stamp = ms => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ---- loading ---------------------------------------------------------------------------
  async function load() {
    const days = RANGES.find(r => r[0] === range)[2];
    try {
      data = await api(`/admin/summary?days=${days}`);
      if (range === 'today') {
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        data.visits = data.visits.filter(v => v[0] >= midnight.getTime());
      }
      logShown = 100;
      renderAll();
    } catch (e) { $('statCards').textContent = e.message; }
    loadErrors();
  }

  function rows() {
    // Only real game visits count toward the charts (not the home page).
    return data.visits.filter(v => data.games[v[2]] !== 'hub');
  }

  function renderAll() {
    renderRange();
    renderCards();
    renderGames();
    renderPlayers();
    renderWhen();
    renderFilters();
    renderLog();
  }

  function renderRange() {
    const box = $('statsRange');
    box.innerHTML = '';
    for (const [id, label] of RANGES) {
      const b = el('button', '', label);
      b.setAttribute('aria-pressed', String(id === range));
      b.onclick = () => { range = id; load(); };
      box.appendChild(b);
    }
  }

  function renderCards() {
    const v = rows();
    const sec = v.reduce((a, r) => a + r[1], 0);
    const plays = v.reduce((a, r) => a + r[5], 0);
    const players = new Set(v.map(r => data.players[r[3]]).filter(Boolean)).size;
    const cards = [
      [v.length, 'Visits'], [plays, 'Games played'], [dur(sec), 'Play time'],
      [players, 'Players'], [v.length ? dur(sec / v.length) : '0s', 'Avg visit'],
      [data.openErrors, 'Open errors', data.openErrors > 0]
    ];
    const box = $('statCards');
    box.innerHTML = '';
    for (const [value, label, warn] of cards) {
      const c = el('div', 'stat-card' + (warn ? ' warn' : ''));
      c.append(el('b', '', String(value)), el('span', '', label));
      if (label === 'Open errors') { c.style.cursor = 'pointer'; c.onclick = () => $('errorList').scrollIntoView({ behavior: 'smooth' }); }
      box.appendChild(c);
    }
  }

  function groupBy(list, keyFn) {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { visits: 0, sec: 0, plays: 0, last: 0, rows: [] });
      const g = m.get(k);
      g.visits++; g.sec += r[1]; g.plays += r[5]; g.last = Math.max(g.last, r[0]); g.rows.push(r);
    }
    return m;
  }

  function renderGames() {
    const box = $('statGames');
    box.innerHTML = '';
    const groups = [...groupBy(rows(), r => data.games[r[2]])].sort((a, b) => b[1].sec - a[1].sec || b[1].visits - a[1].visits);
    if (!groups.length) { box.appendChild(el('div', 'empty-note', 'Nothing played in this time yet.')); return; }
    const max = Math.max(...groups.map(([, g]) => g.sec), 1);
    for (const [game, g] of groups) {
      const row = el('div', 'bar-row');
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.max(2, (g.sec / max) * 100)}%`;
      bar.appendChild(fill);
      const nums = `${g.visits} visit${g.visits === 1 ? '' : 's'}${g.plays ? ` · ${g.plays} played` : ''} · ${dur(g.sec)} · avg ${dur(g.sec / g.visits)}`;
      row.append(el('span', 'label', gameName(game)), bar, el('span', 'nums', nums));
      row.title = `Last played ${stamp(g.last)}`;
      box.appendChild(row);
    }
  }

  function renderPlayers() {
    const box = $('statPlayers');
    box.innerHTML = '';
    const groups = [...groupBy(rows(), r => data.players[r[3]] || '')].sort((a, b) => b[1].sec - a[1].sec);
    if (!groups.length) { box.appendChild(el('div', 'empty-note', 'Nobody yet.')); return; }
    for (const [name, g] of groups) {
      const block = el('div', 'player-block');
      const top = el('div', 'top-line');
      top.append(el('span', '', name || 'No name picked'), el('small', '', `${dur(g.sec)} · ${g.visits} visit${g.visits === 1 ? '' : 's'} · last ${stamp(g.last)}`));
      const games = [...groupBy(g.rows, r => data.games[r[2]])].sort((a, b) => b[1].sec - a[1].sec)
        .map(([game, gg]) => `${gameName(game)} ${dur(gg.sec)}`).join('  ·  ');
      block.append(top, el('div', 'games', games));
      box.appendChild(block);
    }
  }

  function renderWhen() {
    const box = $('statWhen');
    box.innerHTML = '';
    const v = rows();
    if (!v.length) { box.appendChild(el('div', 'empty-note', 'No visits yet.')); return; }
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const byHour = new Array(24).fill(0), byDay = new Array(7).fill(0);
    for (const r of v) {
      const d = new Date(r[0]);
      grid[d.getDay()][d.getHours()]++;
      byHour[d.getHours()]++;
      byDay[d.getDay()]++;
    }
    const max = Math.max(...grid.flat(), 1);
    const heat = el('div', 'heat');
    heat.appendChild(el('span'));
    for (let h = 0; h < 24; h++) heat.appendChild(el('span', 'hl', h % 6 === 0 ? hourLabel(h).replace(' ', '') : ''));
    for (let d = 0; d < 7; d++) {
      heat.appendChild(el('span', 'dl', DAYS[d]));
      for (let h = 0; h < 24; h++) {
        const c = el('span', 'cell');
        const n = grid[d][h];
        if (n) c.style.background = `rgba(255, 199, 44, ${0.18 + 0.82 * (n / max)})`;
        c.title = `${DAYS[d]} ${hourLabel(h)}: ${n} visit${n === 1 ? '' : 's'}`;
        heat.appendChild(c);
      }
    }
    const topDay = byDay.indexOf(Math.max(...byDay));
    const topHour = byHour.indexOf(Math.max(...byHour));
    box.append(heat, el('p', 'heat-note', `Busiest day: ${DAYS_LONG[topDay]}. Busiest hour: around ${hourLabel(topHour)}.`));
  }

  // ---- the log ------------------------------------------------------------------------------
  function renderFilters() {
    const fill = (sel, items, all) => {
      const keep = sel.value;
      sel.innerHTML = '';
      sel.appendChild(new Option(all, ''));
      for (const [value, label] of items) sel.appendChild(new Option(label, value));
      sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
    };
    const gameIds = [...new Set(data.visits.map(r => data.games[r[2]]))];
    fill($('logGame'), gameIds.map(g => [g, gameName(g)]), 'Every game');
    const names = [...new Set(data.visits.map(r => data.players[r[3]]))];
    fill($('logPlayer'), names.map(n => [n || '(none)', n || 'No name picked']), 'Everyone');
  }

  function renderLog() {
    const box = $('statLog');
    box.innerHTML = '';
    const g = $('logGame').value, p = $('logPlayer').value;
    const list = data.visits.filter(r => (!g || data.games[r[2]] === g) && (!p || (data.players[r[3]] || '(none)') === p));
    if (!list.length) { box.appendChild(el('div', 'empty-note', 'No visits match.')); $('logMore').classList.add('hidden'); return; }
    let lastDay = '';
    for (const r of list.slice(0, logShown)) {
      const day = dayOf(r[0]);
      if (day !== lastDay) { box.appendChild(el('div', 'log-day', day)); lastDay = day; }
      const row = el('div', 'log-row');
      const who = data.players[r[3]] || 'No name';
      const device = data.devices[r[4]];
      row.append(
        el('span', 'when', timeOf(r[0])),
        el('span', '', `${DEVICE_EMOJI[device] || ''} ${who} · ${gameName(data.games[r[2]])}`),
        el('span', 'dur', `${dur(r[1], true)}${r[5] ? ` · ${r[5]} played` : ''}`)
      );
      box.appendChild(row);
    }
    $('logMore').classList.toggle('hidden', list.length <= logShown);
  }

  // ---- errors --------------------------------------------------------------------------------
  function chatText(e) {
    return [
      `ARKS Arcade error ${e.code}`,
      `Game: ${e.game ? gameName(e.game).replace(/^\S+ /, '') : 'not tied to one game'} (${e.source === 'server' ? 'server' : 'in the browser'})`,
      `Message: ${e.message}`,
      e.location ? `Where: ${e.location}` : '',
      `Seen: ${e.count} time${e.count === 1 ? '' : 's'}, first ${stamp(e.firstSeen)}, last ${stamp(e.lastSeen)}`,
      e.browser ? `Browser: ${e.browser}` : '',
      e.player ? `Player: ${e.player}` : '',
      e.stack ? `Stack:\n${e.stack}` : ''
    ].filter(Boolean).join('\n');
  }

  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      // Plain http on a home network has no clipboard API; the old way still works.
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      t.remove();
    }
    const was = btn.textContent;
    btn.textContent = ok ? '✓ Copied' : 'Copy failed: select the text above';
    setTimeout(() => { btn.textContent = was; }, 1800);
  }

  async function loadErrors() {
    const box = $('errorList');
    let list;
    try { list = await api('/admin/errors'); } catch (e) { box.textContent = e.message; return; }
    box.innerHTML = '';
    if (!list.length) { box.appendChild(el('div', 'empty-note', 'No errors. 🎉')); return; }
    for (const e of list) {
      const card = el('div', 'err ' + (e.resolved ? 'fixed' : 'open'));
      const head = el('div', 'err-head');
      head.append(el('code', '', e.code), el('b', '', e.game ? gameName(e.game) : 'Arcade'),
        el('span', 'muted', `${e.source === 'server' ? 'server' : 'browser'} · ${e.count}× · last ${stamp(e.lastSeen)}${e.resolved ? ' · marked fixed' : ''}`));
      const details = el('details');
      details.appendChild(el('summary', 'muted', 'Details'));
      details.appendChild(el('pre', '', chatText(e)));
      const actions = el('div', 'err-actions');
      const copyBtn = el('button', 'small-btn', '📋 Copy for chat');
      copyBtn.onclick = () => copy(chatText(e), copyBtn);
      const fixBtn = el('button', 'small-btn', e.resolved ? '↺ Reopen' : '✓ Mark fixed');
      fixBtn.onclick = async () => {
        await api(`/admin/errors/${encodeURIComponent(e.code)}/resolve`, { method: 'POST', body: e.resolved ? { reopen: true } : {} });
        loadErrors();
        if (data) { data.openErrors += e.resolved ? 1 : -1; renderCards(); }
      };
      actions.append(copyBtn, fixBtn);
      card.append(head, el('div', 'err-msg', e.message), details, actions);
      box.appendChild(card);
    }
  }

  // ---- wiring ----------------------------------------------------------------------------------
  $('logGame').onchange = () => { logShown = 100; renderLog(); };
  $('logPlayer').onchange = () => { logShown = 100; renderLog(); };
  $('logMore').onclick = () => { logShown += 200; renderLog(); };
  $('errRefresh').onclick = () => load();
  $('errClearFixed').onclick = async () => { await api('/admin/errors?resolved=1', { method: 'DELETE' }); loadErrors(); };
  $('resetStats').onclick = async () => {
    if (!confirm('Delete every visit from the stats? This cannot be undone.')) return;
    await api('/admin/visits', { method: 'DELETE' });
    load();
  };
  document.addEventListener('admin-tab', e => { if (e.detail === 'tabStats') load(); });
})();
