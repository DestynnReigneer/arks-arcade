'use strict';

// The pieces every game's lobby shares (the play-together design):
// the players' seats, the "choose who to play with" list, and the live chat.
// Chess is the first game to use them. Each game keeps its own rooms on the
// server and hands these the room's snapshot; nothing here talks to a server
// except through the functions the game passes in.
//
//   LobbyUI.seats(el, seats, { invited, max, canMute, onMute, onRemove })
//   LobbyUI.people(el, people, picked)       picked: a Set of profile ids, kept by the game
//   LobbyUI.chat(el, { send })               builds the chat once; returns { render(messages, { muted }) }

window.LobbyUI = (() => {
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const initial = name => (String(name || '?').trim()[0] || '?').toUpperCase();
  const HUES = ['#00ffc2', '#ff2ec4', '#ffd23f', '#9b7bff', '#ff8a3d', '#38c6ff'];
  const hue = name => HUES[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

  function avatar(name, empty) {
    const a = make('span', 'lb-av' + (empty ? ' empty' : ''), empty ? (name === '+' ? '+' : initial(name)) : initial(name));
    if (!empty) a.style.background = hue(name);
    return a;
  }

  // The emoji picker: a row of groups, and the group's emoji to tap. The list is a
  // separate file (about 1,150 emoji), fetched the first time anyone opens it.
  let listLoading = null;
  function loadList() {
    if (window.EMOJI_GROUPS) return Promise.resolve(window.EMOJI_GROUPS);
    if (!listLoading) listLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'emoji-list.js';
      s.onload = () => resolve(window.EMOJI_GROUPS || []);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return listLoading;
  }
  function emojiPanel(panel, pickOne) {
    if (panel.dataset.built) return;
    panel.dataset.built = '1';
    panel.textContent = 'Loading…';
    loadList().then(groups => {
      panel.replaceChildren();
      const tabs = make('div', 'lb-emo-tabs');
      const grid = make('div', 'lb-emo-grid');
      const show = g => {
        for (const t of tabs.children) t.setAttribute('aria-pressed', String(t.dataset.id === g.id));
        grid.replaceChildren(...g.emoji.map(ch => {
          const b = make('button', '', ch);
          b.type = 'button';
          b.addEventListener('click', () => pickOne(ch));
          return b;
        }));
        grid.scrollTop = 0;
      };
      for (const g of groups) {
        const t = make('button', '', [...g.label][0] === '❤' ? '❤️' : g.label.split(' ')[0]);
        t.type = 'button';
        t.title = g.label.slice(g.label.indexOf(' ') + 1);
        t.dataset.id = g.id;
        t.addEventListener('click', () => show(g));
        tabs.append(t);
      }
      panel.append(tabs, grid);
      if (groups.length) show(groups[0]);
    }, () => { panel.textContent = 'The emoji didn\'t load. Try again in a moment.'; delete panel.dataset.built; });
  }

  // Who's in, who's been invited, and the empty seats. A seat with `ready` (true or
  // false) says Ready or Not ready under the name; an open seat's dots grow and start
  // over while it waits for someone.
  function seats(el, list, { invited = [], max = 2, canMute = false, onMute, onRemove } = {}) {
    el.replaceChildren();
    for (const s of list) {
      const box = make('div', 'lb-seat' + (s.ready === false ? ' waiting' : ''));
      const tag = s.host ? 'HOST' : s.ready === true ? 'READY' : s.ready === false ? 'NOT READY' : s.online ? 'HERE' : 'AWAY';
      box.append(avatar(s.name), make('span', 'lb-name', s.you ? 'You' : s.name), make('span', 'lb-tag', (s.muted ? '🔇 ' : '') + tag));
      if (canMute && !s.host && !s.you) {
        const b = make('button', 'lb-mute', s.muted ? 'Unmute' : 'Mute');
        b.type = 'button';
        b.title = s.muted ? 'Show their chat messages again' : 'Hide their chat messages from everyone';
        b.addEventListener('click', () => onMute(s.id, !s.muted));
        box.append(b);
        if (onRemove) {
          const x = make('button', 'lb-mute', 'Remove Player');
          x.type = 'button';
          x.addEventListener('click', () => onRemove(s.id));
          box.append(x);
        }
      }
      el.append(box);
    }
    let open = Math.max(0, max - list.length);
    for (const name of invited) {
      if (!open) break;
      const box = make('div', 'lb-seat empty');
      box.append(avatar(name, true), make('span', 'lb-name', name), make('span', 'lb-tag', 'INVITED'));
      el.append(box);
      open--;
    }
    for (; open > 0; open--) {
      const box = make('div', 'lb-seat empty');
      const name = make('span', 'lb-name lb-open', 'Open');
      name.append(make('span', 'lb-dots'));
      box.append(avatar('+', true), name, make('span', 'lb-tag', ''));
      el.append(box);
    }
  }

  // Tiles to tap: everyone in the family who has a profile here.
  function people(el, list, picked, onChange) {
    el.replaceChildren();
    for (const p of list) {
      const b = make('button', 'lb-who' + (picked.has(p.id) ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(picked.has(p.id)));
      b.append(avatar(p.name), make('span', 'lb-name', p.name));
      b.addEventListener('click', () => {
        if (picked.has(p.id)) picked.delete(p.id); else picked.add(p.id);
        people(el, list, picked, onChange);
        if (onChange) onChange();
      });
      el.append(b);
    }
  }

  // The chat: messages fading in at the bottom, quick buttons, and a box to type in.
  const QUICK = ['👋', '😂', '🔥', 'GG', 'Let\'s go!', 'Your move!'];
  function chat(el, { send }) {
    el.replaceChildren();
    el.classList.add('lb-chat');
    const lines = make('div', 'lb-lines');
    lines.setAttribute('aria-live', 'polite');
    const quick = make('div', 'lb-quick');
    const form = make('form', 'lb-say');
    const input = make('input');
    input.maxLength = 200;
    input.placeholder = 'Say something…';
    input.setAttribute('aria-label', 'Chat message');
    input.autocomplete = 'off';
    const go = make('button', 'lb-send', 'Send');
    go.type = 'submit';
    // Every standard emoji, in groups (emoji-list.js, loaded the first time it's opened).
    const smile = make('button', 'lb-emo-btn', '😀');
    smile.type = 'button';
    smile.title = 'Emoji';
    smile.setAttribute('aria-label', 'Emoji');
    smile.setAttribute('aria-expanded', 'false');
    const panel = make('div', 'lb-emo hidden');
    form.append(smile, input, go);
    el.append(lines, quick, panel, form);
    smile.addEventListener('click', () => {
      const open = panel.classList.toggle('hidden') === false;
      smile.setAttribute('aria-expanded', String(open));
      if (open) emojiPanel(panel, ch => {
        const at = input.selectionStart == null ? input.value.length : input.selectionStart;
        const end = input.selectionEnd == null ? at : input.selectionEnd;
        const next = input.value.slice(0, at) + ch + input.value.slice(end);
        if (next.length > input.maxLength) return;
        input.value = next;
        input.setSelectionRange(at + ch.length, at + ch.length);
      });
    });

    let busy = false;
    const post = async text => {
      if (busy || !text.trim()) return;
      busy = true;
      try { await send(text); input.value = ''; } catch (e) { if (window.ArcadeKit) ArcadeKit.toast(e.message); } finally { busy = false; }
    };
    for (const q of QUICK) {
      const b = make('button', '', q);
      b.type = 'button';
      b.addEventListener('click', () => post(q));
      quick.append(b);
    }
    form.addEventListener('submit', e => { e.preventDefault(); post(input.value); });

    let lastId = null;
    function render(messages, { muted = false } = {}) {
      input.disabled = go.disabled = smile.disabled = muted;
      if (muted) panel.classList.add('hidden');
      for (const b of quick.children) b.disabled = muted;
      input.placeholder = muted ? 'The host muted you' : 'Say something…';
      const newest = messages.length ? messages[messages.length - 1].id : null;
      if (newest === lastId) return;
      lastId = newest;
      lines.replaceChildren();
      if (!messages.length) lines.append(make('div', 'lb-sys', 'Nothing said yet. Say hi!'));
      for (const m of messages) {
        if (m.system) { lines.append(make('div', 'lb-sys', m.text)); continue; }
        const row = make('div', 'lb-line');
        const who = make('b', '', m.mine ? 'You' : m.name);
        who.style.color = hue(m.name);
        row.append(who, document.createTextNode(' ' + m.text));
        lines.append(row);
      }
      lines.scrollTop = lines.scrollHeight;
    }
    return { render };
  }

  return { seats, people, chat };
})();
