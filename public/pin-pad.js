// Six-digit PIN pads that work like a phone lock screen: there's no Enter
// key, the PIN is checked the moment the 6th digit goes in.
//
//   PinPad.attach(input, pin => check(pin))
//
// adds a 0-9 / CLR / ⌫ keypad under the input (typing still works too) and
// calls the callback with the six digits. Call attach again to swap the
// callback; call PinPad.clear(input) after a wrong PIN, and
// PinPad.show(input, false) to hide the input and its keypad together.
(function () {
  const LEN = 6;

  const css = `
.pin-pad{display:grid;grid-template-columns:repeat(3,64px);gap:8px;justify-content:center;margin:12px auto 4px}
.pin-pad button{height:52px;border-radius:12px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);
  color:inherit;font:inherit;font-size:22px;font-weight:700;cursor:pointer;touch-action:manipulation}
.pin-pad button:active{transform:scale(.95);background:rgba(127,127,127,.28)}
.pin-pad button.pin-fn{font-size:14px;letter-spacing:.05em}
.pin-pad-input{letter-spacing:.5em;text-align:center}`;

  function addStyles() {
    if (document.getElementById('pinPadCss')) return;
    const s = document.createElement('style');
    s.id = 'pinPadCss';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function attach(input, onComplete) {
    if (input._pinPad) { input._pinPad.onComplete = onComplete; return; }
    addStyles();
    const state = { onComplete, busy: false };
    input._pinPad = state;
    input.maxLength = LEN;
    input.classList.add('pin-pad-input');
    input.setAttribute('placeholder', '••••••');

    const pad = document.createElement('div');
    pad.className = 'pin-pad';
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', '⌫']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = k;
      b.dataset.k = k;
      if (k === 'CLR' || k === '⌫') b.className = 'pin-fn';
      b.setAttribute('aria-label', k === 'CLR' ? 'Clear' : k === '⌫' ? 'Delete' : k);
      pad.appendChild(b);
    }
    input.after(pad);
    state.pad = pad;

    const check = async () => {
      input.value = input.value.replace(/\D/g, '').slice(0, LEN);
      if (input.value.length < LEN || state.busy || !state.onComplete) return;
      state.busy = true;
      try { await state.onComplete(input.value); } finally { state.busy = false; }
    };
    pad.addEventListener('click', e => {
      const k = e.target.closest('button') && e.target.closest('button').dataset.k;
      if (!k || state.busy) return;
      if (k === 'CLR') input.value = '';
      else if (k === '⌫') input.value = input.value.slice(0, -1);
      else if (input.value.length < LEN) input.value += k;
      check();
    });
    input.addEventListener('input', check);
    // On an arcade that signs in through ARKS ID, the only PIN pads are the
    // adult ones, and they don't take a PIN: see arksIdPad below.
    if (typeof ArcadeProfile !== 'undefined' && ArcadeProfile.arksId) ArcadeProfile.arksId().ready.then(Id => { if (Id.on) arksIdPad(input, state, Id); });
  }

  // With ARKS ID, adult levels follow the signed-in person's role. When an
  // adult PIN pad shows up on screen, a grown-up's page fetches an adult pass
  // and hands it to the game in place of the PIN; anyone else is told why the
  // levels stay locked. Waiting until the pad is actually showing means
  // nothing unlocks unless the game is asking.
  function arksIdPad(input, state, Id) {
    state.arks = true;
    input.style.display = 'none';
    state.pad.style.display = 'none';
    const note = document.createElement('p');
    note.className = 'pin-pad-arksid';
    note.style.cssText = 'text-align:center;margin:10px 0;line-height:1.45';
    state.pad.after(note);
    state.note = note;
    const me = Id.me || {};
    if (!me.signedIn) {
      note.textContent = 'Adult levels unlock when a grown-up signs in with their ARKS ID. ';
      const a = document.createElement('a');
      a.href = '/auth/signin?return=' + encodeURIComponent(location.pathname + location.search + location.hash);
      a.textContent = 'Sign in';
      a.style.color = 'inherit';
      note.appendChild(a);
      return;
    }
    if (!me.adult) { note.textContent = 'Adult levels are only for grown-ups’ ARKS ID accounts, so they stay locked here.'; return; }
    note.textContent = 'Unlocking with your ARKS ID…';
    let done = false;
    const unlock = async () => {
      if (done || state.busy || !state.onComplete) return;
      done = true;
      try {
        const res = await fetch('/api/arksid/adult-pass', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.pass) throw new Error(data.error || 'ARKS ID didn’t answer. Try again in a moment.');
        note.textContent = 'Unlocked with your ARKS ID.';
        state.busy = true;
        try { await state.onComplete(data.pass); } finally { state.busy = false; }
      } catch (e) { note.textContent = e.message; done = false; }
    };
    // Unlock each time the pad comes into view (it may be shown, hidden and
    // shown again as someone switches levels).
    new IntersectionObserver(entries => {
      for (const e of entries) { if (e.isIntersecting) unlock(); else done = false; }
    }).observe(note);
  }

  function clear(input) {
    input.value = '';
  }

  function show(input, on) {
    const state = input._pinPad;
    if (state && state.arks) { if (state.note) state.note.style.display = on ? '' : 'none'; return; }
    input.classList.toggle('hidden', !on);
    if (state) state.pad.style.display = on ? '' : 'none';
  }

  window.PinPad = { LEN, attach, clear, show };
})();
