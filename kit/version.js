'use strict';

// Which build is running. CI bakes the git commit (GIT_SHA) and the time the
// image was built (BUILD_DATE) into the image; the version number comes from
// the app's package.json and the Node version from Node itself. A copy run
// with `npm start` has neither, so it reports itself as "dev". Each app shows
// this in its admin page and at /healthz, never on a page everyone sees.
//
// Part of the shared kit: every app has this exact file in kit/version.js.

const PACKAGE_VERSION = require('../package.json').version;

function readVersion(env = process.env) {
  const sha = String(env.GIT_SHA || '').trim().toLowerCase();
  const full = /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
  const built = String(env.BUILD_DATE || '').trim();
  return {
    version: PACKAGE_VERSION,
    commit: full ? full.slice(0, 7) : 'dev',
    commitFull: full,
    built: built && !Number.isNaN(Date.parse(built)) ? built : null,
    node: process.versions.node
  };
}

// Read once when the server starts: the image never changes underneath it.
const CURRENT = Object.freeze(readVersion());

// version() is the running build, always the same frozen answer. version(env)
// reads another set of variables, which is how the tests try both cases.
function version(env) {
  return env ? readVersion(env) : CURRENT;
}

module.exports = { version, readVersion };
