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

  // How long a line of text should stay up so it can be read at a relaxed
  // pace: a couple of seconds to notice it, plus time for every word.
  const readMs = text => 2500 + 400 * String(text || '').trim().split(/\s+/).filter(Boolean).length;

  // A joke that pops up over the game: the setup, then the punchline, each up
  // long enough to read. Tap to move it along. Jokes queue, never stack.
  let jokeQueue = Promise.resolve();
  function joke(setup, punch) {
    jokeQueue = jokeQueue.then(() => new Promise(resolve => {
      let el = $('jokePop');
      if (!el) {
        el = document.createElement('div');
        el.id = 'jokePop';
        el.className = 'joke-pop';
        el.setAttribute('role', 'status');
        el.innerHTML = '<div class="jp-setup"></div><div class="jp-punch"></div><div class="jp-hint">tap to close</div>';
        document.body.appendChild(el);
      }
      const [setupEl, punchEl] = el.children;
      setupEl.textContent = setup;
      punchEl.textContent = '';
      el.classList.remove('punched');
      el.classList.add('show');
      let timer = null;
      const finish = () => { clearTimeout(timer); el.onclick = null; el.classList.remove('show'); setTimeout(resolve, 400); };
      const reveal = () => {
        clearTimeout(timer);
        punchEl.textContent = punch;
        el.classList.add('punched');
        if (window.Blip) { Blip.tone(150, 0.08, { type: 'sine', volume: 0.1 }); Blip.tone(150, 0.08, { type: 'sine', volume: 0.1, delay: 0.14 }); }
        el.onclick = finish;
        timer = setTimeout(finish, readMs(setup) / 2 + readMs(punch));
      };
      el.onclick = reveal;
      timer = setTimeout(reveal, readMs(setup));
    }));
  }

  async function api(path, body, headers = {}) {
    const res = await fetch(path, body === undefined ? { headers } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
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
        // Playing as a profile: the score is theirs, so the boxes are filled
        // in and hidden. The board shows what the profile chose.
        const me = typeof ArcadeProfile !== 'undefined' && ArcadeProfile.token() ? ArcadeProfile.initials() : '';
        if (me) last = me;
        boxes.forEach((b, i) => { b.value = last[i] || ''; });
        const row = boxes[0].parentElement;
        row.classList.toggle('hidden', !!me);
        const hint = row.previousElementSibling;
        if (hint && hint.classList.contains('hint')) hint.classList.toggle('hidden', !!me);
        if (!me) boxes[0].focus();
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
      const who = li.querySelector('.who');
      if (r.profileName && typeof ArcadeProfile !== 'undefined') {
        who.style.cssText = 'display:flex;align-items:center;gap:6px;width:auto;letter-spacing:0;white-space:nowrap';
        who.append(ArcadeProfile.avatarEl(r.profileAvatar, 22), r.profileName);
      } else who.textContent = r.initials;
      li.querySelector('.det').textContent = r.detail || '';
      li.querySelector('.pts').textContent = r.score.toLocaleString('en-US');
      list.appendChild(li);
    });
  }

  async function loadScores(game, board, list, highlightId, headers) {
    try {
      renderScores(list, await api(`/api/scores/${game}?board=${encodeURIComponent(board || '')}&limit=20`, undefined, headers), highlightId);
    } catch (e) {
      list.innerHTML = `<li class="empty"></li>`;
      list.firstChild.textContent = e.message;
    }
  }

  // A signed-in profile gets the credit (the server checks its token).
  const saveScore = (game, entry) => api(`/api/scores/${game}`, {
    ...entry, profileToken: typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null
  });

  return { $, toast, readMs, joke, api, wireInitials, renderScores, loadScores, saveScore };
})();
