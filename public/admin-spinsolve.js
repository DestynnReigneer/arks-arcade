'use strict';

// Admin for Spin & Solve: theme requests from players, and building puzzle
// packs the same way as Wordless themes (copy a prompt, paste the AI's
// answer back). Shares the admin password admin.js unlocks.

(() => {
  const API = '/api/spinsolve/admin';
  const $ = id => document.getElementById(id);
  const LEVELS = {
    kids: '🧒 Kids', cheeky: '🌶️ Cheeky', spicy: '🌶️🌶️ Spicy', filthy: '🌶️🌶️🌶️ Filthy'
  };
  const LEVEL_TONE = {
    kids: 'Family-friendly: fine for young kids. No swearing, nothing rude.',
    cheeky: 'ADULTS ONLY, for a private party game among consenting adults: innuendo, flirting and double meanings, mild swearing at most. Nothing graphic.',
    spicy: 'ADULTS ONLY, for a private party game among consenting adults: crude, boozy, sexual innuendo and plenty of swearing. Raunchy but not graphic.',
    filthy: 'ADULTS ONLY, for a private party game among consenting adults: explicit, filthy and no holds barred, sex and swearing welcome.'
  };
  const state = { requestId: null };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function say(el, text, ok = true) {
    el.textContent = text;
    el.className = 'status-msg ' + (ok ? 'ok' : 'error');
  }

  function buildPrompt(topic, level) {
    return `Create a puzzle pack for a Wheel of Fortune-style phrase game. The topic is: ${topic}.

Return ONLY a single valid JSON object (no markdown, no code fences, no commentary) with exactly these fields:

{
  "label": "Short display name for the pack",
  "emoji": "one emoji that fits the pack",
  "puzzles": [ { "category": "Phrase", "answer": "AN EXAMPLE PUZZLE" } ]
}

Write 40 to 60 puzzles about ${topic}. Rules for every puzzle:
- "answer" is in CAPITAL LETTERS, using only letters, spaces and these marks: ' - & ? !
- No word longer than 12 letters, and no more than about 40 characters in total
- A real phrase, title, thing, place, person or activity people would recognize, 2 to 6 words is ideal
- "category" is a short game-show category like Phrase, Thing, Place, Person, Food & Drink, What Are You Doing?, Before & After, Fun & Games, Movie Title, Event
- Mix the categories, and mix easy and hard puzzles
- No duplicates. Use American English spelling.

Tone: ${LEVEL_TONE[level]} No slurs or hateful terms.`;
  }

  // ---- requests -------------------------------------------------------------

  async function loadRequests() {
    const list = $('spinRequests');
    try {
      const rows = await api('/requests?status=pending');
      list.innerHTML = rows.length ? '' : '<div class="admin-note">No pending requests.</div>';
      rows.forEach((r, i) => {
        const card = document.createElement('div');
        card.className = 'req-card';
        card.innerHTML = `<div class="req-top"><span class="req-topic"></span><span class="req-meta"></span></div>
          <div class="req-note"></div>
          <div class="req-actions"><button data-act="build">🛠️ Build this pack</button><button data-act="dismiss">✕ Dismiss</button></div>`;
        card.querySelector('.req-topic').textContent = `${i + 1}. ${r.topic}`;
        card.querySelector('.req-meta').textContent = `${r.requestedBy || 'Anonymous'} · ${new Date(r.createdAt + 'Z').toLocaleDateString('en-US')}`;
        card.querySelector('.req-note').textContent = r.note || '';
        card.querySelector('[data-act="build"]').onclick = () => {
          state.requestId = r.id;
          $('spinTopic').value = r.topic;
          $('spinBuildingFor').textContent = `Building for request: "${r.topic}". Creating the pack closes the request.`;
          $('spinTopic').scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        card.querySelector('[data-act="dismiss"]').onclick = async () => {
          try { await api(`/requests/${r.id}/dismiss`, { method: 'POST', body: {} }); loadRequests(); } catch (e) { alert(e.message); }
        };
        list.appendChild(card);
      });
    } catch (e) { list.textContent = e.message; }
  }

  // ---- packs ------------------------------------------------------------------

  async function loadPacks() {
    const list = $('spinPacks');
    try {
      const packs = await api('/packs');
      list.innerHTML = packs.length ? '' : '<div class="admin-note">No packs yet. The built-in puzzles are always there.</div>';
      for (const p of packs) {
        const row = document.createElement('div');
        row.className = 'theme-row';
        row.innerHTML = `<span></span><button style="background:transparent;border:1px solid #7f3a3a;color:#f5a3a3;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">🗑 Delete</button>`;
        row.firstChild.textContent = `${p.emoji} ${p.label} · ${LEVELS[p.level]} · ${p.count} puzzles`;
        row.querySelector('button').onclick = async () => {
          if (!confirm(`Delete the "${p.label}" pack? This can't be undone.`)) return;
          try { await api(`/packs/${p.id}`, { method: 'DELETE' }); loadPacks(); } catch (e) { alert(e.message); }
        };
        list.appendChild(row);
      }
    } catch (e) { list.textContent = e.message; }
  }

  async function createPack() {
    const status = $('spinStatus');
    let parsed;
    try { parsed = JSON.parse($('spinJson').value); } catch {
      return say(status, 'Invalid JSON — check for missing commas/quotes.', false);
    }
    try {
      const r = await api('/packs', {
        method: 'POST',
        body: { ...parsed, level: $('spinLevel').value, requestId: state.requestId || undefined }
      });
      const skipped = r.skipped.length
        ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 4).map(s => `${s.answer} (${s.reason})`).join('; ')}${r.skipped.length > 4 ? '…' : ''}`
        : '';
      say(status, `Created "${r.pack.label}" with ${r.pack.count} puzzles.${skipped}`);
      $('spinJson').value = '';
      state.requestId = null;
      $('spinBuildingFor').textContent = '';
      loadPacks();
      loadRequests();
    } catch (e) { say(status, e.message, false); }
  }

  function refresh() { loadRequests(); loadPacks(); }

  $('spinCopyPrompt').onclick = async e => {
    const topic = $('spinTopic').value.trim();
    if (!topic) return say($('spinStatus'), 'Type a topic first.', false);
    await navigator.clipboard.writeText(buildPrompt(topic, $('spinLevel').value));
    e.target.textContent = '✓ Copied!';
    setTimeout(() => { e.target.textContent = '📋 Copy prompt'; }, 1500);
  };
  $('spinCreate').onclick = createPack;
  document.addEventListener('admin-tab', e => { if (e.detail === 'tabSpin') refresh(); });
})();
