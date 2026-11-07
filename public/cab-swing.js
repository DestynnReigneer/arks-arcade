// Big Swing: a batting cabinet in the spirit of the ones where a ball rolls down a track to a real bat at home plate.
// Hold to pull the bat back, let go to swing; early goes left, late goes right, and a full swing right over the plate
// flies into the home-run target. Three outs end the game, and the score is the runs. Runs in cab-frame.js.
(function () {
  'use strict';
  var CAB = window.CAB, V3 = CAB.V3, S = CAB.sound;
  var PZ = 6.4, BY = 0.42, D = 2.2, WALL = -8.9, REST = -1.15;
  var KINDS = { OUT: ['OUT', '#ff4d6d', '#3a0716'], '1B': ['1B', '#00ffc2', '#05362c'], '2B': ['2B', '#5ab0ff', '#08223f'], '3B': ['3B', '#c08bff', '#2a0f47'] };
  var POOL = ['1B', '1B', '2B', '2B', '3B', 'OUT', 'OUT'];
  // The bat's thickness along its length (from the knob at the pivot to the end of the barrel), matching the model.
  var PROF = [[0, 0.168], [0.04, 0.182], [0.09, 0.14], [0.13, 0.087], [0.9, 0.09], [1.3, 0.119], [1.8, 0.189], [2.2, 0.235], [2.52, 0.241], [2.65, 0.21], [2.7, 0.05]];
  var BAT = 2.7, BALL = 0.2;
  function batR(sv) {
    for (var i = 1; i < PROF.length; i++) if (sv <= PROF[i][0]) { var a = PROF[i - 1], b = PROF[i], k = (sv - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; }
    return 0;
  }

  var g = {
    id: 'bigswing', name: 'Big Swing', track: 'ballpark',
    tvHint: 'Hold OK to pull the bat back and let go to swing. On a game controller, A, X, R1 or the right trigger works too, and Start pauses.',
    pad: [['HOLD TO PULL, LET GO TO SWING', 'hold']],
    init: function () {
      var s = this.scene = CAB.scene({ bg: 0x070414, near: 30, far: 70, span: 14, key: 1.1 });
      s.background = CAB.canvasTex(4, 512, function (x) { var gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#05020f'); gr.addColorStop(0.6, '#1b0b3d'); gr.addColorStop(1, '#3a1460'); x.fillStyle = gr; x.fillRect(0, 0, 4, 512); });
      var cam = this.cam = new THREE.PerspectiveCamera(47, 1, 0.1, 200);
      cam.position.set(0, 9.2, 17.4); cam.lookAt(0, 1.2, -0.6); this.camBase = cam.position.clone();
      // the field, painted on one texture: mowing stripes, the dirt infield, chalk lines
      var fieldTex = CAB.canvasTex(1024, 1280, function (x, w, h) {
        for (var i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#1f7a3d' : '#25904a'; x.fillRect(0, i * h / 16, w, h / 16); }
        var px = function (X) { return (X + 7) / 14 * w; }, pz = function (Z) { return (Z + 9.6) / 18 * h; };
        x.fillStyle = '#b5824e'; x.beginPath(); x.moveTo(px(0), pz(PZ + 1.2)); x.lineTo(px(4.6), pz(2.6)); x.lineTo(px(0), pz(-1.6)); x.lineTo(px(-4.6), pz(2.6)); x.closePath(); x.fill();
        x.fillStyle = '#25904a'; x.beginPath(); x.moveTo(px(0), pz(PZ - 0.9)); x.lineTo(px(3.0), pz(3.1)); x.lineTo(px(0), pz(0.2)); x.lineTo(px(-3.0), pz(3.1)); x.closePath(); x.fill();
        x.fillStyle = '#b5824e'; x.beginPath(); x.arc(px(0), pz(PZ), 1.3 / 14 * w, 0, 7); x.fill();
        x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 6; x.beginPath(); x.moveTo(px(0), pz(PZ)); x.lineTo(px(-7), pz(PZ - 7)); x.moveTo(px(0), pz(PZ)); x.lineTo(px(7), pz(PZ - 7)); x.stroke();
        x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(px(-0.55), pz(PZ - 0.55), 4, 1.1 / 18 * h); x.fillRect(px(0.55) - 4, pz(PZ - 0.55), 4, 1.1 / 18 * h);
      });
      var field = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.85, envMap: CAB.env, envMapIntensity: 0.2 }));
      field.rotation.x = -Math.PI / 2; field.position.set(0, 0, -0.6); s.add(field);
      var plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 5), CAB.mat(0xffffff)); plate.rotation.y = Math.PI / 2 + Math.PI / 10; plate.position.set(0, 0.02, PZ); s.add(plate);
      // side walls and the padded back wall with the slot row
      [-7, 7].forEach(function (x) { var w = new THREE.Mesh(CAB.rbox(0.4, 1.2, 18, 0.12), CAB.shiny(0x173a8a)); w.position.set(x, 0.6, -0.6); s.add(w); var cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 18), CAB.glow(0xffd23f, 0.45)); cap.position.set(x, 1.22, -0.6); s.add(cap); });
      var back = new THREE.Mesh(CAB.rbox(14.4, 4.4, 0.6, 0.15), CAB.shiny(0x0f4a2c, { roughness: 0.6, clearcoat: 0.3 })); back.position.set(0, 2.2, WALL - 0.35); s.add(back);
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.12, 0.64), CAB.glow(0xffd23f, 1.6)); stripe.position.set(0, 4.42, WALL - 0.35); s.add(stripe);
      this.slots = []; var W = 13.4 / 7;
      for (var i = 0; i < 7; i++) {
        var x = -6.7 + W * (i + 0.5);
        var mouth = new THREE.Mesh(CAB.rbox(W - 0.3, 0.85, 0.5, 0.12), CAB.mat(0x020105, { roughness: 1 })); mouth.position.set(x, 0.45, WALL - 0.12); s.add(mouth);
        if (i) { var div = new THREE.Mesh(CAB.rbox(0.14, 1.0, 1.4, 0.05), CAB.chrome()); div.position.set(-6.7 + W * i, 0.5, WALL + 0.45); s.add(div); }
        var lb = CAB.label('1B', '#00ffc2', 0.95, '#05362c'); lb.position.set(x, 1.55, WALL + 0.1); s.add(lb);
        this.slots.push({ x: x, lb: lb, t: '1B' });
      }
      // the home-run target: a lit hole with chasing bulbs
      var hr = new THREE.Group(); hr.position.set(0, 3.0, WALL); s.add(hr);
      var hole = new THREE.Mesh(new THREE.CircleGeometry(0.75, 48), CAB.mat(0x020105, { roughness: 1 })); hole.position.z = 0.02; hr.add(hole);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.1, 16, 64), CAB.chrome(0xffd23f)); ring.position.z = 0.05; hr.add(ring);
      var bp = []; for (var k = 0; k < 20; k++) { var a = k / 20 * Math.PI * 2; bp.push(new V3(Math.cos(a) * 1.08, Math.sin(a) * 1.08, 0.08)); }
      this.hrBulbs = CAB.bulbs(hr, bp, [0xffd23f, 0xff2ec4], 0.09);
      var hrLb = CAB.label('HOME RUN', '#ffd23f', 0.75, null, true); hrLb.position.set(0, 1.55, 0.2); hr.add(hrLb);
      // the scoreboard on top of the wall
      var self = this;
      this.boardTex = CAB.canvasTex(1024, 300, function (x, w, h) { self.drawBoard(x, w, h); });
      var sb = new THREE.Mesh(CAB.rbox(8.4, 2.5, 0.3, 0.12), CAB.mat(0x111118, { metalness: 0.5 })); sb.position.set(0, 6.0, WALL - 0.6); s.add(sb);
      var scr = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 2.2), new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false })); scr.position.set(0, 6.0, WALL - 0.43); s.add(scr);
      // the crowd in the stands behind the wall, and two light towers
      var N = 520, crowd = this.crowd = new THREE.InstancedMesh(CAB.rbox(0.42, 0.62, 0.36, 0.12, 2), CAB.mat(0xffffff, { roughness: 0.7 }), N);
      var c = new THREE.Color(), m4 = new THREE.Matrix4(), pal = [0xff2ec4, 0x00ffc2, 0xffd23f, 0x5ab0ff, 0xffffff, 0xff7a2e, 0x8a5cff, 0x2a2a3a];
      this.fans = [];
      for (var f = 0; f < N; f++) {
        var row = f % 8, col = Math.floor(f / 8), fx = -16 + col * (32 / (N / 8)) + (row % 2) * 0.2, fz = WALL - 1.6 - row * 0.75, fy = 4.4 + row * 0.55;
        if (Math.abs(fx) < 4.6 && row < 5) continue;
        this.fans.push({ i: f, x: fx, y: fy, z: fz, p: Math.random() * 6 });
        m4.makeTranslation(fx, fy, fz); crowd.setMatrixAt(f, m4); c.setHex(pal[f % pal.length]); crowd.setColorAt(f, c);
      }
      for (var hide = 0; hide < N; hide++) if (!this.fans.some(function (q) { return q.i === hide; })) { m4.makeTranslation(0, -50, 0); crowd.setMatrixAt(hide, m4); }
      s.add(crowd);
      [-9.5, 9.5].forEach(function (x) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 12, 16), CAB.chrome(0x8890a0)); pole.position.set(x, 6, WALL - 3); s.add(pole);
        var head = new THREE.Mesh(CAB.rbox(3, 1.6, 0.3, 0.1), CAB.glow(0xfff6dd, 3.2)); head.position.set(x, 12.2, WALL - 2.8); head.lookAt(0, 0, 4); s.add(head);
      });
      // the pitching machine, its chute down to the field, and the straight track to the plate
      var mach = new THREE.Group(); mach.position.set(0, 2.4, -5.7); s.add(mach);
      var body = new THREE.Mesh(CAB.rbox(1.4, 1.5, 1.2, 0.2), CAB.shiny(0xd12a3a)); mach.add(body);
      [-0.38, 0.38].forEach(function (x) { var wh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 32), CAB.mat(0x18181f, { metalness: 0.4 })); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.75, 0.2); mach.add(wh); });
      var legs = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.8, 12), CAB.chrome()); legs.position.set(0, -1.5, 0); mach.add(legs);
      this.chuteA = new V3(0, 2.05, -5.0); this.chuteB = new V3(0, BY, -1.2);
      var len = this.chuteA.distanceTo(this.chuteB), chute = new THREE.Mesh(CAB.rbox(0.62, 0.08, len, 0.03), CAB.glass(0x6fa8d8, 0.45)); chute.material.envMapIntensity = 0.3;
      chute.position.copy(this.chuteA).add(this.chuteB).multiplyScalar(0.5); chute.position.y -= 0.24; chute.lookAt(this.chuteB.x, this.chuteB.y - 0.24, this.chuteB.z); s.add(chute);
      var track = new THREE.Mesh(CAB.rbox(0.62, 0.1, PZ + 2.8 - (-1.2), 0.03), CAB.mat(0x30344a, { metalness: 0.6, roughness: 0.3 })); track.position.set(0, BY - 0.27, (PZ + 2.8 - 1.2) / 2); s.add(track);
      [-0.33, 0.33].forEach(function (x) { var r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, PZ + 4), CAB.glow(0xff3b3b, 1.4)); r.position.set(x, BY - 0.15, (PZ + 2.8 - 1.2) / 2); r.userData.noShadow = true; s.add(r); });
      // the catcher's mitt behind the plate
      var mitt = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 1.7), CAB.mat(0x7a4a22, { roughness: 0.7 })); mitt.rotation.x = Math.PI / 2; mitt.position.set(0, BY, PZ + 2.1); s.add(mitt);
      // the bat: you hold the thin handle at the pivot, the thick barrel swings over the plate
      this.bat = new THREE.Group(); this.bat.position.set(-D, BY, PZ); s.add(this.bat);
      var prof = [[0, 0], [0.12, 0], [0.13, 0.04], [0.1, 0.09], [0.062, 0.13], [0.064, 0.9], [0.085, 1.3], [0.135, 1.8], [0.168, 2.2], [0.172, 2.52], [0.15, 2.65], [0.0, 2.7]].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      var batM = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), CAB.shiny(0xd8a066, { roughness: 0.4 })); batM.rotation.z = -Math.PI / 2; batM.scale.set(1.4, 1, 1.4); this.bat.add(batM);
      var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.75, 24), CAB.mat(0x15151c, { roughness: 0.8 })); grip.rotation.z = -Math.PI / 2; grip.position.x = 0.52; grip.scale.set(1.4, 1, 1.4); this.bat.add(grip);
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, BY, 16), CAB.chrome()); post.position.set(-D, BY / 2, PZ); s.add(post);
      // a few see-through copies of the bat trail behind it during a fast swing, like a motion blur
      this.ghosts = []; this.angHist = [];
      for (var gi = 0; gi < 4; gi++) {
        var gh = new THREE.Group(); gh.position.copy(this.bat.position); s.add(gh);
        var gm = new THREE.Mesh(batM.geometry, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.32 - gi * 0.07, depthWrite: false })); gm.rotation.copy(batM.rotation); gm.scale.copy(batM.scale); gm.userData.noShadow = true; gh.add(gm);
        gh.visible = false; this.ghosts.push(gh);
      }
      this.base = []; var self2 = this;
      [[3.0, 3.1], [0, 0.2], [-3.0, 3.1]].forEach(function (p) { var l = new THREE.Mesh(CAB.rbox(0.55, 0.12, 0.55, 0.05), CAB.glow(0x334455, 0.2)); l.rotation.y = Math.PI / 4; l.position.set(p[0], 0.06, p[1]); s.add(l); self2.base.push(l); });
      this.b = CAB.ball(0xffffff, 0.2); s.add(this.b);
      this.trail = []; for (var t = 0; t < 10; t++) { var tm = new THREE.Mesh(new THREE.SphereGeometry(0.16 - t * 0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5 - t * 0.045, blending: THREE.AdditiveBlending, depthWrite: false })); tm.visible = false; s.add(tm); this.trail.push(tm); }
      this.sparks = CAB.sparks(s, 600); this.t = 0;
      CAB.shade(s);
    },
    drawBoard: function (x, w, h) {
      x.fillStyle = '#05050a'; x.fillRect(0, 0, w, h);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      function cell(cx, title, value, color) { x.font = '700 34px Orbitron, sans-serif'; x.fillStyle = '#ffd23f'; x.fillText(title, cx, 60); x.font = '900 110px Orbitron, sans-serif'; x.fillStyle = color || '#fff'; x.fillText(value, cx, 175); }
      cell(150, 'RUNS', String(this.runs || 0), '#00ffc2');
      x.font = '700 34px Orbitron, sans-serif'; x.fillStyle = '#ffd23f'; x.fillText('OUTS', 400, 60); x.fillText('STRIKES', 640, 60);
      for (var i = 0; i < 3; i++) { x.fillStyle = i < (this.outs || 0) ? '#ff4d6d' : '#2a2a35'; x.beginPath(); x.arc(340 + i * 60, 160, 22, 0, 7); x.fill(); x.fillStyle = i < (this.strikes || 0) ? '#ffd23f' : '#2a2a35'; x.beginPath(); x.arc(580 + i * 60, 160, 22, 0, 7); x.fill(); }
      var on = this.on || [0, 0, 0], bx = 880, by = 150;
      [[bx + 55, by], [bx, by - 55], [bx - 55, by]].forEach(function (p, i) { x.save(); x.translate(p[0], p[1]); x.rotate(Math.PI / 4); x.fillStyle = on[i] ? '#ffd23f' : '#2a2a35'; x.fillRect(-20, -20, 40, 40); x.restore(); });
      x.font = '700 28px Orbitron, sans-serif'; x.fillStyle = '#9fa4c4'; x.fillText(this.mph ? 'PITCH ' + this.mph + ' MPH' : 'BIG SWING', 400, 262); x.fillText('FIRST TO 10 RUNS WINS BIG', 760, 262);
    },
    redraw: function () { if (this.boardTex) this.boardTex.redraw(); },
    reshuffle: function () { var t = CAB.shuffle(POOL.slice()); this.slots.forEach(function (sl, i) { sl.t = t[i]; var d = KINDS[t[i]]; sl.lb.set(d[0], d[1], d[2]); }); },
    lights: function () { var on = this.on; this.base.forEach(function (l, i) { var c = on[i] ? 0xffd23f : 0x334455; l.material.color.setHex(c); l.material.emissive.setHex(c); l.material.emissiveIntensity = on[i] ? 2.2 : 0.2; }); this.redraw(); },
    reset: function () {
      this.runs = 0; this.outs = 0; this.strikes = 0; this.on = [0, 0, 0]; this.over = false; this.result = ''; this.big = false; this.mph = 0;
      this.phase = 'wait'; this.wait = 1.6; this.pull = 0; this.holding = false; this.angle = REST; this.swingV = 0; this.swung = false; this.hype = 0; this.first = true;
      this.b.visible = false; this.trail.forEach(function (t) { t.visible = false; }); this.sparks.clear(); this.reshuffle(); this.lights();
    },
    audio: function (ev) { S.fx.crowd(ev === 'start' || ev === 'resume'); },
    press: function () { if (this.over || this.swingV) return; this.holding = true; },
    // Letting go fires the bat like a spring: it starts slow, snaps through the plate, then follows through and slows down.
    release: function () {
      if (!this.holding) return; this.holding = false; this.power = Math.max(0.15, this.pull);
      this.swingV = 3 + 5 * this.power; this.swingA = 150 + 210 * this.power; this.pull = 0; this.swung = true; S.fx.swish(this.power);
    },
    pitch: function () {
      CAB.clearCall(); this.phase = 'pitch'; this.b.visible = true; this.b.position.copy(this.chuteA); this.cq = 0; this.swung = false;
      var r = Math.random(); this.pv = r < 0.18 ? 12 : r < 0.6 ? 9.5 : 7.5; this.mph = Math.round(this.pv * 6.6); this.redraw();
      if (this.pv >= 12) CAB.toast(this.first0 ? 'Batter up! FASTBALL!' : 'FASTBALL!'); else if (this.first0) CAB.toast('Batter up!'); this.first0 = false;
    },
    nextPitch: function (secs) { this.phase = 'wait'; this.wait = secs || 2.1; this.shuffleT = 0.9; },
    out: function (text, sub) {
      this.outs++; this.strikes = 0; this.redraw();
      if (this.outs >= 3) {
        this.over = true; this.result = 'Three outs. ' + this.runs + (this.runs === 1 ? ' run' : ' runs') + (this.big ? ' and the Big Win!' : '.');
        CAB.call('THREE OUTS', '', 'Game over: ' + this.runs + (this.runs === 1 ? ' run' : ' runs'), 3); S.fx.sad();
      } else { CAB.call(text, '', sub || (this.outs + (this.outs === 1 ? ' out' : ' outs')), 1.7); S.fx.sad(); }
      this.nextPitch(2.3);
    },
    strike: function () {
      S.fx.mitt(); this.strikes++; this.redraw();
      if (this.strikes >= 3) { this.out('STRIKE THREE!', 'You\'re out'); return; }
      CAB.toast((this.swung ? 'Swing and a miss! Strike ' : 'Strike ') + this.strikes, true);
      this.nextPitch(1.9);
    },
    hit: function (kind) {
      var n = { '1B': 1, '2B': 2, '3B': 3, HR: 4 }[kind], scored = 0, on = this.on, next = [0, 0, 0], loaded = on[0] && on[1] && on[2];
      for (var i = 2; i >= 0; i--) if (on[i]) { var to = i + n; if (to >= 3) scored++; else next[to] = 1; }
      if (n >= 4) scored++; else next[n - 1] = 1;
      this.on = next; this.runs += scored; this.strikes = 0; this.lights();
      var name = n === 4 ? (loaded ? 'GRAND SLAM!' : 'HOME RUN!') : { 1: 'SINGLE!', 2: 'DOUBLE!', 3: 'TRIPLE!' }[n];
      CAB.call(name, n === 4 ? 'huge' : 'good', scored ? '+' + scored + (scored === 1 ? ' run' : ' runs') + ' scored' : 'Runner on ' + ['first', 'second', 'third'][n - 1], n === 4 ? 2.6 : 1.7);
      S.fx.cheer(n === 4 ? 2.5 : 0.7 + n * 0.3); this.hype = n === 4 ? 4 : 1.5 + n * 0.5;
      if (n >= 2) setTimeout(function () { S.fx.organRally(); }, 500);
      if (!this.big && this.runs >= 10) { this.big = true; var self = this; setTimeout(function () { CAB.call('BIG WIN!', 'huge', '10 runs!', 2.6); S.fx.fanfare(); S.fx.coins(2); self.hrBulbs.mode = 'flash'; }, 1900); }
      this.nextPitch(n === 4 ? 3.2 : 2.4);
    },
    // the crowd bounces more when something good happens (drawn once per frame)
    frame: function () {
      var m4 = this.m4 || (this.m4 = new THREE.Matrix4()), t = this.t, hype = this.hype, crowd = this.crowd;
      this.fans.forEach(function (f) { var j = Math.max(0, Math.sin(t * (6 + hype) + f.p)) * (0.04 + hype * 0.12); m4.makeTranslation(f.x, f.y + j, f.z); crowd.setMatrixAt(f.i, m4); });
      crowd.instanceMatrix.needsUpdate = true;
    },
    update: function (dt, live) {
      this.t += dt; this.hrBulbs.update(this.t); this.sparks.update(dt);
      this.hype = Math.max(0, this.hype - dt * 0.8);
      // the bat: pull back while holding, swing through on release, then drift back to the ready spot
      if (this.holding) { this.pull = Math.min(1, this.pull + dt / 0.75); this.angle = REST - 0.85 * this.pull; }
      else if (this.swingV) {
        // in small steps, so even the fastest swing can't skip past the ball
        var left = dt;
        while (left > 0 && this.swingV) {
          var h = Math.min(left, 0.03 / Math.max(1, this.swingV)); left -= h;
          this.swingV = this.angle < 0.35 ? this.swingV + this.swingA * h : Math.max(2, this.swingV - 260 * h);
          this.angle += this.swingV * h;
          if (live && this.phase === 'pitch' && this.batContact()) break;
          if (this.angle >= 1.6) { this.angle = 1.6; this.swingV = 0; this.recover = 0.35; }
        }
      }
      else if (this.angle > REST + 0.001 && this.phase !== 'pitch') { this.recover -= dt; if (this.recover <= 0) this.angle = Math.max(REST, this.angle - 3 * dt); }
      this.bat.rotation.y = this.angle;
      var hist = this.angHist; hist.unshift(this.angle); if (hist.length > 12) hist.pop();
      var fast = this.swingV > 12;
      this.ghosts.forEach(function (gh, i) { var a = hist[(i + 1) * 2]; gh.visible = fast && a != null; if (gh.visible) gh.rotation.y = a; });
      if (!live) return;
      var p = this.b.position;
      if (this.phase === 'wait') {
        if (this.shuffleT > 0) { this.shuffleT -= dt; if (Math.floor(this.shuffleT * 14) !== Math.floor((this.shuffleT + dt) * 14)) { this.reshuffle(); S.fx.click(2); } }
        this.wait -= dt;
        if (this.wait <= 0 && !this.over) { if (this.first) { this.first0 = true; this.first = false; } this.pitch(); }
        return;
      }
      if (this.phase === 'pitch') {
        if (this.cq < 1) { this.cq = Math.min(1, this.cq + dt * (0.5 + this.cq * 1.4)); p.lerpVectors(this.chuteA, this.chuteB, this.cq * this.cq); }
        else { p.set(0, BY, p.z + this.pv * dt); }
        if (this.swingV && this.batContact()) return;
        if (p.z > PZ + 2.0) { this.b.visible = false; this.strike(); }
        return;
      }
      if (this.phase === 'fly') {
        var fl = this.fly; fl.t += dt; var q = Math.min(1, fl.t / fl.T);
        p.set(fl.x0 * (1 - q), BY + q * (3.0 - BY) + Math.sin(q * Math.PI) * 4.2, fl.z0 + (WALL - fl.z0) * q);
        this.trailStep();
        if (q >= 1) {
          this.b.visible = false; this.trail.forEach(function (t) { t.visible = false; });
          var at = new V3(0, 3, WALL + 0.3); CAB.shake(0.5); CAB.flash(0.6); S.fx.fireworks(); this.hrBulbs.boost = 1.5;
          var sp = this.sparks; [0, 350, 700, 1050].forEach(function (ms, i) { setTimeout(function () { sp.burst(new V3((i - 1.5) * 3, 7 + Math.random() * 2, WALL - 1), [0xffd23f, 0xff2ec4, 0x00ffc2, 0xffffff], 70, 7, 4); }, ms); });
          sp.burst(at, [0xffd23f, 0xffffff], 50, 4);
          this.hit('HR');
        }
        return;
      }
      if (this.phase === 'roll') {
        // rolling friction slows the ball, and the field tilts back toward the plate, so a ball that dies always rolls back
        var v = Math.hypot(this.vx, this.vz), dec = (v > 2 ? 3.2 : 0.8) * dt + (v > this.rollV ? (v - this.rollV) * (1 - Math.exp(-dt * 14)) : 0), k = Math.max(0, 1 - dec / (v || 1));
        this.vx *= k; this.vz *= k; this.vz += 1.9 * dt;
        p.x += this.vx * dt; p.z += this.vz * dt;
        if (p.y > 0.2) { this.vy -= 20 * dt; p.y = Math.max(0.2, p.y + this.vy * dt); }
        this.trailStep();
        if (Math.abs(p.x) > 6.55) { p.x = Math.sign(p.x) * 6.55; this.vx *= -0.6; S.fx.bonk(); }
        if (p.z <= WALL + 0.35) {
          var slot = this.slots.reduce(function (a, sl) { return Math.abs(sl.x - p.x) < Math.abs(a.x - p.x) ? sl : a; });
          this.b.visible = false; this.trail.forEach(function (t) { t.visible = false; });
          if (slot.t === 'OUT') this.out('OUT!', 'Caught in the out slot'); else this.hit(slot.t);
          return;
        }
        if (p.z > PZ + 1.2 && this.vz > 0) { this.b.visible = false; this.trail.forEach(function (t) { t.visible = false; }); this.out('GROUNDED OUT', 'Not enough on it to reach the wall'); }
      }
    },
    // Contact: the ball touches the bat's actual surface.
    batContact: function () {
      var p = this.b.position; if (p.z <= -1.2) return false;
      var ux = Math.cos(this.angle), uz = -Math.sin(this.angle), bx = p.x + D, bz = p.z - PZ;
      var sv = CAB.clamp(bx * ux + bz * uz, 0, BAT), ex = bx - sv * ux, ez = bz - sv * uz, gap = Math.sqrt(ex * ex + ez * ez);
      if (gap >= BALL + batR(sv)) return false;
      var push = BALL + batR(sv) - gap; p.x += ex / (gap || 1) * push; p.z += ez / (gap || 1) * push; this.contact(this.angle, sv); return true;
    },
    contact: function (th, sv) {
      var sweet = 1 - Math.min(1, Math.abs(sv - 2.3) / 0.8) * 0.55, power = this.power;
      var p = this.b.position;
      if (power >= 0.82 && Math.abs(th) < 0.2 && sweet > 0.8) {
        this.phase = 'fly'; this.fly = { t: 0, x0: p.x, z0: p.z, T: 1.25 }; S.fx.crack(true); CAB.shake(0.25); S.fx.ooh();
        return;
      }
      S.fx.crack(false); CAB.shake(0.08 + power * 0.1);
      // the ball leaves the bat a little faster than the bat is moving there, so the bat never catches up and passes through it
      var sp = this.rollV = 5 + 15 * power * sweet, go = Math.max(sp, Math.min(this.swingV, 30) * sv * 1.15);
      this.vx = -Math.sin(th) * go; this.vz = -Math.cos(th) * go; this.phase = 'roll'; this.vy = 0;
      if (power >= 0.82 && Math.abs(th) < 0.25) S.fx.ooh();
    },
    trailStep: function () {
      var tr = this.trail; for (var i = tr.length - 1; i > 0; i--) { tr[i].position.copy(tr[i - 1].position); tr[i].visible = tr[i - 1].visible; }
      tr[0].position.copy(this.b.position); tr[0].visible = true;
    },
    // What goes on the board when the run ends.
    final: function () { return { score: this.runs || 0, board: 'runs', detail: (this.big ? 'Big Win, ' : '') + (this.runs === 1 ? '1 run' : (this.runs || 0) + ' runs') }; },
    hud: function () { return [['Runs', this.runs || 0], ['Outs', this.outs || 0], ['Strikes', this.strikes || 0], ['Power', null, this.holding ? this.pull : 0]]; }
  };
  CAB.games.push(g);
})();
