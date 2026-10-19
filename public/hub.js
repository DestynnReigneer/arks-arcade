'use strict';

// The arcade's front door: its name, the Comm Center, feedback, and a pile of
// gaming-culture Easter eggs for whoever goes poking around.

(() => {
  const $ = id => document.getElementById(id);
  const GAMES = {
    wordless: { label: 'Wordless', href: 'wordless.html' },
    rambler: { label: 'Rambler', href: 'rambler.html' },
    shortfuse: { label: 'Short Fuse', href: 'shortfuse.html' }
  };

  // ---- the arcade's name --------------------------------------------------
  // ARCADE_NAME in .env: "ARKS" makes this the ARKS Arcade. Blank is just Arcade.
  fetch('/api/arcade-info').then(r => r.json()).then(info => {
    const name = (info.name || '').trim();
    $('arcadeName').textContent = name ? name + ' ' : '';
    document.title = name ? `${name} Arcade` : 'Arcade';
  }).catch(() => {});

  // ---- Comm Center ----------------------------------------------------------

  // SQLite stores UTC without a zone marker.
  const parseWhen = iso => new Date(String(iso).replace(' ', 'T') + 'Z');

  function ago(iso) {
    const s = Math.max(0, (Date.now() - parseWhen(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
    return parseWhen(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const TAGS = { highscore: 'High score', theme: 'New theme', announcement: 'News' };

  async function loadFeed() {
    const host = $('commFeed');
    try {
      const posts = await fetch('/api/comm/posts?limit=8').then(r => r.json());
      host.innerHTML = '';
      if (!posts.length) {
        host.innerHTML = '<li class="comm-empty">All quiet on the server. Go set a high score.</li>';
        return;
      }
      for (const p of posts) {
        const li = document.createElement('li');
        li.innerHTML = `<button type="button"><span class="post-emoji"></span>
          <span class="post-main"><div class="post-title"></div><div class="post-meta"></div></span>
          <span class="post-tag"></span></button>`;
        li.querySelector('.post-emoji').textContent = p.emoji;
        li.querySelector('.post-title').textContent = p.title;
        li.querySelector('.post-meta').textContent = ago(p.createdAt);
        li.querySelector('.post-tag').textContent = TAGS[p.kind] || '';
        li.querySelector('button').onclick = () => openPost(p);
        host.appendChild(li);
      }
    } catch {
      host.innerHTML = '<li class="comm-empty">Comm link down. Try again in a bit.</li>';
    }
  }

  function openPost(p) {
    $('postEmoji').textContent = p.emoji;
    $('postTitle').textContent = p.title;
    $('postWhen').textContent = parseWhen(p.createdAt).toLocaleString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('postBody').textContent = p.body || '';
    const game = GAMES[p.game];
    $('postPlay').classList.toggle('hidden', !game);
    if (game) {
      $('postPlay').href = game.href;
      $('postPlay').textContent = `▶ Play ${game.label}`;
    }
    $('postModal').classList.remove('hidden');
    $('postClose').focus();
  }

  // ---- feedback -------------------------------------------------------------

  let fbKind = 'message';

  function openFeedback() {
    fbKind = 'message';
    paintKinds();
    $('fbMessage').value = '';
    $('fbMsg').textContent = '';
    $('fbMsg').className = 'form-msg';
    $('feedbackModal').classList.remove('hidden');
    $('fbMessage').focus();
  }

  function paintKinds() {
    for (const b of $('fbKinds').children) b.setAttribute('aria-pressed', String(b.dataset.kind === fbKind));
  }

  async function sendFeedback() {
    const message = $('fbMessage').value.trim();
    const msg = $('fbMsg');
    if (!message) {
      msg.textContent = 'Write something first.';
      msg.className = 'form-msg err';
      return;
    }
    $('fbSend').disabled = true;
    try {
      const res = await fetch('/api/comm/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: fbKind, message, from: $('fbFrom').value, game: $('fbGame').value || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send that.');
      msg.textContent = 'Sent! Message received, over and out. 📡';
      msg.className = 'form-msg ok';
      setTimeout(() => $('feedbackModal').classList.add('hidden'), 1500);
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'form-msg err';
    } finally {
      $('fbSend').disabled = false;
    }
  }

  // ---- Easter eggs ----------------------------------------------------------

  const QUOTES = [
    "It's dangerous to go alone! Take this. 🗡️",
    'The cake is a lie.',
    'All your base are belong to us.',
    'Thank you Mario! But our princess is in another castle.',
    'Hey! Listen!',
    'Stay a while and listen.',
    'War. War never changes.',
    'Would you kindly… play a round?',
    'Press F to pay respects.',
    'Snake? Snake?! SNAAAKE!',
    'Leeroy Jenkins!',
    'You have died of dysentery.',
    'A winner is you!',
    'Do a barrel roll!',
    'Praise the sun! \\[T]/',
    'Finish him!',
    'Achievement unlocked: opened the arcade.',
    'Wake up, Samurai.',
    'Get over here!',
    'Hadouken!'
  ];

  function rotateQuotes() {
    const el = $('quote');
    let i = Math.floor(Math.random() * QUOTES.length);
    const show = () => {
      el.style.opacity = 0;
      setTimeout(() => { el.textContent = QUOTES[i]; el.style.opacity = 1; i = (i + 1) % QUOTES.length; }, 400);
    };
    show();
    setInterval(show, 9000);
  }

  let toastTimer = null;
  function toast(text, ms = 2600) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function rain(emojis, count = 40) {
    if (reduced) return;
    for (let n = 0; n < count; n++) {
      const d = document.createElement('div');
      d.className = 'rain';
      d.textContent = emojis[n % emojis.length];
      d.style.left = Math.random() * 100 + 'vw';
      d.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
      d.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 4500);
    }
  }

  function bodyEffect(cls, ms) {
    document.body.classList.remove(cls);
    void document.body.offsetWidth;   // restart the animation if it is already running
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), ms);
  }

  // Commands work from the little terminal (so phones get them too) or typed
  // anywhere on the page with a keyboard.
  const COMMANDS = {
    '/help': () => toast('Try: /dance, /gg, /glhf, /roll, /respawn… and some secrets. 🤫', 4000),
    '/dance': () => { bodyEffect('dancing', 4000); toast('💃 /dance 🕺'); },
    '/gg': () => { rain(['🤝', 'GG', '🏆', '✨']); toast('GG WP 🤝'); },
    '/glhf': () => { rain(['🍀', '🎮', '✨']); toast('Good luck, have fun! 🍀'); },
    '/roll': () => toast(`🎲 You rolled a ${1 + Math.floor(Math.random() * 20)} (d20)`),
    '/respawn': () => { location.reload(); },
    '/afk': () => toast('brb… 🚽'),
    '/wave': () => toast('👋 o/'),
    '/flex': () => toast('💪 Flexing on the leaderboard.'),
    '/f': () => { rain(['🫡'], 20); toast('Respects paid. 🫡'); },
    // the secrets
    'gg': () => { rain(['🤝', 'GG', '🏆', '✨']); toast('GG WP 🤝'); },
    'iddqd': () => toast('😇 God mode enabled. (It does nothing. You were already a god.)', 3500),
    'idkfa': () => toast('🔫 All weapons and keys. Still have to find the words yourself.', 3500),
    'xyzzy': () => toast('A hollow voice says "Plugh."'),
    'hesoyam': () => { rain(['💵', '❤️', '🛡️']); toast('Health, armor, $250,000. 💵'); },
    'barrelroll': () => { bodyEffect('barrel', 1300); toast('🛩️ Do a barrel roll!'); },
    'thecakeisalie': () => { rain(['🍰']); toast('🍰 …it really was.'); },
    'leeroy': () => toast('LEEEEROOOOY JENKIIIINS! 🐔', 3000),
    'rickroll': () => toast('🎵 Never gonna give you up… 🎵', 3500)
  };
  // Typed-anywhere triggers, checked against the end of what was typed.
  const TYPED = ['gg', 'iddqd', 'idkfa', 'xyzzy', 'hesoyam', 'barrelroll', 'thecakeisalie', 'leeroy', 'rickroll',
    '/dance', '/gg', '/glhf', '/help', '/roll', '/afk', '/wave', '/flex'];

  function runCommand(raw) {
    const cmd = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (COMMANDS[cmd]) { COMMANDS[cmd](); return true; }
    return false;
  }

  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let keys = [];
  let typed = '';

  function onKey(e) {
    if (e.target.closest('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();

    keys = [...keys, k].slice(-KONAMI.length);
    if (keys.join() === KONAMI.join()) {
      keys = [];
      $('arcadeTitle').classList.add('rainbow');
      rain(['❤️', '⭐', '🍄']);
      toast('↑↑↓↓←→←→BA — 30 extra lives! 🍄', 3500);
      return;
    }

    if (k.length !== 1) return;
    typed = (typed + k).slice(-20);
    // Longest match first, so "/gg" is not swallowed by "gg".
    const hit = TYPED.filter(c => typed.endsWith(c)).sort((a, b) => b.length - a.length)[0];
    if (hit) { typed = ''; runCommand(hit); }
  }

  // Five quick taps on the title.
  let taps = [];
  function onTitleTap() {
    const now = Date.now();
    taps = [...taps.filter(t => now - t < 1500), now];
    if (taps.length >= 5) {
      taps = [];
      rain(['🏅']);
      toast('🏅 Achievement unlocked: Button Masher', 3000);
    }
  }

  // ---- wiring -----------------------------------------------------------------

  $('postClose').onclick = () => $('postModal').classList.add('hidden');
  $('feedbackOpen').onclick = openFeedback;
  $('fbCancel').onclick = () => $('feedbackModal').classList.add('hidden');
  $('fbSend').onclick = sendFeedback;
  for (const b of $('fbKinds').children) b.onclick = () => { fbKind = b.dataset.kind; paintKinds(); };

  // Click outside a card, or Escape, closes it.
  for (const id of ['postModal', 'feedbackModal']) {
    $(id).addEventListener('click', e => { if (e.target.id === id) $(id).classList.add('hidden'); });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  });

  $('terminal').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const value = e.target.value;
    e.target.value = '';
    if (!value.trim()) return;
    if (!runCommand(value)) toast(`Unknown command: ${value.trim().slice(0, 20)}. Try /help`);
  });
  document.addEventListener('keydown', onKey);
  $('arcadeTitle').addEventListener('click', onTitleTap);

  loadFeed();
  rotateQuotes();
  setInterval(loadFeed, 60000);
})();
