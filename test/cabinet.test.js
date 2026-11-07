'use strict';

// The 3D cabinet games (Big Swing and the ones after it): three.js is the copy in public/vendor/three (version 0.128,
// with its MIT license kept), the shared engine, sound and frame are valid scripts, and each game's board takes an
// honest score and refuses one no real game could reach. These games send their own score, the deliberate exception
// to "the server decides every score", so the maximum is the check that matters.

const path = require('node:path');
const fs = require('node:fs');

// Each cabinet game, its board and the highest score it can save (arcade/scores.js).
const CABINETS = [];

async function run({ base, root }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };

  console.log('\n-- cabinet games: the 3D engine --');
  const vendor = path.join(root, 'public/vendor/three');
  const THREE = require(path.join(vendor, 'three.min.js'));
  ok('three.js is the copy in the arcade, version 0.128', THREE.REVISION === '128', THREE.REVISION);
  ok('three.js keeps its MIT license', /The MIT License/.test(fs.readFileSync(path.join(vendor, 'LICENSE'), 'utf8')));
  for (const f of ['CopyShader.js', 'LuminosityHighPassShader.js', 'EffectComposer.js', 'RenderPass.js', 'ShaderPass.js', 'UnrealBloomPass.js', 'RoundedBoxGeometry.js']) {
    ok(`the ${f} add-on is there`, fs.existsSync(path.join(vendor, f)));
  }
  for (const f of ['cab-engine.js', 'cab-sound.js', 'cab-frame.js']) {
    let good = true;
    try { new Function(fs.readFileSync(path.join(root, 'public', f), 'utf8')); } catch { good = false; }
    ok(`${f} is a valid script`, good);
  }
  const pages = fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html'));
  const external = pages.filter(f => /<script[^>]+src="https?:/.test(fs.readFileSync(path.join(root, 'public', f), 'utf8')));
  ok('no page loads a script from outside the arcade', external.length === 0, external.join());

  console.log('\n-- cabinet games: the boards --');
  const post = (game, body) => fetch(`${base}/api/scores/${game}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const c of CABINETS) {
    const good = await post(c.game, { initials: 'CAB', score: 7, board: c.board, detail: 'test' });
    ok(`${c.game}: an honest score goes on the board`, good.status === 201, String(good.status));
    const top = await post(c.game, { initials: 'CAB', score: c.max, board: c.board });
    ok(`${c.game}: the highest real score (${c.max}) is accepted`, top.status === 201, String(top.status));
    const over = await post(c.game, { initials: 'CAB', score: c.max + 1, board: c.board });
    ok(`${c.game}: a score no real game could reach is refused`, over.status === 400, String(over.status));
    const zero = await post(c.game, { initials: 'CAB', score: 0, board: c.board });
    ok(`${c.game}: a score of nothing isn't saved`, zero.status === 400, String(zero.status));
    const list = await (await fetch(`${base}/api/scores/${c.game}?board=${c.board}`)).json();
    ok(`${c.game}: the board lists the best first`, list.length >= 2 && list[0].score === c.max, JSON.stringify(list.slice(0, 2)));
  }

  console.log(`
  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run, CABINETS };
