// ARKS Racer: a synthwave time-trial racer in the spirit of the classic arcade stock-car cabinets. Three laps against
// the clock on one of eight tracks; each lap adds time, and the board keeps the fastest finishing times. Steer by
// tapping or sliding on the game, the arrow buttons, or the keys; the gas is held or always on. Runs in cab-frame.js.
(function () {
  'use strict';
  var CAB = window.CAB, V3 = CAB.V3, S = CAB.sound;
  function grad(stops) { return CAB.canvasTex(4, 512, function (x) { var g = x.createLinearGradient(0, 0, 0, 512); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); x.fillStyle = g; x.fillRect(0, 0, 4, 512); }); }
  function lin(hex) { return new THREE.Color(hex); }
  // Each track is a layout, a sky, a palette and its own kind of place, so no two look alike.
  // The colors come from synthwave sunset palettes. Tracks with `pads` have speed pads on their straights.
  var TRACKS = {
    sunset: {
      name: 'Sunset Strip', song: 'lofiSunset', palette: 'sunset', place: 'a desert highway',
      pts: [[0, 0], [120, -20], [220, 20], [240, 120], [180, 190], [80, 170], [20, 220], [-80, 200], [-140, 120], [-120, 20]],
      sky: [[0, '#0b0326'], [0.45, '#3b0a5e'], [0.7, '#c2187a'], [0.86, '#ff6a3d'], [1, '#ffb347']], fog: 0x5a1170, ground: 0x2a0b30, grid: [0xff2ec4, 0xb0168a],
      curbs: [0x00ffd9, 0xff2ec4], road: 0x170c26,
      sun: { c: ['#fff36b', '#ff8a3d', '#ff2e8a'], size: 220, y: 70 }, mountains: { color: 0x00ffd5, wire: true }, palms: { glow: [0xff2ec4, 0x00ffc2] }, cacti: true
    },
    neon: {
      name: 'Neon Night', song: 'lofiNeon', palette: 'midnight', place: 'downtown at night', pads: true,
      pts: [[0, 0], [90, 10], [150, -40], [230, -20], [250, 70], [200, 140], [120, 120], [60, 190], [-40, 180], [-110, 110], [-90, 30]],
      sky: [[0, '#02010a'], [0.5, '#0a0b2e'], [0.8, '#1c1052'], [1, '#3a1a7a']], fog: 0x120a38, ground: 0x05040f, grid: [0x00e5ff, 0x1b4bd1],
      curbs: [0x00e5ff, 0xb14dff], road: 0x0d0d1c,
      moon: { color: 0xdfe8ff, size: 90 }, city: { lit: true }, lamps: true
    },
    ocean: {
      name: 'Ocean Drive', song: 'lofiOcean', palette: 'ocean', place: 'a causeway over the ocean', pads: true,
      pts: [[0, 0], [140, 0], [230, 40], [250, 130], [190, 165], [120, 125], [50, 165], [0, 240], [-90, 215], [-135, 125], [-100, 40]],
      sky: [[0, '#1a0b3d'], [0.35, '#5a1aa8'], [0.62, '#d41fb0'], [0.82, '#ff3ec8'], [1, '#ffb0e8']], fog: 0x9a1fc0,
      curbs: [0x6ef0ff, 0xff3ec8], road: 0x140a30,
      sun: { c: ['#ffd0f0', '#ff8ae0', '#ff3ec8'], size: 240, y: 40 }, water: { color: 0x1e5bd8, sand: 0xc77ab8 }, palms: { glow: [0x2ea8ff, 0x6ef0ff], beach: true }, boats: true
    },
    midnight: {
      name: 'Midnight Run', song: 'lofiMidnight', palette: 'midnight', place: 'a deep canyon',
      pts: [[0, 0], [160, 0], [260, 40], [285, 130], [225, 195], [100, 205], [-40, 200], [-130, 150], [-145, 60], [-80, 10]],
      sky: [[0, '#000000'], [0.55, '#07020f'], [0.8, '#2a0838'], [1, '#7a0a4a']], fog: 0x1a0628, ground: 0x0a0408, grid: [0x12d8c8, 0x0a7a8a],
      curbs: [0x12d8c8, 0xff2e6a], road: 0x0a0814,
      sun: { c: ['#ff7a4a', '#ff2e6a', '#c0105a'], size: 200, y: 25 }, canyon: { rock: 0x5a1a34, edge: 0xff2e6a }
    },
    golden: {
      name: 'Golden Coast', song: 'lofiGolden', palette: 'golden', place: 'rolling hills with wind turbines',
      pts: [[0, 0], [110, 10], [185, -40], [265, -25], [305, 60], [255, 130], [170, 120], [105, 160], [120, 235], [40, 285], [-60, 245], [-115, 150], [-90, 60]],
      sky: [[0, '#2a0a3a'], [0.35, '#8a1440'], [0.6, '#ff4a3a'], [0.82, '#ff7a2a'], [1, '#ffd23f']], fog: 0xc41a50, ground: 0x24081e,
      curbs: [0xffd23f, 0x1ac8d8], road: 0x1a0a20,
      sun: { c: ['#fff2a0', '#ffd23f', '#ff7a2a'], size: 230, y: 50, solid: true }, hills: [0xb0203e, 0xd8503a, 0x8a1a5a, 0x6a2a7a], turbines: true
    },
    teal: {
      name: 'Crystal Cove', song: 'lofiTide', palette: 'teal', place: 'a field of giant glowing crystals',
      pts: [[0, 0], [90, -20], [180, 25], [215, 110], [170, 170], [195, 240], [115, 290], [20, 260], [-65, 290], [-150, 215], [-125, 120], [-65, 55]],
      sky: [[0, '#0a2a3a'], [0.4, '#1a6a7a'], [0.68, '#3ab8c0'], [0.86, '#ff7ab0'], [1, '#ffb0d0']], fog: 0x2a9aa0, ground: 0x03141c,
      curbs: [0xff3e8a, 0x8af0e8], road: 0x081820,
      sun: { c: ['#ffd27a', '#ff7ab0', '#ff3e8a'], size: 210, y: 55 }, crystals: [0x8af0e8, 0xff7ab0, 0xb06aff]
    },
    star: {
      name: 'Star Road', song: 'lofiMoon', palette: 'cosmic', place: 'a road floating through space', pads: true,
      pts: [[0, 0], [140, -20], [250, 10], [300, 90], [260, 170], [170, 175], [110, 230], [120, 310], [30, 340], [-60, 300], [-110, 210], [-160, 120], [-110, 40]],
      sky: [[0, '#000000'], [0.6, '#05030f'], [0.85, '#1a1450'], [1, '#4a2ab0']], fog: 0x0d0a2a,
      curbs: [0x5ae8ff, 0xff4ac8], road: 0x0d0a2a,
      space: { planet: 0x7a3ae0, ring: 0x5ae8ff }
    },
    forest: {
      name: 'Laser Forest', song: 'lofiForest', palette: 'forest', place: 'a dark forest of neon trees',
      pts: [[0, 0], [80, 30], [170, 0], [240, 50], [230, 140], [150, 170], [90, 130], [30, 180], [60, 260], [-30, 300], [-120, 250], [-140, 150], [-80, 70]],
      sky: [[0, '#020805'], [0.45, '#0a2a1a'], [0.75, '#3a1a6a'], [1, '#7a3ac0']], fog: 0x123a24, ground: 0x061a0e,
      curbs: [0xb0ff7a, 0xc07aff], road: 0x0a120c,
      moon: { color: 0xc0ffd0, size: 110 }, trees: { dark: 0x14502e, glow: [0x5ad05a, 0xc07aff, 0x7af0ff] }, fireflies: 0xb0ff7a
    }
  };
  var ORDER = ['sunset', 'neon', 'ocean', 'midnight', 'golden', 'teal', 'star', 'forest'];
  var TOP = 52, BOOST = 74, OFF = 18;

  // Steering, the way racing games make touch steering comfortable: a small dead zone in the middle so a wobbly
  // finger goes straight, then a curve so small slides make small turns and only big slides turn hard.
  // TURN is how fast the wheel itself can turn (full lock in about a third of a second), so a quick, big swipe
  // eases into the turn instead of throwing the car off the road, while small corrections still answer at once.
  var DEAD = 0.08, CURVE = 1.6, TURN = 3.2;
  function shape(x) { var m = Math.abs(x); if (m < DEAD) return 0; m = (m - DEAD) / (1 - DEAD); return (x < 0 ? -1 : 1) * Math.pow(m, CURVE); }

  var g = {
    id: 'racer', name: 'ARKS Racer', noShadow: true,
    track: function () { return TRACKS[this.opt.track].song; },
    tvHint: 'The arrows on the remote steer and OK is the gas. On a game controller, the D-pad or the left stick steers, A or the right trigger is the gas, and Start pauses.',
    tvButtons: { 0: 'ArrowUp', 7: 'ArrowUp', 9: 'p' }, tvEnter: 'ArrowUp',
    pad: [['◀', 'left'], ['▶', 'right'], ['GAS', 'gas']],
    options: [{ id: 'track', label: 'Track', def: 'sunset', choices: ORDER.map(function (k) { return [k, TRACKS[k].name]; }) },
      { id: 'gas', label: 'Gas', def: 'pedal', choices: [['pedal', 'Hold to go'], ['auto', 'Always on']] },
      { id: 'touch', label: 'Touch', def: 'tap', choices: [['tap', 'Tap like the keys'], ['slide', 'Slide']] }],
    init: function () {
      this.cam = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);
      this.keys = { left: false, right: false, gas: false }; this.keyWheel = 0; this.touchSteer = null; this.touchGas = false; this.built = {}; this.t = 0;
      if (!TRACKS[this.opt.track]) this.opt.track = 'sunset';
      this.useTrack(this.opt.track);
    },
    setOption: function (id, v) { if (id === 'track') this.useTrack(TRACKS[v] ? v : 'sunset'); },
    useTrack: function (name) {
      if (!this.built[name]) this.built[name] = this.build(TRACKS[name], name);
      var b = this.built[name]; this.T = TRACKS[name]; this.scene = b.scene; this.cp = b.cp; this.N = b.N; this.W = b.W; this.car = b.car; this.pads = b.pads; this.anim = b.anim;
    },
    build: function (T, name) {
      var s = new THREE.Scene(), anim = [];
      s.background = grad(T.sky); s.fog = new THREE.Fog(T.fog, 120, 460);
      s.add(new THREE.HemisphereLight(0xffb3f0, 0x1a0b30, 0.7));
      var dl = new THREE.DirectionalLight(0xffd0a0, 0.9); dl.position.set(0, 40, -100); s.add(dl);
      var pts = T.pts.map(function (p) { return new V3(p[0], 0, p[1]); });
      var curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      var N = 800, W = 7, cp = curve.getSpacedPoints(N); cp.pop();
      var pos = [], col = [], idx = [], curb = [], ccol = [];
      var road = lin(T.road), white = lin(0xf2f2f2), c1 = lin(T.curbs[0]), c2 = lin(T.curbs[1]);
      for (var i = 0; i < N; i++) {
        var a = cp[i], b = cp[(i + 1) % N], t = b.clone().sub(a).normalize(), nrm = new V3(-t.z, 0, t.x);
        var l = a.clone().addScaledVector(nrm, W), r = a.clone().addScaledVector(nrm, -W);
        pos.push(l.x, 0.05, l.z, r.x, 0.05, r.z);
        var c = i < 6 ? white : road; col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        var on = Math.floor(i / 3) % 2 ? c1 : c2;
        [1, -1].forEach(function (sd) {
          var o = a.clone().addScaledVector(nrm, sd * W), q = a.clone().addScaledVector(nrm, sd * (W + 0.9));
          curb.push(o.x, 0.07, o.z, q.x, 0.07, q.z); ccol.push(on.r * 2, on.g * 2, on.b * 2, on.r * 2, on.g * 2, on.b * 2);
        });
      }
      for (var j = 0; j < N; j++) { var k = (j + 1) % N, a0 = j * 2, b0 = k * 2; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
      function ribbon(p, c, ix) { var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); if (c) gg.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); gg.setIndex(ix); gg.computeVertexNormals(); return gg; }
      s.add(new THREE.Mesh(ribbon(pos, col, idx), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.3, envMap: CAB.env, envMapIntensity: 0.8 })));
      var cidx = [];
      for (var m = 0; m < N; m++) { var n2 = (m + 1) % N; [0, 2].forEach(function (off) { var a1 = m * 4 + off, b1 = n2 * 4 + off; cidx.push(a1, b1, a1 + 1, a1 + 1, b1, b1 + 1); }); }
      s.add(new THREE.Mesh(ribbon(curb, ccol, cidx), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
      var center = []; for (var cl = 0; cl < N; cl += 2) { if (Math.floor(cl / 6) % 2) continue; var p0 = cp[cl], p1 = cp[(cl + 2) % N]; center.push(p0.x, 0.08, p0.z, p1.x, 0.08, p1.z); }
      var cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(center, 3)); s.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xfff27a })));
      if (T.ground != null) { var ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshBasicMaterial({ color: T.ground })); ground.rotation.x = -Math.PI / 2; ground.position.set(50, -0.05, 100); s.add(ground); }
      if (T.grid) { var grid = new THREE.GridHelper(1600, 160, T.grid[0], T.grid[1]); grid.position.set(50, 0, 100); grid.material.transparent = true; grid.material.opacity = 0.6; s.add(grid); }
      var rnd = 7 + ORDER.indexOf(name) * 4; function rand() { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; }
      function nearTrack(x, z) { var bd = 1e12; for (var q = 0; q < N; q += 4) { var p = cp[q], d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < bd) bd = d; } return Math.sqrt(bd); }
      var mid = new V3(); T.pts.forEach(function (p) { mid.x += p[0] / T.pts.length; mid.z += p[1] / T.pts.length; });
      // a spot somewhere around the track, between `near` and `far` from the road
      function spot(near, far, spread) { for (var tries = 0; tries < 40; tries++) { var x = mid.x - spread + rand() * spread * 2, z = mid.z - spread + rand() * spread * 2, d = nearTrack(x, z); if (d > near && d < far) return [x, z, d]; } return null; }
      // many copies of one shape in one draw call
      var m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sv3 = new V3(), eul = new THREE.Euler();
      function many(geo, mat, list) {
        var im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(function (o, k) { eul.set(o.rx || 0, o.ry || 0, o.rz || 0); qt.setFromEuler(eul); sv3.set(o.sx || 1, o.sy || 1, o.sz || 1); m4.compose(new V3(o.x, o.y, o.z), qt, sv3); im.setMatrixAt(k, m4); });
        s.add(im); return im;
      }

      // the sun: a gradient disc, cut with stripes unless it's a solid one
      if (T.sun) {
        var sc = document.createElement('canvas'); sc.width = 256; sc.height = 256; var sx = sc.getContext('2d');
        var sg = sx.createLinearGradient(0, 0, 0, 256); sg.addColorStop(0, T.sun.c[0]); sg.addColorStop(0.5, T.sun.c[1]); sg.addColorStop(1, T.sun.c[2]);
        sx.fillStyle = sg; sx.beginPath(); sx.arc(128, 128, 126, 0, Math.PI * 2); sx.fill();
        if (!T.sun.solid) { sx.globalCompositeOperation = 'destination-out'; for (var st = 0; st < 7; st++) sx.fillRect(0, 150 + st * 15, 256, 3 + st * 1.4); }
        var stex = new THREE.CanvasTexture(sc); stex.encoding = THREE.sRGBEncoding;
        var sunM = new THREE.MeshBasicMaterial({ map: stex, transparent: true, fog: false, depthWrite: false }); sunM.color.setScalar(1.9);
        var sun = new THREE.Mesh(new THREE.PlaneGeometry(T.sun.size, T.sun.size), sunM); sun.position.set(mid.x, T.sun.y, -620); sun.renderOrder = -1; s.add(sun);
      }
      if (T.moon) {
        var moonM = new THREE.MeshBasicMaterial({ map: CAB.dotTexture(), transparent: true, fog: false, depthWrite: false }); moonM.color.setHex(T.moon.color); moonM.color.multiplyScalar(2.2);
        var moon = new THREE.Mesh(new THREE.PlaneGeometry(T.moon.size, T.moon.size), moonM); moon.position.set(-120, 150, -600); moon.renderOrder = -1; s.add(moon);
      }
      // mountains along the horizon, drawn as glowing wireframes
      if (T.mountains) {
        for (var mt = 0; mt < 16; mt++) {
          var hgt = 40 + rand() * 80, rad2 = 50 + rand() * 45;
          var w1 = new THREE.Mesh(new THREE.ConeGeometry(rad2, hgt, 4), new THREE.MeshBasicMaterial({ color: T.mountains.color, wireframe: true, fog: false })); w1.position.set(-560 + mt * 80, hgt / 2 - 2, -470 - rand() * 70); s.add(w1);
        }
      }
      // palms: glowing neon leaves; on the beach they only grow on the sand next to the road
      if (T.palms) {
        var trunkM = new THREE.MeshBasicMaterial({ color: 0x2a0a40 });
        for (var q = 0; q < (T.palms.beach ? 150 : 130); q++) {
          var ps = T.palms.beach ? spot(W + 7, W + 15, 300) : spot(W + 6, 400, 320); if (!ps) continue;
          var palm = new THREE.Group(), tall = 8 + rand() * 5, trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, tall, 8), trunkM);
          trunk.position.y = tall / 2; trunk.rotation.z = (rand() - 0.5) * 0.25; palm.add(trunk);
          var leafM = CAB.glow(rand() > 0.5 ? T.palms.glow[0] : T.palms.glow[1], 1.2);
          for (var lf = 0; lf < 7; lf++) { var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.6, 5.4, 4), leafM); leaf.position.y = tall; leaf.rotation.y = lf * Math.PI * 2 / 7; leaf.rotation.z = Math.PI / 2.3; leaf.translateY(2.4); palm.add(leaf); }
          palm.position.set(ps[0], 0, ps[1]); s.add(palm);
        }
      }
      // desert cactus with glowing outlines
      if (T.cacti) {
        var cacM = new THREE.MeshBasicMaterial({ color: 0x0b2a2a }), cacs = [];
        for (var cc = 0; cc < 90; cc++) { var cs = spot(W + 6, 300, 320); if (cs) cacs.push(cs); }
        cacs.forEach(function (c) {
          var h = 4 + rand() * 4, grp = new THREE.Group();
          var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, h, 8), cacM); stem.position.y = h / 2; grp.add(stem);
          [-1, 1].forEach(function (sd) { if (rand() < 0.3) return; var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 8), cacM); arm.position.set(sd * 1.3, h * 0.55 + 0.8, 0); grp.add(arm); var elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 8), cacM); elbow.rotation.z = Math.PI / 2; elbow.position.set(sd * 0.9, h * 0.55, 0); grp.add(elbow); });
          var edge = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.88, 0.25, 8), CAB.glow(0x00ffd5, 1.6)); edge.position.y = h; grp.add(edge);
          grp.position.set(c[0], 0, c[1]); grp.rotation.y = rand() * 6; s.add(grp);
        });
      }
      // the ocean: a sandy causeway under the road and shiny water everywhere else
      if (T.water) {
        var water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: T.water.color, roughness: 0.12, metalness: 0.7, envMap: CAB.env, envMapIntensity: 1.2 }));
        water.rotation.x = -Math.PI / 2; water.position.set(50, -0.4, 100); s.add(water);
        var sand = [], sidx = [];
        for (var si = 0; si < N; si++) { var sa = cp[si], sb = cp[(si + 1) % N], stt = sb.clone().sub(sa).normalize(), sn = new V3(-stt.z, 0, stt.x); var L1 = sa.clone().addScaledVector(sn, W + 16), R1 = sa.clone().addScaledVector(sn, -W - 16); sand.push(L1.x, -0.02, L1.z, R1.x, -0.02, R1.z); }
        for (var sj = 0; sj < N; sj++) { var sk = (sj + 1) % N; sidx.push(sj * 2, sk * 2, sj * 2 + 1, sj * 2 + 1, sk * 2, sk * 2 + 1); }
        s.add(new THREE.Mesh(ribbon(sand, null, sidx), new THREE.MeshBasicMaterial({ color: T.water.sand, side: THREE.DoubleSide })));
        // glints on the water that drift and twinkle
        var gl = [], glN = 400; for (var gi = 0; gi < glN; gi++) { var gs = spot(W + 18, 900, 500); if (gs) gl.push(gs[0], -0.3, gs[1]); }
        var gg2 = new THREE.BufferGeometry(); gg2.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
        var glM = new THREE.PointsMaterial({ color: 0xffd0f0, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8 }); s.add(new THREE.Points(gg2, glM));
        anim.push(function (tt) { glM.opacity = 0.5 + Math.sin(tt * 3) * 0.3; });
      }
      if (T.boats) {
        for (var bt = 0; bt < 14; bt++) {
          var bs = spot(60, 600, 520); if (!bs) continue;
          var boat = new THREE.Group(), hull = new THREE.Mesh(CAB.rbox(6, 1.2, 2.2, 0.4), CAB.mat(0xf4f0ff)); hull.position.y = 0.2; boat.add(hull);
          var sail = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 3), CAB.glow(bt % 2 ? 0xff8ae0 : 0x6ef0ff, 0.9)); sail.position.y = 5.4; sail.scale.z = 0.15; boat.add(sail);
          boat.position.set(bs[0], -0.2, bs[1]); boat.rotation.y = rand() * 6; s.add(boat);
          (function (bb, ph) { anim.push(function (tt) { bb.rotation.z = Math.sin(tt * 1.3 + ph) * 0.06; bb.position.y = -0.2 + Math.sin(tt * 1.7 + ph) * 0.15; }); })(boat, bt);
        }
      }
      // canyon walls: tall rock slabs close to both sides of the road, with a glowing rim on top
      if (T.canyon) {
        var slabs = [], rims = [];
        for (var ci = 0; ci < N; ci += 3) {
          var ca = cp[ci], cb = cp[(ci + 1) % N], ct = cb.clone().sub(ca).normalize(), cn = new V3(-ct.z, 0, ct.x), hd = Math.atan2(ct.x, ct.z);
          [1, -1].forEach(function (sd) {
            var dist = W + 9 + rand() * 6, x = ca.x + cn.x * sd * dist, z = ca.z + cn.z * sd * dist;
            if (nearTrack(x, z) < W + 7) return;
            var h = 14 + rand() * 26 + Math.sin(ci * 0.05) * 6, w = 4 + rand() * 4;
            slabs.push({ x: x, y: h / 2 - 0.5, z: z, ry: hd + (rand() - 0.5) * 0.4, sx: w, sy: h, sz: 7 + rand() * 4 });
            rims.push({ x: x, y: h - 0.4, z: z, ry: hd, sx: w * 0.9, sy: 0.3, sz: 7 });
          });
        }
        many(new THREE.BoxGeometry(1, 1, 1), CAB.mat(T.canyon.rock, { roughness: 0.95, envMapIntensity: 0.1 }), slabs);
        many(new THREE.BoxGeometry(1, 1, 1), CAB.glow(T.canyon.edge, 1.8), rims);
        // far mesas on the horizon
        for (var me = 0; me < 12; me++) { var mh = 30 + rand() * 50, mesa = new THREE.Mesh(new THREE.CylinderGeometry(30 + rand() * 30, 50 + rand() * 30, mh, 6), new THREE.MeshBasicMaterial({ color: 0x14040e, fog: false })); mesa.position.set(-500 + me * 90, mh / 2 - 2, -480 - rand() * 60); s.add(mesa); }
      }
      // rolling hills and slowly turning wind turbines
      if (T.hills) {
        T.hills.forEach(function (hc, hi) {
          var list = [];
          for (var h2 = 0; h2 < 22; h2++) { var hs = spot(W + 28, 600, 480); if (!hs) continue; var rr = 30 + rand() * 50; list.push({ x: hs[0], y: -rr * 0.55, z: hs[1], sx: rr, sy: rr * (0.5 + rand() * 0.3), sz: rr }); }
          many(new THREE.SphereGeometry(1, 20, 12), CAB.mat(hc, { roughness: 0.9, envMapIntensity: 0.1 }), list);
        });
      }
      if (T.turbines) {
        var poleM = CAB.mat(0xf4f0ff, { roughness: 0.4 }), bladeM = CAB.mat(0xf4f0ff, { roughness: 0.4 }), lightM = CAB.glow(0xff2040, 3);
        for (var tb = 0; tb < 16; tb++) {
          var ts = spot(W + 20, 260, 360); if (!ts) continue;
          var tg = new THREE.Group(), th = 26 + rand() * 8;
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.9, th, 10), poleM); pole.position.y = th / 2; tg.add(pole);
          var hub = new THREE.Group(); hub.position.set(0, th, 0.9); tg.add(hub);
          hub.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), poleM));
          for (var bl = 0; bl < 3; bl++) { var blade = new THREE.Mesh(CAB.rbox(0.9, 12, 0.25, 0.12), bladeM); blade.position.y = 6; var arm = new THREE.Group(); arm.rotation.z = bl * Math.PI * 2 / 3; arm.add(blade); hub.add(arm); }
          var tip = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), lightM); tip.position.set(0, th + 1.1, -0.3); tg.add(tip);
          tg.position.set(ts[0], 0, ts[1]); tg.rotation.y = 0.6; s.add(tg);
          (function (hb, sp) { anim.push(function (tt, dt) { hb.rotation.z -= dt * sp; }); })(hub, 0.6 + rand() * 0.5);
        }
      }
      // giant glowing crystals in clusters
      if (T.crystals) {
        T.crystals.forEach(function (ccol2, ki) {
          var list = [];
          for (var cr = 0; cr < 30; cr++) {
            var cs2 = spot(W + 8, 320, 360); if (!cs2) continue;
            for (var k2 = 0; k2 < 3; k2++) { var hh = 6 + rand() * 18; list.push({ x: cs2[0] + (rand() - 0.5) * 8, y: hh * 0.45, z: cs2[1] + (rand() - 0.5) * 8, rx: (rand() - 0.5) * 0.6, ry: rand() * 3, rz: (rand() - 0.5) * 0.6, sx: hh * 0.22, sy: hh, sz: hh * 0.22 }); }
          }
          var cm = new THREE.MeshStandardMaterial({ color: ccol2, emissive: ccol2, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85, envMap: CAB.env, envMapIntensity: 1.5 });
          many(new THREE.OctahedronGeometry(1, 0), cm, list);
          (function (mm, ph) { anim.push(function (tt) { mm.emissiveIntensity = 0.7 + Math.sin(tt * 1.6 + ph) * 0.35; }); })(cm, ki * 2);
        });
      }
      // space: thousands of stars all around, a ringed planet, and glowing struts holding up the road
      if (T.space) {
        var sp2 = []; for (var sti = 0; sti < 4000; sti++) { var u = rand() * 2 - 1, th2 = rand() * Math.PI * 2, rr2 = 600 + rand() * 300, sq = Math.sqrt(1 - u * u); sp2.push(mid.x + rr2 * sq * Math.cos(th2), u * rr2 * 0.6, mid.z + rr2 * sq * Math.sin(th2)); }
        var sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.Float32BufferAttribute(sp2, 3));
        var starM = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false }); s.add(new THREE.Points(sgeo, starM));
        var planet = new THREE.Mesh(new THREE.SphereGeometry(110, 48, 32), new THREE.MeshStandardMaterial({ color: T.space.planet, emissive: T.space.planet, emissiveIntensity: 0.35, roughness: 0.8, fog: false })); planet.position.set(mid.x + 420, 170, -760); s.add(planet);
        var ring = new THREE.Mesh(new THREE.RingGeometry(150, 210, 96), new THREE.MeshBasicMaterial({ color: T.space.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false })); ring.position.copy(planet.position); ring.rotation.set(1.2, 0.3, 0); s.add(ring);
        anim.push(function (tt, dt) { planet.rotation.y += dt * 0.05; });
        var struts = []; for (var su = 0; su < N; su += 20) { struts.push({ x: cp[su].x, y: -30.6, z: cp[su].z, sx: 0.22, sy: 60, sz: 0.22 }); }
        many(new THREE.BoxGeometry(1, 1, 1), CAB.glow(T.curbs[0], 0.7), struts);
        var under = []; for (var ui = 0; ui < N; ui++) { var ua = cp[ui], ub = cp[(ui + 1) % N], ut = ub.clone().sub(ua).normalize(), un = new V3(-ut.z, 0, ut.x); [W + 0.9, -W - 0.9].forEach(function (o) { under.push(ua.x + un.x * o, -0.6, ua.z + un.z * o); }); }
        var ug = new THREE.BufferGeometry(); ug.setAttribute('position', new THREE.Float32BufferAttribute(under, 3));
        s.add(new THREE.Points(ug, new THREE.PointsMaterial({ color: T.curbs[1], size: 3, sizeAttenuation: false })));
      }
      // a forest of dark pine trees, each tier ringed with neon, and fireflies drifting between them
      if (T.trees) {
        var tiers = [[], [], []], rings = T.trees.glow.map(function () { return []; });
        for (var tr = 0; tr < 420; tr++) {
          var tsp = spot(W + 5, 260, 330); if (!tsp) continue;
          var hgt2 = 9 + rand() * 9, gi2 = Math.floor(rand() * rings.length);
          for (var ti = 0; ti < 3; ti++) { var w2 = (3.2 - ti * 0.8) * (hgt2 / 13), yy = hgt2 * (0.3 + ti * 0.22); tiers[ti].push({ x: tsp[0], y: yy, z: tsp[1], sx: w2, sy: hgt2 * 0.4, sz: w2 }); rings[gi2].push({ x: tsp[0], y: yy - hgt2 * 0.2, z: tsp[1], rx: Math.PI / 2, sx: w2 * 0.98, sy: w2 * 0.98, sz: 1 }); }
        }
        var darkM = new THREE.MeshBasicMaterial({ color: T.trees.dark });
        tiers.forEach(function (lst) { many(new THREE.ConeGeometry(1, 1, 8), darkM, lst); });
        rings.forEach(function (lst, k3) { many(new THREE.TorusGeometry(1, 0.09, 4, 16), CAB.glow(T.trees.glow[k3], 3), lst); });
      }
      if (T.fireflies) {
        var ff = [], fbase = []; for (var fi = 0; fi < 500; fi++) { var fs = spot(W + 2, 120, 300); if (!fs) continue; var fy = 1 + rand() * 8; ff.push(fs[0], fy, fs[1]); fbase.push(fs[0], fy, fs[1]); }
        var fgeo = new THREE.BufferGeometry(); fgeo.setAttribute('position', new THREE.Float32BufferAttribute(ff, 3));
        var fM = new THREE.PointsMaterial({ color: T.fireflies, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9 }); s.add(new THREE.Points(fgeo, fM));
        anim.push(function (tt) { var a2 = fgeo.attributes.position.array; for (var k4 = 0; k4 < a2.length; k4 += 3) { var ph = k4 * 0.37; a2[k4] = fbase[k4] + Math.sin(tt * 0.7 + ph) * 1.5; a2[k4 + 1] = fbase[k4 + 1] + Math.sin(tt * 1.1 + ph * 1.3) * 0.8; } fgeo.attributes.position.needsUpdate = true; fM.opacity = 0.6 + Math.sin(tt * 4) * 0.3; });
      }
      // a city: lit windows and neon signs
      if (T.city) {
        var winTex = CAB.canvasTex(64, 128, function (x, w, h) { x.fillStyle = '#07061a'; x.fillRect(0, 0, w, h); for (var yy = 4; yy < h - 4; yy += 8) for (var xx = 4; xx < w - 4; xx += 8) { if (Math.random() < 0.45) { x.fillStyle = ['#ffd27a', '#7af0ff', '#ff7ae0', '#fff2c4'][Math.floor(Math.random() * 4)]; x.fillRect(xx, yy, 4, 5); } } });
        winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping; winTex.repeat.set(2, 5);
        var bm = new THREE.MeshStandardMaterial({ color: 0x0b0a1e, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.5, roughness: 0.6 });
        for (var bq = 0; bq < 170; bq++) {
          var bx = -320 + rand() * 720, bz = -200 + rand() * 520;
          if (nearTrack(bx, bz) < W + 12) continue;
          var bw = 8 + rand() * 14, bh = 14 + rand() * 60, bd = 8 + rand() * 14;
          var bld = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bm); bld.position.set(bx, bh / 2, bz); s.add(bld);
          if (rand() < 0.25) { var sign = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.8, 1.2, 0.3), CAB.glow(rand() > 0.5 ? 0xff2ec4 : 0x00e5ff, 2.4)); sign.position.set(bx, bh + 1.2, bz + bd / 2); s.add(sign); }
        }
      }
      if (T.lamps) {
        for (var sl = 0; sl < N; sl += 25) {
          var lp = cp[sl], lt = cp[(sl + 1) % N].clone().sub(lp).normalize(), side = sl % 50 ? 1 : -1, ln = new V3(-lt.z, 0, lt.x).multiplyScalar(side * (W + 2.5));
          var lpole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 8), CAB.mat(0x30324a)); lpole.position.set(lp.x + ln.x, 3.5, lp.z + ln.z); s.add(lpole);
          var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10), CAB.glow(0xfff0c8, 3)); lamp.position.set(lp.x + ln.x * 0.85, 7.1, lp.z + ln.z * 0.85); s.add(lamp);
        }
      }
      for (var lp2 = 0; lp2 < N; lp2 += 40) { var cpp = cp[lp2]; var post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), CAB.glow(lp2 === 0 ? 0xffd23f : T.curbs[0], 1.6)); var t2 = cp[(lp2 + 1) % N].clone().sub(cpp).normalize(); post.position.copy(cpp).addScaledVector(new V3(-t2.z, 0, t2.x), W + 3); post.position.y = 3; s.add(post); }
      var arch = new THREE.Mesh(CAB.rbox(2 * W + 6, 1.2, 1, 0.3), CAB.glow(0xffd23f, 1.8)); var t0 = cp[1].clone().sub(cp[0]); arch.position.copy(cp[0]); arch.position.y = 7.5; arch.rotation.y = Math.atan2(t0.x, t0.z) + Math.PI / 2; s.add(arch);
      this.signs(s, cp, N, W, T);
      var pads = T.pads ? this.speedPads(s, cp, N, W, anim) : [];
      // the car: smooth white body with a stripe, glowing lights, chrome wheels
      var car = new THREE.Group();
      var body = new THREE.Mesh(CAB.rbox(2.1, 0.62, 4.3, 0.26), CAB.shiny(0xf4f0ff, { roughness: 0.2 })); body.position.y = 0.66; car.add(body);
      var nose = new THREE.Mesh(CAB.rbox(1.9, 0.3, 1.2, 0.14), CAB.shiny(0xf4f0ff, { roughness: 0.2 })); nose.position.set(0, 0.5, 1.9); car.add(nose);
      var cab = new THREE.Mesh(CAB.rbox(1.6, 0.58, 2.0, 0.26), CAB.shiny(0x14062a, { roughness: 0.05, metalness: 0.5 })); cab.position.set(0, 1.22, -0.25); car.add(cab);
      var stripe = new THREE.Mesh(CAB.rbox(0.55, 0.64, 4.34, 0.2), CAB.shiny(T.curbs[1])); stripe.position.y = 0.67; car.add(stripe);
      var wing = new THREE.Mesh(CAB.rbox(2.1, 0.08, 0.5, 0.04), CAB.shiny(0x14062a)); wing.position.set(0, 1.25, -2.0); car.add(wing);
      [-0.8, 0.8].forEach(function (x) { var st2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.2), CAB.chrome()); st2.position.set(x, 1.05, -2.0); car.add(st2); });
      var tails = [];
      [-0.7, 0.7].forEach(function (x) { var tm = CAB.glow(0xff2040, 3), tl = new THREE.Mesh(CAB.rbox(0.5, 0.18, 0.06, 0.03), tm); tl.position.set(x, 0.78, -2.16); car.add(tl); tails.push(tm); var hl = new THREE.Mesh(CAB.rbox(0.45, 0.14, 0.06, 0.03), CAB.glow(0xfff6dd, 2.5)); hl.position.set(x, 0.6, 2.5); car.add(hl); });
      var wg = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 28), wm = CAB.mat(0x111116, { roughness: 0.7 }), hm = CAB.chrome();
      [[-1.02, 1.35], [1.02, 1.35], [-1.02, -1.35], [1.02, -1.35]].forEach(function (w) { var wh = new THREE.Mesh(wg, wm); wh.rotation.z = Math.PI / 2; wh.position.set(w[0], 0.46, w[1]); car.add(wh); var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.44, 16), hm); hub.rotation.z = Math.PI / 2; hub.position.copy(wh.position); car.add(hub); });
      // neon underglow: bright under the car and fading out to nothing, so it reads as light on the road, not a sheet
      var soft = CAB.canvasTex(128, 256, function (x, w, h) {
        x.save(); x.scale(1, 2); var gr = x.createRadialGradient(64, 64, 6, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gr; x.fillRect(0, 0, 128, 128); x.restore();
      });
      var glowUnder = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.0), new THREE.MeshBasicMaterial({ color: T.curbs[1], map: soft, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); glowUnder.rotation.x = -Math.PI / 2; glowUnder.position.y = 0.08; car.add(glowUnder);
      car.userData.tails = tails;
      s.add(car);
      return { scene: s, cp: cp, N: N, W: W, car: car, pads: pads, anim: anim };
    },
    // Glowing arrow boards on the outside of each turn, a little before it starts: one arrow for a bend, three for a hairpin.
    signs: function (s, cp, N, W, T) {
      var hd = cp.map(function (p, i) { var q = cp[(i + 1) % N]; return Math.atan2(q.x - p.x, q.z - p.z); });
      function turn(i) { var d = hd[(i + 55) % N] - hd[i]; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
      var tex = {}, last = -999, first = -1, col = CAB.hex(T.curbs[0]);
      function board(n, right) {
        var key = n + (right ? 'r' : 'l'); if (tex[key]) return tex[key];
        return (tex[key] = CAB.canvasTex(256, 128, function (x, w, h) {
          x.fillStyle = '#0a0414'; x.fillRect(0, 0, w, h); x.strokeStyle = col; x.lineWidth = 8; x.strokeRect(6, 6, w - 12, h - 12);
          x.fillStyle = col; x.lineJoin = 'round';
          for (var a = 0; a < n; a++) {
            var cx = w / 2 + (a - (n - 1) / 2) * 62, dir = right ? 1 : -1;
            x.beginPath(); x.moveTo(cx - 22 * dir, 28); x.lineTo(cx + 18 * dir, 64); x.lineTo(cx - 22 * dir, 100); x.lineTo(cx - 6 * dir, 100); x.lineTo(cx + 34 * dir, 64); x.lineTo(cx - 6 * dir, 28); x.closePath(); x.fill();
          }
        }));
      }
      for (var i = 0; i < N; i += 5) {
        var d = turn(i); if (Math.abs(d) < 0.55 || i - last < 110) continue;
        if (first < 0) first = i; else if (N - i + first < 110) continue;
        last = i;
        var at = (i - 22 + N) % N, p = cp[at], h = hd[at], right = d < 0, n = Math.abs(d) > 1.25 ? 3 : Math.abs(d) > 0.85 ? 2 : 1;
        var side = right ? -1 : 1, nx = -Math.cos(h) * side, nz = Math.sin(h) * side;
        var grp = new THREE.Group(); grp.position.set(p.x + nx * (W + 3.5), 0, p.z + nz * (W + 3.5)); grp.rotation.y = h + Math.PI; s.add(grp);
        var mat = new THREE.MeshBasicMaterial({ map: board(n, right), toneMapped: false }); mat.color.setScalar(1.8);
        var face = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), mat); face.position.y = 3.6; grp.add(face);
        [-2.4, 2.4].forEach(function (x) { var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8), CAB.mat(0x30324a)); leg.position.set(x, 1.1, 0.05); grp.add(leg); });
      }
    },
    // Speed pads: glowing chevron plates on the straightest parts of the track, on one half of the road, so you have to line up for them.
    speedPads: function (s, cp, N, W, anim) {
      var hd = cp.map(function (p, i) { var q = cp[(i + 1) % N]; return Math.atan2(q.x - p.x, q.z - p.z); });
      function bend(i, span) { var d = hd[(i + span) % N] - hd[i]; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); }
      var tex = CAB.canvasTex(128, 256, function (x, w, h) {
        x.fillStyle = 'rgba(255,210,63,.25)'; x.fillRect(0, 0, w, h); x.strokeStyle = '#ffd23f'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
        x.fillStyle = '#ffd23f'; for (var k = 0; k < 3; k++) { var y = 40 + k * 70; x.beginPath(); x.moveTo(16, y + 40); x.lineTo(64, y); x.lineTo(112, y + 40); x.lineTo(112, y + 62); x.lineTo(64, y + 22); x.lineTo(16, y + 62); x.closePath(); x.fill(); }
      });
      var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }); mat.color.setScalar(2);
      anim.push(function (tt) { mat.color.setScalar(1.4 + Math.sin(tt * 8) * 0.6); });
      // the three straightest stretches, spread around the lap
      var cand = []; for (var c = 40; c < N - 20; c += 4) cand.push([bend(c, 50) + bend((c - 30 + N) % N, 30), c]);
      cand.sort(function (x, y) { return x[0] - y[0]; });
      var picks = []; cand.forEach(function (x) { if (picks.length < 3 && picks.every(function (q) { var d = Math.abs(q - x[1]); return Math.min(d, N - d) > 120; })) picks.push(x[1]); });
      picks.sort(function (x, y) { return x - y; });
      var pads = [], side = 1;
      for (var pk = 0; pk < picks.length; pk++) {
        var i = picks[pk]; side = -side;
        var p = cp[i], h = hd[i], nx = Math.cos(h), nz = -Math.sin(h);
        var pad = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, 9), mat); pad.rotation.order = 'YXZ'; pad.rotation.set(-Math.PI / 2, h + Math.PI, 0);
        pad.position.set(p.x + nx * side * W * 0.5, 0.1, p.z + nz * side * W * 0.5); s.add(pad);
        pads.push({ i: i, side: side });
      }
      return pads;
    },
    nearest: function (x, z, from) {
      var best = 0, bd = 1e12, N = this.N, lo = 0, hi = N;
      if (from >= 0) { lo = from - 30; hi = from + 30; }
      for (var i = lo; i < hi; i++) { var k = (i + N) % N, p = this.cp[k], d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < bd) { bd = d; best = k; } }
      return { i: best, d: Math.sqrt(bd) };
    },
    reset: function () {
      this.useTrack(this.opt.track);
      var a = this.cp[2], b = this.cp[6];
      this.x = a.x; this.z = a.z; this.h = Math.atan2(b.x - a.x, b.z - a.z); this.v = 0; this.idx = 2; this.sv = 0; this.boostT = 0; this.lastPad = -1;
      this.lap = 0; this.time = 32; this.total = 0; this.over = false; this.result = ''; this.half = false; this.lapT = 0; this.best = 0; this.offT = 0; this.off = false; this.fall = null; this.y = 0; this.tumble = 0; this.warp = 0; this.car.scale.setScalar(1);
      this.steer(null, false);
      this.place(0, true);
    },
    audio: function (ev) {
      if (ev === 'start' || ev === 'resume') { if (!this.engine) { this.engine = S.loop('engine'); this.rumble = S.loop('rumble'); } }
      else { if (this.engine) { this.engine.stop(); this.rumble.stop(); this.engine = this.rumble = null; } }
    },
    press: function () {}, release: function () {},
    steer: function (dir, on, src) { if (on && (dir === 'left' || dir === 'right')) this.fromTouch = src === 'touch'; if (dir === null) { this.keys.left = this.keys.right = this.keys.gas = false; this.touchSteer = null; this.touchGas = false; return; } if (dir in this.keys) this.keys[dir] = on; },
    // A finger on the game: how far it has slid left or right (-1 to 1), and whether it's still down (that's the gas).
    drag: function (amount, down) { this.touchSteer = down ? amount : null; this.touchGas = down; },
    // The car and the chase camera. The camera glides toward its spot by the same amount per second on any screen.
    place: function (dt, snap) {
      var c = this.car; c.position.set(this.x, this.y || 0, this.z); c.rotation.y = this.h; c.rotation.z = this.sv * 0.06; c.rotation.x = this.tumble || 0;
      if (this.fall) { this.cam.lookAt(this.x, this.y, this.z); return; }
      var dx = Math.sin(this.h), dz = Math.cos(this.h), back = 10 + (this.boostT > 0 ? 2 : 0);
      var want = this.want || (this.want = new V3()); want.set(this.x - dx * back, 4.2, this.z - dz * back);
      if (snap) this.cam.position.copy(want); else this.cam.position.lerp(want, 1 - Math.exp(-dt * 12));
      this.cam.lookAt(this.x + dx * 8, 1.2, this.z + dz * 8);
      var tl = c.userData.tails, br = !this.gasOn() && this.v > 1 ? 6 : 3; if (tl && tl[0].emissiveIntensity !== br * 1.4) tl.forEach(function (m) { m.emissiveIntensity = br * 1.4; });
    },
    // scenery that moves (turbines, boats, fireflies) is drawn once per frame
    frame: function (dt) { this.t += dt; var t = this.t; if (this.anim) this.anim.forEach(function (f) { f(t, dt); }); },
    update: function (dt, live) {
      if (this.engine) { this.engine.set(live ? (this.gasOn() ? 1 : 0.6) : 0.5, 45 + this.v * 2.6); this.rumble.set(live && this.off ? Math.min(1, this.v / 20) : 0); }
      if (!live) { this.sv += (0 - this.sv) * Math.min(1, dt * 8); this.v = 0; this.place(dt); return; }
      if (this.fall) { this.falling(dt); return; }
      if (this.warp > 0) { this.warp = Math.max(0, this.warp - dt); this.car.scale.setScalar(1 - this.warp * 1.6); }
      // steering answers quickly: a finger on the screen is followed almost at once, and the keys ease in over a few
      // hundredths of a second, so you can correct a turn before it gets away from you
      // The keys work like turning a wheel: holding one turns it further and further (full lock in about a third of a
      // second, so a tap is a small correction), and letting go brings it back to center quickly.
      var kd = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      if (kd) this.keyWheel = CAB.clamp((this.keyWheel || 0) + kd * 3.2 * dt + (kd * (this.keyWheel || 0) < 0 ? kd * 6 * dt : 0), -1, 1);
      // after a tap on the screen the wheel straightens more slowly than after a key, so taps (slower than key taps) add up
      else this.keyWheel = (this.keyWheel || 0) * Math.max(0, 1 - (this.fromTouch ? 4.5 : 9) * dt);
      var st = this.touchSteer != null ? shape(this.touchSteer) : this.keyWheel;
      this.sv += CAB.clamp((st - this.sv) * Math.min(1, dt * 22), -TURN * dt, TURN * dt);
      var n = this.nearest(this.x, this.z, this.idx), off = this.off = n.d > this.W;
      // the gas pedal: hold it to speed up; let go and the car coasts down slowly (no brake: coasting is how you slow down)
      if (this.boostT > 0) this.boostT -= dt;
      var top = off ? OFF : this.boostT > 0 ? BOOST : TOP;
      if (this.v > top) this.v = Math.max(top, this.v - (off ? 45 : 14) * dt);
      else if (this.gasOn()) this.v = Math.min(top, this.v + (this.v < 20 ? 22 : 15) * dt);
      else this.v = Math.max(0, this.v - (4 + this.v * 0.07) * dt);
      this.h -= this.sv * 2.1 * dt * Math.min(1, this.v / 18);
      this.x += Math.sin(this.h) * this.v * dt; this.z += Math.cos(this.h) * this.v * dt;
      var N = this.N, prev = this.idx; this.idx = n.i;
      // speed pads: crossing one on its side of the road gives a burst of speed for a second and a half
      for (var pi = 0; pi < this.pads.length; pi++) {
        var pd = this.pads[pi], rel = (this.idx - pd.i + N) % N;
        if (rel <= 3 && this.lastPad !== pi) {
          var c0 = this.cp[this.idx], c1 = this.cp[(this.idx + 1) % N], tx = c1.x - c0.x, tz = c1.z - c0.z, lat = (this.x - c0.x) * tz - (this.z - c0.z) * tx;
          if (lat * pd.side > 0 && Math.abs(lat) / Math.hypot(tx, tz) < this.W * 0.95) { this.lastPad = pi; this.boostT = 1.5; this.v = Math.max(this.v, TOP + 8); S.fx.boost(); CAB.toast('BOOST!'); CAB.shake(0.15); }
        }
      }
      if (this.lastPad >= 0 && (this.idx - this.pads[this.lastPad].i + N) % N > 20) this.lastPad = -1;
      if (this.idx > N * 0.45 && this.idx < N * 0.55) this.half = true;
      this.time -= dt; this.total += dt; this.lapT += dt;
      if (this.half && prev > N * 0.85 && this.idx < N * 0.15) {
        this.lap++; this.half = false;
        if (!this.best || this.lapT < this.best) this.best = this.lapT;
        if (this.lap >= 3) { this.over = true; this.result = 'Finished in ' + this.total.toFixed(2) + 's. Best lap ' + this.best.toFixed(2) + 's.'; CAB.call('FINISH!', 'huge', this.total.toFixed(2) + ' seconds', 2.6); S.fx.fanfare(); }
        else { this.time += 24; CAB.call('LAP ' + (this.lap + 1), 'good', this.lapT.toFixed(2) + 's, +24 seconds', 1.6); S.fx.lap(); }
        this.lapT = 0;
      }
      // on Star Road there's nothing under the road: drive too far off it and you fall
      if (this.T.space && n.d > this.W + 1.1 && !this.over) { this.fall = { t: 0, vy: 0, i: n.i }; S.fx.sad(); CAB.toast('Lost in space!', true); }
      if (off) { this.offT -= dt; if (this.offT <= 0) { CAB.toast('Off the track', true); this.offT = 2; } } else this.offT = 0;
      if (this.time <= 0 && !this.over) { this.time = 0; this.over = true; this.result = 'Time\'s up on lap ' + (this.lap + 1) + '.'; CAB.call('TIME UP', '', 'Lap ' + (this.lap + 1) + ' of 3', 2.4); S.fx.sad(); }
      this.place(dt);
    },
    gasOn: function () { return this.opt.gas === 'auto' || this.keys.gas || this.touchGas; },
    // Falling off Star Road: the car tumbles away for a second, then beams back onto the road where it fell.
    // The clock keeps running the whole time.
    falling: function (dt) {
      var f = this.fall; f.t += dt; f.vy -= 26 * dt; this.y += f.vy * dt; this.tumble += dt * 2.4;
      this.v = Math.max(0, this.v - 20 * dt); this.x += Math.sin(this.h) * this.v * dt; this.z += Math.cos(this.h) * this.v * dt;
      this.time -= dt; this.total += dt; this.lapT += dt;
      if (f.t > 1.3) {
        var N = this.N, a = this.cp[f.i], b = this.cp[(f.i + 4) % N];
        this.x = a.x; this.z = a.z; this.h = Math.atan2(b.x - a.x, b.z - a.z); this.v = 0; this.sv = 0; this.y = 0; this.tumble = 0; this.idx = f.i;
        this.fall = null; this.warp = 0.6; this.car.scale.setScalar(0.04); S.fx.sparkle(); CAB.flash(0.35); CAB.toast('Beamed back to the road');
        this.place(0, true); return;
      }
      if (this.time <= 0 && !this.over) { this.time = 0; this.over = true; this.result = 'Time\'s up on lap ' + (this.lap + 1) + '.'; CAB.call('TIME UP', '', 'Lap ' + (this.lap + 1) + ' of 3', 2.4); S.fx.sad(); }
      this.place(dt);
    },
    // What goes on the board when the race ends: the finishing time in thousandths of a second (lower is better), on
    // the track's own board. A race that ran out of time doesn't go on the board.
    final: function () {
      var done = this.lap >= 3;
      return { score: done ? Math.round(this.total * 1000) : 0, board: this.opt.track, detail: done ? 'Best lap ' + this.best.toFixed(2) + 's' : '' };
    },
    hud: function () { return [['Steer', null, this.sv || 0, DEAD, 'wheel'], ['Time', Math.max(0, this.time || 0).toFixed(1)], ['Lap', Math.min(3, (this.lap || 0) + 1) + ' / 3'], ['Speed', Math.round((this.v || 0) * 3) + ' mph'], ['Best lap', this.best ? this.best.toFixed(2) : '-']]; }
  };
  CAB.games.push(g);
})();
