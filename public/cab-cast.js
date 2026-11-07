// The cast for the 3D cabinet games (ARKS Train Station so far): characters who hang around a game, wander between
// spots, talk, and drop in for cameos. Give it the scene, the spots characters may stand on, and who is in the cast.
(function () {
  'use strict';
  var CAB = window.CAB, V3 = CAB.V3, S = CAB.sound;

  // ---------- the characters' bodies ----------
  function robotFace(color, kind) {
    var mood = { eyes: 'open', mouth: 0 };
    var tex = CAB.canvasTex(256, 160, function (x, w, h) {
      x.fillStyle = '#05030c'; x.fillRect(0, 0, w, h); x.fillStyle = CAB.hex(color); x.strokeStyle = CAB.hex(color); x.shadowColor = CAB.hex(color); x.shadowBlur = 18;
      if (kind === 'visor') {
        // one wide, smug eye slit that narrows when it blinks
        var hh = mood.eyes === 'closed' ? 6 : mood.eyes === 'happy' ? 12 : 26; x.fillRect(40, 60 - hh / 2, 176, hh);
        x.fillRect(80, 118 - mood.mouth * 6, 96, 5 + mood.mouth * 12);
        return;
      }
      if (mood.eyes === 'happy') { x.lineWidth = 12; [80, 176].forEach(function (ex) { x.beginPath(); x.arc(ex, 70, 22, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); }); }
      else if (mood.eyes === 'closed') { x.fillRect(58, 64, 44, 8); x.fillRect(154, 64, 44, 8); }
      else { x.beginPath(); x.arc(80, 64, 20, 0, 7); x.arc(176, 64, 20, 0, 7); x.fill(); }
      x.fillRect(98, 112 - mood.mouth * 8, 60, 6 + mood.mouth * 16);
    });
    return { tex: tex, mood: mood };
  }
  var BODIES = {
    // the round white station robots
    robot: function (o) {
      var grp = new THREE.Group(), bodyM = CAB.shiny(o.body || 0xe8e4f4, { roughness: 0.2 });
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.3, 32), bodyM); body.position.y = 1.0; grp.add(body);
      var belly = new THREE.Mesh(new THREE.SphereGeometry(0.65, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bodyM); belly.position.y = 0.35; grp.add(belly);
      var band = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.05, 10, 40), CAB.glow(o.color, 1.8)); band.rotation.x = Math.PI / 2; band.position.y = 1.35; grp.add(band);
      var head = new THREE.Group(); head.position.y = 2.15; grp.add(head);
      head.add(new THREE.Mesh(CAB.rbox(1.2, 0.85, 0.9, 0.3), bodyM));
      var f = robotFace(o.color), screen = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), new THREE.MeshBasicMaterial({ map: f.tex })); screen.material.color.setScalar(1.6); screen.position.z = 0.46; head.add(screen);
      var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), CAB.chrome()); ant.position.y = 0.62; head.add(ant);
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), CAB.glow(o.color, 2.5)); tip.position.y = 0.88; head.add(tip);
      var arms = [-1, 1].map(function (sd) { var arm = new THREE.Group(); arm.position.set(sd * 0.68, 1.45, 0); grp.add(arm); var a = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.8, 12), bodyM); a.position.y = -0.38; arm.add(a); var hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), CAB.glow(o.color, 1)); hand.position.y = -0.82; arm.add(hand); arm.rotation.z = sd * 0.15; return arm; });
      return { g: grp, head: head, face: f, arms: arms, top: 3.1 };
    },
    // a tall, dented chrome robot with one smug visor: the show-off
    showoff: function (o) {
      var grp = new THREE.Group(), metal = CAB.mat(0x9aa0b4, { roughness: 0.25, metalness: 0.9, envMapIntensity: 1.3 }), dark = CAB.mat(0x2a2c38, { roughness: 0.5, metalness: 0.6 });
      var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 1.5, 24), metal); torso.position.y = 1.55; grp.add(torso);
      var hatch = new THREE.Mesh(CAB.rbox(0.7, 0.55, 0.1, 0.06), dark); hatch.position.set(0, 1.5, 0.66); grp.add(hatch);
      [-0.28, 0.28].forEach(function (x) { var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.85, 12), metal); leg.position.set(x, 0.42, 0); grp.add(leg); var foot = new THREE.Mesh(CAB.rbox(0.3, 0.14, 0.45, 0.05), dark); foot.position.set(x, 0.07, 0.08); grp.add(foot); });
      var head = new THREE.Group(); head.position.y = 2.75; grp.add(head);
      var dome = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 24), metal); head.add(dome);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal); cap.position.y = 0.47; head.add(cap);
      var f = robotFace(o.color, 'visor'), screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.38), new THREE.MeshBasicMaterial({ map: f.tex })); screen.material.color.setScalar(1.7); screen.position.set(0, 0.05, 0.43); head.add(screen);
      var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8), CAB.chrome()); ant.position.y = 0.95; head.add(ant);
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), CAB.glow(o.color, 2.5)); tip.position.y = 1.15; head.add(tip);
      var arms = [-1, 1].map(function (sd) { var arm = new THREE.Group(); arm.position.set(sd * 0.75, 2.1, 0); grp.add(arm); var a = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 10), metal); a.position.y = -0.55; arm.add(a); var hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), dark); hand.position.y = -1.12; arm.add(hand); arm.rotation.z = sd * 0.12; return arm; });
      return { g: grp, head: head, face: f, arms: arms, top: 4.1 };
    },
    // a raccoon in a striped tail, always looking for snacks
    raccoon: function (o) {
      var grp = new THREE.Group(), fur = CAB.mat(0x6a6478, { roughness: 0.9 }), pale = CAB.mat(0xd8d2e4, { roughness: 0.9 }), black = CAB.mat(0x14121a, { roughness: 0.8 });
      var body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), fur); body.scale.set(1, 1.05, 1.2); body.position.y = 0.62; grp.add(body);
      var bellyM = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 12), pale); bellyM.position.set(0, 0.55, 0.38); bellyM.scale.set(1, 1, 0.6); grp.add(bellyM);
      var head = new THREE.Group(); head.position.set(0, 1.35, 0.15); grp.add(head);
      var skull = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), fur); skull.scale.set(1.15, 0.95, 1); head.add(skull);
      var mask = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 8, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.2), black); mask.scale.set(1.16, 0.96, 1.01); head.add(mask);
      var snout = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 16), pale); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.1, 0.5); head.add(snout);
      var nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), black); nose.position.set(0, -0.1, 0.7); head.add(nose);
      [-1, 1].forEach(function (sd) { var ear = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 12), fur); ear.position.set(sd * 0.3, 0.42, 0); ear.rotation.z = -sd * 0.3; head.add(ear); var eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), CAB.glow(o.color, 2.2)); eye.position.set(sd * 0.18, 0.05, 0.41); head.add(eye); });
      var tail = new THREE.Group(); tail.position.set(0, 0.5, -0.6); tail.rotation.x = -0.9; grp.add(tail);
      for (var i = 0; i < 6; i++) { var seg = new THREE.Mesh(new THREE.CylinderGeometry(0.17 - i * 0.012, 0.19 - i * 0.012, 0.22, 14), i % 2 ? black : fur); seg.position.y = -i * 0.21; tail.add(seg); }
      var arms = [-1, 1].map(function (sd) { var arm = new THREE.Group(); arm.position.set(sd * 0.48, 0.95, 0.2); grp.add(arm); var a = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.45, 10), fur); a.position.y = -0.2; arm.add(a); arm.rotation.z = sd * 0.3; return arm; });
      return { g: grp, head: head, arms: arms, tail: tail, top: 2.1 };
    },
    // a little ghost who floats instead of walking
    ghost: function (o) {
      var grp = new THREE.Group(), sheet = new THREE.MeshStandardMaterial({ color: 0xf4f0ff, emissive: o.color, emissiveIntensity: 0.25, roughness: 0.4, transparent: true, opacity: 0.85, envMap: CAB.env, envMapIntensity: 0.6 });
      var inner = new THREE.Group(); grp.add(inner);
      var top = new THREE.Mesh(new THREE.SphereGeometry(0.6, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), sheet); top.position.y = 1.7; inner.add(top);
      var skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1.0, 28, 1, true), sheet); skirt.position.y = 1.2; inner.add(skirt);
      for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2, drip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), sheet); drip.position.set(Math.sin(a) * 0.58, 0.7, Math.cos(a) * 0.58); inner.add(drip); }
      var head = new THREE.Group(); head.position.y = 1.75; inner.add(head);
      [-1, 1].forEach(function (sd) { var eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), CAB.mat(0x0a0614)); eye.scale.set(1, 1.5, 0.5); eye.position.set(sd * 0.2, 0.05, 0.55); head.add(eye); });
      var mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), CAB.mat(0x0a0614)); mouth.scale.set(1, 1.3, 0.5); mouth.position.set(0, -0.22, 0.56); head.add(mouth);
      var arms = [-1, 1].map(function (sd) { var arm = new THREE.Group(); arm.position.set(sd * 0.62, 1.35, 0); inner.add(arm); var nub = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), sheet); nub.scale.set(0.8, 1.3, 0.8); nub.position.y = -0.1; arm.add(nub); return arm; });
      var light = new THREE.PointLight(o.color, 0.6, 5); light.position.y = 1.4; inner.add(light);
      return { g: grp, head: head, arms: arms, inner: inner, mouth: mouth, float: true, top: 2.5 };
    }
  };

  // What anyone in the cast says when the train flattens them, when they laugh at someone it flattened,
  // when they come back as a balloon or a ghost, and when a stray ball knocks them over.
  var SPLAT = ["Ow. I can taste my own feet.", "I'm fine. I'm two-dimensional now, but I'm fine.", "Note to self: the train does not brake for celebrities.", "Mmmph. Mmmph mmph. That means OW.", "Who put a train on the train tracks?!"];
  var MOCK = ["Look at you! Finally got that flat stomach you wanted.", "I'd help, but this is the most interesting you've ever been.", "Ten out of ten. The train didn't even slow down.", "Somebody slide them under a door, they'll be fine.", "Hold still, I'm taking a picture. This is going on the wall.", "You're so flat I could mail you home."];
  var BALLOON = ["Hang on, I just gotta blow myself back up.", "Okay, okay, that's enough air. THAT'S ENOUGH AIR.", "I feel so light. Physically. Emotionally I'm still mad."];
  var GHOST = ["BOOOO! Still laughing?", "I'm back, and I'm haunting you specifically.", "Wooo! That's what you get for laughing!"];
  var SCARED = ["AAAH! Okay, I deserved that.", "Not cool! NOT COOL!", "I did not scream. That was the train."];
  var KNOCK = ["Ow! Who's throwing balls at the staff?", "Right in the circuits!", "I'm filing that under assault.", "Nice aim. Wrong target."];

  // ---------- the cast ----------
  // o: { scene, spots: [V3...] (where people stand), offstage: [V3...] (where they come in from), look: V3 (what they watch),
  //      scale, regulars: [def...], cameos: [def...], idle: [lines], onEvent,
  //      track: { on(pos), carAt(pos), clear(pos), coming(pos, near, far), near(pos, onRails) } when the game has a train }
  // A def: { name, body, color, idle: [lines], hit, miss, hard, arrive, leave, roast: { NAME: [[line, reply]...] }, from: 'side'|'sky'|'fade' }
  CAB.cast = function (o) {
    var scene = o.scene, people = [], sc = o.scale || 1, lastSpeaker = null;
    var cast = { people: people, chatT: 4, cameoT: 18 + Math.random() * 10, queue: [], splatCool: 20 }, T = o.track;

    function make(def, regular) {
      var b = BODIES[def.body || 'robot'](def); b.g.scale.setScalar(sc * (def.scale || 1)); scene.add(b.g);
      b.g.traverse(function (m) { if (m.isMesh) { m.castShadow = true; } });
      var p = { def: def, name: def.name, regular: regular, b: b, g: b.g, base: sc * (def.scale || 1), at: null, from: new V3(), to: new V3(), walkT: 0, walkD: 0, talk: 0, wave: 0, ph: Math.random() * 6, stay: 0, state: 'off', blink: 0, fade: 1 };
      b.g.visible = false; people.push(p); return p;
    }
    var regs = (o.regulars || []).map(function (d) { return make(d, true); });
    var cams = (o.cameos || []).map(function (d) { return make(d, false); });

    function taken(spot) { return people.some(function (p) { return p.state !== 'off' && p.at === spot; }); }
    function freeSpot(avoid) { var list = o.spots.filter(function (s) { return !taken(s) && s !== avoid && (!s.roofOnly); }); return list.length ? CAB.pick(list) : null; }
    function anySpot() { var list = o.spots.filter(function (s) { return !taken(s); }); return list.length ? CAB.pick(list) : null; }
    // walk (or hop, or float) from where they are to a spot; hops arc up when the height changes
    function go(p, spot, then) {
      p.from.copy(p.g.position); p.to.copy(spot); p.at = spot; p.walkT = 0; p.then = then || null;
      p.walkD = Math.max(0.4, p.from.distanceTo(p.to) / (p.def.body === 'raccoon' ? 4.2 : 2.4)); p.state = 'walk';
      // now and then someone doesn't look both ways before crossing the tracks
      p.reckless = !!T && !p.def.float && cast.splatCool <= 0 && Math.random() < 0.5;
    }
    function enter(p) {
      var spot = p.regular ? freeSpot() : anySpot(); if (!spot) return false;
      var how = p.def.from || 'side', start = new V3();
      if (how === 'sky') start.set(spot.x, spot.y + 12, spot.z);
      else if (how === 'fade') start.copy(spot).add(new V3(0, 0.6, 0));
      else start.copy(CAB.pick(o.offstage));
      p.g.position.copy(start); p.g.visible = true; p.fade = how === 'fade' ? 0 : 1; setOpacity(p, p.fade);
      p.how = how; go(p, spot, function () {
        if (how === 'sky') { S.fx.land(6); CAB.shake(0.25); }
        if (!p.regular) { p.stay = 11 + Math.random() * 5; if (p.def.arrive) say(p, CAB.pick(p.def.arrive), 3.6); setTimeout(function () { if (p.state === 'here') roast(p); }, 4200); }
      });
      return true;
    }
    function leave(p) {
      if (p.def.leave) say(p, CAB.pick(p.def.leave), 3);
      // everyone walks off (a ghost just fades away), even the ones who dropped in from the sky
      var out = p.how === 'fade' ? p.g.position.clone() : CAB.pick(o.offstage).clone();
      setTimeout(function () {
        if (p.state !== 'here') return;
        if (p.how === 'sky') p.how = 'side';
        p.leaving = true; p.leaveOut = out; p.leaveThen = function () { p.state = 'off'; p.g.visible = false; p.at = null; p.leaving = false; };
        go(p, out, p.leaveThen); p.at = null;
      }, 1600);
    }
    function setOpacity(p, k) { p.g.traverse(function (m) { if (m.isMesh && m.material) { if (m.material.userData.op == null) m.material.userData.op = m.material.transparent ? m.material.opacity : 1; m.material.transparent = k < 1 || m.material.userData.op < 1; m.material.opacity = m.material.userData.op * k; } }); }
    // one character takes a shot at someone else who's here, and that one fires back
    function roast(p) {
      var targets = people.filter(function (q) { return q !== p && q.state === 'here' && p.def.roast && p.def.roast[q.name]; });
      if (!targets.length) { if (p.def.idle) say(p, CAB.pick(p.def.idle)); return; }
      var q = CAB.pick(targets), pair = CAB.pick(p.def.roast[q.name]);
      say(p, pair[0], 3.8); setTimeout(function () { if (q.state === 'here') say(q, pair[1], 3.6); }, 3000);
    }
    function say(p, line, secs) {
      if (!line || p.state === 'off') return;
      CAB.say(p.name, function () { return p.g.localToWorld(new V3(0, p.b.top + 0.2, 0)); }, p.name, line, secs || 4.2);
      p.talk = Math.min(3.5, 1 + line.length * 0.04); S.fx.chirp(); lastSpeaker = p; cast.chatT = 8 + Math.random() * 6;
    }
    function here() { return people.filter(function (p) { return p.state === 'here'; }); }
    // say() skips anyone who isn't standing around, so the flattened and the knocked-over speak through this
    function blurt(p, line, secs) { var st = p.state; p.state = 'here'; say(p, line, secs); p.state = st; }

    // ---------- run over by the train ----------
    function splat(p) {
      p.state = 'flat'; p.fx = 'squash'; p.fxT = 0; p.saidSplat = p.mocked = p.booed = false; p.talk = 0;
      p.flatAt = p.g.position.clone(); p.flatAt.y = 0; p.g.rotation.x = 0; p.offRails = T.near(p.flatAt, false);
      // someone flattened while laughing at a flattened friend doesn't bring a third one onto the rails
      p.chain = !!p.onRailsMocker; p.onRailsMocker = false;
      S.fx.splat(); CAB.shake(0.18); cast.splatCool = 35 + Math.random() * 25;
    }
    // someone who's standing around wanders over to laugh. Sometimes they stand right on the rails to do it.
    function callMocker(v) {
      var list = here().filter(function (q) { return q !== v; }); if (!list.length) return;
      var m = CAB.pick(list), onRails = !m.def.float && !v.chain && Math.random() < 0.4;
      m.onRailsMocker = onRails;
      go(m, T.near(v.flatAt, onRails), function () { say(m, CAB.pick(MOCK), 3.6); });
      m.reckless = false; m.wander = 12; m.stay = Math.max(m.stay, 8);
    }
    function standUp(p) {
      p.g.scale.setScalar(p.base); p.g.rotation.x = p.g.rotation.z = 0; setOpacity(p, 1); p.fx = null; p.state = 'here'; p.g.position.y = 0;
      if (T && T.on(p.g.position)) p.g.position.copy(T.near(p.g.position, false));
      resume(p);
    }
    // back to whatever they were doing: leaving, or heading for a spot to stand
    function resume(p) {
      if (p.leaving) { go(p, p.leaveOut, p.leaveThen); return; }
      var s = p.at && !(T && T.on(p.at)) ? p.at : (freeSpot() || anySpot());
      if (s) go(p, s); else p.state = 'here';
    }
    function flatUpdate(p, dt) {
      p.fxT += dt; var B = p.base, k, e;
      if (p.fx === 'squash') {
        k = Math.min(1, p.fxT / 0.12); p.g.scale.set(B * (1 + 0.5 * k), B * (1 - 0.88 * k), B * (1 + 0.5 * k)); p.g.position.copy(p.flatAt);
        if (!p.saidSplat && p.fxT > 0.7) { p.saidSplat = true; blurt(p, CAB.pick(SPLAT), 3); }
        if (!p.mocked && p.fxT > 2.2) { p.mocked = true; callMocker(p); }
        if (p.fxT > 7) {
          p.fxT = 0;
          var others = people.filter(function (q) { return q !== p && (q.state === 'here' || q.state === 'walk'); });
          if (Math.random() < 0.5 || !others.length) { p.fx = 'balloon'; S.fx.inflate(); blurt(p, CAB.pick(BALLOON), 2.6); }
          else { p.fx = 'ghost'; p.boo = others.sort(function (a, b) { return a.g.position.distanceTo(p.flatAt) - b.g.position.distanceTo(p.flatAt); })[0]; p.booFrom = p.flatAt.clone(); }
        }
      } else if (p.fx === 'balloon') {
        // blows back up like a balloon, way too far, floats a little, then pops back to normal
        k = Math.min(1, p.fxT / 1.6); e = k * k * (3 - 2 * k);
        p.g.scale.set(B * (1.5 - 0.1 * e), B * (0.12 + 1.38 * e), B * (1.5 - 0.1 * e));
        // drifting off the rails as it fills up, so it doesn't land back in front of the train
        p.g.position.lerpVectors(p.flatAt, p.offRails, e); p.g.position.y = 1.4 * e + Math.sin(p.ph * 7) * 0.08 * e; p.g.rotation.z = Math.sin(p.ph * 5) * 0.15 * e;
        if (p.fxT > 2.3) { S.fx.pop(); standUp(p); }
      } else if (p.fx === 'ghost') {
        // comes back as a see-through ghost, sneaks up on the nearest person and scares them
        var q = p.boo; p.g.scale.setScalar(B); setOpacity(p, 0.38);
        var dest = q.g.position.clone().add(new V3(0.9, 0, 0.6)); k = Math.min(1, p.fxT / 2.2); e = k * k * (3 - 2 * k);
        p.g.position.lerpVectors(p.booFrom, dest, e); p.g.position.y = 1.1 + Math.sin(p.ph * 3) * 0.15;
        if (p.fxT > 2.3 && !p.booed) {
          p.booed = true; blurt(p, CAB.pick(GHOST), 2.6); p.wave = 1.5;
          if (q.state === 'here' || q.state === 'walk') { q.jump = 0.5; setTimeout(function () { if (q.state === 'here' || q.state === 'walk') blurt(q, CAB.pick(SCARED), 3); }, 900); }
        }
        if (p.fxT > 5) standUp(p);
      }
    }

    // ---------- knocked over by a stray ball ----------
    cast.bump = function (pos, r) {
      people.forEach(function (p) {
        if ((p.state !== 'here' && p.state !== 'walk') || p.def.float || (p.bumpCool || 0) > 0) return;
        var dx = p.g.position.x - pos.x, dz = p.g.position.z - pos.z, rr = r + 0.7 * p.base;
        if (dx * dx + dz * dz > rr * rr || pos.y > p.g.position.y + p.b.top * p.base) return;
        p.state = 'down'; p.downT = 0; p.bumpCool = 6; S.fx.bonk(); blurt(p, CAB.pick(KNOCK), 2.8);
      });
    };
    function downUpdate(p, dt) {
      p.downT += dt;
      var k = p.downT < 2.4 ? Math.min(1, p.downT / 0.25) : Math.max(0, 1 - (p.downT - 2.4) / 0.4);
      p.g.rotation.x = -k * 1.45;
      if (p.downT > 2.8) { p.g.rotation.x = 0; p.state = 'here'; resume(p); }
    }

    cast.start = function () {
      people.forEach(function (p) { p.state = 'off'; p.g.visible = false; p.at = null; p.leaving = false; p.fx = null; p.jump = 0; p.g.scale.setScalar(p.base); p.g.rotation.x = p.g.rotation.z = 0; setOpacity(p, 1); });
      cast.splatCool = 20;
      // the regulars start on their own spots
      regs.forEach(function (p) { var s = freeSpot(); if (!s) return; p.g.position.copy(s); p.at = s; p.state = 'here'; p.g.visible = true; p.how = 'side'; p.wander = 10 + Math.random() * 12; });
      cast.chatT = 4; cast.cameoT = 16 + Math.random() * 10;
    };
    // something happened in the game: 'hit', 'hard' or 'miss'. A cameo guest answers first if one is here.
    cast.react = function (kind, chance) {
      var list = here(); if (!list.length || Math.random() > (chance == null ? 1 : chance)) return;
      var guest = list.filter(function (p) { return !p.regular && p.def[kind]; });
      var p = guest.length ? guest[0] : CAB.pick(list.filter(function (q) { return q.def[kind]; }));
      if (!p) return; say(p, CAB.pick(p.def[kind])); if (kind === 'hard' && p.b.face) { p.b.face.mood.eyes = 'happy'; p.wave = 1.5; }
    };
    cast.say = function (name, line, secs) { var p = people.filter(function (q) { return q.name === name && q.state === 'here'; })[0] || here()[0]; if (p) say(p, line, secs); };
    cast.update = function (dt, live) {
      people.forEach(function (p) {
        if (p.state === 'off') return;
        p.ph += dt; p.bumpCool = Math.max(0, (p.bumpCool || 0) - dt);
        if (p.state === 'flat') { flatUpdate(p, dt); return; }
        if (p.state === 'down') { downUpdate(p, dt); return; }
        if (p.state === 'walk') {
          // careful walkers wait at the edge of the tracks until the train has gone by; reckless ones step out right in front of it
          var hold = false;
          if (T && !p.def.float && p.how !== 'sky') {
            var nk = Math.min(1, (p.walkT + dt) / p.walkD), nxt = new V3().lerpVectors(p.from, p.to, nk * nk * (3 - 2 * nk));
            if (T.on(nxt) && !T.on(p.g.position)) hold = p.reckless ? !T.coming(nxt, 0.5, 2.2) : !T.clear(nxt);
          }
          if (!hold) p.walkT += dt;
          var k = Math.min(1, p.walkT / p.walkD), e = k * k * (3 - 2 * k);
          p.g.position.lerpVectors(p.from, p.to, p.how === 'sky' ? k * k : e);
          if (p.how !== 'sky' && Math.abs(p.to.y - p.from.y) > 0.3) p.g.position.y += Math.sin(k * Math.PI) * 3;
          if (!p.def.float && p.how !== 'sky') p.g.position.y += Math.abs(Math.sin(p.ph * 9)) * 0.12;
          var dx = p.to.x - p.from.x, dz = p.to.z - p.from.z; if (dx * dx + dz * dz > 0.01) p.g.rotation.y = Math.atan2(dx, dz);
          if (p.how === 'fade') { p.fade = p.leaving ? 1 - k : k; setOpacity(p, p.fade); }
          if (k >= 1) { var fn = p.then; p.then = null; if (!p.leaving) p.state = 'here'; else { p.leaving = false; } if (fn) fn(); }
        } else {
          // standing: turn toward the action, bob, and now and then a regular strolls to another spot
          var ty = Math.atan2(o.look.x - p.g.position.x, o.look.z - p.g.position.z); p.g.rotation.y += (ty - p.g.rotation.y) * Math.min(1, dt * 4);
          p.g.position.y = p.at.y + (p.def.float ? 0.25 + Math.sin(p.ph * 2) * 0.15 : Math.sin(p.ph * 2) * 0.04);
          if (live && p.regular) { p.wander -= dt; if (p.wander <= 0 && p.talk <= 0) { var s = freeSpot(p.at); if (s) go(p, s); p.wander = 14 + Math.random() * 14; } }
          if (live && !p.regular) { p.stay -= dt; if (p.stay <= 0 && p.talk <= 0) { p.stay = 99; leave(p); } }
          // a little hop when a ghost scares them
          if (p.jump > 0) { p.jump = Math.max(0, p.jump - dt); p.g.position.y += Math.sin((0.5 - p.jump) / 0.5 * Math.PI) * 0.9; }
        }
        // anyone on the rails when a car gets there is flattened (ghosts float right through)
        if (T && !p.def.float && p.g.position.y < 1 && T.on(p.g.position) && T.carAt(p.g.position)) { splat(p); return; }
        // faces, mouths, arms and tails
        p.talk = Math.max(0, p.talk - dt); p.wave = Math.max(0, p.wave - dt);
        var B = p.b;
        if (B.face) {
          var mouth = p.talk > 0 ? (Math.floor(p.ph * 12) % 2) : 0;
          if (Math.random() < dt * 0.25) p.blink = 0.12; if (p.blink > 0) p.blink -= dt;
          var eyes = p.blink > 0 ? 'closed' : B.face.mood.eyes; if (p.talk <= 0 && B.face.mood.eyes === 'happy' && Math.random() < dt * 0.3) B.face.mood.eyes = 'open';
          if (eyes !== p.drawnEyes || mouth !== p.drawnMouth) { var keep = B.face.mood.eyes; B.face.mood.eyes = eyes; B.face.mood.mouth = mouth; B.face.tex.redraw(); B.face.mood.eyes = keep; p.drawnEyes = eyes; p.drawnMouth = mouth; }
        }
        if (B.mouth) B.mouth.scale.y = 1.3 + (p.talk > 0 ? Math.abs(Math.sin(p.ph * 12)) * 1.4 : 0);
        if (B.tail) B.tail.rotation.z = Math.sin(p.ph * 3) * 0.35;
        if (B.head && !B.face) B.head.rotation.z = p.talk > 0 ? Math.sin(p.ph * 6) * 0.08 : 0;
        if (B.arms) B.arms[1].rotation.z = (p.wave > 0 ? 2.4 + Math.sin(p.ph * 14) * 0.4 : (p.talk > 0 ? 0.15 + Math.sin(p.ph * 5) * 0.3 : 0.15));
      });
      if (!live) return;
      cast.splatCool -= dt;
      // small talk, and now and then a guest drops in
      cast.chatT -= dt;
      if (cast.chatT <= 0) {
        var list = here().filter(function (p) { return p !== lastSpeaker; }); if (!list.length) list = here();
        var p = CAB.pick(list); cast.chatT = 8 + Math.random() * 6;
        if (p) { if (!p.regular || Math.random() < 0.25) roast(p); else say(p, CAB.pick(p.def.idle || o.idle)); }
      }
      cast.cameoT -= dt;
      if (cast.cameoT <= 0) {
        cast.cameoT = 26 + Math.random() * 16;
        var inNow = cams.some(function (p) { return p.state !== 'off'; });
        if (!inNow) { var pickC = CAB.pick(cams.filter(function (p) { return p !== cast.lastCameo; })) || CAB.pick(cams); if (pickC && enter(pickC)) cast.lastCameo = pickC; }
      }
    };
    return cast;
  };
})();
