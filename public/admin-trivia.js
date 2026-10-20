'use strict';

// Admin for Know-It-All: topic requests, question packs from an AI prompt
// (any genre, difficulty mix and spice level), and the Open Trivia DB download.

(() => {
  const API = '/api/trivia/admin';
  const $ = id => document.getElementById(id);
  const LEVELS = { kids: '🧒 Family', cheeky: '🌶️ Cheeky', spicy: '🌶️🌶️ Spicy', filthy: '🌶️🌶️🌶️ Filthy' };
  const TONE = {
    kids: 'Family-friendly: fine for kids and grandparents. Nothing rude.',
    cheeky: 'ADULTS ONLY, for a private party game among consenting adults: flirty, romantic and boozy, innuendo welcome, nothing graphic.',
    spicy: 'ADULTS ONLY, for a private party game among consenting adults: sex facts, dirty minds, booze and swearing. Raunchy but not graphic.',
    filthy: 'ADULTS ONLY, for a couple or close friends playing a late-night drinking game: explicit sex questions, positions, toys and kinks, swearing welcome. Keep it fun and consensual, and keep the facts accurate.'
  };
  const state = { requestId: null };

  const token = () => window.ADMIN_TOKEN || (() => { try { return localStorage.getItem('wordless_admin_token') || ''; } catch { return ''; } })();
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Admin-Token': token() }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const say = (el, text, ok = true) => { el.textContent = text; el.className = 'status-msg ' + (ok ? 'ok' : 'error'); };

  function buildPrompt(topic, level, difficulty) {
    const mix = difficulty === 'mixed' ? 'a mix of easy, medium and hard (about a third each)' : `mostly ${difficulty}`;
    return `Write a question pack for a multiple-choice trivia game. The topic is: ${topic}.

Return ONLY a single valid JSON object (no markdown, no code fences, no commentary) with exactly these fields:

{
  "label": "Short display name for the pack",
  "emoji": "one emoji that fits the pack",
  "genre": "one or two words, like Movies, Sports, Sex Facts or Booze",
  "questions": [
    { "question": "The question?", "correct": "The right answer", "wrong": ["Wrong 1", "Wrong 2", "Wrong 3"], "difficulty": "easy" }
  ]
}

Write 40 to 60 questions about ${topic}. Rules:
- Every question has exactly one correct answer and three wrong ones that are believable, not silly
- Facts must be accurate and well known enough to check; skip anything disputed
- Keep questions under 200 characters and answers short
- "difficulty" is easy, medium or hard: ${mix}
- No duplicates, no "all of the above", no trick questions
- Use American English spelling in your own wording, but keep real titles and names exactly as they are

Tone: ${TONE[level]} No slurs or hateful terms.`;
  }

  async function loadRequests() {
    const list = $('triviaRequests');
    try {
      const rows = await api('/requests?status=pending');
      list.innerHTML = rows.length ? '' : '<div class="admin-note">No pending requests.</div>';
      rows.forEach((r, i) => {
        const card = document.createElement('div');
        card.className = 'req-card';
        card.innerHTML = `<div class="req-top"><span class="req-topic"></span><span class="req-meta"></span></div><div class="req-note"></div>
          <div class="req-actions"><button data-act="build">🛠️ Build this pack</button><button data-act="dismiss">✕ Dismiss</button></div>`;
        card.querySelector('.req-topic').textContent = `${i + 1}. ${r.topic}`;
        card.querySelector('.req-meta').textContent = `${r.requestedBy || 'Anonymous'} · ${new Date(r.createdAt + 'Z').toLocaleDateString('en-US')}`;
        card.querySelector('.req-note').textContent = r.note || '';
        card.querySelector('[data-act="build"]').onclick = () => {
          state.requestId = r.id;
          $('triviaTopic').value = r.topic;
          $('triviaBuildingFor').textContent = `Building for request: "${r.topic}". Creating the pack closes the request.`;
          $('triviaTopic').scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        card.querySelector('[data-act="dismiss"]').onclick = async () => {
          try { await api(`/requests/${r.id}/dismiss`, { method: 'POST', body: {} }); loadRequests(); } catch (e) { alert(e.message); }
        };
        list.appendChild(card);
      });
    } catch (e) { list.textContent = e.message; }
  }

  async function loadPacks() {
    const list = $('triviaPacks');
    try {
      const packs = await api('/packs');
      list.innerHTML = packs.length ? '' : '<div class="admin-note">No packs yet. The built-in and downloaded questions are always there.</div>';
      for (const p of packs) {
        const row = document.createElement('div');
        row.className = 'theme-row';
        row.innerHTML = '<span></span><button style="background:transparent;border:1px solid #7f3a3a;color:#f5a3a3;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">🗑 Delete</button>';
        row.firstChild.textContent = `${p.emoji} ${p.label} · ${p.genre} · ${LEVELS[p.level]} · ${p.count} questions`;
        row.querySelector('button').onclick = async () => {
          if (!confirm(`Delete the "${p.label}" pack? This can't be undone.`)) return;
          try { await api(`/packs/${p.id}`, { method: 'DELETE' }); loadPacks(); } catch (e) { alert(e.message); }
        };
        list.appendChild(row);
      }
    } catch (e) { list.textContent = e.message; }
  }

  async function loadOnline() {
    try {
      const s = await api('/online');
      $('triviaOnline').textContent = !s.enabled ? 'Turned off (TRIVIA_ONLINE=off in .env).'
        : s.running ? `Downloading now… ${s.addedThisRun} added so far (${s.downloaded} saved).`
          : `${s.downloaded.toLocaleString('en-US')} questions saved.` + (s.finishedAt ? ` Last download ${new Date(s.finishedAt).toLocaleDateString('en-US')}.` : '') + (s.lastError ? ` Last try stopped: ${s.lastError}` : '');
      if (s.running) setTimeout(loadOnline, 5000);
    } catch (e) { $('triviaOnline').textContent = e.message; }
  }

  async function createPack() {
    const status = $('triviaStatus');
    let parsed;
    try { parsed = JSON.parse($('triviaJson').value); } catch { return say(status, 'Invalid JSON — check for missing commas/quotes.', false); }
    try {
      const r = await api('/packs', { method: 'POST', body: { ...parsed, level: $('triviaLevel').value, requestId: state.requestId || undefined } });
      const skipped = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map(s => `${s.question} (${s.reason})`).join('; ')}${r.skipped.length > 3 ? '…' : ''}` : '';
      say(status, `Created "${r.pack.label}" with ${r.pack.count} questions.${skipped}`);
      $('triviaJson').value = '';
      state.requestId = null;
      $('triviaBuildingFor').textContent = '';
      loadPacks();
      loadRequests();
    } catch (e) { say(status, e.message, false); }
  }

  $('triviaCopyPrompt').onclick = async e => {
    const topic = $('triviaTopic').value.trim();
    if (!topic) return say($('triviaStatus'), 'Type a topic first.', false);
    await navigator.clipboard.writeText(buildPrompt(topic, $('triviaLevel').value, $('triviaDifficulty').value));
    e.target.textContent = '✓ Copied!';
    setTimeout(() => { e.target.textContent = '📋 Copy prompt'; }, 1500);
  };
  $('triviaCreate').onclick = createPack;
  $('triviaSync').onclick = async () => {
    try { await api('/online/sync', { method: 'POST', body: {} }); loadOnline(); } catch (e) { alert(e.message); }
  };
  document.addEventListener('admin-tab', e => { if (e.detail === 'tabTrivia') { loadRequests(); loadPacks(); loadOnline(); } });
})();
