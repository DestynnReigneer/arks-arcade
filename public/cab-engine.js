// The shared 3D look for the cabinet games (Big Swing, Bucket Drop, the Launcher, the Train Station and the Racer):
// the renderer, the glow, reflections, and the small helpers every one of them uses. It's built on three.js 0.128,
// copied into public/vendor/three so nothing loads from outside the arcade. A game page calls CAB.attach(stage) once,
// then cab-frame.js runs the game.
(function () {
  'use strict';
  var CAB = window.CAB = window.CAB || {};
  var V3 = CAB.V3 = THREE.Vector3;
  CAB.games = [];

  // Colors are written as sRGB hex like a designer would; the pipeline works in linear light, so convert on the way in.
  var setHex = THREE.Color.prototype.setHex;
  THREE.Color.prototype.setHex = function (h) { setHex.call(this, h); return this.convertSRGBToLinear(); };

  var renderer = null, composer = null, renderPass = null, bloom = null, finalPass = null, stage = null;

  // Puts the 3D view into the stage element and sets up the glow and the final color pass.
  CAB.attach = function (el) {
    stage = el;
    renderer = CAB.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the final pass, after the glow
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.insertBefore(renderer.domElement, stage.firstChild);
    // A device with no graphics chip draws 3D in software (SwiftShader, llvmpipe), which is slow and hogs the processor.
    // There the games draw at a lower resolution, without shadows, and about 30 times a second (cab-frame.js).
    try {
      var gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
      CAB.software = /swiftshader|llvmpipe|software|basic render/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
    } catch (e) { CAB.software = false; }
    if (CAB.software) renderer.shadowMap.enabled = false;

    var pmrem = new THREE.PMREMGenerator(renderer);
    // What shiny things reflect: a dark arcade room with a soft light overhead and neon panels around it.
    CAB.env = pmrem.fromScene((function () {
      var e = new THREE.Scene();
      e.add(new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0x07040e, side: THREE.BackSide })));
      function panel(w, h, color, k, x, y, z, rx, ry) {
        var m = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }); m.color.multiplyScalar(k);
        var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.set(rx || 0, ry || 0, 0); e.add(p);
      }
      panel(8, 4, 0xffffff, 2.2, 0, 5.8, 0, Math.PI / 2);
      panel(14, 0.5, 0xff2ec4, 3.5, 0, 2, -9.8);
      panel(14, 0.5, 0x00ffc2, 3, 0, 3.5, 9.8);
      panel(0.5, 8, 0x8a5cff, 3, -9.8, 1, 0, 0, Math.PI / 2);
      panel(0.5, 8, 0xffd23f, 2, 9.8, 1, 0, 0, Math.PI / 2);
      return e;
    })(), 0.03).texture;

    var gl2 = renderer.capabilities.isWebGL2;
    var rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType };
    var rt = gl2 && THREE.WebGLMultisampleRenderTarget ? new THREE.WebGLMultisampleRenderTarget(4, 4, rtOpts) : new THREE.WebGLRenderTarget(4, 4, rtOpts);
    if (rt.samples !== undefined) rt.samples = 4;
    composer = new THREE.EffectComposer(renderer, rt);
    renderPass = new THREE.RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(renderPass);
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 1.5);
    composer.addPass(bloom);
    // The last pass: tone mapping, a white flash, a color tint (the blacklight), and a soft dark edge.
    finalPass = new THREE.ShaderPass({
      uniforms: { tDiffuse: { value: null }, exposure: { value: 1.0 }, flash: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform float exposure; uniform float flash; uniform vec3 tint; varying vec2 vUv;',
        'vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }',
        'void main(){',
        '  vec3 c = aces(texture2D(tDiffuse, vUv).rgb * exposure * tint + flash);',
        '  c = mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));',
        '  vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q)*0.55;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
      ].join('\n')
    });
    composer.addPass(finalPass);
  };

  CAB.size = function (cams) {
    var w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    var pr = CAB.software ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    bloom.strength = 0.8;
    (cams || []).forEach(function (c) { if (c) { c.aspect = w / h; c.updateProjectionMatrix(); } });
  };

  // Camera shake and a white flash, both decaying on their own.
  var shakeAmt = 0, shakeOff = new V3();
  CAB.shake = function (a) { shakeAmt = Math.max(shakeAmt, a); };
  CAB.flash = function (a) { finalPass.uniforms.flash.value = Math.max(finalPass.uniforms.flash.value, a); };
  CAB.tint = function (r, g, b) { finalPass.uniforms.tint.value.set(r, g, b); };
  CAB.render = function (scene, cam, dt) {
    renderPass.scene = scene; renderPass.camera = cam;
    if (shakeAmt > 0.001) { shakeOff.set((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, 0); cam.position.add(shakeOff); }
    composer.render();
    if (shakeAmt > 0.001) cam.position.sub(shakeOff);
    shakeAmt *= Math.pow(0.02, dt || 0.016);
    var f = finalPass.uniforms.flash; f.value = Math.max(0, f.value - (dt || 0.016) * 3);
  };

  // ---------- materials and shapes ----------
  CAB.mat = function (color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.45, metalness: 0.1, envMap: CAB.env, envMapIntensity: 0.6 }, extra || {}));
  };
  // Shiny candy plastic with a clear coat: the "toy you want to touch" look.
  CAB.shiny = function (color, extra) {
    return new THREE.MeshPhysicalMaterial(Object.assign({ color: color, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, envMap: CAB.env, envMapIntensity: 1.0 }, extra || {}));
  };
  CAB.chrome = function (color) { return new THREE.MeshStandardMaterial({ color: color || 0xe8ecf4, roughness: 0.12, metalness: 1, envMap: CAB.env, envMapIntensity: 1.4 }); };
  CAB.glass = function (color, op) {
    return new THREE.MeshPhysicalMaterial({ color: color || 0xdff6ff, roughness: 0.04, metalness: 0, clearcoat: 1, transparent: true, opacity: op == null ? 0.22 : op, envMap: CAB.env, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false });
  };
  // Glowing: k above 1 blooms.
  CAB.glow = function (color, k) { return new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: (k == null ? 1.6 : k) * 1.4, roughness: 0.4, envMap: CAB.env, envMapIntensity: 0.4 }); };
  CAB.basic = function (color, extra) { return new THREE.MeshBasicMaterial(Object.assign({ color: color }, extra || {})); };
  CAB.rbox = function (w, h, d, r, seg) { return new THREE.RoundedBoxGeometry(w, h, d, seg || 4, r == null ? Math.min(w, h, d) * 0.18 : r); };

  CAB.scene = function (o) {
    o = o || {};
    var s = new THREE.Scene();
    s.background = new THREE.Color(o.bg == null ? 0x120724 : o.bg);
    if (o.fog !== false) s.fog = new THREE.Fog(o.bg == null ? 0x120724 : o.bg, o.near || 30, o.far || 90);
    var hemi = new THREE.HemisphereLight(0xd9c8ff, 0x1a0b30, o.hemi == null ? 0.25 : o.hemi); s.add(hemi);
    var key = new THREE.DirectionalLight(0xfff2e6, o.key == null ? 1.3 : o.key); key.position.set(5, 16, 9);
    if (o.span) {
      key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      var c = key.shadow.camera; c.left = -o.span; c.right = o.span; c.top = o.span; c.bottom = -o.span; c.near = 1; c.far = 70;
      key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    }
    s.add(key); s.userData.key = key; s.userData.hemi = hemi;
    var pink = new THREE.PointLight(0xff2ec4, 1.1, 45); pink.position.set(-9, 6, 5); s.add(pink);
    var teal = new THREE.PointLight(0x00ffc2, 0.8, 45); teal.position.set(9, 5, -4); s.add(teal);
    s.userData.rims = [pink, teal];
    return s;
  };
  CAB.shade = function (scene) { scene.traverse(function (o) { if (o.isMesh && !o.userData.noShadow && !(o.material && o.material.transparent)) { o.castShadow = true; o.receiveShadow = true; } }); };

  // A dark arcade room around the game: a glossy floor, a back wall with neon strips, and soft out-of-focus lights.
  CAB.room = function (s, o) {
    o = o || {};
    var y = o.y == null ? -1 : o.y, z = o.z == null ? -16 : o.z, w = o.w || 60;
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(w, 60), CAB.mat(o.floor || 0x120822, { roughness: 0.42, metalness: 0.2, envMapIntensity: 0.08 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = y; floor.receiveShadow = true; floor.userData.noShadow = true; s.add(floor);
    var wall = new THREE.Mesh(new THREE.PlaneGeometry(w, 24), CAB.mat(0x0d0620, { roughness: 0.9 })); wall.position.set(0, y + 12, z); wall.userData.noShadow = true; s.add(wall);
    var cols = o.colors || [0xff2ec4, 0x00ffc2, 0x8a5cff, 0xffd23f];
    for (var i = 0; i < 5; i++) {
      var strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.08, 0.08), CAB.glow(cols[i % cols.length], 2.2));
      strip.position.set(0, y + 2.5 + i * 2.6, z + 0.1); strip.userData.noShadow = true; s.add(strip);
    }
    // bokeh dots: soft round sprites far back
    var tex = CAB.dotTexture();
    for (var k = 0; k < 40; k++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: cols[k % cols.length], transparent: true, opacity: 0.35 + Math.random() * 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      var sc = 0.8 + Math.random() * 2.2; sp.scale.set(sc, sc, 1);
      sp.position.set((Math.random() - 0.5) * w * 0.9, y + 1 + Math.random() * 14, z + 0.5 + Math.random() * 2);
      s.add(sp);
    }
    return floor;
  };
  var dotTex = null;
  CAB.dotTexture = function () {
    if (dotTex) return dotTex;
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    dotTex = new THREE.CanvasTexture(c); dotTex.encoding = THREE.sRGBEncoding; return dotTex;
  };

  // Marquee bulbs that chase around a path; call .update(t) each frame.
  CAB.bulbs = function (parent, points, colors, size) {
    var geo = new THREE.SphereGeometry(size || 0.09, 12, 8), list = [];
    points.forEach(function (p, i) {
      var m = CAB.glow(colors[i % colors.length], 0.4); var b = new THREE.Mesh(geo, m); b.position.copy(p); b.userData.noShadow = true; parent.add(b); list.push(m);
    });
    return {
      mode: 'chase', boost: 0,
      update: function (t) {
        var self = this; this.boost = Math.max(0, this.boost - Math.max(0, Math.min(0.1, t - (this.lt || t)))); this.lt = t;
        list.forEach(function (m, i) {
          var on = self.mode === 'flash' ? (Math.floor(t * 8) % 2 === 0) : ((Math.floor(t * 9) + i) % 3 === 0);
          m.emissiveIntensity = (on ? 3.6 : 0.4) + self.boost * 2.5;
        });
      }
    };
  };

  // Text on a canvas, as a sprite that always faces the camera. .set(text, color, bg) redraws it.
  CAB.label = function (text, color, h, bg, wide) {
    var W = wide ? 1024 : 512, c = document.createElement('canvas'); c.width = W; c.height = 256;
    var tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    var hh = h || 0.8; sp.scale.set(hh * W / 256, hh, 1); sp.renderOrder = 5;
    sp.set = function (t, col, b) {
      var x = c.getContext('2d'); x.clearRect(0, 0, W, 256); t = String(t);
      if (b) { x.fillStyle = b; x.beginPath(); if (x.roundRect) x.roundRect(10, 20, W - 20, 216, 40); else x.rect(10, 20, W - 20, 216); x.fill(); }
      var size = 150; x.font = '800 ' + size + 'px Orbitron, Segoe UI, sans-serif';
      while (x.measureText(t).width > W - 70 && size > 40) { size -= 6; x.font = '800 ' + size + 'px Orbitron, Segoe UI, sans-serif'; }
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineJoin = 'round'; x.lineWidth = 18; x.strokeStyle = 'rgba(10,4,22,.95)'; x.strokeText(t, W / 2, 134);
      x.fillStyle = col || '#ffffff'; x.fillText(t, W / 2, 134);
      tex.needsUpdate = true;
    };
    sp.set(text, color, bg);
    return sp;
  };

  // A canvas drawn by a function, used as a texture (scoreboards, name plates, faces).
  CAB.canvasTex = function (w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    tex.redraw = function () { var x = c.getContext('2d'); draw(x, w, h); tex.needsUpdate = true; };
    tex.redraw(); return tex;
  };

  CAB.ball = function (color, r, extra) { return new THREE.Mesh(new THREE.SphereGeometry(r || 0.18, 32, 24), CAB.shiny(color || 0xffffff, Object.assign({ roughness: 0.18 }, extra || {}))); };

  // Sparks and confetti: a pool of small glowing bits with gravity.
  CAB.sparks = function (scene, max) {
    max = max || 400;
    var geo = new THREE.BufferGeometry(), pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, map: CAB.dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; scene.add(pts);
    var P = []; for (var i = 0; i < max; i++) P.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, grav: 9 });
    var tmp = new THREE.Color();
    return {
      burst: function (at, colors, n, speed, grav) {
        for (var k = 0; k < n; k++) {
          var p = null; for (var j = 0; j < max; j++) if (P[j].life <= 0) { p = P[j]; break; } if (!p) return;
          var th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = (speed || 5) * (0.4 + Math.random() * 0.8);
          p.x = at.x; p.y = at.y; p.z = at.z; p.vx = Math.sin(ph) * Math.cos(th) * sp; p.vy = Math.abs(Math.cos(ph)) * sp * 0.9 + sp * 0.3; p.vz = Math.sin(ph) * Math.sin(th) * sp;
          p.life = 0.9 + Math.random() * 0.9; p.grav = grav == null ? 9 : grav;
          tmp.setHex(colors[k % colors.length]); p.r = tmp.r * 3; p.g = tmp.g * 3; p.b = tmp.b * 3;
        }
      },
      clear: function () { P.forEach(function (p) { p.life = 0; }); },
      update: function (dt) {
        for (var i = 0; i < max; i++) {
          var p = P[i];
          if (p.life > 0) { p.life -= dt; p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
          var k = p.life > 0 ? Math.min(1, p.life * 1.5) : 0;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.life > 0 ? p.y : -999; pos[i * 3 + 2] = p.z;
          col[i * 3] = p.r * k; col[i * 3 + 1] = p.g * k; col[i * 3 + 2] = p.b * k;
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      }
    };
  };

  // "+15" style numbers that float up and fade. The labels are made once and reused, so a pop never stalls a frame.
  CAB.popper = function (scene) {
    var pool = [];
    for (var i = 0; i < 8; i++) { var l = CAB.label(' ', '#ffd23f', 0.7); l.visible = false; scene.add(l); pool.push({ l: l, t: 9 }); }
    return {
      pop: function (at, text, color, h) {
        var p = pool.reduce(function (a, b) { return b.t > a.t ? b : a; });
        p.l.set(text, color || '#ffd23f'); var hh = h || 0.7; p.l.scale.set(hh * 2, hh, 1); p.l.position.copy(at); p.l.visible = true; p.t = 0;
      },
      update: function (dt) {
        pool.forEach(function (p) {
          if (p.t > 1.3) return; p.t += dt; p.l.position.y += dt * 1.4; p.l.material.opacity = Math.max(0, 1 - p.t / 1.3);
          if (p.t > 1.3) p.l.visible = false;
        });
      },
      clear: function () { pool.forEach(function (p) { p.t = 9; p.l.visible = false; }); }
    };
  };

  // Build every shader before play starts, so the first hit or explosion doesn't freeze a frame.
  CAB.warm = function (scene, cam) { try { renderer.compile(scene, cam); } catch (e) { /* not ready yet */ } };

  CAB.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  CAB.hex = function (n) { return '#' + n.toString(16).padStart(6, '0'); };
  CAB.shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  CAB.pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
})();
