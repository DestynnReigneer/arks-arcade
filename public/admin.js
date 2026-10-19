(function() {
  const TOKEN_KEY = 'wordless_admin_token';

  const lockScreen = document.getElementById('lockScreen');
  const adminContent = document.getElementById('adminContent');
  const tokenInput = document.getElementById('tokenInput');
  const unlockBtn = document.getElementById('unlockBtn');
  const lockError = document.getElementById('lockError');
  const lockBtn = document.getElementById('lockBtn');

  const requestsList = document.getElementById('requestsList');
  const themesList = document.getElementById('themesList');
  const jsonInput = document.getElementById('jsonInput');
  const createFromJsonBtn = document.getElementById('createFromJsonBtn');
  const jsonStatus = document.getElementById('jsonStatus');

  let token = '';

  // Same shape, but for grown-ups: the words are the joke.
  function buildAdultPrompt(topic) {
    return buildPrompt(topic)
      .replace('Keep every word family-friendly.',
        'This is an ADULTS-ONLY theme for a private party game among consenting adults. Make the words cheeky, naughty and funny: innuendo, rude slang and swear words are welcome. No slurs or hateful terms.')
      .replace('at least 25 words of 3-4 letters (Easy: simple words a young child knows)',
        'at least 40 words of 3-4 letters (Easy: short, punchy rude words; every one of them naughty, no tame filler)')
      .replace('No duplicates.', 'No duplicates. Every word at every length should be naughty or innuendo, not just on-topic.')
      .replace('"label": "Short display name for the theme",', '"label": "Short display name for the theme",\n  "adult": true,');
  }

  function buildPrompt(topic) {
    return `Create a word-guessing game "theme pack" for the topic: ${topic}.

Return ONLY a single valid JSON object (no markdown, no code fences, no commentary) with exactly these fields:

{
  "label": "Short display name for the theme",
  "subject": "Short description of what the words are, e.g. '${topic} character or thing'",
  "emoji": "one emoji that fits the theme",
  "accent": "#hexcolor - a bright accent color fitting the theme",
  "bg": "#hexcolor - a dark background color fitting the theme",
  "fontKey": "one of: sans, serif, comic, mono, fantasy",
  "words": ["80 to 120 lowercase words or names related to ${topic}, each using only letters a-z, 3 to 10 letters long, no spaces, no punctuation, no numbers"],
  "clues": { "word": { "category": "Character, Place, Thing, Food...", "clue": "one short sentence" } }
}

"clues" has an entry for EVERY word. Each clue is one short sentence that hints at the word without giving it away: never use the word itself, a part of it, or its first letter as a giveaway. Think game-show clue, not dictionary definition. "category" is one or two words, like a game-show puzzle title.

The game has four difficulty levels that pick words by length, so spread the words across all lengths:
- at least 25 words of 3-4 letters (Easy: simple words a young child knows)
- at least 25 words of 5-6 letters (Normal)
- at least 20 words of 7-8 letters (Hard)
- at least 15 words of 9-10 letters (Ludicrous)
No duplicates. Keep every word family-friendly. Use American English spelling.`;
  }

  // For a theme that has words but no clues yet.
  function buildCluesPrompt(theme) {
    return `Write game-show style clues for a word-guessing game. The theme is: ${theme.label} (${theme.subject}).

Return ONLY a single valid JSON object (no markdown, no code fences, no commentary) mapping every word below to a category and a clue:

{ "word": { "category": "Character, Place, Thing, Food...", "clue": "one short sentence" } }

Each clue is one short sentence that hints at the word without giving it away: never use the word itself or a part of it. "category" is one or two words, like a game-show puzzle title. ${theme.adult ? 'This is an adults-only theme, so cheeky innuendo is welcome.' : 'Keep it family-friendly.'} Use American English spelling.

Words:
${theme.words.join(', ')}`;
  }

  async function apiGet(url) {
    const res = await fetch(url, { headers: { 'X-Admin-Token': token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE', headers: { 'X-Admin-Token': token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function loadRequests() {
    const requests = await apiGet('/api/theme-requests?status=pending');
    requestsList.innerHTML = '';
    if (requests.length === 0) {
      requestsList.innerHTML = '<div class="empty-note">No pending requests.</div>';
      return;
    }
    requests.forEach(r => {
      const card = document.createElement('div');
      card.className = 'req-card';
      card.innerHTML = `
        <div class="req-top">
          <div class="req-topic">${escapeHtml(r.topic)}</div>
          <div class="req-meta">${escapeHtml(r.createdAt)}${r.requestedBy ? ' · from ' + escapeHtml(r.requestedBy) : ''}</div>
        </div>
        ${r.note ? `<div class="req-note">"${escapeHtml(r.note)}"</div>` : ''}
        <div class="req-actions">
          <button data-action="copy">📋 1. Copy prompt</button>
          <button data-action="dismiss">✕ Dismiss</button>
        </div>
        <div class="req-fulfill-box open">
          <textarea rows="4" placeholder="2. Paste the AI's answer here"></textarea>
          <button data-action="create-and-fulfill" class="primary-btn" style="border:none;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer;">3. Create theme</button>
          <div class="status-msg"></div>
        </div>
      `;

      card.querySelector('[data-action="copy"]').addEventListener('click', async (e) => {
        await navigator.clipboard.writeText(buildPrompt(r.topic));
        const btn = e.target;
        const original = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = original; }, 1500);
      });

      card.querySelector('[data-action="dismiss"]').addEventListener('click', async () => {
        try {
          await apiPost(`/api/theme-requests/${r.id}/dismiss`);
          await loadRequests();
        } catch (e) {
          alert(e.message);
        }
      });

      card.querySelector('[data-action="create-and-fulfill"]').addEventListener('click', async () => {
        const box = card.querySelector('.req-fulfill-box');
        const statusEl = box.querySelector('.status-msg');
        statusEl.textContent = '';
        statusEl.className = 'status-msg';
        let parsed;
        try {
          parsed = JSON.parse(box.querySelector('textarea').value);
        } catch (err) {
          statusEl.textContent = 'Invalid JSON — check for missing commas/quotes.';
          statusEl.className = 'status-msg error';
          return;
        }
        try {
          // Passing the request id marks it done in the same step.
          await apiPost('/api/themes', { ...parsed, requestId: r.id });
          await loadRequests();
          await loadThemes();
        } catch (err) {
          statusEl.textContent = err.message;
          statusEl.className = 'status-msg error';
        }
      });

      requestsList.appendChild(card);
    });
  }

  async function loadThemes() {
    const themes = await apiGet('/api/themes');
    themesList.innerHTML = '';
    themes.forEach(t => {
      const row = document.createElement('div');
      row.className = 'theme-row';
      row.innerHTML = `
        <span>${t.emoji} ${escapeHtml(t.label)} ${t.builtin ? '<span style="opacity:0.4">(built-in)</span>' : ''}${t.adult ? ' <span style="color:#ff9a9a">🔞 adult</span>' : ''} <span style="opacity:0.4">· ${t.words.length} words · ${t.builtin ? 'clues built in' : `${Object.keys(t.clues || {}).length} clues`}</span></span>
        <span style="display:flex;gap:6px">
        ${t.builtin ? '' : '<button data-action="clues" style="background:transparent;border:1px solid #6b5bb5;color:#c9bdf5;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">💡 Clues</button>'}
        ${t.builtin ? '' : '<button data-action="delete" style="background:transparent;border:1px solid #7f3a3a;color:#f5a3a3;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">🗑 Delete</button>'}
        </span>
      `;
      if (!t.builtin) {
        row.querySelector('[data-action="clues"]').addEventListener('click', () => toggleCluesPanel(row, t));
      }
      if (!t.builtin) {
        row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          if (!confirm(`Delete theme "${t.label}"? This can't be undone.`)) return;
          try {
            await apiDelete(`/api/themes/${encodeURIComponent(t.id)}`);
            await loadThemes();
          } catch (e) {
            alert(e.message);
          }
        });
      }
      themesList.appendChild(row);
    });
  }

  // Copy a prompt, paste the AI's answer back: same no-API-key flow as making a theme.
  function toggleCluesPanel(row, theme) {
    const open = row.nextElementSibling && row.nextElementSibling.classList.contains('clues-panel');
    if (open) { row.nextElementSibling.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'clues-panel';
    panel.style.cssText = 'padding:10px 0 14px;display:flex;flex-direction:column;gap:8px';
    panel.innerHTML = `
      <div style="font-size:12px;opacity:0.75">1. Copy the prompt and paste it into any AI chat. 2. Paste its answer below. 3. Save. Clues show up as Wordless hints.</div>
      <button class="small-btn" data-act="copy">📋 Copy clues prompt</button>
      <textarea class="admin-textarea" rows="5" placeholder='{ "word": { "category": "...", "clue": "..." } }'></textarea>
      <button class="primary-btn" data-act="save" style="border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer">Save clues</button>
      <div class="status-msg"></div>`;
    const status = panel.querySelector('.status-msg');
    panel.querySelector('[data-act="copy"]').addEventListener('click', async e => {
      await navigator.clipboard.writeText(buildCluesPrompt(theme));
      e.target.textContent = '✓ Copied!';
      setTimeout(() => { e.target.textContent = '📋 Copy clues prompt'; }, 1500);
    });
    panel.querySelector('[data-act="save"]').addEventListener('click', async () => {
      let clues;
      try { clues = JSON.parse(panel.querySelector('textarea').value); } catch {
        status.textContent = 'Invalid JSON — check for missing commas/quotes.';
        status.className = 'status-msg error';
        return;
      }
      try {
        const r = await apiPost(`/api/themes/${encodeURIComponent(theme.id)}/clues`, { clues: clues.clues || clues });
        status.textContent = `Saved ${r.saved} clues (${r.total} of ${r.of} words have one).`;
        status.className = 'status-msg ok';
        setTimeout(loadThemes, 1500);
      } catch (e) {
        status.textContent = e.message;
        status.className = 'status-msg error';
      }
    });
    row.after(panel);
  }

  document.getElementById('copyNewPromptBtn').addEventListener('click', async (e) => {
    const topic = document.getElementById('newTopic').value.trim();
    if (!topic) {
      jsonStatus.textContent = 'Type a topic first.';
      jsonStatus.className = 'status-msg error';
      return;
    }
    const adult = document.getElementById('newAdult').checked;
    await navigator.clipboard.writeText(adult ? buildAdultPrompt(topic) : buildPrompt(topic));
    const btn = e.target;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy prompt'; }, 1500);
  });

  createFromJsonBtn.addEventListener('click', async () => {
    jsonStatus.textContent = '';
    jsonStatus.className = 'status-msg';
    let parsed;
    try {
      parsed = JSON.parse(jsonInput.value);
    } catch (e) {
      jsonStatus.textContent = 'Invalid JSON — check for missing commas/quotes.';
      jsonStatus.className = 'status-msg error';
      return;
    }
    try {
      // Adult if either the box is ticked or the adult prompt's answer says so.
      await apiPost('/api/themes', { ...parsed, adult: document.getElementById('newAdult').checked || parsed.adult === true });
      jsonInput.value = '';
      jsonStatus.textContent = 'Theme created!';
      jsonStatus.className = 'status-msg ok';
      await loadThemes();
    } catch (e) {
      jsonStatus.textContent = e.message;
      jsonStatus.className = 'status-msg error';
    }
  });

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* unavailable */ }
  }
  function safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* unavailable */ }
  }

  async function tryUnlock(candidateToken, { quiet = false } = {}) {
    token = candidateToken;
    try {
      await apiGet('/api/theme-requests?status=pending');
      safeStorageSet(TOKEN_KEY, candidateToken);
      // The Rambler admin panel shares this token rather than asking twice.
      window.ADMIN_TOKEN = candidateToken;
      lockScreen.classList.add('hidden');
      adminContent.classList.remove('hidden');
      await Promise.all([loadRequests(), loadThemes()]);
    } catch (e) {
      token = '';
      // A remembered password that stopped working means it was changed in
      // .env. Forget it quietly rather than greet the page with an error.
      if (quiet) safeStorageRemove(TOKEN_KEY);
      else lockError.textContent = 'Wrong password.';
    }
  }

  unlockBtn.addEventListener('click', () => tryUnlock(tokenInput.value.trim()));
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock(tokenInput.value.trim());
  });

  lockBtn.addEventListener('click', () => {
    safeStorageRemove(TOKEN_KEY);
    token = '';
    window.ADMIN_TOKEN = '';
    adminContent.classList.add('hidden');
    lockScreen.classList.remove('hidden');
    tokenInput.value = '';
  });

  (function init() {
    const saved = safeStorageGet(TOKEN_KEY);
    if (saved) tryUnlock(saved, { quiet: true });
  })();
})();
