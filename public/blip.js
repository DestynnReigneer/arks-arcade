'use strict';

// Tiny synthesized sound effects for the newer games (Spin & Solve, Chess,
// Dino Dash). Nothing to download, nothing licensed. Browsers stay silent
// until the first tap, so every sound quietly does nothing before that.
// One mute switch for all of them, remembered per browser.

const Blip = (() => {
  let ctx = null;
  let muted = (() => { try { return localStorage.getItem('arcade.muted') === 'yes'; } catch { return false; } })();

  function audio() {
    if (muted) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One note: frequency (or [start, end] for a slide), length in seconds.
  function tone(freq, length = 0.1, { type = 'square', volume = 0.12, delay = 0 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    const [from, to] = Array.isArray(freq) ? freq : [freq, freq];
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  // A few notes in a row: [[freq, length], ...]
  function tune(notes, opts = {}) {
    let delay = 0;
    for (const [f, len] of notes) {
      tone(f, len, { ...opts, delay });
      delay += len * 0.9;
    }
  }

  function noise(length = 0.2, volume = 0.15) {
    const a = audio();
    if (!a) return;
    const buffer = a.createBuffer(1, Math.floor(a.sampleRate * length), a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = a.createBufferSource();
    const gain = a.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain).connect(a.destination);
    src.start();
  }

  return {
    tone, tune, noise,
    // Call from the first tap so later sounds are allowed to play.
    unlock() { audio(); },
    get muted() { return muted; },
    setMuted(value) {
      muted = !!value;
      try { localStorage.setItem('arcade.muted', muted ? 'yes' : 'no'); } catch { /* unavailable */ }
    },
    // Wires a button that toggles sound and shows 🔊 / 🔇.
    muteButton(btn) {
      const paint = () => { btn.textContent = muted ? '🔇' : '🔊'; btn.title = muted ? 'Sound off' : 'Sound on'; };
      paint();
      btn.addEventListener('click', () => { this.setMuted(!muted); paint(); if (!muted) tone(660, 0.08); });
    }
  };
})();
