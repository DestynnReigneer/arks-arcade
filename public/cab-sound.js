// Music and sound effects for the cabinet games, all made in code with Web Audio: no recordings, nothing to license.
// It follows the arcade's own sound and music switches (the 🔊 and 🎵 buttons, kept by blip.js), so turning sound
// off on any page turns it off here too.
(function () {
  'use strict';
  var CAB = window.CAB = window.CAB || {};
  var S = CAB.sound = { musicOn: true, sfxOn: true };
  try {
    var muted = localStorage.getItem('arcade.muted') === 'yes';
    S.sfxOn = !muted; S.musicOn = !muted && localStorage.getItem('arcade.music') !== 'no';
  } catch (e) { /* storage unavailable: both on */ }

  var ctx = null, out, musicBus, sfxBus, verb, verbIn, delayIn, noiseBuf, musicGain, sfxGain;

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function n(name) { var m = /^([A-G][#b]?)(-?\d)$/.exec(name); return 12 * (+m[2] + 1) + NOTE[m[1]]; }
  S.n = n;

  S.unlock = function () {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      out = ctx.createGain(); out.gain.value = 0.9; comp.connect(out); out.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = S.musicOn ? 0.55 : 0; musicGain.connect(comp);
      sfxGain = ctx.createGain(); sfxGain.gain.value = S.sfxOn ? 0.9 : 0; sfxGain.connect(comp);
      musicBus = ctx.createGain(); musicBus.connect(musicGain);
      sfxBus = ctx.createGain(); sfxBus.connect(sfxGain);
      // a generated room reverb
      var len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) { var d = ir.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      verb = ctx.createConvolver(); verb.buffer = ir;
      verbIn = ctx.createGain(); verbIn.connect(verb);
      var vOut = ctx.createGain(); vOut.gain.value = 0.32; verb.connect(vOut); vOut.connect(comp);
      // a dotted-eighth echo for leads
      var dl = ctx.createDelay(1.5); dl.delayTime.value = 0.35; var fb = ctx.createGain(); fb.gain.value = 0.33; var dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2600;
      delayIn = ctx.createGain(); delayIn.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); var dOut = ctx.createGain(); dOut.gain.value = 0.35; dlf.connect(dOut); dOut.connect(musicBus);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); var nd = noiseBuf.getChannelData(0); for (var k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  };
  S.now = function () { return ctx ? ctx.currentTime : 0; };
  S.ready = function () { return !!ctx; };
  // blip.js saves the switches; these only change what plays here
  S.setMusic = function (on) { S.musicOn = on; if (musicGain) musicGain.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05); };
  S.setSfx = function (on) { S.sfxOn = on; if (sfxGain) sfxGain.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05); };

  // ---------- building blocks ----------
  function env(g, t, a, peak, d, sustain, rel) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (sustain != null) { g.gain.setTargetAtTime(Math.max(0.0001, peak * sustain), t + a, d / 3); g.gain.setTargetAtTime(0.0001, t + a + d + (rel ? 0 : 0), (rel || 0.1) / 3); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type, f, t, stop, dest) { var o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(dest); o.start(t); o.stop(stop); return o; }
  function gain(v, dest) { var g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }
  function filt(type, f, q, dest) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; b.connect(dest); return b; }
  function noise(t, dur, dest) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur); return s; }
  function pan(p, dest) { if (!ctx.createStereoPanner) return dest; var s = ctx.createStereoPanner(); s.pan.value = p; s.connect(dest); return s; }
  function send(node, amt) { var g = ctx.createGain(); g.gain.value = amt; node.connect(g); g.connect(verbIn); }

  // ---------- drum machine ----------
  var I = {};
  I.kick = function (t, v, bus) { var g = gain(0, bus); env(g, t, 0.002, 1.0 * (v || 1), 0.42); var o = osc('sine', 150, t, t + 0.5, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.13); var c = gain(0, bus); env(c, t, 0.001, 0.25 * (v || 1), 0.02); noise(t, 0.03, filt('highpass', 2500, 0.7, c)); };
  I.snare = function (t, v, bus, tone) { var g = gain(0, bus); env(g, t, 0.001, 0.5 * (v || 1), 0.2); var f = filt('bandpass', tone || 1900, 0.8, g); noise(t, 0.25, f); var b = gain(0, bus); env(b, t, 0.001, 0.35 * (v || 1), 0.1); osc('triangle', 185, t, t + 0.15, b); send(g, 0.25); };
  I.clap = function (t, v, bus) { var g = gain(0, bus); var f = filt('bandpass', 1300, 1.2, g); noise(t, 0.3, f); var p = (v || 1) * 0.6; g.gain.setValueAtTime(0.0001, t); [0, 0.011, 0.022].forEach(function (o) { g.gain.setValueAtTime(p, t + o); g.gain.exponentialRampToValueAtTime(p * 0.2, t + o + 0.009); }); g.gain.setValueAtTime(p, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); send(g, 0.35); };
  I.hat = function (t, v, bus, open) { var g = gain(0, bus); env(g, t, 0.001, 0.22 * (v || 1), open ? 0.22 : 0.045); noise(t, open ? 0.3 : 0.08, filt('highpass', open ? 7000 : 8500, 0.7, g)); };
  I.shaker = function (t, v, bus) { var g = gain(0, bus); env(g, t, 0.012, 0.1 * (v || 1), 0.06); noise(t, 0.1, filt('bandpass', 6000, 1.5, g)); };
  I.rim = function (t, v, bus) { var g = gain(0, bus); env(g, t, 0.001, 0.35 * (v || 1), 0.05); osc('triangle', 1700, t, t + 0.08, filt('bandpass', 1700, 4, g)); };

  // ---------- synths ----------
  I.bass = function (t, note, dur, v, bus, bright) {
    var f = midi(note), g = gain(0, bus); env(g, t, 0.005, 0.5 * (v || 1), dur * 0.9, 0.7, 0.08);
    var lp = filt('lowpass', 220, 6, g); lp.frequency.setValueAtTime(bright || 900, t); lp.frequency.exponentialRampToValueAtTime(240, t + Math.min(0.25, dur));
    osc('sawtooth', f, t, t + dur + 0.2, lp); var o2 = osc('square', f * 0.5, t, t + dur + 0.2, gain(0.5, lp)); o2.detune.value = 4;
  };
  I.sub = function (t, note, dur, v, bus) { var g = gain(0, bus); env(g, t, 0.01, 0.55 * (v || 1), dur, 0.8, 0.1); osc('sine', midi(note), t, t + dur + 0.3, g); osc('triangle', midi(note) * 2, t, t + dur + 0.3, gain(0.12, g)); };
  I.pad = function (t, notes, dur, v, bus, cut) {
    var g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09 * (v || 1), t + Math.min(0.6, dur * 0.4)); g.gain.setValueAtTime(0.09 * (v || 1), t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    var lp = filt('lowpass', cut || 1500, 0.8, g); send(g, 0.6);
    notes.forEach(function (nn) { [-9, 9].forEach(function (dt) { var o = osc('sawtooth', midi(nn), t, t + dur + 0.7, lp); o.detune.value = dt; }); });
  };
  I.stab = function (t, notes, v, bus) {
    var g = gain(0, bus); env(g, t, 0.003, 0.16 * (v || 1), 0.18); var lp = filt('lowpass', 3200, 2, g); lp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    notes.forEach(function (nn) { osc('sawtooth', midi(nn), t, t + 0.3, lp); osc('square', midi(nn) * 1.003, t, t + 0.3, gain(0.5, lp)); });
    var d = gain(0.6, delayIn); g.connect(d); send(g, 0.3);
  };
  I.pluck = function (t, note, v, bus, dur) {
    var g = gain(0, bus); env(g, t, 0.003, 0.18 * (v || 1), dur || 0.22); var lp = filt('lowpass', 5000, 3, g); lp.frequency.exponentialRampToValueAtTime(700, t + (dur || 0.22));
    osc('square', midi(note), t, t + (dur || 0.22) + 0.1, lp); var d = gain(0.7, delayIn); g.connect(d);
  };
  I.lead = function (t, note, dur, v, bus, type) {
    var g = gain(0, bus); env(g, t, 0.01, 0.13 * (v || 1), dur, 0.75, 0.15); var lp = filt('lowpass', 2600, 1.2, g);
    var o = osc(type || 'sawtooth', midi(note), t, t + dur + 0.4, lp), o2 = osc(type || 'sawtooth', midi(note), t, t + dur + 0.4, lp); o2.detune.value = 11;
    var lfo = osc('sine', 5.5, t, t + dur + 0.4, gain(6, o.detune)); lfo.connect(gain(6, o2.detune));
    var d = gain(0.8, delayIn); g.connect(d); send(g, 0.3);
  };
  // Electric piano: a bell-ish FM tone, warm and a little wobbly.
  I.keys = function (t, notes, dur, v, bus) {
    var g = gain(0, bus); var lp = filt('lowpass', 2200, 0.7, g); send(g, 0.45);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11 * (v || 1), t + 0.01); g.gain.setTargetAtTime(0.0001, t + 0.05, dur * 0.55);
    var trem = osc('sine', 4.2, t, t + dur + 1.5, gain(0.025, g.gain));
    notes.forEach(function (nn, i) {
      var f = midi(nn), car = osc('sine', f, t + i * 0.012, t + dur + 1.5, lp);
      var mg = gain(0, car.frequency); mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5); osc('sine', f, t, t + dur + 1.5, mg);
      osc('triangle', f * 2, t, t + 0.25, gain(0.04, lp));
    });
  };
  // Ballpark organ: stacked sine drawbars with a spinning-speaker wobble, through a big room.
  I.organ = function (t, notes, dur, v, bus) {
    var g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07 * (v || 1), t + 0.012); g.gain.setValueAtTime(0.07 * (v || 1), t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
    var trem = osc('sine', 6.4, t, t + dur + 0.2, gain(0.018, g.gain)); send(g, 0.9);
    [].concat(notes).forEach(function (nn) {
      var f = midi(nn);
      [[1, 1], [2, 0.75], [3, 0.45], [4, 0.4], [6, 0.18], [8, 0.16]].forEach(function (h) { var o = osc('sine', f * h[0], t, t + dur + 0.2, gain(h[1] * 0.3, g)); o.detune.value = (Math.random() - 0.5) * 6; });
    });
  };

  // ---------- the songs ----------
  // Each song is a function called once per 16th note: (step, time, sixteenth length, bar, beat-in-bar).
  var SONGS = {};
  var techChords = [[n('A1'), [n('A3'), n('C4'), n('E4'), n('G4')]], [n('F1'), [n('F3'), n('A3'), n('C4'), n('E4')]], [n('C2'), [n('G3'), n('C4'), n('E4'), n('G4')]], [n('G1'), [n('G3'), n('B3'), n('D4'), n('F#4')]]];
  SONGS.techno = { bpm: 128, step: function (s, t, L, bar, b, bus) {
    var ch = techChords[Math.floor(bar / 2) % 4], sec = Math.floor(bar / 8) % 4;
    if (b % 4 === 0) I.kick(t, 1, bus);
    if (b % 4 === 2) I.hat(t, 0.9, bus, true);
    if (sec > 0) I.hat(t, b % 2 ? 0.35 : 0.6, bus);
    if (b === 4 || b === 12) I.clap(t, 0.8, bus);
    if (b % 4 !== 0) I.bass(t, ch[0] + ([0, 0, 12, 0, 0, 7, 0, 12])[b % 8], L * 0.9, 0.75, bus, 1400);
    if ((b === 3 || b === 10) && sec !== 0) I.stab(t, ch[1], 0.9, bus);
    if (sec >= 2) { var arp = ch[1], k = b % arp.length; I.pluck(t, arp[(b * 3) % arp.length] + 12 + (b % 8 > 5 ? 12 : 0), 0.6, bus, 0.16); }
    if (b === 0 && bar % 4 === 0) I.pad(t, ch[1], L * 32, 0.7, bus, 1100);
  } };
  var electroChords = [[n('D2'), [n('D4'), n('F4'), n('A4')]], [n('Bb1'), [n('D4'), n('F4'), n('Bb4')]], [n('F2'), [n('C4'), n('F4'), n('A4')]], [n('C2'), [n('C4'), n('E4'), n('G4')]]];
  var electroHook = ['D5', '-', 'F5', 'A5', '-', 'G5', 'F5', '-', 'E5', '-', 'F5', 'D5', '-', '-', 'A4', '-', 'Bb4', '-', 'D5', 'F5', '-', 'E5', 'D5', '-', 'C5', '-', 'E5', 'G5', '-', 'F5', 'E5', '-'];
  SONGS.electro = { bpm: 116, step: function (s, t, L, bar, b, bus) {
    var ch = electroChords[bar % 4];
    if (b === 0 || b === 6 || b === 10) I.kick(t, 1, bus);
    if (b === 4 || b === 12) I.snare(t, 0.8, bus, 2200);
    I.hat(t, b % 2 ? 0.3 : 0.55, bus, b % 4 === 2);
    if (b % 2 === 0) I.bass(t, ch[0] + (b % 4 === 2 ? 12 : 0), L * 1.6, 0.7, bus, 1100);
    if (b === 0) I.pad(t, ch[1], L * 16, 0.6, bus, 1800);
    if (bar % 8 >= 2) { var h = electroHook[(bar % 2) * 16 + b]; if (h !== '-') I.lead(t, n(h), L * 1.6, 0.85, bus, 'square'); }
  } };
  // "Take Me Out to the Ball Game" (1908, public domain) on the ballpark organ, in waltz time: 3 beats a bar, 4 sixteenths a beat.
  var tune = [
    ['C4', 2], ['C5', 1], ['A4', 1], ['G4', 1], ['E4', 1], ['G4', 3], ['D4', 3],
    ['C4', 2], ['C5', 1], ['A4', 1], ['G4', 1], ['E4', 1], ['G4', 6],
    ['A4', 1], ['G#4', 1], ['A4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['A4', 2], ['F4', 1], ['D4', 3],
    ['A4', 2], ['A4', 1], ['A4', 1], ['B4', 1], ['C5', 1], ['D5', 1], ['B4', 1], ['A4', 1], ['G4', 1], ['E4', 1], ['D4', 1],
    ['C4', 2], ['C5', 1], ['A4', 1], ['G4', 1], ['E4', 1], ['G4', 3], ['D4', 2], ['D4', 1],
    ['C4', 1], ['D4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['A4', 1], ['A4', 3], ['A4', 1], ['B4', 1], ['C5', 1],
    ['C5', 3], ['C5', 2], ['C5', 1], ['C5', 1], ['B4', 1], ['A4', 1], ['G4', 1], ['F#4', 1], ['G4', 1],
    ['A4', 3], ['B4', 3], ['C5', 6], ['-', 6]
  ];
  // Turn beat lengths into 16th steps (each beat is 4 steps).
  var tuneSteps = []; tune.forEach(function (x) { tuneSteps.push([x[0], x[1] * 4]); for (var i = 1; i < x[1] * 4; i++) tuneSteps.push(null); });
  var tuneChords = ['C', 'C', 'G', 'G', 'C', 'C', 'G', 'G', 'F', 'F', 'D', 'G', 'D', 'D', 'G', 'G', 'C', 'C', 'G', 'G', 'F', 'F', 'C', 'C', 'C', 'C', 'G', 'G', 'C', 'G', 'C', 'C'];
  var chordNotes = { C: [n('C3'), [n('E4'), n('G4'), n('C5')]], G: [n('G2'), [n('D4'), n('G4'), n('B4')]], F: [n('F2'), [n('F4'), n('A4'), n('C5')]], D: [n('D3'), [n('D4'), n('F#4'), n('A4')]] };
  SONGS.ballpark = { bpm: 150, meter: 12, step: function (s, t, L, bar, b, bus) {
    var pos = s % tuneSteps.length, note = tuneSteps[pos], cb = Math.floor(pos / 12) % tuneChords.length, ch = chordNotes[tuneChords[cb]];
    if (note && note[0] !== '-') I.organ(t, [n(note[0]), n(note[0]) + 12], L * note[1] * 0.92, 1.1, bus);
    if (b === 0) I.organ(t, [ch[0]], L * 3.5, 0.9, bus);
    if (b === 4 || b === 8) I.organ(t, ch[1].map(function (x) { return x - 12; }), L * 2.6, 0.45, bus);
  } };
  // Lofi electronic for the racer: swung drums, warm keys, a bass that moves, and a hook so it isn't sleepy.
  function lofi(bpm, prog, hook, keyShift) {
    return { bpm: bpm, swing: 0.6, crackle: true, step: function (s, t, L, bar, b, bus) {
      var ch = prog[bar % prog.length], sec = Math.floor(bar / 4) % 4;
      if (b === 0 || b === 7 || b === 10) I.kick(t, b ? 0.75 : 0.95, bus);
      if (b === 4 || b === 12) I.snare(t, 0.55, bus, 1500);
      if (b === 15 && bar % 2) I.rim(t, 0.6, bus);
      I.hat(t, (b % 4 === 2 ? 0.55 : 0.28) * (0.8 + Math.random() * 0.4), bus, b === 14 && bar % 4 === 3);
      if (b % 2 === 1) I.shaker(t, 0.6, bus);
      if (b === 0) I.keys(t, ch[1], L * 7, 1, bus);
      if (b === 10 && sec % 2 === 1) I.keys(t, ch[1].slice(1), L * 4, 0.6, bus);
      if (b === 0 || b === 6 || b === 11) I.sub(t, ch[0] + (b === 11 ? 7 : 0), L * (b === 0 ? 5 : 3), 0.9, bus);
      if (sec >= 1) { var h = hook[(bar % 2) * 16 + b]; if (h && h !== '-') I.lead(t, n(h) + (keyShift || 0), L * 2.2, 0.7, bus, 'triangle'); }
    } };
  }
  SONGS.lofiSunset = lofi(86, [[n('F2'), [n('E4'), n('A4'), n('C5'), n('G5')]], [n('E2'), [n('D4'), n('G4'), n('B4'), n('E5')]], [n('D2'), [n('C4'), n('F4'), n('A4'), n('E5')]], [n('C2'), [n('B3'), n('E4'), n('G4'), n('D5')]]],
    ['A5', '-', '-', 'G5', '-', 'E5', '-', '-', 'G5', '-', 'A5', '-', 'C6', '-', '-', '-', 'B5', '-', '-', 'G5', '-', 'E5', '-', 'D5', '-', '-', 'E5', '-', '-', '-', '-', '-']);
  SONGS.lofiNeon = lofi(92, [[n('A1'), [n('G4'), n('C5'), n('E5'), n('B5')]], [n('D2'), [n('F#4'), n('C5'), n('E5'), n('A5')]], [n('G2'), [n('F#4'), n('B4'), n('D5'), n('A5')]], [n('C2'), [n('E4'), n('B4'), n('D5'), n('G5')]]],
    ['E5', '-', 'G5', '-', 'A5', '-', '-', 'B5', '-', 'A5', '-', 'G5', '-', 'E5', '-', '-', 'D5', '-', '-', 'E5', '-', 'G5', '-', '-', 'A5', '-', 'G5', '-', 'E5', '-', '-', '-']);
  // One more lofi song per new racetrack, each in its own key and tempo.
  function chords(list) { return list.map(function (c) { return [n(c[0]), c[1].map(n)]; }); }
  function hook(str) { return str.split(' '); }
  SONGS.lofiOcean = lofi(90, chords([['D2', ['F4', 'A4', 'C5', 'E5']], ['G2', ['F4', 'A4', 'B4', 'E5']], ['C2', ['E4', 'G4', 'B4', 'D5']], ['A1', ['E4', 'G4', 'C5', 'E5']]]),
    hook('A5 - - C6 - A5 - G5 - - E5 - D5 - - - F5 - - E5 - D5 - - C5 - - D5 - E5 - - -'));
  SONGS.lofiMoon = lofi(80, chords([['C#2', ['E4', 'G#4', 'B4', 'D#5']], ['F#2', ['E4', 'A4', 'C#5', 'G#5']], ['B1', ['D#4', 'F#4', 'A4', 'C#5']], ['E2', ['D#4', 'G#4', 'B4', 'F#5']]]),
    hook('G#5 - - - F#5 - E5 - - - C#5 - - E5 - - B5 - - A5 - G#5 - - F#5 - - - E5 - - -'));
  SONGS.lofiMidnight = lofi(96, chords([['A1', ['C4', 'E4', 'G4', 'B4']], ['F2', ['C4', 'E4', 'A4', 'C5']], ['G2', ['D4', 'F4', 'B4', 'E5']], ['E2', ['D4', 'G#4', 'B4', 'E5']]]),
    hook('E5 - A5 - - B5 - C6 - - B5 - A5 - - - G5 - - A5 - E5 - - D5 - E5 - - - G#5 -'));
  SONGS.lofiGolden = lofi(88, chords([['C2', ['E4', 'G4', 'B4', 'D5']], ['A1', ['E4', 'G4', 'C5', 'E5']], ['F2', ['E4', 'A4', 'C5', 'G5']], ['G2', ['D4', 'F4', 'B4', 'E5']]]),
    hook('G5 - E5 - G5 - A5 - - - C6 - - B5 - - A5 - - G5 - E5 - D5 - - E5 - - C5 - -'));
  SONGS.lofiTide = lofi(84, chords([['G2', ['F#4', 'A4', 'B4', 'D5']], ['E2', ['D4', 'G4', 'B4', 'D5']], ['C2', ['E4', 'G4', 'B4', 'D5']], ['D2', ['C4', 'F#4', 'A4', 'E5']]]),
    hook('D5 - - G5 - - F#5 - - D5 - B4 - - - - E5 - - G5 - - A5 - B5 - - A5 - - F#5 -'));
  SONGS.lofiForest = lofi(92, chords([['E2', ['D4', 'G4', 'B4', 'F#5']], ['C2', ['E4', 'G4', 'B4', 'D5']], ['A1', ['C4', 'E4', 'G4', 'B4']], ['B1', ['D#4', 'F#4', 'A4', 'C#5']]]),
    hook('B5 - - G5 - E5 - - F#5 - G5 - - - D5 - E5 - - - G5 - A5 - B5 - - D6 - - B5 - -'));
  // A funky station groove for the train.
  var funkChords = [[n('E2'), [n('D4'), n('G#4'), n('B4')]], [n('E2'), [n('D4'), n('G#4'), n('B4')]], [n('A2'), [n('C#4'), n('G4'), n('B4')]], [n('B1'), [n('D#4'), n('A4'), n('C#5')]]];
  var funkBass = [0, '-', 12, 0, '-', 0, 10, '-', 0, '-', 12, '-', 7, '-', 10, 12];
  SONGS.station = { bpm: 108, swing: 0.56, step: function (s, t, L, bar, b, bus) {
    var ch = funkChords[bar % 4];
    if (b === 0 || b === 10 || (b === 7 && bar % 2)) I.kick(t, 0.95, bus);
    if (b === 4 || b === 12) I.snare(t, 0.75, bus, 2000);
    I.hat(t, b % 2 ? 0.25 : 0.5, bus, b === 6);
    var bn = funkBass[b]; if (bn !== '-') I.bass(t, ch[0] + bn, L * 0.8, 0.8, bus, 1700);
    if (b === 2 || b === 5 || b === 13) I.stab(t, ch[1], 0.8, bus);
    if (b === 0 && bar % 2 === 0) I.pad(t, ch[1].map(function (x) { return x + 12; }), L * 30, 0.35, bus, 2400);
  } };

  // ---------- the sequencer ----------
  var song = null, timer = null, crackleNode = null;
  S.music = function (name) {
    if (!ctx) return; S.stopMusic(0.05);
    var def = SONGS[name]; if (!def) return;
    var bus = ctx.createGain(); bus.gain.value = 1; bus.connect(musicBus);
    song = { def: def, bus: bus, step: 0, next: ctx.currentTime + 0.08, name: name, paused: false };
    if (def.crackle) {
      crackleNode = ctx.createBufferSource(); crackleNode.buffer = noiseBuf; crackleNode.loop = true;
      var cg = gain(0.018, bus), bp = filt('bandpass', 3000, 0.4, cg); crackleNode.connect(bp); crackleNode.start();
    }
    timer = setInterval(schedule, 25); schedule();
  };
  function schedule() {
    if (!song || song.paused) return;
    var def = song.def, L = 60 / def.bpm / 4, meter = def.meter || 16;
    while (song.next < ctx.currentTime + 0.12) {
      var s = song.step, bar = Math.floor(s / meter), b = s % meter;
      var t = song.next + (def.swing && b % 2 ? (def.swing - 0.5) * 2 * L : 0);
      try { def.step(s, t, L, bar, b, song.bus); } catch (e) {}
      if (def.crackle && Math.random() < 0.12) { var pg = gain(0, song.bus); env(pg, t, 0.001, 0.05 + Math.random() * 0.06, 0.01); noise(t, 0.02, filt('highpass', 1500, 0.7, pg)); }
      song.step++; song.next += L;
    }
  }
  S.pauseMusic = function () { if (song) { song.paused = true; song.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05); } };
  S.resumeMusic = function () { if (song && song.paused) { song.paused = false; song.next = ctx.currentTime + 0.06; song.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.05); } };
  S.stopMusic = function (fade) {
    if (timer) { clearInterval(timer); timer = null; }
    if (song) { var b = song.bus; b.gain.setTargetAtTime(0, ctx.currentTime, (fade || 0.3) / 3); setTimeout(function () { b.disconnect(); }, (fade || 0.3) * 1000 + 600); song = null; }
    if (crackleNode) { try { crackleNode.stop(ctx.currentTime + (fade || 0.3)); } catch (e) {} crackleNode = null; }
  };
  S.duck = function (amt, secs) { if (song) { var g = song.bus.gain, t = ctx.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(amt, t, 0.05); g.setTargetAtTime(1, t + secs, 0.3); } };

  // ---------- sound effects ----------
  function fx() { return ctx && S.sfxOn ? sfxBus : null; }
  var X = S.fx = {};
  X.count = function (go) { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.004, 0.35, go ? 0.5 : 0.18); (go ? [n('C6'), n('E6'), n('G6')] : [n('G5')]).forEach(function (m) { osc('triangle', midi(m), t, t + 0.6, g); osc('sine', midi(m) * 2, t, t + 0.3, gain(0.2, g)); }); send(g, 0.3); };
  // The deep plop for every ball dropped.
  X.plop = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.003, 0.9, 0.17); var lp = filt('lowpass', 1100, 1, g); var o = osc('sine', 95, t, t + 0.25, lp); o.frequency.exponentialRampToValueAtTime(230, t + 0.06); o.frequency.exponentialRampToValueAtTime(140, t + 0.17); var o2 = osc('sine', 190, t, t + 0.2, gain(0.25, lp)); o2.frequency.exponentialRampToValueAtTime(420, t + 0.05); var c = gain(0, bus); env(c, t, 0.001, 0.18, 0.03); noise(t, 0.04, filt('lowpass', 900, 0.7, c)); };
  X.land = function (k) { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.002, 0.6, 0.12); osc('sine', 110, t, t + 0.2, filt('lowpass', 500, 1, g)).frequency.exponentialRampToValueAtTime(60, t + 0.12); var d = gain(0, bus); env(d, t + 0.02, 0.003, 0.2, 0.35); osc('sine', midi(n('E6') + (k || 0)), t + 0.02, t + 0.5, d); osc('sine', midi(n('B6') + (k || 0)), t + 0.02, t + 0.5, gain(0.5, d)); send(d, 0.4); };
  X.rim = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.001, 0.32, 0.3); var bp = filt('bandpass', 2400, 3, g); [540, 811, 1263, 1687].forEach(function (f) { osc('square', f, t, t + 0.35, gain(0.3, bp)); }); send(g, 0.3); };
  X.bonk = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.002, 0.4, 0.14); osc('triangle', 180, t, t + 0.2, g).frequency.exponentialRampToValueAtTime(90, t + 0.14); };
  X.click = function (k) { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.001, 0.4, 0.05); noise(t, 0.06, filt('bandpass', 3200 + (k || 0) * 120, 3, g)); var p = gain(0, bus); env(p, t, 0.001, 0.12, 0.06); osc('triangle', 900 + (k || 0) * 90, t, t + 0.08, p); };
  X.sparkle = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime; [0, 4, 7, 12, 16, 19].forEach(function (s, i) { var g = gain(0, bus); env(g, t + i * 0.035, 0.002, 0.16, 0.35); osc('sine', midi(n('C6') + s), t + i * 0.035, t + i * 0.035 + 0.5, g); send(g, 0.6); }); };
  X.coins = function (secs) { var bus = fx(); if (!bus) return; var t = ctx.currentTime; for (var i = 0; i < (secs || 1.5) * 22; i++) { var tt = t + Math.random() * (secs || 1.5), g = gain(0, bus); env(g, tt, 0.001, 0.08 + Math.random() * 0.08, 0.18); var f = 2200 + Math.random() * 2200; osc('sine', f, tt, tt + 0.25, g); osc('sine', f * 1.5, tt, tt + 0.2, gain(0.4, g)); } };
  X.fanfare = function () {
    var bus = fx(); if (!bus) return; var t = ctx.currentTime;
    [[0, 'C5', 0.12], [0.13, 'E5', 0.12], [0.26, 'G5', 0.12], [0.39, 'C6', 0.5], [0.66, 'G5', 0.1], [0.78, 'C6', 0.8]].forEach(function (x) {
      var g = gain(0, bus); env(g, t + x[0], 0.012, 0.22, x[2], 0.7, 0.2); var lp = filt('lowpass', 2800, 1, g);
      [n(x[1]), n(x[1]) - 12, n(x[1]) + 7].forEach(function (m, k) { var o = osc('sawtooth', midi(m), t + x[0], t + x[0] + x[2] + 0.4, gain(k ? 0.4 : 1, lp)); o.detune.value = k * 5; });
      send(g, 0.4);
    });
  };
  // The sad trombone "womp womp".
  X.womp = function () {
    var bus = fx(); if (!bus) return; var t = ctx.currentTime;
    [[0, n('A#3'), n('A3'), 0.38], [0.45, n('A3'), n('G#3') - 0.6, 1.0]].forEach(function (x) {
      var g = gain(0, bus); env(g, t + x[0], 0.03, 0.42, x[3], 0.8, 0.15); var lp = filt('lowpass', 500, 4, g);
      lp.frequency.setValueAtTime(400, t + x[0]); lp.frequency.linearRampToValueAtTime(1400, t + x[0] + 0.12); lp.frequency.linearRampToValueAtTime(600, t + x[0] + x[3]);
      var o = osc('sawtooth', midi(x[1]), t + x[0], t + x[0] + x[3] + 0.3, lp); o.frequency.linearRampToValueAtTime(midi(x[2]), t + x[0] + x[3]);
      if (x[3] > 0.5) { var v = osc('sine', 6, t + x[0] + 0.3, t + x[0] + x[3], gain(5, o.frequency)); }
    });
  };
  X.launch = function (p) { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.002, 0.7, 0.25); osc('sine', 120, t, t + 0.3, g).frequency.exponentialRampToValueAtTime(50, t + 0.2); var s = gain(0, bus); env(s, t, 0.002, 0.3 * (0.5 + p), 0.18); noise(t, 0.2, filt('bandpass', 900, 1.2, s)); var sp = gain(0, bus); env(sp, t, 0.002, 0.12, 0.3); osc('triangle', 300, t, t + 0.35, sp).frequency.exponentialRampToValueAtTime(900, t + 0.25); };
  X.crack = function (big) { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.0005, big ? 1.0 : 0.75, big ? 0.12 : 0.07); noise(t, 0.15, filt('bandpass', 2300, 0.9, g)); var c = gain(0, bus); env(c, t, 0.0005, 0.5, 0.012); noise(t, 0.02, filt('highpass', 5000, 0.7, c)); var th = gain(0, bus); env(th, t, 0.001, 0.5, 0.09); osc('sine', 220, t, t + 0.12, th).frequency.exponentialRampToValueAtTime(90, t + 0.08); send(g, big ? 0.7 : 0.4); };
  X.mitt = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.001, 0.8, 0.07); noise(t, 0.09, filt('lowpass', 1300, 0.9, g)); var b = gain(0, bus); env(b, t, 0.001, 0.5, 0.09); osc('sine', 130, t, t + 0.12, b).frequency.exponentialRampToValueAtTime(70, t + 0.09); send(g, 0.5); };
  X.cheer = function (amt) {
    var bus = fx(); if (!bus) return; var t = ctx.currentTime, a = amt || 1, g = gain(0, bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32 * a, t + 0.35); g.gain.setTargetAtTime(0.0001, t + 0.6 + a * 0.9, 0.5);
    [[700, 1.2], [1500, 1.5], [2600, 2]].forEach(function (b) { var bp = filt('bandpass', b[0], b[1], g); noise(t, 4 + a, bp); var l = osc('sine', 3 + Math.random() * 4, t, t + 4 + a, gain(b[0] * 0.15, bp.frequency)); });
    send(g, 0.7);
    for (var i = 0; i < 3 * a; i++) { var tt = t + 0.2 + Math.random() * 1.2, w = gain(0, bus); env(w, tt, 0.05, 0.05, 0.5); var o = osc('sine', 1800 + Math.random() * 800, tt, tt + 0.7, w); o.frequency.linearRampToValueAtTime(2600 + Math.random() * 600, tt + 0.3); }
  };
  X.ooh = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + 1.4); var b1 = filt('bandpass', 520, 3, g), b2 = filt('bandpass', 880, 4, g); b1.frequency.linearRampToValueAtTime(380, t + 1.3); noise(t, 1.5, b1); noise(t, 1.5, b2); send(g, 0.8); };
  var crowdBed = null;
  X.crowd = function (on) {
    if (!ctx) return;
    if (on && !crowdBed && S.sfxOn) { var g = gain(0, sfxBus); g.gain.setTargetAtTime(0.07, ctx.currentTime, 0.4); var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(filt('bandpass', 900, 0.6, g)); s.start(); var l = osc('sine', 0.23, ctx.currentTime, ctx.currentTime + 3600, gain(0.025, g.gain)); crowdBed = { g: g, s: s, l: l }; }
    if (!on && crowdBed) { var c = crowdBed; crowdBed = null; c.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(function () { try { c.s.stop(); c.l.stop(); } catch (e) {} c.g.disconnect(); }, 1200); }
  };
  X.organRally = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, L = 0.13; [['C5', 1], ['D5', 1], ['E5', 1], ['G5', 2], ['E5', 1], ['G5', 1], ['A5', 1], ['C6', 3]].reduce(function (at, x) { I.organ(at, [n(x[0]), n(x[0]) - 12], L * x[1] * 0.9, 1.3, bus); return at + L * x[1]; }, t); };
  X.fireworks = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime; for (var i = 0; i < 5; i++) { var tt = t + i * 0.28 + Math.random() * 0.1, g = gain(0, bus); env(g, tt, 0.001, 0.6, 0.5); noise(tt, 0.6, filt('lowpass', 1400, 0.7, g)); send(g, 0.8); var c = gain(0, bus); env(c, tt + 0.15, 0.01, 0.06, 0.8); noise(tt + 0.15, 0.9, filt('highpass', 5000, 0.7, c)); } };
  X.whistle = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.06); g.gain.setValueAtTime(0.16, t + 0.7); g.gain.linearRampToValueAtTime(0.0001, t + 0.95); var bp = filt('bandpass', 1200, 0.8, g); [n('F#5'), n('A5'), n('C#6')].forEach(function (m) { var o = osc('sawtooth', midi(m) * 0.98, t, t + 1, gain(0.4, bp)); o.frequency.linearRampToValueAtTime(midi(m), t + 0.12); }); noise(t, 1, filt('bandpass', 2500, 1, gain(0.3, g))); send(g, 0.6); };
  X.clack = function (v) { var bus = fx(); if (!bus) return; var t = ctx.currentTime; [0, 0.07].forEach(function (o) { var g = gain(0, bus); env(g, t + o, 0.001, 0.09 * (v || 1), 0.04); noise(t + o, 0.05, filt('bandpass', 1600, 2, g)); }); };
  X.thunder = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime + 0.35, g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + 0.05); g.gain.setTargetAtTime(0.25, t + 0.15, 0.2); g.gain.setTargetAtTime(0.0001, t + 0.9, 0.6); var lp = filt('lowpass', 260, 0.8, g); noise(t, 3.5, lp); osc('sine', 0.9, t, t + 3.5, gain(90, lp.frequency)); send(g, 0.7); };
  X.chirp = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime; for (var i = 0; i < 4; i++) { var g = gain(0, bus); env(g, t + i * 0.06, 0.002, 0.05, 0.05); osc('square', 700 + Math.random() * 900, t + i * 0.06, t + i * 0.06 + 0.06, g); } };
  X.blacklight = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.3, 0.12, 1.4); var o = osc('sawtooth', 55, t, t + 1.8, filt('lowpass', 300, 8, g)); o.frequency.linearRampToValueAtTime(110, t + 1.5); };
  X.lap = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime; [n('E6'), n('G#6'), n('B6')].forEach(function (m, i) { var g = gain(0, bus); env(g, t + i * 0.08, 0.003, 0.18, 0.4); osc('sine', midi(m), t + i * 0.08, t + i * 0.08 + 0.5, g); send(g, 0.5); }); };
  // The speed pad: a rising whoosh with a bright zap on top.
  // The bat cutting the air: a quick filtered rush that rises with the swing's power.
  X.swish = function (p) { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 + 0.35 * (p || 0), t + 0.07); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); var bp = filt('bandpass', 500, 1.4, g); bp.frequency.exponentialRampToValueAtTime(1800 + 1800 * (p || 0), t + 0.09); bp.frequency.exponentialRampToValueAtTime(700, t + 0.24); noise(t, 0.26, bp); };
  X.boost = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.01, 0.45, 0.6); var bp = filt('bandpass', 600, 1.5, g); bp.frequency.exponentialRampToValueAtTime(4200, t + 0.5); noise(t, 0.7, bp); var z = gain(0, bus); env(z, t, 0.002, 0.18, 0.35); osc('sawtooth', 300, t, t + 0.4, filt('lowpass', 2400, 2, z)).frequency.exponentialRampToValueAtTime(1200, t + 0.35); };
  // The cast: a wet thud when the train flattens someone, a rubbery squeak as they blow back up, and the pop after.
  X.splat = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.002, 0.8, 0.22); osc('sine', 140, t, t + 0.3, filt('lowpass', 600, 1, g)).frequency.exponentialRampToValueAtTime(45, t + 0.22); var q = gain(0, bus); env(q, t + 0.03, 0.005, 0.35, 0.18); var bp = filt('bandpass', 700, 4, q); bp.frequency.exponentialRampToValueAtTime(250, t + 0.2); noise(t + 0.03, 0.22, bp); };
  X.inflate = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.2); g.gain.linearRampToValueAtTime(0.0001, t + 1.5); var o = osc('square', 220, t, t + 1.6, filt('bandpass', 1200, 3, g)); o.frequency.exponentialRampToValueAtTime(900, t + 1.5); osc('sine', 9, t, t + 1.6, gain(40, o.frequency)); };
  X.pop = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime, g = gain(0, bus); env(g, t, 0.0005, 0.9, 0.06); noise(t, 0.08, filt('highpass', 1500, 0.7, g)); var b = gain(0, bus); env(b, t, 0.001, 0.4, 0.08); osc('sine', 200, t, t + 0.1, b).frequency.exponentialRampToValueAtTime(70, t + 0.08); send(g, 0.4); };
  X.sad = function () { var bus = fx(); if (!bus) return; var t = ctx.currentTime; [n('E4'), n('C4')].forEach(function (m, i) { var g = gain(0, bus); env(g, t + i * 0.16, 0.005, 0.2, 0.3); osc('triangle', midi(m), t + i * 0.16, t + i * 0.16 + 0.4, g); }); };

  // Loops that follow the game: the racer's engine, a rolling ball, the off-road rumble. Each has .set(level, pitch) and .stop().
  S.loop = function (kind) {
    if (!ctx || !S.sfxOn) return { set: function () {}, stop: function () {} };
    var t = ctx.currentTime, g = gain(0, sfxBus), parts = [];
    if (kind === 'engine') {
      var lp = filt('lowpass', 700, 2, g), a = osc('sawtooth', 50, t, t + 3600, lp), b = osc('square', 50, t, t + 3600, gain(0.45, lp)); b.detune.value = 14;
      parts = [a, b];
      return { set: function (lvl, f) { var now = ctx.currentTime; g.gain.setTargetAtTime(0.11 * lvl, now, 0.05); a.frequency.setTargetAtTime(f, now, 0.05); b.frequency.setTargetAtTime(f * 0.5, now, 0.05); lp.frequency.setTargetAtTime(300 + f * 6, now, 0.05); }, stop: stop };
    }
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; var f2 = filt(kind === 'rumble' ? 'lowpass' : 'bandpass', kind === 'rumble' ? 220 : 500, 0.9, g); s.connect(f2); s.start(); parts = [s];
    return { set: function (lvl, f) { var now = ctx.currentTime; g.gain.setTargetAtTime((kind === 'rumble' ? 0.5 : 0.22) * lvl, now, 0.04); if (f) f2.frequency.setTargetAtTime(f, now, 0.05); }, stop: stop };
    function stop() { var now = ctx.currentTime; g.gain.setTargetAtTime(0, now, 0.05); setTimeout(function () { parts.forEach(function (p) { try { p.stop(); } catch (e) {} }); g.disconnect(); }, 400); }
  };
})();
