'use strict';

// Adult games used to have a lobby password the host made up and guests typed.
// It's gone (the maintainer, 2026-11-15): anyone can join an adult game except a
// kid's or a teen's device (arcade/adult-join.js). These stay so the games can
// keep calling them, and they never ask for anything.

function requireNew() { return null; }
function check() { /* nothing to check */ }
const extra = err => (err && err.needsPassword ? { needsPassword: err.needsPassword } : {});

module.exports = { requireNew, check, extra, MIN: 0 };
