// Bucket Drop: a drop cabinet in the spirit of the ones where clear cups ride a spinning turntable. You get 50 balls and
// 30 seconds; each tap drops a ball from the tube above the cups. 10 points a catch, 25 more for every 5 in a row, and
// catching all 50 wins the jackpot the whole arcade plays for (arcade/cab-jackpot.js). Runs in cab-frame.js.
(function () {
  'use strict';
  var CAB = window.CAB, V3 = CAB.V3, S = CAB.sound;
  // TOP is the turntable's surface. The cups are straight, clear cylinders with walls TW thick.
  var RING = 3.35, GUT = 5.4, TOP = -0.02, H = 1.45, BR = 0.24, TW = 0.06, G = 22, TABLE = 5.05;
  var SIZES = { big: 1.38, normal: 1.15, small: 0.95 }, SPEEDS = { chill: 0.7, normal: 1.0, fast: 1.35, wild: 1.8 };
  // Points, like the other games: 10 for each ball you catch, 25 more for every 5 in a row, and the jackpot for all 50.
  var PER = 10, STREAK = 25, JACK0 = 1000;
  function rr(x, x0, y0, w, h, r) { x.beginPath(); x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.closePath(); }
  // Red LED lettering, like an alarm clock: each character is lit segments over faint unlit ones. It uses 14 segments
  // (the outer six, the middle bar in two halves, and the center and diagonal strokes) so letters like K read too.
  var LED = (function () {
    var SEG = { a: [0, 0, 1, 0], b: [1, 0, 1, .5], c: [1, .5, 1, 1], d: [0, 1, 1, 1], e: [0, .5, 0, 1], f: [0, 0, 0, .5], g: [0, .5, .5, .5], G: [.5, .5, 1, .5],
      h: [0, 0, .5, .5], i: [.5, 0, .5, .5], j: [1, 0, .5, .5], k: [.5, .5, 0, 1], l: [.5, .5, .5, 1], m: [.5, .5, 1, 1] };
    var CH = { '0': 'abcdef', '1': 'bc', '2': 'abgGed', '3': 'abGcd', '4': 'fgGbc', '5': 'afgGcd', '6': 'afedcgG', '7': 'abc', '8': 'abcdefgG', '9': 'abcdfgG',
      J: 'bcde', A: 'abcefgG', C: 'adef', K: 'efgjm', P: 'abefgG', O: 'abcdef', T: 'ail' };
    function glyph(x, ch, x0, y0, w, h, on) {
      var segs = on ? (CH[ch] || '') : 'abcdefgGhijklm', sk = 0.12, pad = 0.09;
      x.lineCap = 'round'; x.lineWidth = Math.max(3, w * 0.16);
      for (var n = 0; n < segs.length; n++) {
        var sg = SEG[segs[n]], ax = sg[0], ay = sg[1], bx = sg[2], by = sg[3];
        // pull each end in a little so the segments have gaps between them, and lean the whole thing slightly
        var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); ax += dx / L * pad; ay += dy / L * pad; bx -= dx / L * pad; by -= dy / L * pad;
        x.beginPath(); x.moveTo(x0 + ax * w + (1 - ay) * h * sk, y0 + ay * h); x.lineTo(x0 + bx * w + (1 - by) * h * sk, y0 + by * h); x.stroke();
      }
    }
    return {
      // Draws the text centered on cx, top at y; cw and ch are one character's size. pad keeps room for that many characters.
      text: function (x, str, cx, y, cw, ch, pad) {
        str = String(str); var n = Math.max(str.length, pad || 0), gap = cw * 0.42, tw = n * cw + (n - 1) * gap, x0 = cx - tw / 2;
        if (pad) str = new Array(n - str.length + 1).join(' ') + str;
        x.save();
        for (var k = 0; k < n; k++) {
          var gx = x0 + k * (cw + gap);
          x.shadowBlur = 0; x.strokeStyle = 'rgba(255,40,30,.10)'; glyph(x, '', gx, y, cw, ch, false);
          x.shadowColor = '#ff2a1a'; x.shadowBlur = 14; x.strokeStyle = '#ff3324'; glyph(x, str[k], gx, y, cw, ch, true);
        }
        x.restore();
      }
    };
  })();

  var g = {
    id: 'bucketdrop', name: 'Bucket Drop', track: 'techno',
    tvHint: 'Press OK to drop a ball into a cup. On a game controller, A, X, R1 or the right trigger drops one too, and Start pauses.',
    pad: [['DROP', 'press']],
    options: [
      { id: 'size', label: 'Cups', def: 'big', choices: [['big', 'Big'], ['normal', 'Normal'], ['small', 'Small']] },
      { id: 'speed', label: 'Speed', def: 'fast', choices: [['chill', 'Chill'], ['normal', 'Normal'], ['fast', 'Fast'], ['wild', 'Wild']] }
    ],
    init: function () {
      var s = this.scene = CAB.scene({ bg: 0x0c0418, near: 18, far: 48, span: 9 });
      var cam = this.cam = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
      cam.position.set(0, 8.4, 14.6); cam.lookAt(0, 3.5, -1.2);
      CAB.room(s, { y: -1.1, z: -14 });
      var self = this;
      // the jackpot is the arcade's, kept on the server; it shows the starting amount until the server answers
      this.jackpot = JACK0; this.fetchJackpot();
      // the red cabinet base, its glowing lip, and the gutter around the turntable
      var base = new THREE.Mesh(new THREE.CylinderGeometry(6.1, 6.4, 0.9, 96), CAB.shiny(0xc81e2a, { roughness: 0.35 })); base.position.y = -0.75; s.add(base);
      var lip = new THREE.Mesh(new THREE.TorusGeometry(5.85, 0.14, 16, 128), CAB.glow(0xff3040, 1.6)); lip.rotation.x = Math.PI / 2; lip.position.y = -0.05; s.add(lip);
      var pts = []; for (var i = 0; i < 56; i++) { var a = i / 56 * Math.PI * 2; pts.push(new V3(6.05 * Math.cos(a), -0.12, 6.05 * Math.sin(a))); }
      this.lights = CAB.bulbs(s, pts, [0xffffff, 0xff3040, 0xffd23f], 0.08);
      var gut = new THREE.Mesh(new THREE.RingGeometry(5.08, 5.72, 128), CAB.shiny(0x0e0620, { roughness: 0.35 })); gut.rotation.x = -Math.PI / 2; gut.position.y = -0.31; s.add(gut);
      var hole = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), CAB.mat(0x000000)); hole.rotation.x = -Math.PI / 2; hole.position.set(0, -0.305, -GUT); s.add(hole);
      // the big red drop button on the front of the cabinet
      this.btn = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.22, 40), CAB.shiny(0xff2030, { emissive: new THREE.Color(0xff1020), emissiveIntensity: 0.5 })); this.btn.position.set(0, -0.15, 6.15); s.add(this.btn);
      var btnRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 12, 48), CAB.glow(0x2f8bff, 2)); btnRing.rotation.x = Math.PI / 2; btnRing.position.set(0, -0.2, 6.15); s.add(btnRing);
      // the blue turntable
      this.table = new THREE.Group(); s.add(this.table);
      var plat = new THREE.Mesh(new THREE.CylinderGeometry(TABLE, TABLE + 0.05, 0.36, 128), CAB.shiny(0x1d5fd8, { roughness: 0.25, emissive: new THREE.Color(0x0a2a80), emissiveIntensity: 0.25 })); plat.position.y = TOP - 0.18; this.table.add(plat);
      var swirl = new THREE.Mesh(new THREE.CircleGeometry(TABLE - 0.05, 96), new THREE.MeshStandardMaterial({ map: CAB.canvasTex(512, 512, function (x, w, h) {
        var gr = x.createRadialGradient(256, 256, 30, 256, 256, 256); gr.addColorStop(0, '#5aa8ff'); gr.addColorStop(1, '#1747b8'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
        x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 10; for (var r = 40; r < 256; r += 36) { x.beginPath(); x.arc(256, 256, r, 0, 7); x.stroke(); }
      }), roughness: 0.2, metalness: 0.05, envMap: CAB.env, envMapIntensity: 0.7 }));
      swirl.rotation.x = -Math.PI / 2; swirl.position.y = TOP + 0.005; this.table.add(swirl);
      var edge = new THREE.Mesh(new THREE.TorusGeometry(TABLE, 0.05, 12, 128), CAB.glow(0x7fd0ff, 1.8)); edge.rotation.x = Math.PI / 2; edge.position.y = TOP; this.table.add(edge);
      this.bucketGroup = new THREE.Group(); this.table.add(this.bucketGroup);
      this.buildScreen();
      // the clear drop tube over the drop spot, holding a column of the balls you have left
      var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 2.1, 40, 1, true), CAB.glass(0xd8f4ff, 0.18)); tube.position.set(0, 5.25, RING); s.add(tube);
      [4.25, 6.3].forEach(function (y) { var c = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.06, 16, 48), CAB.chrome()); c.rotation.x = Math.PI / 2; c.position.set(0, y, RING); s.add(c); });
      this.pile = [];
      for (var p = 0; p < 4; p++) { var pb = CAB.ball(0xe01828, 0.22); pb.position.set(0, 4.55 + p * 0.45, RING); s.add(pb); this.pile.push(pb); }
      var spot = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 48), CAB.glow(0x00ffc2, 2.5)); spot.rotation.x = -Math.PI / 2; spot.position.set(0, TOP + 0.01, RING); spot.userData.noShadow = true; s.add(spot);
      this.loose = new THREE.Group(); s.add(this.loose);
      this.sparks = CAB.sparks(s); this.pop = CAB.popper(s);
      this.tmp = new V3(); this.t = 0; this.scrT = 0;
      this.buildBuckets();
      CAB.shade(s);
    },
    // The big screen behind the cups: time left on a dial and balls left, and between them, on top, the jackpot in red
    // LED letters on a black plate (like an alarm clock), framed by chasing light bulbs.
    buildScreen: function () {
      var s = this.scene, self = this, W = 1024, H = 640;
      (this.screenParts || []).forEach(function (m) { s.remove(m); });
      // Each circle has its label sitting right on top of it.
      function timeDial(x, cx, cy) {
        var r = 180;
        x.font = '900 50px Orbitron, sans-serif'; x.fillStyle = '#fff'; x.fillText('TIME', cx, cy - r - 82);
        x.font = '700 28px Orbitron, sans-serif'; x.fillText('REMAINING', cx, cy - r - 40);
        // the dial: green while there's plenty of time, red as it runs out
        var t = self.time == null ? 30 : self.time, f = t / 30;
        x.lineWidth = 38; x.strokeStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
        x.strokeStyle = f > 0.5 ? '#3ee05a' : f > 0.2 ? '#ffc21f' : '#ff3040'; x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); x.stroke();
        // PRESS is set smaller than the countdown so the whole word fits inside the ring
        x.font = self.started ? '900 116px Orbitron, sans-serif' : '900 66px Orbitron, sans-serif'; x.fillStyle = '#fff'; x.fillText(self.started ? Math.ceil(t) : 'PRESS', cx, cy + (self.started ? 6 : -18));
        if (!self.started) { x.font = '800 36px Orbitron, sans-serif'; x.fillText('TO START', cx, cy + 60); }
      }
      function ballsLeft(x, cx, cy) {
        var r = 192;
        x.font = '900 50px Orbitron, sans-serif'; x.fillStyle = '#fff'; x.fillText('BALLS', cx, cy - r - 70);
        x.font = '700 28px Orbitron, sans-serif'; x.fillText('REMAINING', cx, cy - r - 28);
        x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
        x.font = '900 156px Orbitron, sans-serif'; x.fillStyle = '#e01828'; x.fillText(String(self.left == null ? 50 : self.left), cx, cy - 54);
        for (var k = 0; k < 9; k++) { x.fillStyle = '#d0141f'; x.beginPath(); x.arc(cx - 72 + (k % 5) * 36 + (k > 4 ? 18 : 0), cy + (k > 4 ? 96 : 60), 19, 0, 7); x.fill(); }
      }
      // The jackpot plate: the bulbs chase around the frame, and every unlit segment shows faintly, like a real LED display.
      function plate(x, cx, y0, pw, ph) {
        var x0 = cx - pw / 2;
        x.fillStyle = '#3a0a0a'; rr(x, x0 - 26, y0 - 26, pw + 52, ph + 52, 30); x.fill();
        x.fillStyle = '#050505'; rr(x, x0, y0, pw, ph, 14); x.fill();
        var gl = x.createLinearGradient(0, y0, 0, y0 + ph * 0.5); gl.addColorStop(0, 'rgba(255,255,255,.10)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gl; rr(x, x0, y0, pw, ph * 0.5, 14); x.fill();
        LED.text(x, 'JACKPOT', cx, y0 + 22, 30, 54);
        LED.text(x, String(self.jackpot), cx, y0 + 98, 38, 70, 5);
        // the bulbs: every third one lit, stepping around the frame
        var bulbs = [], step = 26, bx0 = x0 - 13, by0 = y0 - 13, bw = pw + 26, bh = ph + 26;
        for (var u = 0; u <= bw; u += step) bulbs.push([bx0 + u, by0]);
        for (var v = step; v <= bh; v += step) bulbs.push([bx0 + bw, by0 + v]);
        for (u = bw - step; u >= 0; u -= step) bulbs.push([bx0 + u, by0 + bh]);
        for (v = bh - step; v > 0; v -= step) bulbs.push([bx0, by0 + v]);
        var tick = Math.floor((self.t || 0) * 10);
        bulbs.forEach(function (b, i) {
          var on = (i + tick) % 3 === 0;
          x.beginPath(); x.arc(b[0], b[1], 8, 0, 7);
          x.fillStyle = on ? (i % 2 ? '#fff6c8' : '#ffd23f') : '#5a3a10'; x.shadowColor = '#ffd23f'; x.shadowBlur = on ? 18 : 0; x.fill();
        });
        x.shadowBlur = 0;
      }
      this.screenTex = CAB.canvasTex(W, H, function (x, w, h) {
        var gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1c6fe0'); gr.addColorStop(1, '#0a3a9a'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        timeDial(x, 215, 425); ballsLeft(x, 809, 425);
        plate(x, 512, 40, 300, 186);
      });
      var SW = 11.6, SH = SW * H / W, y = 2.2 + SH / 2;
      var scr = new THREE.Mesh(CAB.rbox(SW, SH, 0.2, 0.15), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false })); scr.material.color.setScalar(1.15); scr.position.set(0, y, -5.7); s.add(scr);
      var bezel = new THREE.Mesh(CAB.rbox(SW + 0.5, SH + 0.5, 0.3, 0.2), CAB.shiny(0x101018)); bezel.position.set(0, y, -5.86); s.add(bezel);
      this.screenParts = [scr, bezel];
    },
    // Five clear, straight cups with a dark rim and a colored glow band, like the real ones.
    buildBuckets: function () {
      var grp = this.bucketGroup; while (grp.children.length) grp.remove(grp.children[0]);
      var R = this.R = SIZES[(this.opt && this.opt.size) || 'big'];
      var cols = [0xff2ec4, 0x00e6b0, 0xffc21f, 0x8a5cff, 0xff6a2e];
      this.buckets = [];
      for (var k = 0; k < 5; k++) {
        var a = k * Math.PI * 2 / 5, b = new THREE.Group();
        var wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64, 1, true), CAB.glass(0xe8f6ff, 0.22)); wall.position.y = TOP + H / 2; b.add(wall);
        var floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48), CAB.glass(0xbfe6ff, 0.35)); floor.rotation.x = -Math.PI / 2; floor.position.y = TOP + 0.03; b.add(floor);
        var rim = new THREE.Mesh(new THREE.TorusGeometry(R, TW, 12, 72), CAB.mat(0x1a1a24, { roughness: 0.4 })); rim.rotation.x = Math.PI / 2; rim.position.y = TOP + H; b.add(rim);
        var foot = new THREE.Mesh(new THREE.TorusGeometry(R, TW, 10, 72), CAB.mat(0x1a1a24, { roughness: 0.4 })); foot.rotation.x = Math.PI / 2; foot.position.y = TOP + TW; b.add(foot);
        var band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.005, 0.03, 8, 72), CAB.glow(cols[k], 1.4)); band.rotation.x = Math.PI / 2; band.position.y = TOP + H - 0.18; b.add(band);
        b.position.set(RING * Math.cos(a), 0, RING * Math.sin(a)); b.userData.a = a;
        b.userData.n = 0; b.userData.keep = b.children.length;
        grp.add(b); this.buckets.push(b);
      }
      if (this.scene) CAB.shade(this.scene);
    },
    setOption: function (id) { if (id === 'size') this.buildBuckets(); },
    reset: function () {
      if (this.R !== SIZES[this.opt.size]) this.buildBuckets();
      this.buckets.forEach(function (b) { for (var i = b.children.length - 1; i >= b.userData.keep; i--) b.remove(b.children[i]); b.userData.n = 0; });
      while (this.loose.children.length) this.loose.remove(this.loose.children[0]);
      this.sparks.clear(); this.pop.clear();
      this.balls = []; this.rimT = 0; this.score = 0; this.caught = 0; this.left = 50; this.time = 30; this.started = false; this.over = false; this.rot = this.rot || 0; this.result = ''; this.streak = 0; this.btnT = 0;
      this.showPile(); this.screenTex.redraw();
    },
    showPile: function () { var vis = Math.min(this.pile.length, this.left); this.pile.forEach(function (p, i) { p.visible = i < vis; }); },
    press: function () {
      if (this.over || this.left <= 0) return;
      this.started = true; this.left--; S.fx.plop(); this.btnT = 0.12;
      this.showPile();
      var m = CAB.ball(0xe01828, BR); m.castShadow = true; m.position.set(0, 4.2, RING); this.loose.add(m);
      this.balls.push({ m: m, v: new V3(0, -3, 0), st: 'fall', rim: false });
    },
    // Where cup k's center is right now and how fast it's moving, worked out from the turntable angle
    // so it's exact at every small step, not just once per frame.
    bucketAt: function (k, w, out, vel) {
      var a = this.buckets[k].userData.a + this.rot, c = Math.cos(a), s = Math.sin(a);
      out.set(RING * c, 0, RING * s); vel.set(-RING * w * s, 0, RING * w * c);
    },
    land: function (b, k) {
      var bk = this.buckets[k], p = b.m.position;
      this.caught++; this.score += PER; this.streak++; b.st = 'in';
      this.table.updateMatrixWorld(true);
      var lp = bk.worldToLocal(p.clone()), n = bk.userData.n++, ang = n * 2.4, rr = Math.min(this.R - BR - TW - 0.02, 0.12 + (n % 5) * 0.14);
      bk.add(b.m); b.m.position.copy(lp); b.vy = Math.min(0, b.v.y);
      b.ty = TOP + 0.03 + BR + Math.floor(n / 5) * 0.3; b.tx = Math.cos(ang) * rr; b.tz = Math.sin(ang) * rr;
      S.fx.land(Math.min(12, this.streak - 1));
      var at = bk.localToWorld(new V3(0, 1.9, 0)); this.pop.pop(at, '+' + PER, '#ffd23f', 0.6);
      if (this.streak % 5 === 0) { this.score += STREAK; CAB.toast(this.streak + ' in a row! +' + STREAK); this.sparks.burst(at, [0xffd23f, 0xff2ec4, 0x00ffc2], 40, 5); }
    },
    miss: function (b) {
      if (b.missed) return; b.missed = true; this.streak = 0;
      if (b.rim) CAB.toast('Rim!', true); else S.fx.bonk();
    },
    // A ball against one cup: the rim on top, then the wall from the outside. Returns true if it dropped in.
    hitCup: function (b, k, w) {
      var p = b.m.position, v = b.v, C = this.tmp, Vb = this.tmpV, R = this.R;
      this.bucketAt(k, w, C, Vb);
      var qx = p.x - C.x, qz = p.z - C.z, d = Math.sqrt(qx * qx + qz * qz);
      if (d > R + TW + BR + 0.05 || p.y > TOP + H + TW + BR + 0.05) return false;
      var ux = d > 1e-6 ? qx / d : 1, uz = d > 1e-6 ? qz / d : 0, rimY = TOP + H;
      // the rim is a ring: find its closest point and bounce off it
      var nx = p.x - (C.x + ux * R), ny = p.y - rimY, nz = p.z - (C.z + uz * R), nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < BR + TW) {
        nx /= nl; ny /= nl; nz /= nl;
        var rx = v.x - Vb.x, ry = v.y, rz = v.z - Vb.z, vn = rx * nx + ry * ny + rz * nz;
        if (vn < 0) { rx -= 1.5 * vn * nx; ry -= 1.5 * vn * ny; rz -= 1.5 * vn * nz; v.set(rx + Vb.x, ry, rz + Vb.z); }
        var push = BR + TW - nl; p.x += nx * push; p.y += ny * push; p.z += nz * push;
        b.rim = true; if (this.rimT <= 0) { S.fx.rim(); this.rimT = 0.15; }
        qx = p.x - C.x; qz = p.z - C.z; d = Math.sqrt(qx * qx + qz * qz);
      }
      // below the rim, the wall is solid: a ball outside stays outside and bounces off it
      if (p.y < rimY && d >= R - TW) {
        if (d < R + TW + BR) {
          var ox = d > 1e-6 ? qx / d : 1, oz = d > 1e-6 ? qz / d : 0, vr = (v.x - Vb.x) * ox + (v.z - Vb.z) * oz;
          if (vr < 0) { v.x -= 1.5 * vr * ox; v.z -= 1.5 * vr * oz; }
          p.x = C.x + ox * (R + TW + BR); p.z = C.z + oz * (R + TW + BR);
          if (this.rimT <= 0) { S.fx.rim(); this.rimT = 0.15; } b.rim = true;
        }
        return false;
      }
      // inside the rim and below it, the ball came in over the top: it's in
      if (p.y < rimY - 0.05 && d < R - TW) { this.land(b, k); return true; }
      return false;
    },
    update: function (dt, live) {
      this.t += dt; this.lights.update(this.t);
      var w = SPEEDS[this.opt.speed] * (1 + (live && this.started ? (30 - this.time) * 0.011 : 0));
      this.rot += w * dt; this.table.rotation.y = -this.rot;
      if (live && this.started) this.time = Math.max(0, this.time - dt);
      this.rimT = Math.max(0, this.rimT - dt);
      this.btnT = Math.max(0, (this.btnT || 0) - dt); this.btn.position.y = -0.15 - (this.btnT > 0 ? 0.08 : 0);
      this.scrT -= dt; if (this.scrT <= 0) { this.scrT = 0.05; this.screenTex.redraw(); }
      var R = this.R, C = this.tmp, Vb = this.tmpV || (this.tmpV = new V3()), q = this.tmpQ || (this.tmpQ = new V3());
      for (var i = this.balls.length - 1; i >= 0; i--) {
        var b = this.balls[i], p = b.m.position, v = b.v;
        if (b.st === 'in') {
          // settling into the cup: drop onto the pile and ease over to a resting spot, inside the walls
          if (p.y > b.ty) { b.vy -= G * dt; p.y = Math.max(b.ty, p.y + b.vy * dt); }
          var e = Math.min(1, dt * 4); p.x += (b.tx - p.x) * e; p.z += (b.tz - p.z) * e;
          var lim = R - TW - BR - 0.01, d0 = Math.hypot(p.x, p.z);
          if (d0 > lim) { p.x *= lim / d0; p.z *= lim / d0; }
          continue;
        }
        if (b.st === 'gutter') {
          // in the gutter: the ball rolls around the ring to the return hole at the back and drops in
          if (!b.sink) b.ga += b.gw * dt; p.set(GUT * Math.sin(b.ga), -0.31 + BR, GUT * Math.cos(b.ga));
          if (b.sink || Math.cos(b.ga) < -0.995) { b.sink = (b.sink || 0) + dt; p.y -= b.sink * 1.6; b.m.scale.setScalar(Math.max(0.01, 1 - b.sink * 3)); if (b.sink > 0.33) { this.loose.remove(b.m); this.balls.splice(i, 1); } }
          continue;
        }
        if (b.st === 'table') {
          // riding the turntable: it carries the ball around and slowly flings it toward the edge,
          // and the ball bumps against the cups' walls instead of passing into them
          var ca = Math.cos(w * dt), sa = Math.sin(w * dt), x0 = p.x, rad = Math.hypot(p.x, p.z) || 1;
          p.x = x0 * ca - p.z * sa; p.z = x0 * sa + p.z * ca;
          b.out = (b.out || 0) + 2.2 * dt; p.x += p.x / rad * b.out * dt; p.z += p.z / rad * b.out * dt;
          for (var k2 = 0; k2 < 5; k2++) {
            this.bucketAt(k2, w, C, Vb); q.set(p.x - C.x, 0, p.z - C.z); var dq = q.length(), need = R + TW + BR;
            if (dq < need) { q.multiplyScalar(need / (dq || 1)); p.x = C.x + q.x; p.z = C.z + q.z; }
          }
          if (Math.hypot(p.x, p.z) > TABLE + 0.1) { b.st = 'fall'; v.set(p.x / rad * b.out, 0, p.z / rad * b.out); }
          continue;
        }
        v.y -= G * dt; p.addScaledVector(v, dt);
        if (p.y < TOP + H + 1 && p.y > TOP - 0.5) {
          for (var k = 0; k < 5; k++) if (this.hitCup(b, k, w)) break;
          if (b.st === 'in') continue;
        }
        // the turntable top
        var rr0 = Math.hypot(p.x, p.z);
        if (p.y < TOP + BR && p.y > TOP - 0.4 && rr0 < TABLE) {
          p.y = TOP + BR; this.miss(b);
          if (v.y < -1.2) { v.y = -v.y * 0.3; v.x *= 0.7; v.z *= 0.7; } else { b.st = 'table'; v.set(0, 0, 0); }
        }
        // off the edge of the turntable and into the gutter, never through the cabinet
        if (p.y < -0.31 + BR && rr0 >= TABLE && rr0 < 6.2) {
          this.miss(b); b.st = 'gutter'; b.ga = Math.atan2(p.x, p.z); b.gw = (Math.sin(b.ga) >= 0 ? 1 : -1) * 1.4;
          p.set(GUT * Math.sin(b.ga), -0.31 + BR, GUT * Math.cos(b.ga)); if (this.rimT <= 0) { S.fx.bonk(); this.rimT = 0.1; }
          continue;
        }
        if (p.y < -8) { this.miss(b); this.loose.remove(b.m); this.balls.splice(i, 1); }
      }
      this.sparks.update(dt); this.pop.update(dt);
      if (live && this.started && !this.over) {
        var falling = this.balls.some(function (b) { return b.st === 'fall' && !b.missed; });
        if (this.time <= 0 || (this.left === 0 && !falling)) {
          this.over = true; this.screenTex.redraw();
          var hit = this.caught === 50;
          if (hit) { var won = this.jackpot; this.won = won; this.score += won; this.result = 'JACKPOT! All 50 caught, for ' + this.score + ' points.'; CAB.call('JACKPOT!', 'huge', '+' + won + ' points', 3); S.fx.fanfare(); S.fx.coins(2); this.lights.mode = 'flash'; }
          else { this.result = 'You caught ' + this.caught + ' of 50, for ' + this.score + ' points.'; CAB.call(this.time <= 0 ? 'TIME!' : 'ALL DROPPED', 'good', this.score + ' points'); }
          // tell the arcade: a win starts the jackpot over, any other game adds to it
          this.reportGame(hit);
        }
      }
      if (!live) this.lights.mode = this.over && this.caught === 50 ? 'flash' : 'chase';
    },
    // The arcade's jackpot, from the server (it shows the starting amount if the server can't be reached).
    fetchJackpot: function () {
      var self = this;
      fetch('/api/cab-jackpot/bucketdrop').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && Number.isFinite(d.amount)) { self.jackpot = d.amount; self.screenTex.redraw(); }
      }).catch(function () { /* keep showing what we have */ });
    },
    reportGame: function (won) {
      var self = this;
      fetch('/api/cab-jackpot/bucketdrop/played', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ won: won }) })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          if (d && Number.isFinite(d.amount)) { self.jackpot = d.amount; self.screenTex.redraw(); }
        }).catch(function () { /* the board still takes the score */ });
    },
    // What goes on the board when the run ends, with the settings it was played on.
    final: function () {
      var cups = { big: 'Big cups', normal: 'Normal cups', small: 'Small cups' }[this.opt.size] || '', speed = { chill: 'chill', normal: 'normal', fast: 'fast', wild: 'wild' }[this.opt.speed] || '';
      return { score: this.score || 0, board: (this.opt.size || 'big') + '-' + (this.opt.speed || 'fast'), detail: (this.caught === 50 ? 'Jackpot! ' : '') + this.caught + ' of 50, ' + cups + ', ' + speed };
    },
    hud: function () { return [['Score', this.score || 0], ['Caught', this.caught || 0], ['Balls', this.left], ['Time', this.started ? this.time.toFixed(1) : '30.0'], ['Jackpot', this.jackpot]]; }
  };
  CAB.games.push(g);
})();
