'use strict';

// Test runner. Boots the real server on a spare port, runs every suite
// against it, shuts it down, and exits non-zero if anything failed — which is
// what makes it usable as a CI gate.
//
//   npm test

const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const fs = require('node:fs');

// Each run gets its own free ports unless TEST_PORT says otherwise, so two
// copies of the repo can run their tests at the same time without one suite
// quietly talking to the other's server (and sharing its rate limits).
let PORT = Number(process.env.TEST_PORT) || 0;
let BASE = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
const ROOT = path.join(__dirname, '..');

// The suites that run right here in this process (the unit checks, the bot
// playing a whole Words with Family game, random Snake and Blocks games, free-play
// Shuffle Scuffle rounds) use Math.random. A seeded one makes every run roll
// the same dice, so a failure shows up every time instead of once in a while.
// TEST_SEED tries a different roll. The servers the suites talk to are
// separate processes and keep the real Math.random.
const SEED = Number(process.env.TEST_SEED) || 20261101;
Math.random = (() => {
  let a = SEED >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

const SUITES = [
  ['unit', require('./unit.test.js')],
  ['api', require('./api.test.js')],
  ['sudoku', require('./sudoku.test.js')],
  ['scuffle', require('./scuffle.test.js')],
  ['crisscross', require('./crisscross.test.js')],
  ['chess', require('./chess.test.js')],
  ['clueless', require('./clueless.test.js')],
  ['tumbler', require('./tumbler.test.js')],
  ['continue', require('./continue.test.js')],
  ['trophies', require('./trophies.test.js')],
  ['cabinet', require('./cabinet.test.js')],
  ['housekeeping', require('./housekeeping.test.js')],
  ['boards', require('./boards.test.js')],
  ['tv', require('./tv.test.js')],
  ['tv-party', require('./tv-party.test.js')],
  ['party-lobby', require('./party-lobby.test.js')]
];

// A throwaway brand/ and media/ folder, so the tests can check what the
// arcade picks up from them and what it refuses to serve.
const os = require('node:os');
const MEDIA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-media-'));
const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
for (const [file, body] of [
  ['brand/avatar.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ['brand/notes.txt', 'not a logo'],
  ['media/clips/rickroll.gif', GIF],
  ['media/clips/bad name.gif', GIF],
  ['media/clips/readme.txt', 'not a clip'],
  ['media/images/cat.gif', GIF],
  ['media/sprites/dance-hero.gif', GIF]
]) {
  fs.mkdirSync(path.dirname(path.join(MEDIA_ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(MEDIA_ROOT, file), body);
}

function startServer(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...extraEnv,
        PORT: String(port),
        NODE_ENV: 'test',
        // Adult levels need an ARKS ID adult pass; without ARKS ID the suite uses this
        // test-only pass instead (arcade/adult-pin.js, never read outside NODE_ENV=test).
        TEST_ADULT_PASS: '246810',
        // Admin routes are deny-by-default, so the suite has to supply a
        // token to be able to prove they are locked *and* that they work.
        ADMIN_TOKEN: 'test-admin-token',
        // The recovery PIN on the admin page's PIN pad (arcade/admin-session.js).
        ADMIN_PIN: '135790',
        BRAND_DIR: path.join(MEDIA_ROOT, 'brand'),
        MEDIA_DIR: path.join(MEDIA_ROOT, 'media'),
        CLIP_SURPRISE: '0',
        // Sudoku turns away a finish faster than this per square; the real
        // rule (400) would make the tests wait half a minute per puzzle.
        SUDOKU_MIN_MS_PER_SQUARE: '20',
        // Lets the Shuffle Scuffle tests ask for 2-second rounds.
        SCUFFLE_TEST_SECONDS: '2',
        // Clueless turns away a finish faster than this per square.
        CLUELESS_MIN_MS_PER_SQUARE: '20',
        // Tumbler Rumble refuses taps later than the run has really lasted;
        // this lets the suite send a whole run without playing it in real time.
        TUMBLER_SLACK_MS: '60000',
        // Rambler's once-a-minute housekeeping, slowed to once an hour, so the
        // check that /healthz no longer rolls a season over can't be beaten
        // to it by the timer.
        HOUSEKEEPING_MS: '3600000'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let out = '';
    const onData = chunk => {
      out += chunk.toString();
      if (out.includes('running at')) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => reject(new Error(`server exited early (${code})\n${out}`)));
    setTimeout(() => reject(new Error(`server did not start in time\n${out}`)), 30000);
  });
}

// Poll rather than assume: the log line appears just before listen() resolves.
async function waitForHealth(base) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server never became healthy');
}

// Wipe the test database before every run so results never depend on what a
// previous run left behind.
function resetTestDb() {
  const dir = path.join(ROOT, 'data');
  for (const f of ['test.db', 'test.db-journal', 'test.db-wal', 'test.db-shm',
    'test-arksid.db', 'test-arksid.db-journal', 'test-arksid.db-wal', 'test-arksid.db-shm']) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* not there */ }
  }
}

