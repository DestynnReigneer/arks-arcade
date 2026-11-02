'use strict';

// The server the browser tests run against (npm run test:browser starts it
// through playwright.config.js). It's the real arcade in ARKS ID mode, talking
// to the same pretend ARKS ID the other tests use (test/fake-arksid.js), on a
// throwaway database that's wiped every time. Nobody is signed in, and the
// browser counts as a visitor's phone, so guest play is offered.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startFakeArksId } = require('../fake-arksid');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const DB = 'browser-test.db';

for (const end of ['', '-journal', '-wal', '-shm']) {
  try { fs.unlinkSync(path.join(ROOT, 'data', DB + end)); } catch { /* not there */ }
}

(async () => {
  const secret = 'browser-test-secret-'.padEnd(43, 's');
  // The pretend sign-in service sits on the next port up, where the
  // switches test reaches its /test/... addresses.
  const fake = await startFakeArksId({ secret, arcadeBase: `http://localhost:${PORT}`, port: PORT + 1 });
  fake.next = null;          // a silent sign-in finds nobody
  fake.deviceOwner = null;   // a visitor's device: guests are welcome
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      RAMBLER_DB: DB,
      ADMIN_TOKEN: 'browser-test-admin',
      ARKS_ID_URL: fake.base,
      ARKS_ID_SECRET: secret,
      CLIP_SURPRISE: '0',
      // Clueless turns away a finish faster than 0.3 seconds a square; the
      // browser test types quicker than a person.
      CLUELESS_MIN_MS_PER_SQUARE: '20'
    }
  });
  const stop = () => { child.kill(); fake.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', code => { fake.close(); process.exit(code || 0); });
})();
