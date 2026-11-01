'use strict';

// Which build is running. CI bakes the git commit (GIT_SHA) and the time the
// image was built (BUILD_DATE) into the image; the version number comes from
// package.json. Shown on the admin page and in /healthz, never to players.
// A copy run from a laptop has neither, so it reports itself as 'dev'.

const PACKAGE_VERSION = require('../package.json').version;

function read(env) {
  const sha = String(env.GIT_SHA || '').trim().toLowerCase();
  const real = /^[0-9a-f]{7,40}$/.test(sha);
  const built = String(env.BUILD_DATE || '').trim();
  return {
    version: PACKAGE_VERSION,
    commit: real ? sha.slice(0, 7) : 'dev',
    commitFull: real ? sha : null,
    built: built && !Number.isNaN(Date.parse(built)) ? built : null,
    node: process.versions.node
  };
}

// Read once at startup: the environment doesn't change while the app runs.
const CURRENT = Object.freeze(read(process.env));

// version() is the running build; version(env) reads another set of
// variables, which is how the tests try both cases.
function version(env) {
  return env ? read(env) : { ...CURRENT };
}

module.exports = { version };
