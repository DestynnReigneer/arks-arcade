// ARKS Launcher: a ball-launching cabinet in the spirit of the ones where you pull a lever and launch a ball up a long
// lane through one-way gates. Where the ball stops, the last gate it passed is what you win; the Super Bonus gate near
// the end moves you up a level and refills your balls. Twenty levels, then it starts over. Runs in cab-frame.js.
(function () {
  'use strict';
  var CAB = window.CAB, V3 = CAB.V3, S = CAB.sound;
  // The levels. Each one has its gate spots up the lane and what each pays; 'J' is the Super Bonus, always with tight gates
  // on both sides. Hitting the Super Bonus moves you to the next level and fills your balls back up.
  // The first five teach one idea each. The second set (from level 6) mixes the distances with the ramp, beads, potholes,
  // headwind and the Goldilocks zone, and only refills half your balls.
  // A gate marked 'z' rides with the Goldilocks zone: its spot is measured from the moving Super Bonus.
  var FAR = [[4, 5], [6.4, 10], [8.8, 15], [11.2, 20], [13.6, 25], [16, 30], [18.4, 40], [19.3, 'J'], [19.95, 20], [22.4, 10]];
  var MID = [[3.5, 5], [5.6, 10], [7.7, 15], [9.8, 20], [10.6, 25], [11.3, 'J'], [11.8, 25], [14.5, 30], [17.5, 40], [20.5, 20], [23, 10]];
  var SHORT = [[2.5, 5], [4, 10], [5.4, 15], [6.2, 'J'], [6.65, 20], [9, 25], [12, 30], [15.5, 40], [19, 50], [22.4, 10]];
  var RAMPFAR = [[4, 5], [6.4, 10], [8.8, 15], [11.2, 20], [16.2, 30], [18, 40], [19.3, 'J'], [19.95, 20], [22.4, 10]];
  var ZONE = [[-0.8, 40, 'z'], [0, 'J', 'z'], [0.65, 20, 'z'], [21.6, 25], [23, 10]], GOLD = [11.6, 19.3, 9];
  function zone(front) { return front.concat(ZONE); }
  function without(gates, from, to) { return gates.filter(function (g) { return g[0] < from || g[0] > to; }); }
  var LEVELS = [
    { name: 'The Classic', note: 'The jackpot is near the far end, like the real machine.', gates: FAR },
    { name: 'Middle Ground', note: 'The jackpot moved to the middle of the lane.', gates: MID },
    { name: 'Short Stop', note: 'The jackpot is close, so go easy on the pull.', gates: SHORT },
    { name: 'The Ramp', note: 'A ramp before the jackpot eats your speed.', ramp: [12.3, 15.3, 0.7], gates: RAMPFAR },
    { name: 'Headwind', note: 'A fan at the far end blows down the lane, and it gusts. Watch the fan and launch when it slows.', wind: [8, 2.4], gates: FAR },
    { name: 'Middle Beads', note: 'Bead curtains hang in front of a middle jackpot.', beads: [6.65, 8.75], gates: MID },
    { name: 'Middle Ramp', note: 'A ramp sits right in front of a middle jackpot.', ramp: [6.2, 9.2, 0.55], gates: without(MID, 6, 9.4) },
    { name: 'Middle Potholes', note: 'Potholes on the way to a middle jackpot. Roll over one too slowly and the ball drops in.', holes: [4.55, 6.65, 8.75], gates: MID },
    { name: 'Far Potholes', note: 'Potholes all the way up to the far jackpot.', holes: [7.6, 12.4, 17.2], gates: FAR },
    { name: 'Goldilocks', note: 'The jackpot slides between the middle and the far end, and stops where it is when you launch.', zone: GOLD, gates: zone([[3.5, 5], [6, 10], [8.5, 15], [10.4, 20]]) },
    { name: 'Goldilocks Ramp', note: 'The sliding jackpot, with a ramp to climb first.', zone: GOLD, ramp: [5.4, 8.2, 0.55], gates: zone([[3.5, 5], [9.4, 15], [10.4, 20]]) },
    { name: 'Goldilocks Potholes', note: 'The sliding jackpot, with potholes on the way.', zone: GOLD, holes: [7.3, 9.45], gates: zone([[3.5, 5], [6, 10], [8.5, 15], [10.4, 20]]) },
    { name: 'Goldilocks Beads', note: 'The sliding jackpot, behind two bead curtains.', zone: GOLD, beads: [7.25, 9.45], gates: zone([[3.5, 5], [6, 10], [8.5, 15], [10.4, 20]]) },
    { name: 'Middle Headwind', note: 'The fan is back, blowing at a middle jackpot.', wind: [5, 2.0], gates: MID },
    { name: 'Ramp and Potholes', note: 'Potholes before and after the ramp.', ramp: [12.3, 15.3, 0.7], holes: [7.6, 17.1], gates: RAMPFAR },
    { name: 'Beads in the Wind', note: 'A bead curtain and the fan, with the jackpot at the far end.', beads: [14.8], wind: [10, 1.6], gates: FAR },
    { name: 'Short Stop Potholes', note: 'The close jackpot, with potholes right in front of it.', holes: [3.25, 4.7], gates: SHORT },
    { name: 'Goldilocks Ramp and Potholes', note: 'The sliding jackpot, a ramp and a pothole.', zone: GOLD, ramp: [5.4, 8.2, 0.55], holes: [9.9], gates: zone([[3.5, 5], [9.4, 15], [10.4, 20]]) },
    { name: 'Goldilocks Storm', note: 'The sliding jackpot, a bead curtain and the fan.', zone: GOLD, beads: [7.25], wind: [9, 1.5], gates: zone([[3.5, 5], [6, 10], [8.5, 15], [10.4, 20]]) },
    { name: 'The Gauntlet', note: 'Everything at once: the sliding jackpot, a ramp, beads and a pothole. Clear it and you start over at The Classic.', zone: GOLD, ramp: [4.2, 6.9, 0.5], beads: [8.0], holes: [9.9], gates: zone([[3.2, 5], [7.4, 10], [8.9, 15], [10.4, 20]]) }
  ];
  var BALLS = 8, REFILL2 = 4, SET2 = 5, RAMP_G = 16, HOLE_V = 3, HOLE_COST = 1.0, BACK_G = 6;
  var CAMY = 12, CAMB = 12.5, CAML = 8;
  var END = 24, A_UP = 5.5, GATE_COST = 0.3, NOISE = 0.045, TILT = 0.11, Z0 = 8;
  // the fan's gusts: smooth but uneven, so it never settles into an easy rhythm
  function windAt(t, max) { return max * (0.5 + 0.5 * Math.sin(0.9 * t + 2 * Math.sin(0.37 * t))); }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  var g = {
    id: 'launcher', name: 'ARKS Launcher', track: 'electro',
    tvHint: 'Hold OK to pull back and let go to launch. On a game controller, A, X, R1 or the right trigger works too, and Start pauses.',
    pad: [['HOLD TO PULL, LET GO TO LAUNCH', 'hold']],
    options: [{ id: 'start', label: 'Start at', def: '0', choices: LEVELS.map(function (l, i) { return [String(i), l.name]; }) },
      { id: 'after', label: 'After a roll', def: 'back', choices: [['back', 'Gates open, ball rolls back'], ['vanish', 'Ball disappears']] },
      { id: 'view', label: 'View', def: 'tv', choices: [['tv', 'TV camera'], ['side', 'From the side'], ['close', 'Jackpot close-up']] }],
    init: function () {
      var s = this.scene = CAB.scene({ bg: 0x0b0418, near: 30, far: 80, span: 18, key: 1.0 });
      var cam = this.cam = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
      CAB.room(s, { y: -2.5, z: -26, w: 80 });
      var lane = this.lane = new THREE.Group(); lane.position.set(0, 0, Z0); lane.rotation.x = TILT; s.add(lane);
      var L = END + 2.5;
      var bedTex = CAB.canvasTex(256, 2048, function (x, w, h) {
        x.fillStyle = '#b9b4cc'; x.fillRect(0, 0, w, h); x.fillStyle = '#1a2a9a'; x.fillRect(w * 0.36, 0, w * 0.28, h);
        x.fillStyle = 'rgba(255,255,255,.25)'; for (var i = 0; i < 40; i++) x.fillRect(w * 0.36, i * h / 40, w * 0.28, 4);
      });
      var bed = new THREE.Mesh(CAB.rbox(3.4, 0.3, L, 0.1), new THREE.MeshPhysicalMaterial({ map: bedTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMap: CAB.env, envMapIntensity: 0.6 }));
      bed.position.set(0, -0.15, -L / 2 + 1.5); lane.add(bed);
      var cab = new THREE.Mesh(CAB.rbox(4.6, 1.2, L + 0.6, 0.3), CAB.shiny(0x1b0b3a)); cab.position.set(0, -0.9, -L / 2 + 1.5); lane.add(cab);
      [-1.75, 1.75].forEach(function (x) {
        var rail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, L, 16), CAB.chrome()); rail.rotation.x = Math.PI / 2; rail.position.set(x, 0.35, -L / 2 + 1.5); lane.add(rail);
        var neon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, L), CAB.glow(0x2f8bff, 2.4)); neon.position.set(x * 1.27, -0.32, -L / 2 + 1.5); neon.userData.noShadow = true; lane.add(neon);
      });
      var endW = new THREE.Mesh(CAB.rbox(3.6, 1.4, 0.4, 0.12), CAB.shiny(0xc4202e)); endW.position.set(0, 0.5, -END - 0.3); lane.add(endW);
      this.levelGroup = new THREE.Group(); lane.add(this.levelGroup); this.jackpot = 200; this.buildLevel(0);
      // the plunger with its spring
      this.plunger = new THREE.Group(); lane.add(this.plunger);
      var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 16), CAB.chrome()); rod.rotation.x = Math.PI / 2; rod.position.z = 1.1; this.plunger.add(rod);
      var knob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 20), CAB.shiny(0xff2ec4)); knob.position.z = 2.3; this.plunger.add(knob);
      var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 24), CAB.mat(0x222230)); tip.rotation.x = Math.PI / 2; this.plunger.add(tip);
      var hp = []; for (var h = 0; h <= 160; h++) { var q = h / 160; hp.push(new V3(Math.cos(q * Math.PI * 16) * 0.22, Math.sin(q * Math.PI * 16) * 0.22, q)); }
      this.spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), 320, 0.03, 6), CAB.chrome(0xffd23f)); this.spring.position.set(0, 0.32, 0.25); lane.add(this.spring);
      this.b = CAB.ball(0xff3344, 0.42, { emissive: new THREE.Color(0xff1030), emissiveIntensity: 0.35 }); lane.add(this.b);
      // a glowing ring under the ball so it's easy to follow up the lane
      this.halo = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 40), CAB.glow(0xffd23f, 2.4)); this.halo.rotation.x = -Math.PI / 2; this.halo.userData.noShadow = true; lane.add(this.halo);
      this.sparks = CAB.sparks(s, 500); this.pop = CAB.popper(s);
      this.t = 0; this.zf = 0; this.jackCam = 0; this.camZ = Z0; this.camY = 0.4;
      this.retune(true);
      CAB.shade(s);
    },
    setOption: function (id) { if (id === 'start' && this.st === 'ready') { var n = +this.opt.start || 0; this.buildLevel(n); this.level = n + 1; } },
    // Puts level n's gates (and its ramp or bead curtains) on the lane.
    buildLevel: function (n) {
      var grp = this.levelGroup, lv = LEVELS[n], self = this;
      while (grp.children.length) grp.remove(grp.children[0]);
      this.lvIndex = n; this.lv = lv; this.gateObjs = []; this.curtains = []; this.holes = []; this.fan = null; this.fans = []; this.streamers = [];
      this.zc = lv.zone ? (lv.zone[0] + lv.zone[1]) / 2 : 0; this.zt = Math.random() * 10;
      // zone gates are measured from the sliding Super Bonus; sort so the gates are in order up the lane
      var gates = lv.gates.map(function (gt) { return { s: gt[2] === 'z' ? self.zc + gt[0] : gt[0], off: gt[2] === 'z' ? gt[0] : null, v: gt[1] }; }).sort(function (a, b) { return a.s - b.s; });
      gates.forEach(function (gd, i) {
        var gt = [gd.s, gd.v], jack = gt[1] === 'J', holder = new THREE.Group(); holder.position.set(0, 0.95, -gt[0]); grp.add(holder);
        if (jack) self.JI = i;
        [-1.55, 1.55].forEach(function (x) { var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 12), CAB.chrome()); post.position.set(x, -0.45, 0); holder.add(post); });
        var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.1, 12), CAB.chrome()); bar.rotation.z = Math.PI / 2; holder.add(bar);
        var piv = new THREE.Group(); holder.add(piv);
        var flap = new THREE.Mesh(CAB.rbox(1.2, 0.72, 0.04, 0.02), jack ? CAB.glass(0x7dff6a, 0.45) : CAB.glass(0xd9f6ff, 0.28)); flap.position.y = -0.4; piv.add(flap);
        if (jack) { flap.material.emissive = new THREE.Color(0x3aff3a); flap.material.emissiveIntensity = 0.6; }
        var side = i % 2 ? 2.7 : -2.7;
        if (jack) {
          var arch = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.09, 12, 48, Math.PI), CAB.chrome(0xffd23f)); arch.position.y = 0.2; holder.add(arch);
          var ap = []; for (var k = 0; k <= 16; k++) { var a = k / 16 * Math.PI; ap.push(new V3(Math.cos(a) * 2.0, 0.2 + Math.sin(a) * 2.0, 0.1)); }
          self.jackBulbs = CAB.bulbs(holder, ap, [0xffd23f, 0x7dff6a, 0xff2ec4], 0.1);
          self.jackTex = CAB.canvasTex(512, 256, function (x, w, h) {
            x.fillStyle = '#0a0204'; x.fillRect(0, 0, w, h); x.strokeStyle = '#ffd23f'; x.lineWidth = 8; x.strokeRect(8, 8, w - 16, h - 16);
            x.textAlign = 'center'; x.font = '800 40px Orbitron, sans-serif'; x.fillStyle = '#ffd23f'; x.fillText('SUPER BONUS', w / 2, 66);
            x.font = '900 120px Orbitron, sans-serif'; x.fillStyle = '#ff3b3b'; x.shadowColor = '#ff3b3b'; x.shadowBlur = 20; x.fillText(String(self.jackpot || 200), w / 2, 200);
          });
          var board = new THREE.Mesh(CAB.rbox(3.0, 1.5, 0.15, 0.08), new THREE.MeshBasicMaterial({ map: self.jackTex, toneMapped: false })); board.position.set(0, 3.0, 0); holder.add(board);
          board.material.color.setScalar(1.6);
        } else {
          var lb = CAB.label(String(gt[1]), '#ff3b3b', 1.0, '#0a1030'); lb.position.set(side, 0.1, 0); holder.add(lb);
        }
        if (gd.off != null) { var gl = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.04, 0.18), CAB.glow(0xffd23f, 2.2)); gl.position.y = -0.93; gl.userData.noShadow = true; holder.add(gl); }
        self.gateObjs.push({ s: gt[0], off: gd.off, v: gt[1], piv: piv, holder: holder, a: 0, w: 0 });
      });
      // a ramp: two glossy planks that the ball has to climb over
      if (lv.ramp) {
        var r0 = lv.ramp[0], r1 = lv.ramp[1], rh = lv.ramp[2], half = (r1 - r0) / 2, plen = Math.hypot(half, rh), ang = Math.atan2(rh, half);
        [[r0 + half / 2, ang], [r0 + half * 1.5, -ang]].forEach(function (pk) {
          var plank = new THREE.Mesh(CAB.rbox(3.3, 0.1, plen, 0.04), CAB.shiny(0xff2ec4, { roughness: 0.3 })); plank.position.set(0, rh / 2 - 0.03, -pk[0]); plank.rotation.x = pk[1]; grp.add(plank);
          var edge = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.04, 0.04), CAB.glow(0xffd23f, 2)); edge.position.copy(plank.position).add(new V3(0, 0.07, 0)); edge.rotation.x = pk[1]; grp.add(edge);
        });
      }
      // bead curtains: strings of beads hanging across the lane that swing when the ball pushes through
      (lv.beads || []).forEach(function (bs) {
        var hold = new THREE.Group(); hold.position.set(0, 1.55, -bs); grp.add(hold);
        var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.3, 12), CAB.chrome()); bar.rotation.z = Math.PI / 2; hold.add(bar);
        [-1.65, 1.65].forEach(function (x) { var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 12), CAB.chrome()); post.position.set(x, -0.8, 0); hold.add(post); });
        var strands = [], cols = [0xff2ec4, 0x00ffc2, 0xffd23f, 0x8a5cff];
        for (var k2 = 0; k2 < 14; k2++) {
          var st = new THREE.Group(); st.position.x = -1.5 + k2 * (3 / 13); hold.add(st);
          var bm = CAB.glow(cols[k2 % 4], 0.8);
          for (var j = 0; j < 7; j++) { var bead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bm); bead.position.y = -0.12 - j * 0.19; st.add(bead); }
          strands.push(st);
        }
        self.curtains.push({ s: bs, strands: strands, a: 0, w: 0 });
      });
      // potholes: dark holes in the lane with an orange rim. Too slow and the ball drops in; fast and it bumps over
      (lv.holes || []).forEach(function (hs) {
        var hole = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), CAB.mat(0x000000)); hole.rotation.x = -Math.PI / 2; hole.position.set(0, 0.012, -hs); hole.scale.y = 0.75; grp.add(hole);
        var rim = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.02, 40), CAB.glow(0xff7a1a, 2.6)); rim.rotation.x = -Math.PI / 2; rim.position.set(0, 0.016, -hs); rim.scale.y = 0.75; rim.userData.noShadow = true; grp.add(rim);
        self.holes.push(hs);
      });
      // the headwind: a fan over the far end, and streamers on posts that show how hard it's blowing
      if (lv.wind) {
        // two fans, one each side of the far end, facing down the lane
        this.fans = [];
        [-2.75, 2.75].forEach(function (x) {
          var fan = new THREE.Group(); fan.position.set(x, 1.5, -END + 0.6); fan.scale.setScalar(0.85); grp.add(fan);
          var stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 10), CAB.chrome()); stand.position.y = -0.95; fan.add(stand);
          var ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.1, 16, 48), CAB.chrome()); fan.add(ring);
          var hub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), CAB.shiny(0x2fb4ff)); fan.add(hub);
          var blades = new THREE.Group(); fan.add(blades);
          for (var bl = 0; bl < 4; bl++) { var blade = new THREE.Mesh(CAB.rbox(0.32, 0.85, 0.05, 0.05), CAB.shiny(0xe8f6ff, { roughness: 0.3 })); blade.position.y = 0.5; var arm = new THREE.Group(); arm.rotation.z = bl * Math.PI / 2; arm.add(blade); blades.add(arm); }
          self.fans.push(blades);
        });
        this.fan = true;
        for (var ws = lv.wind[0] + 1; ws < END - 1; ws += 3.4) {
          [-1.95, 1.95].forEach(function (x) {
            var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 10), CAB.chrome()); post.position.set(x, 0.75, -ws); grp.add(post);
            var piv2 = new THREE.Group(); piv2.position.set(x, 1.5, -ws); grp.add(piv2);
            var rib = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.1), new THREE.MeshBasicMaterial({ color: 0x00ffc2, side: THREE.DoubleSide, toneMapped: false })); rib.position.y = -0.55; piv2.add(rib);
            self.streamers.push(piv2);
          });
        }
      }
      this.wind = 0;
      if (this.scene) CAB.shade(this.scene);
    },
    // Slides the Goldilocks zone's gates to where the zone is now.
    moveZone: function () {
      var lv = this.lv; if (!lv.zone) return;
      this.zc = lv.zone[0] + (lv.zone[1] - lv.zone[0]) * (0.5 - 0.5 * Math.cos(this.zt * Math.PI * 2 / lv.zone[2]));
      var zc = this.zc; this.gateObjs.forEach(function (gt) { if (gt.off != null) { gt.s = zc + gt.off; gt.holder.position.z = -gt.s; } });
    },
    // how high the lane is at spot s (only the ramp level has a bump), and how steep
    rampAt: function (s) {
      var r = this.lv.ramp; if (!r || s < r[0] || s > r[1]) return { h: 0, k: 0 };
      var mid = (r[0] + r[1]) / 2, half = (r[1] - r[0]) / 2;
      return s < mid ? { h: (s - r[0]) / half * r[2], k: r[2] / half } : { h: (r[1] - s) / half * r[2], k: -r[2] / half };
    },
    // The machine gets retuned now and then, so the same pull doesn't always land the same way.
    retune: function (first) { this.tune = Math.random() < 0.25 && !first ? 0.93 + Math.random() * 0.14 : 0.96 + Math.random() * 0.08; },
    reset: function () {
      if (this.played) this.retune(); this.played = true;
      var first = +(this.opt.start || 0) || 0; if (this.lvIndex !== first) this.buildLevel(first); this.level = first + 1; this.jackpot = 200; this.jackTex.redraw();
      this.lapped = false; this.score = 0; this.left = BALLS; this.over = false; this.result = ''; this.s = 0; this.v = 0; this.st = 'ready'; this.pull = 0; this.holding = false; this.passed = -1;
      this.sparks.clear(); this.pop.clear(); this.jackBulbs.mode = 'chase'; this.place();
    },
    audio: function (ev) {
      if (ev === 'start' || ev === 'resume') { if (!this.roll) this.roll = S.loop('roll'); }
      else if (this.roll) { this.roll.stop(); this.roll = null; }
    },
    worldAt: function (s, y) { return this.lane.localToWorld(new V3(0, y || 0.4, -s)); },
    place: function () {
      var rh = this.rampAt(this.s).h - (this.sunk ? 0.3 : 0);
      this.b.position.set(0, 0.42 + rh, -this.s); this.b.rotation.x = -this.s / 0.42; this.halo.position.set(0, 0.02 + rh, -this.s);
      this.plunger.position.set(0, 0.32, 0.55 + this.pull * 1.3);
      this.spring.scale.z = 0.3 + this.pull * 1.3 + 0.0001;
    },
    press: function () { if (this.over || this.st !== 'ready') return; this.holding = true; },
    release: function () {
      if (!this.holding) return; this.holding = false; this.lastPull = this.pull;
      this.v = (4 + 16 * this.pull) * this.tune * (1 + gauss() * NOISE);
      S.fx.launch(this.pull); CAB.shake(0.05 + this.pull * 0.1);
      this.pull = 0; this.st = 'roll'; this.left--; this.passed = -1; this.sunk = false;
    },
    settle: function () {
      var gi = this.passed, val = gi < 0 ? 0 : this.gateObjs[gi].v, at = this.worldAt(this.s, 1.4);
      if (val === 'J') {
        var won = this.jackpot; this.score += won; this.jackpot = 200;
        CAB.call('SUPER BONUS!', 'huge', '+' + won + ' points', 2.8); this.jackCam = 2.6; S.fx.boost(); S.fx.fanfare(); S.fx.coins(2.2); CAB.shake(0.3);
        this.levelUp = true;
        this.sparks.burst(at, [0xffd23f, 0x7dff6a, 0xff2ec4, 0xffffff], 160, 8, 6); this.jackBulbs.mode = 'flash'; var jb = this.jackBulbs; setTimeout(function () { jb.mode = 'chase'; }, 3000);
      } else {
        if (this.sunk) CAB.toast('Pothole!', true);
        if (val) { this.score += val; this.pop.pop(at, '+' + val, '#ffd23f', 0.8); S.fx.land(Math.min(12, gi)); } else { CAB.toast('Too soft', true); S.fx.bonk(); }
        // a real near miss: one gate short of the jackpot, or one gate past it
        if ((gi === this.JI - 1 || gi === this.JI + 1) && Math.random() < 0.6) { setTimeout(function () { S.fx.womp(); }, 250); CAB.call('SO CLOSE!', '', gi === this.JI - 1 ? 'One gate short of the Super Bonus' : 'Just past the Super Bonus', 1.8); }
        this.jackpot += 5 + Math.floor(Math.random() * 4);
        if (Math.random() < 0.12) { var boost = 25 + Math.floor(Math.random() * 51); this.jackpot += boost; setTimeout(function () { CAB.toast('Jackpot boost +' + boost); S.fx.sparkle(); }, 1100); }
      }
      this.jackTex.redraw();
      this.st = 'done'; this.wait = val === 'J' ? 3.0 : 1.6;
    },
    update: function (dt, live) {
      this.t += dt; this.jackBulbs.update(this.t); this.sparks.update(dt); this.pop.update(dt);
      this.curtains.forEach(function (c) { c.w += (-40 * c.a - 4 * c.w) * dt; c.a += c.w * dt; c.strands.forEach(function (st, k) { st.rotation.x = c.a * (0.7 + 0.3 * Math.sin(k * 1.7)); }); });
      if (this.holding) this.pull = Math.min(1, this.pull + dt / 1.3);
      // the Goldilocks zone slides while you aim and stops the moment you launch
      if (this.lv.zone && this.st === 'ready' && !this.over) { this.zt += dt; this.moveZone(); }
      if (this.lv.wind) {
        this.wind = windAt(this.t, this.lv.wind[1]); var wf = this.wind / this.lv.wind[1];
        (this.fans || []).forEach(function (f, k) { f.rotation.z += (k ? 1 : -1) * dt * (2 + wf * 22); });
        var wt = this.t; this.streamers.forEach(function (st, k) { st.rotation.x = wf * 1.25 + Math.sin(wt * 13 + k) * 0.12 * (0.3 + wf); });
      }
      // the gates swing on a spring after the ball pushes through
      // and a ball resting against a gate (or rolling into it) lifts that flap, so the ball never sits inside it
      var bs = this.s;
      this.gateObjs.forEach(function (gt) {
        gt.w += (-60 * gt.a - 5 * gt.w) * dt; gt.a += gt.w * dt; if (gt.a < 0) { gt.a = 0; gt.w = 0; }
        var touch = bs + 0.42 - gt.s; if (touch > 0 && bs < gt.s + 0.42) { var need = Math.min(1.3, touch * 2.4); if (gt.a < need) { gt.a = need; gt.w = Math.max(0, gt.w); } }
        gt.piv.rotation.x = gt.a;
      });
      if (live && this.st === 'roll') {
        var prev = this.s;
        // rolling friction, plus gravity on the ramp's slopes, plus the fan pushing back once the ball is in its wind
        var wnd = this.lv.wind && this.s > this.lv.wind[0] ? this.wind : 0;
        this.v += ((this.v > 0 ? -A_UP : -4.5) - RAMP_G * this.rampAt(this.s).k - wnd) * dt; this.s += this.v * dt;
        // potholes: a slow ball drops in and stays there (it still wins the last gate it passed); a fast one bumps over
        // and loses a different amount of speed each time, depending on how it hits the edge
        for (var hi = 0; hi < this.holes.length; hi++) {
          var hs = this.holes[hi];
          if (prev < hs && this.s >= hs) {
            if (this.v < HOLE_V) { this.s = hs; this.v = 0; this.sunk = true; S.fx.bonk(); CAB.shake(0.08); this.settle(); break; }
            this.v = Math.sqrt(Math.max(0, this.v * this.v - 2 * HOLE_COST * (0.4 + Math.random() * 1.2))); S.fx.click(-3); CAB.shake(0.05);
          } else if (prev > hs && this.s <= hs) { this.s = hs; this.v = 0; this.sunk = true; S.fx.bonk(); this.settle(); break; }
        }
        for (var ci2 = 0; ci2 < this.curtains.length; ci2++) {
          var cu = this.curtains[ci2];
          if ((prev < cu.s && this.s >= cu.s) || (prev > cu.s && this.s <= cu.s)) {
            var cost = 0.5 + Math.random() * 1.1, sg = this.v >= 0 ? 1 : -1; this.v = sg * Math.sqrt(Math.max(0, this.v * this.v - 2 * cost));
            cu.w += (sg > 0 ? -1 : 1) * (4 + Math.abs(this.v)); S.fx.click(-2);
          }
        }
        for (var i = this.passed + 1; this.st === 'roll' && i < this.gateObjs.length; i++) {
          var gt = this.gateObjs[i];
          if (prev < gt.s && this.s >= gt.s) {
            this.passed = i; gt.w = 10 + Math.max(0, this.v) * 1.5; this.v = Math.sqrt(Math.max(0, this.v * this.v - 2 * GATE_COST));
            if (gt.v === 'J') S.fx.sparkle(); else S.fx.click(i);
          } else break;
        }
        if (this.st === 'roll' && this.s > END - 0.42) { this.s = END - 0.42; this.v = -Math.abs(this.v) * 0.25; S.fx.bonk(); }
        if (this.st === 'roll' && this.v < 0) {
          var stop = this.passed >= 0 ? this.gateObjs[this.passed].s + 0.44 : 0;
          if (this.s <= stop) { this.s = stop; this.v = 0; S.fx.click(-4); this.settle(); }
        }
      }
      if (this.roll) this.roll.set(this.st === 'roll' ? Math.min(1, Math.abs(this.v) / 10) : 0, 300 + Math.abs(this.v) * 60);
      if (this.st === 'done' && !this.over) {
        this.wait -= dt;
        if (this.wait <= 0) {
          // with the roll-back setting, the gates swing open and the ball rolls back down to the plunger
          if ((this.opt.after || 'back') === 'back' && this.s > 0.05) { this.st = 'back'; this.v = 0; this.sunk = false; S.fx.click(-1); }
          else this.next();
        }
      }
      if (live && this.st === 'back') {
        var pb = this.s;
        this.v = Math.max(-11, this.v - BACK_G * dt); this.s += this.v * dt;
        this.curtains.forEach(function (c) { if (pb > c.s && this.s <= c.s) c.w += 3; }, this);
        this.gateObjs.forEach(function (gt) { gt.a += (1.35 - gt.a) * Math.min(1, dt * 10); gt.w = 0; });
        if (this.s <= 0) { this.s = 0; this.v = 0; S.fx.click(-4); this.next(); }
      }
      this.place();
      // The TV camera starts wide on the whole runway, leans in partway after the ball while it rolls,
      // and on a Super Bonus does a fast zoom right onto the ball, then backs out again.
      // The other views are like walking around the machine: from the side, or right up at the jackpot.
      var bp = this.worldAt(this.s, 0.4), view = (this.opt && this.opt.view) || 'tv', jp = this.worldAt(this.gateObjs[this.JI].s, 0.4);
      this.jackCam = Math.max(0, this.jackCam - dt);
      var want = this.over ? 0 : this.jackCam > 0 ? 1 : this.st === 'roll' ? 0.5 : this.st === 'done' ? 0.4 : this.st === 'back' ? 0.3 : 0;
      this.zf += (want - this.zf) * Math.min(1, dt * (this.jackCam > 0 ? 9 : want > this.zf ? 1.8 : 2.2));
      this.camZ += (bp.z - this.camZ) * Math.min(1, dt * 4); this.camY += (bp.y - this.camY) * Math.min(1, dt * 4);
      var cv = [];
      if (view === 'side') cv = [9.5, jp.y + 6, jp.z + 5.5, 0, jp.y + 0.3, jp.z + 1.2];
      else if (view === 'close') cv = [1.6, jp.y + 3.4, jp.z + 6.2, 0, jp.y + 0.8, jp.z - 0.6];
      else {
        var wide = [0, CAMY, Z0 + CAMB, 0, 0, Z0 - CAML], near = [0, this.camY + 4.2, this.camZ + 6.5, 0, this.camY, this.camZ - 3],
          close = [0, this.camY + 1.6, this.camZ + 4.4, 0, this.camY + 0.7, this.camZ - 2.2];
        for (var ci = 0; ci < 6; ci++) cv.push(this.zf <= 0.5 ? wide[ci] + (near[ci] - wide[ci]) * this.zf * 2 : near[ci] + (close[ci] - near[ci]) * (this.zf - 0.5) * 2);
      }
      // glide between views instead of cutting
      if (!this.cv || this.snapCam) { this.cv = cv.slice(); this.snapCam = false; }
      var gk = Math.min(1, dt * (view === 'tv' ? 12 : 4));
      for (var cj = 0; cj < 6; cj++) this.cv[cj] += (cv[cj] - this.cv[cj]) * gk;
      this.cam.position.set(this.cv[0], this.cv[1], this.cv[2]);
      this.cam.lookAt(this.cv[3], this.cv[4], this.cv[5]);
    },
    // After a roll: level up on a Super Bonus, end the game when the balls run out, or get the next ball ready.
    next: function () {
      this.s = 0; this.sunk = false;
      if (this.levelUp) {
        // the Super Bonus moves you up a level and refills your balls: all 8 in the first set, half from level 6 on.
        // After the last level it starts over at The Classic, still with half refills
        var to = this.lvIndex + 1; if (to >= LEVELS.length) { to = 0; this.lapped = true; }
        var refill = this.lapped || to >= SET2 ? REFILL2 : BALLS;
        this.levelUp = false; this.level++; this.left = refill; this.buildLevel(to); this.jackpot = 200; this.jackTex.redraw();
        var msg = this.lv.name + '. ' + this.lv.note + ' Balls refilled to ' + refill + '.';
        if (to === SET2 && !this.lapped) msg = 'The second set starts here, and a Super Bonus only refills half your balls from now on. ' + msg;
        CAB.call('LEVEL ' + this.level, 'good', msg, 4); S.fx.lap(); this.st = 'ready';
      } else if (this.left <= 0) { this.st = 'done'; this.over = true; this.result = 'Reached level ' + this.level + ' with ' + this.score + ' points.'; CAB.call('GAME OVER', 'good', this.score + ' points', 2.4); }
      else this.st = 'ready';
    },
    // What goes on the board when the run ends.
    final: function () {
      var from = +(this.opt.start || 0);
      return { score: this.score || 0, board: 'points', detail: 'Level ' + (this.level || 1) + (from ? ', started at ' + (from + 1) : '') };
    },
    hud: function () { return [['Score', this.score || 0], ['Level', this.level || 1], ['Balls', this.left == null ? BALLS : this.left], ['Jackpot', this.jackpot || 200], ['Power', null, this.holding ? this.pull : 0, this.lastPull, 'side']]; }
  };
  CAB.games.push(g);
})();
