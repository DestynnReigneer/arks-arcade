'use strict';

// The lobby for the party card games (Uh-Oh: Part Deux, Dare Devil), the
// play-together design's step 2 (2026-11-13). Both pages share their setup and
// lobby markup, so this adds the same pieces to each:
//   - Create a game lobby: Who can join (anyone, or Only People Selected).
//   - List Hosted Games: the rooms you can join, and a details card before joining.
//   - The lobby: Ready!, the host's start lighting up once everyone is ready, Mute
//     and Remove Player, and the chat (lobby-ui.js); the chat goes on under the game.
// The page calls it at a few points; it never touches the game itself.
//
//   const lobby = PartyLobby.attach({ game, title, enterRoom, creds: () => ({ code, playerId, token }) })
//   lobby.mode(mode)             from the page's setMode
//   lobby.hostBody()             { who, allowed } to add to the create request, or null to stop
//   lobby.headers()              the profile header for create and join
//   lobby.render(snap)           after the page draws its lobby
//   lobby.game(snap)             while a game is on screen
//   lobby.openFromLink(code)     for page.html?join=CODE

window.PartyLobby = (() => {
  const $ = id => document.getElementById(id);
  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const token = () => (typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() : null);
  const headers = () => (token() ? { 'X-Profile-Token': token() } : {});
  const toast = msg => (window.ArcadeKit ? ArcadeKit.toast(msg) : null);

  function attach({ game, title, enterRoom, creds }) {
    const API = `/api/${game}`;
    const post = async (path, body = {}) => {
      const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), data, { status: res.status });
      return data;
    };
    const roomPost = (path, body = {}) => { const c = creds(); return post(`/rooms/${c.code}/${path}`, { playerId: c.playerId, token: c.token, ...body }).catch(e => toast(e.message)); };

    // ---- Create a game lobby: who can join ----
    let who = 'anyone';
    const chosen = new Set();
    let people = null;
    const hostSetup = $('hostSetup');
    hostSetup.querySelector('.hint').textContent = 'Everyone plays on their own device. Your lobby will show in List Hosted Games and on the Arcade\'s home page once created.';
    const nameRow = $('hostName').closest('label');
    const whoLabel = make('div', 'lb-section-label', 'Who can join');
    const whoSeg = make('div', 'seg');
    whoSeg.innerHTML = '<button data-who="anyone" aria-pressed="true">🎮 Anyone at the arcade</button><button data-who="selected" aria-pressed="false">✅ Only People Selected</button>';
    const pick = make('div', 'lb-people hidden');
    hostSetup.append(whoLabel, whoSeg, pick);
    for (const b of whoSeg.children) b.addEventListener('click', async () => {
      if (b.dataset.who === 'selected' && !token()) { $('setupMsg').textContent = 'Pick your profile at the top first, so the people you choose know who it\'s from.'; return; }
      who = b.dataset.who;
      for (const x of whoSeg.children) x.setAttribute('aria-pressed', String(x === b));
      $('setupMsg').textContent = '';
      pick.classList.toggle('hidden', who !== 'selected');
      if (who === 'selected') {
        if (!people) { try { people = (await (await fetch('/api/invites/people', { headers: headers() })).json()).people || []; } catch { people = []; } }
        LobbyUI.people(pick, people, chosen, () => {});
        if (!people.length) $('setupMsg').textContent = 'Nobody else has a profile here yet.';
      }
    });

    // ---- List Hosted Games ----
    const joinSetup = $('joinSetup');
    joinSetup.innerHTML = `<h2>Available ${title} lobbies</h2><ul class="lb-rows"></ul><p class="hint hidden">There aren't any ${title} lobbies right now. Create one!</p>`;
    const rows = joinSetup.querySelector('.lb-rows');
    const empty = joinSetup.querySelector('p');
    let timer = null;
    const fetchLobbies = async () => (await (await fetch(`${API}/lobbies`, { headers: headers(), cache: 'no-store' })).json()).lobbies || [];
    async function load() {
      let list;
      try { list = await fetchLobbies(); } catch { return; }
      rows.replaceChildren();
      empty.classList.toggle('hidden', list.length > 0);
      for (const l of list) {
        const b = make('button', 'lb-row');
        b.type = 'button';
        if (l.status !== 'open') b.setAttribute('aria-disabled', 'true');
        const main = make('span', 'lb-row-main');
        main.append(make('b', '', `${l.adult ? '🔞 ' : ''}${l.host}'s lobby`),
          make('small', '', l.status === 'playing' ? 'Game started' : 'Multiplayer-Multiple devices'));
        b.append(main, make('span', 'lb-count', `${l.count}/${l.max}`));
        if (l.status === 'full') b.append(make('span', 'lb-full', 'FULL'));
        b.addEventListener('click', () => details(l));
        const li = make('li');
        li.append(b);
        rows.append(li);
      }
    }
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    function mode(m) {
      $('goBtn').classList.toggle('hidden', m === 'join');
      nameRow.classList.toggle('hidden', !!token());
      stop();
      if (m === 'join') { load(); timer = setInterval(() => { if (!document.hidden) load(); }, 5000); }
    }

    // ---- the lobby's details, before joining ----
    const view = make('div', 'overlay hidden pl-details');
    view.setAttribute('role', 'dialog');
    view.innerHTML = `<div class="card-panel"><h2></h2><div class="lb-facts">
      <div><small>PLAYERS</small><span data-players></span></div>
      <div><small>HOW</small><span data-how></span></div>
      <div><small>STATUS</small><span data-status></span></div></div>
      <div data-guest class="hidden"><p class="hint">Choose your profile, or type your name to join as a guest.</p>
      <label>Your name<input data-name maxlength="16" placeholder="e.g. Alex"></label></div>
      <div class="msg" data-msg></div>
      <div class="stack"><button class="primary" data-join>Join lobby</button><button class="ghost" data-close>Not now</button></div></div>`;
    document.body.append(view);
    const q = s => view.querySelector(s);
    let current = null;
    function details(l) {
      current = l;
      q('h2').textContent = `${l.host}'s ${title} lobby`;
      q('[data-players]').textContent = `${l.players.join(', ')} · ${l.count} of ${l.max}`;
      q('[data-how]').textContent = l.screen ? 'The table is on the TV, and your cards stay on your device.' : 'Each player on their own device; your cards stay on yours.';
      q('[data-status]').textContent = l.status === 'full' ? 'Full' : l.status === 'playing' ? 'This game already started, you can join when a new lobby opens or you can create your own.' : 'Waiting for players';
      q('[data-join]').disabled = l.status !== 'open';
      q('[data-guest]').classList.toggle('hidden', !!token());
      q('[data-msg]').textContent = '';
      view.classList.remove('hidden');
    }
    const close = () => view.classList.add('hidden');
    q('[data-close]').addEventListener('click', close);
    const join = async () => {
      if (!current) return;
      q('[data-msg]').textContent = '';
      try {
        // An adult game asks for its lobby password (not the adult pass).
        const r = await RoomPassword.withPassword(password => post(`/rooms/${current.code}/join`, { name: q('[data-name]').value, password }));
        if (r) { close(); stop(); enterRoom(r); }
      } catch (e) { q('[data-msg]').textContent = e.message; }
    };
    q('[data-join]').addEventListener('click', join);
    q('[data-name]').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

    // ---- the lobby: Ready, Mute, Remove Player, the chat ----
    const panel = $('lobbyPlayers').closest('.panel');
    const readyHint = make('p', 'hint hidden', 'When you\'re ready, tap the Ready! button.');
    const readyBtn = make('button', 'primary big hidden', 'Ready!');
    readyBtn.type = 'button';
    $('waitHost').before(readyHint, readyBtn);
    const chatLabel = make('div', 'lb-section-label', 'Chat');
    const chatBox = make('div');
    $('leaveBtn').before(chatLabel, chatBox);
    const send = text => { const c = creds(); return post(`/rooms/${c.code}/chat`, { playerId: c.playerId, token: c.token, text }); };
    const lobbyChat = LobbyUI.chat(chatBox, { send });
    const gameChatBox = make('div', 'hidden');
    gameChatBox.style.marginTop = '12px';
    $('game').append(gameChatBox);
    const gameChat = LobbyUI.chat(gameChatBox, { send });
    let snapNow = null;
    readyBtn.addEventListener('click', () => { const me = snapNow && snapNow.players.find(p => p.id === snapNow.you); roomPost('lobby-ready', { ready: !(me && me.ready) }); });

    function render(snap) {
      snapNow = snap;
      const onTv = snap.screen;
      // The code and the QR are for the TV, where phones scan to join; a lobby
      // hosted on a phone is joined from List Hosted Games, with no code.
      for (const id of ['lobbyCode', 'joinQr', 'joinLink']) $(id).classList.toggle('hidden', !onTv);
      const codeHint = $('lobbyCode').previousElementSibling;
      if (codeHint) codeHint.classList.toggle('hidden', !onTv);
      if (!onTv) $('lobbyInfo').textContent = `${snap.youAreHost ? `Your ${title} lobby` : `${snap.hostName}'s ${title} lobby`} · ${$('lobbyInfo').textContent}`;
      // Ready tags, and the host's Mute and Remove Player.
      const lis = [...$('lobbyPlayers').children];
      snap.players.forEach((p, i) => {
        const li = lis[i];
        if (!li || onTv) return;
        if (!p.host && p.device) { const t = make('span', 'tag', p.ready ? 'ready' : 'not ready'); li.append(t); }
        if (p.mutedChat) li.append(make('span', 'tag', '🔇'));
        if (snap.youAreHost && p.device && p.id !== snap.you) {
          for (const [label, act] of [[p.mutedChat ? 'Unmute' : 'Mute', () => roomPost('mute', { seat: p.id, on: !p.mutedChat })], ['Remove Player', () => roomPost('remove', { seat: p.id })]]) {
            const b = make('button', 'lb-mute', label);
            b.type = 'button';
            b.style.marginLeft = '8px';
            b.addEventListener('click', act);
            li.append(b);
          }
        }
      });
      if (snap.youAreHost && !onTv) {
        const two = snap.players.length >= 2;
        $('startBtn').disabled = !two || !snap.allReady;
        $('startBtn').textContent = !two ? 'Waiting on players to join...' : !snap.allReady ? 'Waiting on players to be ready...' : 'Players Ready, Start Game!';
      }
      const me = snap.players.find(p => p.id === snap.you);
      const guest = !snap.youAreHost && !onTv && !!me;
      readyBtn.classList.toggle('hidden', !guest);
      readyHint.classList.toggle('hidden', !guest || me.ready);
      if (guest) { readyBtn.textContent = me.ready ? 'Not ready yet' : 'Ready!'; readyBtn.className = me.ready ? 'ghost big' : 'primary big'; }
      if (!onTv) {
        $('waitHost').classList.toggle('hidden', snap.youAreHost || (guest && !me.ready));
        $('waitHost').textContent = `Waiting for ${snap.hostName || 'the host'} to start the game…`;
      }
      chatLabel.classList.toggle('hidden', !!snap.isScreen);
      chatBox.classList.toggle('hidden', !!snap.isScreen);
      lobbyChat.render(snap.chat || [], { muted: snap.muted });
    }
    function gameView(snap) {
      const on = snap.kind === 'room' && !snap.isScreen;
      gameChatBox.classList.toggle('hidden', !on);
      if (on) gameChat.render(snap.chat || [], { muted: snap.muted });
    }
    async function openFromLink(code) {
      try {
        const l = (await fetchLobbies()).find(x => x.code === code);
        if (l) return details(l);
      } catch { /* falls through */ }
      $('setupMsg').textContent = 'That game isn\'t open anymore. Choose List Hosted Games to see the ones that are.';
    }
    function hostBody() {
      if (who === 'selected' && !chosen.size) { $('setupMsg').textContent = 'Choose at least one person.'; return null; }
      return { who, allowed: who === 'selected' ? [...chosen] : [] };
    }
    return { mode, hostBody, headers, render, game: gameView, openFromLink, picked: () => who === 'selected' };
  }
  return { attach };
})();
