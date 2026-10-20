'use strict';

// Lobby passwords for adult games. Whoever hosts an adult game makes one up;
// guests type it to join. It's separate from the adult PIN on purpose: the
// PIN lets someone host adult content, the password lets the host's friends
// in without knowing the PIN, and a curious kid tapping Join hits a wall.

const MIN = 3;
const MAX = 30;

function fail(message, status, needsPassword) {
  return Object.assign(new Error(message), { status, needsPassword });
}

const clean = pw => String(pw == null ? '' : pw).trim().slice(0, MAX);

// A host making (or switching to) an adult game has to set one.
function requireNew(pw) {
  const p = clean(pw);
  if (p.length < MIN) throw fail(`Adult games need a lobby password (${MIN}+ characters) so kids can't wander in.`, 400, 'create');
  return p;
}

// A guest joining a locked game has to know it.
function check(room, supplied) {
  if (!room.password) return;
  const p = clean(supplied);
  if (p !== room.password) {
    throw fail(p ? 'That password isn\'t right.' : 'This is a grown-ups game. Ask the host for the lobby password.', 401, 'join');
  }
}

// For the routers' error handlers: pass the flag through so the page knows to ask.
const extra = err => (err && err.needsPassword ? { needsPassword: err.needsPassword } : {});

module.exports = { requireNew, check, extra, MIN };