(async () => {
  let server = null, server2 = null, fake = null;
  resetTestDb();
  let total = 0;
  let failed = 0;

  try {
    if (!PORT) PORT = await freePort();
    BASE = `http://localhost:${PORT}`;
    server = await startServer(PORT);
    await waitForHealth(BASE);

    for (const [name, suite] of SUITES) {
      console.log(`\n${'='.repeat(60)}\n  ${name}\n${'='.repeat(60)}`);
      const result = await suite.run({ base: BASE, root: ROOT });
      total += result.pass + result.fail;
      failed += result.fail;
    }
    // The same arcade signing in through ARKS ID: a second server with
    // ARKS_ID_URL set, talking to a pretend ARKS ID, on its own database.
    const { startFakeArksId } = require('./fake-arksid');
    const ID_PORT = process.env.TEST_PORT ? PORT + 1 : await freePort(), ID_BASE = `http://localhost:${ID_PORT}`;
    const secret = 'arcade-test-secret-'.padEnd(43, 's');
    fake = await startFakeArksId({ secret, arcadeBase: ID_BASE });
    // FEEDBACK_PICTURES_MAX_BYTES: a tiny cap, to try what happens when the
    // feedback pictures folder is full (only read when NODE_ENV is test).
    // TEST_PASS_CHECK_MS: using an adult pass asks ARKS ID about its sign-in when nobody has
    // for this long (three minutes outside the tests).
    server2 = await startServer(ID_PORT, { ARKS_ID_URL: fake.base, ARKS_ID_SECRET: secret, RAMBLER_DB: 'test-arksid.db', FEEDBACK_PICTURES_MAX_BYTES: '1', TEST_PASS_CHECK_MS: '1000' });
    await waitForHealth(ID_BASE);
    console.log(`\n${'='.repeat(60)}\n  arksid\n${'='.repeat(60)}`);
    const result = await require('./arksid.test.js').run({ base: ID_BASE, root: ROOT, fake, admin: 'test-admin-token' });
    total += result.pass + result.fail;
    failed += result.fail;
    // The arcade on a TV with ARKS ID: pairing, adults' night, Back to family.
    console.log(`\n${'='.repeat(60)}\n  tv-arksid\n${'='.repeat(60)}`);
    const tvResult = await require('./tv-arksid.test.js').run({ base: ID_BASE, root: ROOT, fake });
    total += tvResult.pass + tvResult.fail;
    failed += tvResult.fail;
    // The party and word games on a TV with ARKS ID: adults rooms, kids' phones.
    console.log(`
${'='.repeat(60)}
  tv-party-arksid
${'='.repeat(60)}`);
    const partyResult = await require('./tv-party-arksid.test.js').run({ base: ID_BASE, root: ROOT, fake });
    total += partyResult.pass + partyResult.fail;
    failed += partyResult.fail;
  } catch (e) {
    console.error('\nRUNNER FAILED:', e.message);
    failed++;
  } finally {
    if (server) server.kill();
    if (server2) server2.kill();
    if (fake) fake.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${total - failed}/${total} checks passed`);
  console.log(`  (dice seed ${SEED}; set TEST_SEED to roll differently)`);
  console.log(`${'='.repeat(60)}\n`);
  process.exit(failed ? 1 : 0);
})();
