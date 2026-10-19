'use strict';

// Small helpers shared by the newer games: a toast, the initials prompt, and
// the high-score list backed by /api/scores.

const ArcadeKit = (() => {
  const $ = id => document.getElementById(id);

  let toastTimer = null;
  function toast(text, ms = 2200) {
    let el = $('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast hidden';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Three boxes that act like an arcade cabinet: type a letter, jump to the next.
  function wireInitials(boxes, onEnter) {
    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
        if (box.value && boxes[i + 1]) boxes[i + 1].focus();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
        if (e.key === 'Enter') onEnter();
      });
    });
    return {
      value: () => boxes.map(b => b.value).join(''),
      reset() {
        let last = '';
        try { last = localStorage.getItem('arcade.initials') || ''; } catch { /* unavailable */ }
        boxes.forEach((b, i) => { b.value = last[i] || ''; });
        boxes[0].focus();
      },
      remember(v) { try { localStorage.setItem('arcade.initials', v); } catch { /* unavailable */ } }
    };
  }

  function renderScores(list, rows, highlightId) {
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<li class="empty">No scores yet. Be the first!</li>';
      return;
    }
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = (i === 0 ? 'top1' : '') + (r.id === highlightId ? ' me' : '');
      li.innerHTML = '<span class="rk"></span><span class="who"></span><span class="det"></span><span class="pts"></span>';
      li.querySelector('.rk').textContent = `#${i + 1}`;
      li.querySelector('.who').textContent = r.initials;
      li.querySelector('.det').textContent = r.detail || '';
      li.querySelector('.pts').textContent = r.score.toLocaleString('en-US');
      list.appendChild(li);
    });
  }

  async function loadScores(game, board, list, highlightId) {
    try {
      renderScores(list, await api(`/api/scores/${game}?board=${encodeURIComponent(board || '')}&limit=20`), highlightId);
    } catch (e) {
      list.innerHTML = `<li class="empty"></li>`;
      list.firstChild.textContent = e.message;
    }
  }

  const saveScore = (game, entry) => api(`/api/scores/${game}`, entry);

  return { $, toast, api, wireInitials, renderScores, loadScores, saveScore };
})();
