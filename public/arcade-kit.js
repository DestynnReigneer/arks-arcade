'use strict';

// Small helpers shared by the newer games: a toast, who a score goes on the
// board as, and the high-score list backed by /api/scores.

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
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
    return data;
  }

  // Who a finished game's score goes on the board as. Nobody types anything:
  // signed in, it's the profile (the server checks the token, and the board
  // shows the profile's name and avatar); a guest, the name they're playing
  // under. -> the fields to send with the save, or null for nobody (then the
  // score can't go on the board, and NO_NAME says why).
  const NO_NAME = 'Sign in with ARKS ID to put your score on the board.';
  // A TV is signed in as itself, not as whoever has the remote, so a score is
  // never saved under the TV's name. Games with the remote's letter picker
  // (wireInitials with tv) use that; the others leave TV scores off the board.
  const TV_NO_BOARD = 'Scores played on the TV don\'t go on the board. Play on your own device to get on it.';
  const onTvDevice = () => (typeof TvPlay !== 'undefined' && !!TvPlay.on) ||
    document.documentElement.classList.contains('tv') ||
    (typeof ArcadeProfile !== 'undefined' && ArcadeProfile.arksId && !!ArcadeProfile.arksId().tv);
  function boardWho() {
    const P = typeof ArcadeProfile !== 'undefined' ? ArcadeProfile : null;
    if (!P || onTvDevice()) return null;
    const token = P.token() || null;
    const name = P.name() || '';
    if (!token && !name) return null;
    const me = P.get() || {};
    return { profileToken: token, name, avatar: me.avatar || undefined };
  }

  // The TV only: three boxes picked with the remote like an arcade cabinet
  // (tv-play.js does the arrows). A TV is signed in as itself, so its scores go
  // under these letters, not the TV's name. Everywhere else the boxes stay
  // hidden and empty, and the score goes under boardWho().
  // tv: true, or a function saying so.
  function wireInitials(boxes, onEnter, { tv = false } = {}) {
    const onTv = () => (typeof tv === 'function' ? tv() : tv);
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
      tv: () => !!onTv(),
      value: () => (onTv() ? boxes.map(b => b.value).join('') : ''),
      reset() {
        const show = !!onTv();
        let last = '';
        if (show) { try { last = localStorage.getItem('arcade.initials') || ''; } catch { /* unavailable */ } }
        boxes.forEach((b, i) => { b.value = last[i] || ''; });
        const row = boxes[0].parentElement;
        row.classList.toggle('hidden', !show);
        const hint = row.previousElementSibling;
        if (hint && hint.classList.contains('hint')) hint.classList.toggle('hidden', !show);
        if (show) boxes[0].focus();
      },
      remember(v) { if (onTv()) { try { localStorage.setItem('arcade.initials', v); } catch { /* unavailable */ } } }
    };
  }

  // Gets a game-over panel's save part ready. ini: from wireInitials. hint: the
  // line over the boxes, which says whose name the score goes under ("Saving as
  // Sam."), or NO_NAME with the Save button (btn) hidden. On a TV it says to
  // pick initials with the arrows. Asked fresh each time, so a sign-in that
  // finished during the game counts. -> true on a TV.
  const TV_LINE = 'Pick your initials with the arrows to get on the board.';
  function readySave(ini, hint, btn, tvLine = TV_LINE) {
    ini.reset();
    const tv = ini.tv();
    const who = tv ? null : boardWho();
    const none = onTvDevice() ? TV_NO_BOARD : NO_NAME;
    if (hint) { hint.classList.remove('hidden'); hint.textContent = tv ? tvLine : who ? `Saving as ${who.name}.` : none; }
    if (btn) btn.classList.toggle('hidden', !tv && !who);
    return tv;
  }
  // What to send with a save: the TV's initials, or boardWho(). Throws a line
  // to show when there's neither.
  function saveFields(ini) {
    if (ini && ini.tv()) {
      const v = ini.value();
      if (!v) throw new Error('Pick a letter with the arrows first.');
      return { initials: v, profileToken: null };
    }
    const w = boardWho();
    if (!w) throw new Error(onTvDevice() ? TV_NO_BOARD : NO_NAME);
    return w;
  }

  // fmt turns a score into text (a game whose score is a time shows it as a time)
  function renderScores(list, rows, highlightId, fmt) {
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
      li.querySelector('.pts').textContent = fmt ? fmt(r.score) : r.score.toLocaleString('en-US');
      list.appendChild(li);
    });
  }

  async function loadScores(game, board, list, highlightId, headers, fmt) {
    try {
      renderScores(list, await api(`/api/scores/${game}?board=${encodeURIComponent(board || '')}&limit=20`, undefined, headers), highlightId, fmt);
    } catch (e) {
      list.innerHTML = `<li class="empty"></li>`;
      list.firstChild.textContent = e.message;
    }
  }

  // A signed-in profile gets the credit (the server checks its token), and a
  // guest's score goes under their name. An entry with initials (a TV's) goes
  // under those letters instead, with nobody's token or name.
  const saveScore = (game, entry) => api(`/api/scores/${game}`, entry.initials
    ? { ...entry, profileToken: null }
    : { ...(boardWho() || {}), ...entry });

  return { $, toast, readMs, joke, api, wireInitials, readySave, saveFields, boardWho, onTvDevice, NO_NAME, TV_NO_BOARD, renderScores, loadScores, saveScore };
})();
