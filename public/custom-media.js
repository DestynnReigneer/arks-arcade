// The owner's own clips (see docs/CUSTOM-MEDIA.md), on every page:
// - a clip the admin sent to this profile plays the next time a page is open,
// - now and then a random clip plays as a surprise,
// - ArcadeMedia.play(name) plays one on purpose (the home page's secret commands).
// Browsers won't play sound until someone taps, so every clip starts behind a
// "tap to play" card. Without a clips folder on the server, none of this shows.

const ArcadeMedia = (() => {
  let info = { brand: {}, sprites: [], coin: [], clips: [], surprise: 0 };
  const ready = fetch('/api/custom').then(r => (r.ok ? r.json() : info)).then(d => { info = d; return d; }).catch(() => info);

  const BAIT = [
    ['📬', 'You have a new message!'],
    ['📼', 'Incoming transmission…'],
    ['🎁', 'Somebody left you a surprise.'],
    ['🚨', 'Important arcade announcement!']
  ];

  let open = false;
  function show(clip) {
    if (!clip || open) return;
    open = true;
    const [emoji, line] = BAIT[Math.floor(Math.random() * BAIT.length)];
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:16px;background:rgba(4,4,10,.82)';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:min(560px,100%);width:100%;text-align:center;padding:22px 18px;border-radius:16px;background:#171623;border:1px solid #3a3550;color:#f4ecd0;font:16px/1.4 system-ui,sans-serif';
    const big = document.createElement('div');
    big.style.cssText = 'font-size:44px;line-height:1';
    big.textContent = emoji;
    const text = document.createElement('div');
    text.style.cssText = 'margin:10px 0 16px;font-size:19px;font-weight:700';
    text.textContent = line;
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'Tap to open';
    go.style.cssText = 'padding:12px 22px;border-radius:10px;border:0;background:#ffc72c;color:#12111c;font:800 16px system-ui,sans-serif;cursor:pointer';
    card.append(big, text, go);
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    const close = () => { wrap.remove(); open = false; };
    go.onclick = () => {
      card.textContent = '';
      let el;
      if (clip.type === 'video') { el = document.createElement('video'); el.playsInline = true; }
      else if (clip.type === 'audio') { el = document.createElement('audio'); }
      else { el = document.createElement('img'); el.alt = ''; }
      el.src = clip.url;
      el.style.cssText = 'display:block;max-width:100%;max-height:70vh;margin:0 auto;border-radius:10px';
      if (clip.type === 'audio') {
        const disc = document.createElement('div');
        disc.style.cssText = 'font-size:64px';
        disc.textContent = '🎶';
        card.appendChild(disc);
      }
      card.appendChild(el);
      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Close';
      done.style.cssText = 'margin-top:14px;padding:10px 20px;border-radius:10px;border:1px solid #3a3550;background:#1e1a30;color:#f4ecd0;font:700 15px system-ui,sans-serif;cursor:pointer';
      done.onclick = close;
      card.appendChild(done);
      if (el.play) { el.play().catch(() => {}); el.onended = close; }
    };
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  }

  function play(name) {
    const clip = info.clips.find(c => c.name === String(name || '').toLowerCase());
    if (clip) show(clip);
    return !!clip;
  }

  function token() {
    try { return typeof ArcadeProfile !== 'undefined' ? ArcadeProfile.token() || '' : ''; } catch { return ''; }
  }
  async function checkInbox() {
    if (document.visibilityState !== 'visible' || !token()) return;
    try {
      const r = await fetch('/api/custom/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token() }) });
      const d = r.ok ? await r.json() : null;
      if (d && d.clip) show(d.clip);
    } catch { /* try again next time */ }
  }

  ready.then(d => {
    if (!d.clips || !d.clips.length) return;
    checkInbox();
    setInterval(checkInbox, 20 * 1000);
    if (d.surprise > 0 && Math.random() < 1 / d.surprise) {
      setTimeout(() => show(d.clips[Math.floor(Math.random() * d.clips.length)]), 4000);
    }
  });

  return { ready, play, info: () => info };
})();
