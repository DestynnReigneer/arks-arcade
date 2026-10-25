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

  // ---- comedy sounds -----------------------------------------------------------------------------

  // Sad trombone: two drooping notes, the second long and wobbly.
  function womp() {
    const a = audio();
    if (!a) return;
    const muffle = a.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 900;
    muffle.connect(a.destination);
    const note = (from, to, start, len, wobble) => {
      const t = a.currentTime + start;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(from, t);
      o.frequency.linearRampToValueAtTime(to, t + len);
      if (wobble) {
        const lfo = a.createOscillator(), depth = a.createGain();
        lfo.frequency.value = 6;
        depth.gain.value = 5;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + len + 0.05);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.06);
      g.gain.setValueAtTime(0.16, t + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(muffle);
      o.start(t);
      o.stop(t + len + 0.05);
    };
    note(196, 185, 0, 0.36, false);
    note(185, 156, 0.42, 0.8, true);
  }

  // A truck backing up: three steady beeps.
  function backup() {
    for (let i = 0; i < 3; i++) tone(1050, 0.3, { type: 'sine', volume: 0.1, delay: i * 0.6 });
  }

  // A game-show buzzer for when time runs out.
  function timesUp() {
    tone(220, 0.6, { type: 'sawtooth', volume: 0.07 });
    tone(233, 0.6, { type: 'sawtooth', volume: 0.07 });
  }

  // A thinking tune for a countdown: a soft tick-tock under a plucky little
  // melody, ticking faster for the last three seconds, then the buzzer.
  // Returns { stop() }. Our own tune, so nothing borrowed from a game show.
  const THINK = [72, 76, 79, 76, 81, 79, 76, null, 74, 76, 79, 81, 79, 76, 74, null];
  function think(seconds, { onTick, onDone } = {}) {
    let left = seconds * 2, beat = 0, timer = null;
    const half = () => {
      if (left <= 0) { stop(); timesUp(); if (onDone) onDone(); return; }
      const final = left <= 6;
      tone(beat % 2 ? 1200 : 1500, 0.035, { type: 'sine', volume: final ? 0.09 : 0.05 });
      const m = THINK[beat % THINK.length];
      if (m != null && !final) tone(hz(m), 0.22, { type: 'triangle', volume: 0.05 });
      if (final && beat % 2 === 0) tone(1800, 0.05, { type: 'square', volume: 0.03, delay: 0.25 });
      if (beat % 2 === 0 && onTick) onTick(left / 2);
      beat++;
      left--;
    };
    function stop() { clearInterval(timer); timer = null; }
    half();
    timer = setInterval(half, 500);
    return { stop };
  }

  // The same tune, driven by a game's own clock instead of a timer of its
  // own, so it pauses whenever the game's clock pauses. Call step(msLeft) as
  // often as the clock updates; a beat plays each time another half second
  // has gone. reset() before a new countdown.
  function thinker() {
    let lastHalf = null, beat = 0;
    return {
      step(msLeft) {
        const h = Math.ceil(msLeft / 500);
        if (h === lastHalf || h <= 0) { lastHalf = h; return; }
        lastHalf = h;
        const final = h <= 6;
        tone(beat % 2 ? 1200 : 1500, 0.035, { type: 'sine', volume: final ? 0.09 : 0.05 });
        const m = THINK[beat % THINK.length];
        if (m != null && !final) tone(hz(m), 0.22, { type: 'triangle', volume: 0.05 });
        if (final && beat % 2 === 0) tone(1800, 0.05, { type: 'square', volume: 0.03, delay: 0.25 });
        beat++;
      },
      reset() { lastHalf = null; beat = 0; }
    };
  }
  // Whether games with a countdown play the thinking tune, remembered per
  // browser. Off means the quiet ticks for the last few seconds instead.
  let tuneOn = (() => { try { return localStorage.getItem('arcade.thinkTune') !== 'off'; } catch { return true; } })();

  // ---- soft background music --------------------------------------------------------------------
  // A short generated loop per game: a pad, a bass note, a gentle arpeggio and
  // now and then a little tune, all through a low-pass filter so it sits under
  // the sound effects. It has its own switch (remembered per browser), and the
  // main mute silences it too. Chords are semitones from the root note, one per
  // bar; the tune is bars of 8 steps, in semitones from two octaves up,
  // null = rest, H = hold the note before. Most songs play their tune now and
  // then over the arpeggio; a song with `lead` plays it every time round, over
  // a bouncing eighth-note bass instead.
  let musicOn = (() => { try { return localStorage.getItem('arcade.music') !== 'no'; } catch { return true; } })();
  const _ = null, H = 'hold';
  const SONGS = {
    snake: {
      bpm: 108, root: 48, wave: 'triangle', hat: true, arp: [0, 1, 2, 1, 3, 1, 2, 1],
      chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]],
      tune: [7, _, 4, _, 7, 9, 7, _,  4, _, 0, _, 4, _, 2, _,  0, _, 2, 4, 5, _, 4, _,  2, _, 7, _, 2, _, _, _]
    },
    bricks: {
      bpm: 120, root: 45, wave: 'square', hat: true, arp: [0, 2, 1, 2, 3, 2, 1, 2],
      chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
      tune: [7, _, 12, _, 10, 7, _, 3,  8, _, 7, _, 3, _, 0, _,  3, _, 7, 10, 12, _, 10, _,  10, _, 5, _, 2, _, _, _]
    },
    // Korobeiniki, the 1861 Russian folk song (public domain), in A minor.
    blocks: {
      bpm: 140, root: 45, wave: 'triangle', hat: false, lead: true,
      chords: [[0, 3, 7], [0, 3, 7], [-5, -1, 2], [0, 3, 7], [-7, -4, 0], [3, 7, 10], [-5, -1, 2], [0, 3, 7]],
      tune: [7, H, 2, 3, 5, H, 3, 2,   0, H, 0, 3, 7, H, 5, 3,   2, H, H, 3, 5, H, 7, H,   3, H, 0, H, 0, H, H, H,
             _, 5, H, 8, 12, H, 10, 8,  7, H, H, 3, 7, H, 5, 3,   2, H, 2, 3, 5, H, 7, H,   3, H, 0, H, 0, H, _, _]
    },
    towers: {
      bpm: 84, root: 52, wave: 'triangle', hat: false, arp: [0, 1, 2, 3, 2, 1, 0, 1],
      chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]],
      tune: [0, _, 3, 5, 7, _, 5, 3,  10, _, 5, _, 2, _, 0, _,  3, _, 0, _, 3, 5, 7, _,  5, _, 2, _, _, _, _, _]
    }
  };
  let unlocked = false;   // no music before the first tap
  let wanted = null;      // which song this page plays
  let active = false;     // the game says "playing" (not paused or over)
  let song = null;        // the loop that's running: { st, step, next, out, timer }
  let hiss = null;        // a reusable bit of noise for the shaker

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function voice(a, out, midi, t, len, type, vol, attack = 0.01) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.value = hz(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
  }
  function shaker(a, out, t, vol) {
    if (!hiss) {
      hiss = a.createBuffer(1, Math.floor(a.sampleRate * 0.05), a.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    const src = a.createBufferSource(), hp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = hiss;
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    g.gain.value = vol;
    src.connect(hp).connect(g).connect(out);
    src.start(t);
  }
  // Plans the next few notes ahead of time so the beat stays steady.
  function schedule() {
    const s = song, a = ctx;
    if (!s || !a) return;
    const st = s.st, step = 30 / st.bpm;
    while (s.next < a.currentTime + 0.25) {
      const t = s.next, bar = Math.floor(s.step / 8), pos = s.step % 8;
      const chord = st.chords[bar % st.chords.length].map(n => n + st.root);
      const tones = [...chord, chord[0] + 12];
      if (pos === 0) for (const n of chord) voice(a, s.out, n + 12, t, step * 8.6, 'sine', 0.045, step * 2);
      const at = s.step % st.tune.length, note = st.tune[at];
      if (st.lead) {
        voice(a, s.out, chord[0] + (pos % 2 ? 12 : 0), t, step * 0.9, 'triangle', 0.1, 0.01);
        if (typeof note === 'number') {
          let held = 1;
          while (st.tune[(at + held) % st.tune.length] === H) held++;
          voice(a, s.out, st.root + 24 + note, t, step * (held - 0.1), st.wave, 0.09, 0.02);
        }
      } else {
        if (pos === 0 || pos === 4) voice(a, s.out, chord[0], t, step * 3.6, 'triangle', 0.15, 0.02);
        const lift = Math.floor(bar / 4) % 2 ? 24 : 12;
        voice(a, s.out, tones[st.arp[pos] % tones.length] + lift, t, step * 1.6, st.wave, st.wave === 'square' ? 0.025 : 0.055);
        const phrase = Math.floor(bar / 4) % 4;
        if ((phrase === 1 || phrase === 2) && typeof note === 'number') voice(a, s.out, st.root + 24 + note, t, step * 2.4, 'sine', 0.07, 0.02);
      }
      if (st.hat && pos % 2 === 1) shaker(a, s.out, t, 0.05);
      s.next += step;
      s.step++;
    }
  }
  function syncMusic() {
    const go = !!(wanted && unlocked && musicOn && !muted && active && !document.hidden);
    if (go && !song) {
      const a = audio();
      if (!a) return;
      const out = a.createGain(), soft = a.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 2400;
      out.gain.setValueAtTime(0.0001, a.currentTime);
      out.gain.linearRampToValueAtTime(0.3, a.currentTime + 1.5);   // fade in
      out.connect(soft).connect(a.destination);
      song = { st: SONGS[wanted], step: 0, next: a.currentTime + 0.1, out };
      song.timer = setInterval(schedule, 60);
      schedule();
    } else if (!go && song) {
      const s = song;
      song = null;
      clearInterval(s.timer);
      if (ctx) {
        s.out.gain.cancelScheduledValues(ctx.currentTime);
        s.out.gain.setValueAtTime(s.out.gain.value, ctx.currentTime);
        s.out.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);   // fade out
      }
      setTimeout(() => s.out.disconnect(), 1500);
    }
  }
  document.addEventListener('visibilitychange', syncMusic);

  return {
    tone, tune, noise, womp, backup, timesUp, think, thinker,
    get tuneOn() { return tuneOn; },
    // Wires a button that turns just the countdown tune on and off (the rest
    // of the game's sound stays as it is).
    tuneButton(btn) {
      const paint = () => {
        btn.textContent = '🎵';
        btn.style.opacity = tuneOn ? '' : '.4';
        btn.title = tuneOn ? 'Countdown tune on. Tap to turn just the tune off.' : 'Countdown tune off. Tap to turn it on.';
        btn.setAttribute('aria-pressed', String(tuneOn));
        btn.setAttribute('aria-label', 'Countdown tune');
      };
      paint();
      btn.addEventListener('click', () => {
        tuneOn = !tuneOn;
        try { localStorage.setItem('arcade.thinkTune', tuneOn ? 'on' : 'off'); } catch { /* unavailable */ }
        paint();
      });
    },
    // Call from the first tap so later sounds are allowed to play.
    unlock() { unlocked = true; audio(); syncMusic(); },
    get muted() { return muted; },
    setMuted(value) {
      muted = !!value;
      syncMusic();
      try { localStorage.setItem('arcade.muted', muted ? 'yes' : 'no'); } catch { /* unavailable */ }
    },
    // Background music: which song this page plays, and whether the game is
    // running right now (call it every frame; it only acts on a change).
    music(name) { wanted = SONGS[name] ? name : null; syncMusic(); },
    musicPlaying(on) { if (!!on !== active) { active = !!on; syncMusic(); } },
    get musicOn() { return musicOn; },
    // Wires a button that turns the music on and off.
    musicButton(btn) {
      const paint = () => { btn.classList.toggle("off", !musicOn); btn.title = musicOn ? "Music on" : "Music off"; btn.setAttribute("aria-pressed", String(musicOn)); };
      paint();
      btn.addEventListener("click", () => {
        musicOn = !musicOn;
        try { localStorage.setItem("arcade.music", musicOn ? "yes" : "no"); } catch { /* unavailable */ }
        unlocked = true;
        paint();
        syncMusic();
      });
    },
    // Wires a button that toggles sound and shows 🔊 / 🔇.
    muteButton(btn) {
      const paint = () => { btn.textContent = muted ? '🔇' : '🔊'; btn.title = muted ? 'Sound off' : 'Sound on'; };
      paint();
      btn.addEventListener('click', () => { this.setMuted(!muted); paint(); if (!muted) tone(660, 0.08); });
    }
  };
})();
