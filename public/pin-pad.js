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
  }

  function clear(input) {
    input.value = '';
  }

  function show(input, on) {
    input.classList.toggle('hidden', !on);
    if (input._pinPad) input._pinPad.pad.style.display = on ? '' : 'none';
  }

  window.PinPad = { LEN, attach, clear, show };
})();
