'use strict';

// Test runner. Boots the real server on a spare port, runs every suite
// against it, shuts it down, and exits non-zero if anything failed — which is
// what makes it usable as a CI gate.
//
//   npm test

const path = require('node:path');
const { spawn } = require('node:child_process');

const fs = require('node:fs');

const PORT = process.env.TEST_PORT || 3222;
const BASE = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');

const SUITES = [
  ['unit', require('./unit.test.js')],
  ['api', require('./api.test.js')]
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
  ['media/sprites/dance-hero.gif', GIF]
]) {
  fs.mkdirSync(path.dirname(path.join(MEDIA_ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(MEDIA_ROOT, file), body);
}

function startServer(port = PORT, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...extraEnv,
        PORT: String(port),
        NODE_ENV: 'test',
        // Admin routes are deny-by-default, so the suite has to supply a
        // token to be able to prove they are locked *and* that they work.
        ADMIN_TOKEN: 'test-admin-token',
        BRAND_DIR: path.join(MEDIA_ROOT, 'brand'),
        MEDIA_DIR: path.join(MEDIA_ROOT, 'media'),
        CLIP_SURPRISE: '0'
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
async function waitForHealth(base = BASE) {
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
    server = await startServer();
    await waitForHealth();

    for (const [name, suite] of SUITES) {
      console.log(`\n${'='.repeat(60)}\n  ${name}\n${'='.repeat(60)}`);
      const result = await suite.run({ base: BASE, root: ROOT });
      total += result.pass + result.fail;
      failed += result.fail;
    }
    // The same arcade signing in through ARKS ID: a second server with
    // ARKS_ID_URL set, talking to a pretend ARKS ID, on its own database.
    const { startFakeArksId } = require('./fake-arksid');
    const ID_PORT = Number(PORT) + 1, ID_BASE = `http://localhost:${ID_PORT}`;
    const secret = 'arcade-test-secret-'.padEnd(43, 's');
    fake = await startFakeArksId({ secret, arcadeBase: ID_BASE });
    server2 = await startServer(ID_PORT, { ARKS_ID_URL: fake.base, ARKS_ID_SECRET: secret, RAMBLER_DB: 'test-arksid.db' });
    await waitForHealth(ID_BASE);
    console.log(`\n${'='.repeat(60)}\n  arksid\n${'='.repeat(60)}`);
    const result = await require('./arksid.test.js').run({ base: ID_BASE, root: ROOT, fake, admin: 'test-admin-token' });
    total += result.pass + result.fail;
    failed += result.fail;
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
  console.log(`${'='.repeat(60)}\n`);
  process.exit(failed ? 1 : 0);
})();
