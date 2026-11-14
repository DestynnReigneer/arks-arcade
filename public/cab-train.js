// ARKS Train Station: a ball-drop cabinet in the spirit of the ones where a ball runs down a spiral and drops into a
// train of cars circling a track. Land in every car to light the board for All Aboard, and the next of 10 levels
// starts. The cars' names come from the admin page (arcade/train-cars.js); the page sets them before the game starts.
// A cast of bots hangs around the station (cab-cast.js). Runs in cab-frame.js.
(function () {
  'use strict';
  var CAB = window.CAB, V3 = CAB.V3, S = CAB.sound;
  var L = 4.6, R = 3.3, P = 4 * L + 2 * Math.PI * R, SPEED = 4.2, RIM = 0.95, BR = 0.2, WALL = 0.08, VS = 8, VE = 4.5, G = 20;
  // A stadium-shaped track: two straights joined by half circles. at(d) gives the spot d along it and the heading there.
  function at(d) {
    d = ((d % P) + P) % P;
    if (d < 2 * L) return { x: -L + d, z: R, h: Math.PI / 2 };
    d -= 2 * L; if (d < Math.PI * R) { var a = d / R; return { x: L + R * Math.sin(a), z: R * Math.cos(a), h: Math.PI / 2 + a }; }
    d -= Math.PI * R; if (d < 2 * L) return { x: L - d, z: -R, h: -Math.PI / 2 };
    d -= 2 * L; var b = d / R; return { x: -L - R * Math.sin(b), z: -R * Math.cos(b), h: -Math.PI / 2 + b };
  }
  function wrap(v) { return ((v % P) + P) % P; }
  // The other way around: for a spot on the ground, how far along the track its nearest point is, and how far it is from the rails' center line.
  function along(x, z) {
    if (Math.abs(x) <= L) return z >= 0 ? { d: x + L, off: Math.abs(z - R) } : { d: 2 * L + Math.PI * R + (L - x), off: Math.abs(z + R) };
    if (x > L) return { d: 2 * L + Math.atan2(x - L, z) * R, off: Math.abs(Math.hypot(x - L, z) - R) };
    return { d: 4 * L + Math.PI * R + Math.atan2(-(x + L), -z) * R, off: Math.abs(Math.hypot(x + L, z) - R) };
  }

  // The levels. Light all 8 cars (All Aboard) and the next level starts with the board cleared and 15 new balls.
  // speed: how fast the train runs; wave: how much it speeds up and slows down; tunnel: a tunnel hides the cars just
  // before the drop spot; shuffle: the cars swap places every time you land a ball; reverse: the train runs the other
  // way; small: every car is shorter; dark: the station's lights go down and only the cars glow.
  var LEVELS = [
    { name: 'Opening Day', note: 'The train as you know it.' },
    { name: 'Express', note: 'The train runs a third faster.', speed: 1.35 },
    { name: 'Rush Hour', note: 'The train speeds up and slows down without warning.', wave: 0.45 },
    { name: 'The Tunnel', note: 'A tunnel hides the cars right before the drop spot. Watch them go in and count.', tunnel: true },
    { name: 'All Change', note: 'Every time you land a ball, the cars swap places.', shuffle: true },
    { name: 'Wrong Way', note: 'The train runs the other way around the track.', reverse: true },
    { name: 'Compact Cars', note: 'Every car is a size smaller.', small: 0.72 },
    { name: 'Lights Out', note: 'The station goes dark. Only the cars and the board glow.', dark: true },
    { name: 'Express Tunnel', note: 'The fast train, through the tunnel.', speed: 1.3, tunnel: true },
    { name: 'Grand Central', note: 'Rush-hour surprises, the tunnel, and the cars swap places. Clear it and you start over at Opening Day.', wave: 0.35, tunnel: true, shuffle: true }
  ];

  // The bots' lines. Written for teenagers and adults: roasts, slapstick, no baby jokes.
  var IDLE = [
    "I've been standing here so long I started a podcast. Zero listeners. Still better than your aim.",
    "Fun fact: I'm legally required to say something funny every fifteen seconds. Legally.",
    "I'd go outside, but the graphics are worse out there.",
    "Brb, rebooting my personality. It's been buffering since 2019.",
    "Who's paying for all this electricity? Asking for a toaster.",
    "My last owner updated me during a thunderstorm. Anyway, I can taste colors now.",
    "This train has done four hundred laps and never once arrived anywhere. Relatable.",
    "I'm not lazy. I'm in power-saving mode. Permanently.",
    "Somebody tell the conductor the conductor is me. I have no idea what I'm doing.",
    "I tried to think outside the box once. Got stuck in a different box.",
    "Glitch, stop staring at the train. It's not going to love you back.",
    "I asked the train how it's doing. It said, same old track."
  ];
  var MISS = [
    "That ball had a family.", "Bold strategy, aiming for the floor.", "I've seen better aim from a Roomba in a blackout.",
    "Gravity: still undefeated.", "Breaking news: local human discovers missing.", "The ball filed a complaint. With HR.",
    "I'd rate that drop a 10. Out of a hundred.", "Even the floor looked surprised.", "Physics called. It wants an apology."
  ];
  var HIT = ["Okay, okay, I see you. Don't let it go to your head.", "Clean! That's going in the highlight reel.", "Even I'm impressed, and I was built to be disappointed.", "Smooth. Suspiciously smooth."];
  var HARD = ["NO WAY. Do it again, I wasn't recording!", "Did you just hit the tiny one? Who ARE you?", "Somebody check this person for cheat codes."];
  // The regulars hang around the station; the guests drop in for a few lines and leave.
  var REGULARS = [
    { name: 'BOLT', body: 'robot', color: 0x00ffc2, idle: IDLE, hit: HIT, miss: MISS, hard: HARD,
      roast: { GLITCH: [["Glitch, you've been staring at that train for an hour. It's not going to text you back.", "At least something in this station moves with purpose. Unlike you."]] } },
    { name: 'GLITCH', body: 'robot', color: 0xff2ec4, idle: IDLE, hit: HIT, miss: MISS, hard: HARD,
      roast: { BOLT: [["Bolt's antenna is just a stick he found. Don't tell him.", "It's a precision instrument. I found it in a precision dumpster."]] } }
  ];
  var GUESTS = [
    { name: 'RIVET', body: 'showoff', color: 0xffd23f, from: 'sky',
      arrive: ["Relax, everybody. The good-looking one is here.", "Did somebody order a legend? No? Too bad, you got one.", "I'm not saying I'm the main character. I'm saying the lighting follows me."],
      leave: ["I'm out. Try not to do anything impressive while I'm gone. Shouldn't be hard.", "Gotta go. Somewhere a toaster needs my autograph.", "Later, losers. Not you, train. You're cool."],
      idle: ["Easy on that button, champ. At least buy it dinner first.", "I'd tell you how good I am at this game, but you'd cry. Again.", "I've got a dent for every ticket I ever stole. I'm basically all dent."],
      miss: ["Wow. That ball wanted to go anywhere but where you sent it.", "You play like you're getting paid per miss.", "That's what she said. About your aim. She was disappointed.", "I've seen better aim from a vending machine. An unplugged one."],
      hit: ["Okay, that one was fine. Don't make it weird.", "Even a busted clock hits the car twice a day."],
      hard: ["Okay, who taught you that? Was it me? It was probably me."],
      roast: {
        BOLT: [["Bolt, nice paint job. Did you lose a bet?", "It's called pearl white, Rivet. Look it up. Oh wait, you can't read."], ["Bolt, your jokes have more bugs than a picnic.", "And yet I'm still funnier than your whole hard drive."]],
        GLITCH: [["Glitch, buddy, I've had firmware updates with more personality.", "And I've had power outages with less attitude than you."]],
        TONY: [["Hey Tony, the trash is that way. Oh wait, it's the player.", "Rude. Accurate, but rude."]],
        BOO: [["Boo, you're see-through. Kinda like your excuses.", "I'm a ghost, Rivet. Being see-through is my whole job."]] } },
    { name: 'TONY', body: 'raccoon', color: 0xffd23f, from: 'side', scale: 0.9,
      arrive: ["Don't mind me. Just checking the train cars for snacks.", "Anybody gonna finish those tickets?"],
      leave: ["Heard there's a dumpster behind the bowling alley. Big night. Peace.", "If anybody asks, I was never here. Especially the janitor."],
      idle: ["I'm not stealing. I'm redistributing.", "Fun fact: I've ridden this train forty times. Never paid once."],
      miss: ["Ooh, a loose ball. Finders keepers.", "That one's mine now. House rules. My house."],
      hit: ["Nice! Can I have the ticket? I'm gonna eat it."],
      roast: { BOLT: [["Bolt, you got any batteries? Asking for a snack.", "Tony, for the last time, my batteries are not food."]], RIVET: [["Rivet, you smell like a hot penny.", "That's the smell of success, Tony. You wouldn't know it."]] } },
    { name: 'BOO', body: 'ghost', color: 0x8a5cff, from: 'fade',
      arrive: ["Boo. Sorry. Force of habit.", "I've been haunting this station since the eighties. The tickets were better then."],
      leave: ["Okay, I'm going to go stand dramatically in a hallway. Bye.", "Gotta go rattle some chains. It's in my contract."],
      idle: ["I died doing what I loved: waiting for this train.", "Nobody ever asks how the ghost is doing. Fine, thanks. Still dead."],
      miss: ["Ooh, that ball's gonna haunt you.", "I'd cover my eyes, but you can see right through them anyway."],
      hit: ["Spooky good!"],
      roast: { GLITCH: [["Glitch, you flicker more than I do.", "That's a feature, Boo. Means I'm thinking."]], TONY: [["Tony, you've been eating out of the lost and found again.", "And? Some of it was barely lost."]] } }
  ];

  var g = {
    id: 'train', name: 'ARKS Train Station', track: 'station',
    tvHint: 'Press OK to drop a ball. On a game controller, A, X, R1 or the right trigger drops one too, and Start pauses.',
    pad: [['DROP THE BALL', 'press']],
    options: [{ id: 'look', label: 'Look', def: 'normal', choices: [['normal', 'Normal'], ['uv', 'Blacklight']] },
      { id: 'start', label: 'Start at', def: '0', choices: LEVELS.map(function (l, i) { return [String(i), (i + 1) + '. ' + l.name]; }) }],
    // made-up names until the page sets the arcade's own from the admin page (arcade/train-cars.js)
    cars: [['Comet', 'easy'], ['Blaze', 'hard'], ['Pixel', 'easy'], ['Rocket', 'med'], ['Nova', 'easy'], ['Turbo', 'hard'], ['Jinx', 'easy'], ['Zap', 'med']],
    sizes: { easy: [2.2, 5, 0x00e6b0], med: [1.5, 15, 0x3d8bff], hard: [0.95, 40, 0xff2ec4] },
    init: function () {
      var s = this.scene = CAB.scene({ bg: 0x0a0418, near: 26, far: 70, span: 14, key: 1.1 });
      var cam = this.cam = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
      CAB.room(s, { y: -0.7, z: -13, w: 70 });
      // the station: a glossy platform, the building and its marquee sign
      var base = new THREE.Mesh(CAB.rbox(2 * L + 2 * R + 6.5, 0.6, 2 * R + 4.5, 0.25), CAB.shiny(0x24104a, { roughness: 0.5 })); base.position.set(0.8, -0.3, 0); s.add(base);
      var edge = new THREE.Mesh(new THREE.BoxGeometry(2 * L + 2 * R + 6.4, 0.04, 0.14), CAB.glow(0xffd23f, 1.4)); edge.position.set(0.8, 0.02, R + 2.1); s.add(edge);
      var bld = new THREE.Mesh(CAB.rbox(13.6, 4.2, 2.2, 0.2), CAB.shiny(0x3a1450, { roughness: 0.6 })); bld.position.set(0, 2.1, -R - 3.6); s.add(bld);
      // the light board on the front of the station: one tile per car, with a lamp under it.
      // Land a ball in a car and its tile and lamp light up; light all eight for All Aboard.
      var hdr = CAB.label('LIGHT ALL 8 FOR ALL ABOARD', '#ffd23f', 1.4, 'rgba(18,6,38,.92)', true); hdr.position.set(0, 3.9, -R - 1.0); s.add(hdr);
      var self0 = this; this.board = [];
      this.cars.forEach(function (cdef, i) {
        var sz = self0.sizes[cdef[1]], col = CAB.hex(sz[2]);
        var tex = CAB.canvasTex(256, 352, function (x, w, h) {
          x.fillStyle = '#120626'; x.fillRect(0, 0, w, h);
          x.strokeStyle = col; x.lineWidth = 14; x.strokeRect(7, 7, w - 14, h - 14);
          x.fillStyle = col; x.beginPath(); x.arc(w / 2, 128, 82, 0, 7); x.fill();
          var pic = self0.carPics && self0.carPics[i];
          if (pic) {
            // the car's picture in the circle, inside a ring of the car's color
            x.save(); x.beginPath(); x.arc(w / 2, 128, 74, 0, 7); x.clip(); x.drawImage(pic, w / 2 - 74, 54, 148, 148); x.restore();
          } else {
            x.fillStyle = '#120626'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '900 104px Orbitron, sans-serif'; x.fillText(cdef[0][0], w / 2, 134);
          }
          x.textAlign = 'center'; x.textBaseline = 'middle';
          x.font = '800 40px Orbitron, sans-serif'; x.fillStyle = '#ffffff'; var nm = cdef[0].toUpperCase(), fs = 40; while (x.measureText(nm).width > w - 30) { fs -= 2; x.font = '800 ' + fs + 'px Orbitron, sans-serif'; } x.fillText(nm, w / 2, 254);
          x.font = '800 36px Orbitron, sans-serif'; x.fillStyle = col; x.fillText(sz[1] + ' PTS', w / 2, 306);
        });
        var tile = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.05), new THREE.MeshBasicMaterial({ map: tex, color: 0x2e2e3a }));
        var bx = -5.67 + i * 1.62; tile.position.set(bx, 2.2, -R - 2.44); tile.userData.noShadow = true; s.add(tile);
        var lampM = CAB.glow(sz[2], 0.1), lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), lampM); lamp.position.set(bx, 0.85, -R - 2.38); s.add(lamp);
        self0.board.push({ tile: tile, lamp: lampM, flash: 0 });
      });
      var roof = new THREE.Mesh(CAB.rbox(14.4, 0.35, 3.6, 0.12), CAB.shiny(0x8a1c5a)); roof.position.set(0, 4.35, -R - 3.0); s.add(roof);
      var sign = CAB.label('ARKS TRAIN STATION', '#ffd23f', 1.9, null, true); sign.position.set(0, 5.5, -R - 3.2); s.add(sign);
      var sp = []; for (var i = 0; i <= 24; i++) { var u = i / 24; sp.push(new V3(-4.6 + 9.2 * u, 6.0, -R - 3.1)); sp.push(new V3(-4.6 + 9.2 * u, 4.75, -R - 3.1)); }
      this.signBulbs = CAB.bulbs(s, sp, [0xffd23f, 0xff2ec4, 0x00ffc2], 0.07);
      // the rails
      var rails = CAB.chrome(0xc9c2e0);
      [-0.45, 0.45].forEach(function (o) {
        var pts = []; for (var k = 0; k < 240; k++) { var p = at(P * k / 240), nx = Math.cos(p.h), nz = -Math.sin(p.h); pts.push(new V3(p.x + nx * o, 0.08, p.z + nz * o)); }
        s.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, 0.05, 8, true), rails));
      });
      var tieM = CAB.mat(0x4a2a1a, { roughness: 0.8 });
      for (var t = 0; t < 80; t++) { var tp = at(P * t / 80), tie = new THREE.Mesh(CAB.rbox(1.25, 0.06, 0.18, 0.03), tieM); tie.position.set(tp.x, 0.03, tp.z); tie.rotation.y = tp.h; s.add(tie); }
      this.railGlow = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3((function () { var a = []; for (var k = 0; k < 240; k++) { var p = at(P * k / 240); a.push(new V3(p.x, 0.01, p.z)); } return a; })(), true), 240, 0.62, 4, true), new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.railGlow.scale.y = 0.02; s.add(this.railGlow);
      // the train: eight joined cars, sized by how hard they are
      this.carObjs = []; var off = 0, gap = 0.3, self = this;
      this.cars.forEach(function (cdef) {
        var sz = self.sizes[cdef[1]], len = sz[0], c = sz[2];
        var grp = new THREE.Group(), m = CAB.shiny(c, { emissive: new THREE.Color(c), emissiveIntensity: 0.05, roughness: 0.25 });
        var floor = new THREE.Mesh(CAB.rbox(1.25, 0.14, len, 0.05), m); floor.position.y = 0.34; grp.add(floor);
        // the front side and both ends are walls; the back (toward the middle of the track) is open, like the real cars
        [[-0.6, 0, 0.1, len], [0, len / 2 - WALL / 2, 1.3, WALL], [0, -len / 2 + WALL / 2, 1.3, WALL]].forEach(function (wd) {
          var wall = new THREE.Mesh(CAB.rbox(wd[2], 0.62, wd[3], 0.04), m); wall.position.set(wd[0], 0.64, wd[1]); grp.add(wall);
        });
        // a thin chrome rim along the top edges (front and ends), so you can see into the car
        var chr = CAB.chrome();
        [[-0.6, 0, 0.12, len + 0.04], [0, len / 2 - WALL / 2, 1.32, WALL + 0.04], [0, -len / 2 + WALL / 2, 1.32, WALL + 0.04]].forEach(function (td) {
          var trim = new THREE.Mesh(CAB.rbox(td[2], 0.05, td[3], 0.02), chr); trim.position.set(td[0], RIM, td[1]); grp.add(trim);
        });
        [-1, 1].forEach(function (sd) { var wh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 18), CAB.mat(0x15151c)); wh.rotation.z = Math.PI / 2; wh.position.set(sd * 0.55, 0.18, len / 2 - 0.3); grp.add(wh); var wh2 = wh.clone(); wh2.position.z = -len / 2 + 0.3; grp.add(wh2); });
        var plate = CAB.canvasTex(256, 96, function (x, w, h) { x.fillStyle = '#0a0416'; x.fillRect(0, 0, w, h); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 38px Orbitron, sans-serif'; x.fillStyle = '#fff'; x.fillText(cdef[0].toUpperCase(), w / 2, 36); x.font = '700 26px Orbitron, sans-serif'; x.fillStyle = CAB.hex(c); x.fillText(sz[1] + ' PTS', w / 2, 74); });
        var pl = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.3, len - 0.2), 0.42), new THREE.MeshBasicMaterial({ map: plate })); pl.position.set(-0.66, 0.66, 0); pl.rotation.y = -Math.PI / 2; grp.add(pl);
        s.add(grp);
        self.carObjs.push({ g: grp, m: m, len: len, base: len, off: off, v: sz[1], name: cdef[0], kind: cdef[1], lit: false, kids: grp.children.length, glow: 0 });
        off += len + gap;
      });
      this.trainLen = off;
      this.couplers = [];
      for (var k2 = 0; k2 < this.carObjs.length - 1; k2++) { var cp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, gap + 0.12, 10), CAB.chrome()); cp.rotation.x = Math.PI / 2; var cpg = new THREE.Group(); cpg.add(cp); s.add(cpg); this.couplers.push(cpg); }
      // the spiral on the right and the ramp that wraps around the right end and runs along the front
      var a0 = 1.85, rampStart = new V3(L + R * Math.sin(a0), 3.5, R * Math.cos(a0));
      var C = rampStart.clone().add(new V3(1.05, 0, 0)), turns = 2.5, hel = [];
      for (var h = 0; h <= 200; h++) { var q = h / 200, th = Math.PI - (1 - q) * turns * Math.PI * 2; hel.push(new V3(C.x + Math.cos(th) * 1.05, 7.6 - 4.1 * q, C.z + Math.sin(th) * 1.05)); }
      this.helix = new THREE.CatmullRomCurve3(hel); this.helix.arcLengthDivisions = 1200; this.helixLen = this.helix.getLength();
      var rp = [];
      for (var r = 0; r <= 30; r++) { var aa = a0 * (1 - r / 30); rp.push(new V3(L + R * Math.sin(aa), 3.5 - 1.1 * (r / 30), R * Math.cos(aa))); }
      this.dropX = L * 0.5;
      for (var r2 = 1; r2 <= 10; r2++) { var u2 = r2 / 10; rp.push(new V3(L - (L - this.dropX) * u2, 2.4 - 0.75 * u2, R)); }
      this.ramp = new THREE.CatmullRomCurve3(rp); this.ramp.arcLengthDivisions = 800; this.rampLen = this.ramp.getLength();
      var pipe = CAB.glass(0xbfe8ff, 0.26);
      s.add(new THREE.Mesh(new THREE.TubeGeometry(this.helix, 300, 0.3, 14, false), pipe));
      s.add(new THREE.Mesh(new THREE.TubeGeometry(this.ramp, 160, 0.3, 14, false), pipe));
      var stripeM = CAB.glow(0x00ffc2, 1.2);
      s.add(new THREE.Mesh(new THREE.TubeGeometry(this.helix, 300, 0.035, 6, false), stripeM));
      var tower = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 8.2, 20), CAB.chrome()); tower.position.set(C.x, 3.8, C.z); s.add(tower);
      var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.4, 32, 1, true), CAB.shiny(0xffd23f, { side: THREE.DoubleSide })); this.top = this.helix.getPoint(0).clone().add(new V3(0, 0.15, 0)); cup.position.copy(this.top).add(new V3(0, -0.05, 0)); s.add(cup);
      for (var sp2 = 0; sp2 < 7; sp2++) { var pp = this.ramp.getPoint(sp2 / 7 + 0.05), post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, pp.y, 10), CAB.chrome()); post.position.set(pp.x + (pp.z > R - 0.2 ? 0 : 0), pp.y / 2, pp.z + (pp.z > R - 0.2 ? 0.45 : 0)); s.add(post); }
      // where the ball will land: it leaves the ramp at a steady speed, so it always lands at the same spot
      var end = this.ramp.getPoint(1), tan = this.ramp.getTangentAt(1), fx = end.x, fy = end.y + 0.05, fvx = tan.x * VE, fvy = tan.y * VE;
      while (fy > RIM) { fvy -= G / 240; fx += fvx / 240; fy += fvy / 240; }
      this.landX = fx;
      var mark = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 40), CAB.glow(0xffd23f, 2)); mark.rotation.x = -Math.PI / 2; mark.position.set(this.landX, 0.02, R); mark.userData.noShadow = true; s.add(mark);
      this.held = CAB.ball(0xffd23f, BR); s.add(this.held);
      this.loose = new THREE.Group(); s.add(this.loose);
      // where people can stand: around the ends of the track, in the infield, and up on the station roof
      var spots = [new V3(-9.6, 0, 1.4), new V3(-8.4, 0, -4.4), new V3(-1.6, 0, 0.2), new V3(1.8, 0, -0.5), new V3(-10.6, 0, -1.6), new V3(-4.6, 4.55, -6.5), new V3(2.6, 4.55, -6.5)];
      spots[5].roofOnly = spots[6].roofOnly = true;
      // what the cast needs to know about the train so they can wait for it, or get flattened by it
      var self2 = this, track = {
        on: function (q) { return along(q.x, q.z).off < 0.95; },
        carAt: function (q) { var d = along(q.x, q.z).d; return self2.carObjs.some(function (c) { var rel = wrap(d - self2.head - c.off); return rel < c.len + 0.1 || rel > P - 0.35; }); },
        clear: function (q) { var d = along(q.x, q.z).d; return !self2.carObjs.some(function (c) { var rel = wrap(d - self2.head - c.off); return rel < c.len + 0.5 || rel > P - 4.5; }); },
        coming: function (q, a, b) { var d = along(q.x, q.z).d; return self2.carObjs.some(function (c) { var ahead = wrap(self2.head + c.off - d); return ahead > a && ahead < b; }); },
        near: function (q, onRails) { var t = at(along(q.x, q.z).d + (onRails ? 0.9 : 0)); return onRails ? new V3(t.x, 0, t.z) : new V3(t.x + Math.cos(t.h) * 1.6, 0, t.z - Math.sin(t.h) * 1.6); }
      };
      this.cast = CAB.cast({ scene: s, scale: 0.6, spots: spots, track: track, offstage: [new V3(-17, 0, 2), new V3(-16, 0, -5), new V3(15, 0, 5)], look: new V3(this.landX, 0, R), regulars: REGULARS, cameos: GUESTS, idle: IDLE });
      // the tunnel: an arched cover over the top right of the track. The ball takes about 3.6 seconds to reach the drop
      // spot, so the car you need is in here, out of sight, at the moment you press Drop.
      this.tunnel = new THREE.Group(); s.add(this.tunnel);
      var tm = CAB.shiny(0x2a0f4a, { roughness: 0.45 }), tg = CAB.glow(0x00ffc2, 1.6);
      for (var td = 16; td < 26.5; td += 0.5) {
        var tp = at(td + 0.25), seg = new THREE.Group(); seg.position.set(tp.x, 0, tp.z); seg.rotation.y = tp.h; this.tunnel.add(seg);
        var roof = new THREE.Mesh(CAB.rbox(2.0, 0.12, 0.52, 0.04), tm); roof.position.y = 1.42; seg.add(roof);
        [-1, 1].forEach(function (sd) { var wl = new THREE.Mesh(CAB.rbox(0.12, 1.42, 0.52, 0.04), tm); wl.position.set(sd * 0.95, 0.71, 0); seg.add(wl); });
      }
      [16, 26.5].forEach(function (md) { var mouth = at(md), arch = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 10, 32, Math.PI), tg); arch.position.set(mouth.x, 0.45, mouth.z); arch.rotation.y = mouth.h; self.tunnel.add(arch); });
      this.tunnel.visible = false;
      this.sparks = CAB.sparks(s, 500); this.pop = CAB.popper(s);
      this.key = s.userData.key; this.hemi = s.userData.hemi;
      CAB.shade(s);
    },
    // Sets up level n: the train's speed, the tunnel, the car sizes and their order.
    setLevel: function (n) {
      var lv = this.lv = LEVELS[n]; this.lvIndex = n; this.level = n + 1;
      this.tunnel.visible = !!lv.tunnel;
      var k = lv.small || 1; this.carObjs.forEach(function (c) { c.len = c.base * k; c.g.scale.z = k; });
      this.order = this.carObjs.slice(); this.lineUp();
    },
    // Lays the cars out nose to tail in this.order.
    lineUp: function () { var off = 0; this.order.forEach(function (c) { c.off = off; off += c.len + 0.3; }); this.trainLen = off; },
    setOption: function (id) { if (id === 'start') this.setLevel(+this.opt.start || 0); },
    say: function (name, line, secs) { this.cast.say(name, typeof line === 'string' ? line : CAB.pick(line), secs); },
    reset: function () {
      while (this.loose.children.length) this.loose.remove(this.loose.children[0]);
      this.carObjs.forEach(function (c) { c.lit = false; c.glow = 0; for (var i = c.g.children.length - 1; i >= c.kids; i--) c.g.remove(c.g.children[i]); });
      this.setLevel(+(this.opt && this.opt.start) || 0); this.levelUpT = 0;
      this.head = P * 0.7; this.score = 0; this.left = 15; this.ballSt = null; this.over = false; this.result = ''; this.bonus = false; this.t = 0; this.inCar = []; this.rollers = [];
      this.held.visible = true; this.held.position.copy(this.top); this.cast.start(); this.boltT = 30 + Math.random() * 25; this.uvT = 45 + Math.random() * 30; this.uv = 0; this.clackT = 0;
      this.sparks.clear(); this.pop.clear(); this.signBulbs.mode = 'chase'; this.lightsOut = 0; this.uvOn = 0; CAB.tint(1, 1, 1);
      this.key.intensity = 1.1; this.hemi.intensity = 0.25; this.railGlow.material.opacity = 0;
    },
    press: function () {
      if (this.over || this.left <= 0 || this.ballSt) return;
      this.left--; this.held.visible = false; S.fx.plop();
      var m = CAB.ball(0xffd23f, BR); m.castShadow = true; m.position.copy(this.top); this.loose.add(m);
      this.ballSt = { m: m, st: 'spiral', t: 0, dist: 0 };
    },
    reload: function () { if (this.left > 0) { this.held.visible = true; this.held.position.copy(this.top); } },
    react: function (kind) {
      this.cast.react(kind, kind === 'hard' ? 1 : kind === 'hit' ? 0.4 : 0.5);
    },
    update: function (dt, live) {
      this.t += dt; this.signBulbs.update(this.t); this.sparks.update(dt); this.pop.update(dt);
      var self = this;
      // the train runs clockwise: the front of the train leads toward lower track positions
      var lvl = this.lv || LEVELS[0];
      // Rush Hour: every second and a half to four seconds the train picks a new speed and gets there quickly,
      // so a surge or a slowdown can catch you mid-aim
      if (lvl.wave) {
        this.rushT = (this.rushT || 0) - dt;
        if (this.rushT <= 0) { this.rushT = 1.5 + Math.random() * 2.5; this.rushGoal = 1 + lvl.wave * (Math.random() * 2 - 1); }
        this.rush = (this.rush || 1) + ((this.rushGoal || 1) - (this.rush || 1)) * Math.min(1, dt * 2.5);
      } else this.rush = 1;
      this.spd = SPEED * (lvl.speed || 1) * this.rush * (lvl.reverse ? -1 : 1);
      if (live || !this.over) this.head -= this.spd * dt;
      var carObjs = this.carObjs;
      for (var k = 0; k < carObjs.length; k++) {
        var c = carObjs[k], mid = this.head + c.off + c.len / 2, p = at(mid);
        c.g.position.set(p.x, 0, p.z); c.g.rotation.y = p.h; c.mid = mid;
        c.glow = Math.max(0, c.glow - dt * 1.5);
        c.m.emissiveIntensity = (c.lit ? 0.35 + 0.2 * Math.sin(this.t * 6 + k) : 0.04) + c.glow * 2 + this.uv * 1.6 + (lvl.dark ? 0.9 : 0);
      }
      // the couplers go between neighbors in the train's current order
      for (var ck = 0; ck < this.couplers.length; ck++) { var oc = this.order[ck], cp = at(this.head + oc.off + oc.len + 0.15); this.couplers[ck].position.set(cp.x, 0.42, cp.z); this.couplers[ck].rotation.y = cp.h; }
      // the light board: lit tiles glow and pulse, and the one you just lit flashes
      for (var bi = 0; bi < this.board.length; bi++) {
        var bd = this.board[bi], on = carObjs[bi].lit; bd.flash = Math.max(0, bd.flash - dt * 1.2);
        var pulse = this.bonus ? 0.5 + 0.5 * Math.sin(this.t * 10 + bi * 0.8) : 0.85 + 0.15 * Math.sin(this.t * 3 + bi);
        var lv = on ? pulse + bd.flash * 0.6 : 0.22;
        bd.tile.material.color.setRGB(lv, lv, lv); bd.lamp.emissiveIntensity = on ? 2.2 + 2.5 * bd.flash + (this.bonus ? 1.5 * pulse : 0) : 0.12;
      }
      // a ball that landed settles on the floor, then rolls out the open back of the car and drops off
      for (var i = this.inCar.length - 1; i >= 0; i--) {
        var ic = this.inCar[i]; ic.t += dt; var mp = ic.m.position;
        if (mp.y > 0.62) mp.y = Math.max(0.62, mp.y - dt * 4);
        if (ic.t > 0.3) { ic.vx = (ic.vx || 0) + 5 * dt; mp.x += ic.vx * dt; }
        if (mp.x >= 0.62) {
          // out the back: from here it's a loose ball rolling on the ground, carried along a little by the train
          var cg = ic.car.g, hh = cg.rotation.y, wp = cg.localToWorld(mp.clone());
          cg.remove(ic.m); this.loose.add(ic.m); ic.m.position.copy(wp);
          this.rollers.push({ m: ic.m, v: new V3(Math.cos(hh) * ic.vx * 1.3 - Math.sin(hh) * this.spd * 0.5, 0, -Math.sin(hh) * ic.vx * 1.3 - Math.cos(hh) * this.spd * 0.5), t: 0 });
          this.inCar.splice(i, 1);
        }
      }
      this.roll(dt);
      // the cast wanders, talks, and has guests drop in
      this.cast.update(dt, live);
      if (!live) return;
      // the train's clickety-clack
      this.clackT -= dt; if (this.clackT <= 0) { this.clackT = 0.55; S.fx.clack(0.7); }
      // now and then: lightning, or a blacklight color shift
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = 30 + Math.random() * 30; S.fx.thunder();
        this.lightsOut = 0.5; this.say('GLITCH', CAB.pick(['WHO TOUCHED THE BREAKER?', 'Okay, who\'s playing with the lightning again?', 'My insurance does not cover this.']), 3);
      }
      this.lightsOut = Math.max(0, this.lightsOut - dt);
      this.uvT -= dt;
      // the Blacklight look keeps the blacklight on the whole game; otherwise it comes on now and then
      if (this.opt.look === 'uv') { this.uvOn = 1; this.uvT = 99; }
      if (this.uvT <= 0 && this.uv === 0) { this.uvOn = 6; this.uvT = 45 + Math.random() * 30; S.fx.blacklight(); this.say('BOLT', CAB.pick(['Blacklight mode! Now we can see everything you didn\'t clean.', 'Ooh, spooky. Also, why is the floor glowing?', 'Blacklight! Don\'t think about what\'s glowing.']), 3.5); }
      if (this.uvOn > 0) { this.uvOn -= dt; this.uv = Math.min(1, this.uv + dt * 2); } else this.uv = Math.max(0, this.uv - dt * 1.5);
      var dim = Math.max(this.uv * 0.75, this.lightsOut > 0 ? 0.85 : 0, lvl.dark ? 0.97 : 0);
      this.key.intensity = 1.1 * (1 - dim); this.hemi.intensity = 0.25 * (1 - dim * (lvl.dark ? 1 : 0.5));
      // Lights Out turns off the room lights only, so the cars, the board and every win still glow at full neon
      CAB.tint(1 - this.uv * 0.35, 1 - this.uv * 0.55, 1 + this.uv * 0.4);
      this.railGlow.material.opacity = this.uv * 0.6;
      if (this.levelUpT > 0) { this.levelUpT -= dt; if (this.levelUpT <= 0) this.nextLevel(); }
      if (!this.ballSt) { if (!this.over && this.left === 0 && !this.inCar.length && !(this.levelUpT > 0)) this.finish(); return; }
      var b = this.ballSt, pm = b.m.position;
      b.t += dt;
      if (b.st === 'spiral' || b.st === 'ramp') {
        // an even speed down the spiral, easing off along the ramp, so every ball takes exactly the same time
        var sp = b.st === 'spiral', crv = sp ? this.helix : this.ramp, len = sp ? this.helixLen : this.rampLen;
        b.dist += (sp ? VS : VS + (VE - VS) * Math.min(1, b.dist / len)) * dt;
        if (b.dist < len) pm.copy(crv.getPointAt(b.dist / len)).y += 0.05;
        else if (sp) { b.st = 'ramp'; b.dist -= len; }
        else { var tn = this.ramp.getTangentAt(1); pm.copy(this.ramp.getPoint(1)).y += 0.05; b.st = 'drop'; b.t = 0; b.vx = tn.x * VE; b.vy = tn.y * VE; }
      } else if (b.st === 'drop') {
        b.vy -= G * dt; pm.y += b.vy * dt; pm.x += b.vx * dt; b.t += dt;
        var hit = null;
        if (pm.y < RIM + BR + 0.05) {
          // the cars' end walls are solid: test the ball against each one, moving with the train
          var dBall = wrap(pm.x + L);
          for (var j = 0; j < carObjs.length; j++) {
            var cc = carObjs[j], rel = wrap(dBall - (cc.mid - cc.len / 2));
            if (rel > P / 2) rel -= P;
            if (rel < -0.6 || rel > cc.len + 0.6) continue;
            var walls = [[-0.02, WALL], [cc.len - WALL, cc.len + 0.02]];
            for (var wi = 0; wi < 2; wi++) {
              var w0 = walls[wi], qx = CAB.clamp(rel, w0[0], w0[1]), qy = CAB.clamp(pm.y, 0.34, RIM), ex = rel - qx, ey = pm.y - qy, dd = Math.sqrt(ex * ex + ey * ey);
              if (dd < BR) {
                var nx = dd > 1e-6 ? ex / dd : 0, ny = dd > 1e-6 ? ey / dd : 1, rvx = b.vx + this.spd, vn = rvx * nx + b.vy * ny;
                if (vn < 0) { rvx -= 1.45 * vn * nx; b.vy -= 1.45 * vn * ny; b.vx = rvx - this.spd; }
                // a ball sitting on top of a wall can't balance there: it rolls off one side or the other
                if (ny > 0.7) b.vx += (ex >= 0 ? 1 : -1) * 6 * dt + (ex === 0 ? 0.5 : 0);
                pm.x += nx * (BR - dd); pm.y += ny * (BR - dd); rel += nx * (BR - dd);
                if (!b.clank || b.clank !== cc) { S.fx.rim(); b.clank = cc; }
              }
            }
            if (pm.y < RIM - 0.05 && rel > WALL && rel < cc.len - WALL) { hit = cc; break; }
          }
        }
        if (hit) {
          hit.g.updateMatrixWorld(true); hit.g.worldToLocal(pm); hit.g.add(b.m); this.inCar.push({ m: b.m, car: hit, t: 0 });
          var first = !hit.lit; hit.lit = true; hit.glow = 1; this.board[carObjs.indexOf(hit)].flash = 1; this.score += hit.v;
          var wp = hit.g.localToWorld(new V3(0, 1.4, 0));
          this.pop.pop(wp, '+' + hit.v, CAB.hex(this.sizes[hit.kind][2]), 0.7); this.sparks.burst(wp, [this.sizes[hit.kind][2], 0xffd23f, 0xffffff], hit.kind === 'hard' ? 80 : 30, 4);
          S.fx.land(hit.kind === 'hard' ? 12 : hit.kind === 'med' ? 7 : 0);
          if (hit.kind === 'hard') { S.fx.whistle(); CAB.call(hit.name.toUpperCase() + '!', 'huge', '+40, the hard one', 1.8); CAB.shake(0.15); this.react('hard'); }
          else { CAB.toast(hit.name + (first ? '! +' : ' again! +') + hit.v); this.react('hit'); }
          if (this.lv.shuffle && !carObjs.every(function (c) { return c.lit; })) {
            // All Change: the cars trade places (the ball rides along in its car)
            for (var si = this.order.length - 1; si > 0; si--) { var sj = Math.floor(Math.random() * (si + 1)), tmp = this.order[si]; this.order[si] = this.order[sj]; this.order[sj] = tmp; }
            this.lineUp(); S.fx.chirp(); setTimeout(function () { CAB.toast('All change! The cars swapped places.'); }, 500);
          }
          if (!this.bonus && carObjs.every(function (c) { return c.lit; })) {
            this.bonus = true; this.score += 250; var me = this; this.levelUpT = 3.6;
            setTimeout(function () { CAB.call('ALL ABOARD!', 'huge', '+250, every car lit', 2.6); S.fx.whistle(); S.fx.fanfare(); S.fx.coins(2); me.signBulbs.mode = 'flash'; me.say('BOLT', 'ALL ABOARD! Okay, I take back everything I said. Most of it.'); }, 700);
          }
          this.ballSt = null; this.reload();
        } else if (pm.y < 0.3 || b.t > 3) {
          b.st = 'miss'; b.vz = 0.8;
          CAB.toast(b.clank ? 'Bounced off ' + b.clank.name + '\'s wall' : 'Missed the train', true); this.react('miss');
        }
      } else if (b.st === 'miss') {
        // a miss bounces on the platform and rolls away; the next ball is ready as soon as it hits the ground
        b.vy -= 18 * dt; pm.y += b.vy * dt; pm.x += (b.vx || 0) * dt; pm.z += b.vz * dt;
        if (pm.y <= BR) { S.fx.bonk(); this.rollers.push({ m: b.m, v: new V3(b.vx || 0, Math.abs(b.vy) * 0.35, b.vz), t: 0 }); pm.y = BR; this.ballSt = null; this.reload(); }
      }
    },
    // loose balls on the ground: they bounce, roll to a stop, knock over anyone in the way, and fade out (or fall off the platform's edge)
    roll: function (dt) {
      for (var i = this.rollers.length - 1; i >= 0; i--) {
        var r = this.rollers[i], q = r.m.position, v = r.v; r.t += dt;
        var onDeck = Math.abs(q.x - 0.8) < L + R + 3.25 && Math.abs(q.z) < R + 2.25;
        v.y -= 18 * dt; q.addScaledVector(v, dt);
        if (onDeck && q.y < BR) { q.y = BR; v.y = v.y < -1.5 ? -v.y * 0.35 : 0; }
        if (q.y <= BR + 0.01) { var f = Math.max(0, 1 - 0.9 * dt); v.x *= f; v.z *= f; }
        if (q.y < 1.2 && (Math.abs(v.x) + Math.abs(v.z)) > 0.4) this.cast.bump(q, BR);
        if (r.t > 3.5) r.m.scale.setScalar(Math.max(0.01, 1 - (r.t - 3.5) * 2.5));
        if (r.t > 3.9 || q.y < -3) { this.loose.remove(r.m); this.rollers.splice(i, 1); }
      }
    },
    // After All Aboard: the board clears, 15 new balls, and the next level (after the last one, back to the first).
    nextLevel: function () {
      var n = this.lvIndex + 1 < LEVELS.length ? this.lvIndex + 1 : 0, lvlNo = this.level + 1;
      this.carObjs.forEach(function (c) { c.lit = false; c.glow = 0; });
      this.setLevel(n); this.level = lvlNo; this.bonus = false; this.left = 15; this.signBulbs.mode = 'chase';
      if (!this.ballSt) this.reload();
      CAB.call('LEVEL ' + lvlNo, 'good', this.lv.name + '. ' + this.lv.note + ' 15 new balls.', 4); S.fx.lap();
    },
    finish: function () {
      this.over = true; var lit = this.carObjs.filter(function (c) { return c.lit; }).length;
      this.result = this.score + ' points on level ' + this.level + ', ' + lit + ' of 8 cars lit' + (this.bonus ? ', plus ALL ABOARD!' : '.');
      CAB.call('LAST STOP', 'good', this.score + ' points', 2.6); CAB.tint(1, 1, 1);
    },
    // What goes on the board when the run ends.
    final: function () {
      var from = +(this.opt.start || 0);
      return { score: this.score || 0, board: 'points', detail: 'Level ' + (this.level || 1) + (from ? ', started at ' + (from + 1) : '') };
    },
    hud: function () { var lit = (this.carObjs || []).filter(function (c) { return c.lit; }).length; return [['Score', this.score || 0], ['Level', this.level || 1], ['Balls', this.left == null ? 15 : this.left], ['Lit', lit + ' / 8']]; }
  };
  // On a tall phone screen the camera backs up so the whole station still fits.
  var up0 = g.update;
  g.update = function (dt, live) {
    var a = this.cam.aspect || 1.6, k = CAB.clamp(1.75 / a, 1, 2.3);
    this.cam.position.set(0.8, 7.6 * k, 11.4 * k); this.cam.lookAt(0.8, 1.9, -0.4);
    up0.call(this, dt, live);
  };
  CAB.games.push(g);
})();
