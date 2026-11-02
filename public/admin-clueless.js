'use strict';

// Admin for Clueless: crossword clue packs, made the same way as the other
// packs (copy a prompt, paste it into any chatbot, paste the answer back).
// The server picks the words and checks every clue that comes back.

(() => {
  const API = '/api/clueless/admin';
  const $ = id => document.getElementById(id);
  const KINDS = { kids: '👪 Family', grownup: '🧠 Grown-up' };
  let words = [];
  let limits = { maxClue: 80 };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (el, text, ok = true) => { el.textContent = text; el.className = 'status-msg ' + (ok ? 'ok' : 'error'); };

  function buildPrompt(kind, list) {
    const tone = kind === 'kids'
      ? 'These clues are for a family crossword that kids play, so keep every clue friendly and simple enough for a 9-year-old: everyday words, nothing rude, scary or grown-up.'
      : 'These clues are for grown-ups who like a bit of a challenge: wordplay, double meanings, well-known pop culture and general knowledge are all welcome. Keep them clean enough to play with the family in the room, with nothing rude or crude.';
    return `Write one short crossword clue for each of these ${list.length} words.

${list.join(', ')}

Reply with ONLY the clues, one per line, in exactly this format and nothing else (no headings, no numbering, no commentary):

WORD: clue

Rules for every clue:
- Keep it under ${Math.min(60, limits.maxClue)} characters, like a newspaper crossword clue
- Never use the answer word, or any word that starts with it or that it starts with (no "cats" in a clue for CAT)
- The clue must fit the word exactly as written (same tense, singular or plural)
- Use American English spelling
- If a word is too obscure or awkward to clue well, leave that line out

${tone}`;
  }

  async function loadSummary() {
    try {
      const s = await api('/summary');
      limits = s;
      $('cluelessSummary').textContent = `Built-in family clues: ${s.starter.toLocaleString('en-US')} words. From packs: ${s.kids.toLocaleString('en-US')} words with Family clues and ${s.grownup.toLocaleString('en-US')} with Grown-up clues.`;
    } catch (e) { $('cluelessSummary').textContent = e.message; }
  }

  async function newWords() {
    try {
      const r = await api(`/batch?kind=${$('cluelessKind').value}&count=${$('cluelessCount').value}`);
      words = r.words;
      $('cluelessWords').textContent = `Words in the prompt: ${words.join(', ')}`;
    } catch (e) { $('cluelessWords').textContent = e.message; }
  }

  async function loadPacks() {
    const list = $('cluelessPacks');
    try {
      const packs = await api('/packs');
      list.innerHTML = packs.length ? '' : '<div class="admin-note">You haven\'t added a clue pack yet. The built-in clues are always there, so the crosswords work without one.</div>';
      for (const p of packs) {
        const row = document.createElement('div');
        row.className = 'theme-row';
        row.innerHTML = '<span></span><button style="background:transparent;border:1px solid #7f3a3a;color:#f5a3a3;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">🗑 Delete</button>';
        row.firstChild.textContent = `${p.label} · ${KINDS[p.kind] || p.kind} · ${p.count} clues`;
        row.querySelector('button').onclick = async () => {
          if (!confirm(`Delete the "${p.label}" clue pack? Its clues won't be used from tomorrow on. This can't be undone.`)) return;
          try { await api(`/packs/${p.id}`, { method: 'DELETE' }); loadPacks(); loadSummary(); } catch (e) { alert(e.message); }
        };
        list.appendChild(row);
      }
    } catch (e) { list.textContent = e.message; }
  }

  const skippedLine = skipped => (skipped && skipped.length
    ? ` Skipped ${skipped.length}: ${skipped.slice(0, 5).map(s => `${s.word} (${s.reason})`).join('; ')}${skipped.length > 5 ? '…' : ''}`
    : '');

  async function createPack() {
    const status = $('cluelessStatus');
    const text = $('cluelessText').value.trim();
    if (!text) return say(status, 'Paste the chatbot\'s answer into the box first.', false);
    try {
      const r = await api('/packs', { method: 'POST', body: { label: $('cluelessLabel').value, kind: $('cluelessKind').value, text } });
      say(status, `Saved "${r.pack.label}" with ${r.added} clues.${skippedLine(r.skipped)}`);
      $('cluelessText').value = '';
      $('cluelessLabel').value = '';
      loadPacks();
      loadSummary();
      newWords();
    } catch (e) { say(status, e.message, false); }
  }

  $('cluelessCopyPrompt').onclick = async e => {
    if (!words.length) await newWords();
    if (!words.length) return;
    await navigator.clipboard.writeText(buildPrompt($('cluelessKind').value, words));
    e.target.textContent = '✓ Copied!';
    setTimeout(() => { e.target.textContent = '📋 Copy prompt'; }, 1500);
  };
  $('cluelessNewWords').onclick = newWords;
  $('cluelessKind').onchange = newWords;
  $('cluelessCount').onchange = newWords;
  $('cluelessCreate').onclick = createPack;
  document.addEventListener('admin-tab', e => { if (e.detail === 'tabClueless') { loadSummary(); loadPacks(); if (!words.length) newWords(); } });
})();
