'use strict';

// The 3D cabinet games (Big Swing and the ones after it): three.js is the copy in public/vendor/three (version 0.128,
// with its MIT license kept), the shared engine, sound and frame are valid scripts, and each game's board takes an
// honest score and refuses one no real game could reach. These games send their own score, the deliberate exception
// to "the server decides every score", so the maximum is the check that matters.

const path = require('node:path');
const fs = require('node:fs');

// Each cabinet game, its board and the highest score it can save (arcade/scores.js).
const CABINETS = [
  { game: 'bigswing', board: 'runs', max: 300 },
  // 750 is a perfect game without the jackpot; a jackpot score is checked below
  { game: 'bucketdrop', board: 'points', max: 750 },
  { game: 'launcher', board: 'points', max: 50000 },
  { game: 'train', board: 'points', max: 100000 }
];

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

  console.log('\n-- cabinet games: the shared jackpot (Bucket Drop) --');
  const jp = (p, body) => fetch(`${base}/api/cab-jackpot/bucketdrop${p}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).then(r => r.json());
  const start = (await jp('')).amount;
  ok('the jackpot starts at 1,000 or more', start >= 1000, String(start));
  const grown = (await jp('/played', { won: false })).amount;
  ok('every game adds 10 to the jackpot', grown === start + 10, `${start} -> ${grown}`);
  const fake = await post('bucketdrop', { initials: 'CAB', score: 750 + grown, board: 'points' });
  ok('a jackpot score nobody won is refused', fake.status === 400, String(fake.status));
  const after = (await jp('/played', { won: true })).amount;
  ok('winning starts the jackpot over at 1,000', after === 1000, String(after));
  const real = await post('bucketdrop', { initials: 'WIN', score: 750 + grown, board: 'points', detail: 'Jackpot!' });
  ok('the winner can save 750 plus the jackpot they won', real.status === 201, String(real.status));
  const again = await post('bucketdrop', { initials: 'WIN', score: 750 + grown, board: 'points' });
  ok('the same win can only be saved once', again.status === 400, String(again.status));
  ok('a game with no jackpot says so', (await fetch(`${base}/api/cab-jackpot/bigswing`)).status === 404);

  console.log('\n-- cabinet games: the Racer\'s times (fastest first) --');
  const race = (score, board = 'neon') => post('racer', { initials: 'RCR', score, board, detail: 'test' });
  const slow = await race(62000), fast = await race(45000);
  ok('a finishing time goes on its track\'s board', slow.status === 201 && fast.status === 201, `${slow.status} ${fast.status}`);
  ok('the faster time ranks #1', (await fast.json()).rank === 1);
  const mid = await (await race(50000)).json();
  ok('a time between them ranks #2', mid.rank === 2, JSON.stringify(mid));
  const times = await (await fetch(`${base}/api/scores/racer?board=neon`)).json();
  ok('the board lists the fastest first', times.map(r => r.score).slice(0, 3).join() === '45000,50000,62000', JSON.stringify(times.map(r => r.score)));
  ok('a time faster than any real race is refused', (await race(29999)).status === 400);
  ok('a time longer than the clock allows is refused', (await race(85001)).status === 400);
  const other = await (await fetch(`${base}/api/scores/racer?board=star`)).json();
  ok('each track has its own board', !other.some(r => r.initials === 'RCR'));

  console.log("\n-- cabinet games: the Train Station's cars --");
  const cars = await (await fetch(`${base}/api/train-cars`)).json();
  ok('the train has 8 cars with made-up names until the admin names them', cars.cars.length === 8 && cars.cars[0].name === 'Comet', JSON.stringify(cars.cars[0]));
  const asAdmin = (method, body, token = 'test-admin-token') => fetch(`${base}/api/comm/admin/train-cars`, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: body ? JSON.stringify(body) : undefined });
  const mine = cars.cars.map((c, i) => ({ name: `Car ${i + 1}`, kind: c.kind }));
  ok('only the admin can name the cars', (await asAdmin('POST', { cars: mine }, 'wrong')).status === 401);
  ok('names that are too long are refused', (await asAdmin('POST', { cars: mine.map((c, i) => (i ? c : { ...c, name: 'A name far too long' })) })).status === 400);
  ok('the train needs exactly 8 cars', (await asAdmin('POST', { cars: mine.slice(1) })).status === 400);
  ok('a car must be easy, medium or hard', (await asAdmin('POST', { cars: mine.map((c, i) => (i ? c : { ...c, kind: 'impossible' })) })).status === 400);
  const saved = await asAdmin('POST', { cars: mine });
  ok('the admin can name the cars', saved.status === 200, String(saved.status));
  const now = await (await fetch(`${base}/api/train-cars`)).json();
  ok("the game gets the admin's names", now.cars.map(c => c.name).join() === mine.map(c => c.name).join(), JSON.stringify(now.cars.map(c => c.name)));
  const repo = fs.readFileSync(path.join(root, 'public/cab-train.js'), 'utf8');
  ok('the repo only has the made-up names', /\['Comet', 'easy'\]/.test(repo));

  // A picture for a car, shown in its circle on the light board.
  const picAdmin = (method, n, body, token = 'test-admin-token') => fetch(`${base}/api/comm/admin/train-cars/${n}/picture`, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: body ? JSON.stringify(body) : undefined });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
  const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  ok('no car has a picture to start with', now.cars.every(c => c.picture === null));
  ok('only the admin can add a picture', (await picAdmin('POST', 2, { image }, 'wrong')).status === 401);
  ok('a picture that isn\'t a JPEG is refused', (await picAdmin('POST', 2, { image: `data:image/jpeg;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` })).status === 400);
  ok('…and so is a ninth car', (await picAdmin('POST', 9, { image })).status === 404);
  const withPic = await (await picAdmin('POST', 2, { image })).json();
  ok('the admin adds a picture to car 2', /^\/api\/train-cars\/2\/picture\?v=[0-9a-f]{10}$/.test(withPic.cars[1].picture || '') && withPic.cars[0].picture === null, JSON.stringify(withPic.cars[1]));
  const served = await fetch(base + withPic.cars[1].picture);
  ok('the game can load it, as a JPEG', served.status === 200 && served.headers.get('content-type') === 'image/jpeg' && Buffer.from(await served.arrayBuffer()).equals(jpeg));
  ok('a car without a picture has none to load', (await fetch(`${base}/api/train-cars/3/picture`)).status === 404);
  const noPic = await (await picAdmin('DELETE', 2)).json();
  ok('the admin can take it off again', noPic.cars[1].picture === null && (await fetch(`${base}/api/train-cars/2/picture`)).status === 404);

  console.log(`
  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run, CABINETS };
