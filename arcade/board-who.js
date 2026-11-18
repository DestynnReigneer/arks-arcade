'use strict';

// Who a score goes on a high-score board as. Every game's board asks this one
// place, so they all agree:
//
//   - Signed in (the profile token checks out): the profile. The board shows
//     the profile's name (or the initials it chose in its settings) and avatar.
//   - A guest: the name they're playing under (ArcadeProfile.name() on the
//     page), with their avatar if it's one of the arcade's own.
//   - A TV: the initials picked with the remote. The TV is signed in as itself,
//     so its scores don't go under the TV's name. Nobody else types initials.
//
// With none of those the score can't go on a board, and the player is told to
// sign in. The `initials` column every board keeps is still filled in (from the
// name), so older rows and the admin pages keep working.

const Avatars = require('../public/avatars');

const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
const NO_NAME = 'Sign in with ARKS ID to put your score on the board.';
const cleanName = raw => String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 16);
const initialsOf = name => (String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P');

// Is this the name of a profile (any but a turned-down one), ignoring case and spacing?
function profileNamed(name) {
  const db = require('../db');
  const want = name.toLowerCase().replace(/\s+/g, '');
  try {
    return db.db.prepare("SELECT name FROM arcade_profiles WHERE status != 'rejected'").all()
      .some(r => String(r.name || '').toLowerCase().replace(/\s+/g, '') === want);
  } catch { return false; }
}

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

// -> { profile, initials, name, avatar, key }
//   profile: the verified profile, or null for a guest or a TV
//   name/avatar: what the board shows (null for a TV's initials)
//   key: one person's key, for boards that keep one score per person per day
function boardWho({ profileToken, profile = undefined, name, avatar, initials } = {}) {
  const me = profile !== undefined ? profile : profileToken ? require('./profiles').verify(profileToken) : null;
  if (me) {
    return { profile: me, initials: me.initials || initialsOf(me.name), name: me.name, avatar: me.avatar || null, key: `p:${me.id}` };
  }
  let guest = cleanName(name);
  if (guest) {
    // A guest using a family member's profile name goes on the board as
    // "Kim (guest)", so nobody can post scores that look like Kim's.
    if (profileNamed(guest)) guest = `${guest} (guest)`;
    return {
      profile: null, initials: initialsOf(guest), name: guest,
      avatar: avatar && Avatars.valid(avatar) ? String(avatar) : null,
      key: `n:${guest.toLowerCase()}`
    };
  }
  const ini = String(initials || '').toUpperCase().trim();
  if (INITIALS_RE.test(ini)) return { profile: null, initials: ini, name: null, avatar: null, key: `g:${ini}` };
  throw fail(NO_NAME, 400);
}

module.exports = { boardWho, initialsOf, cleanName, NO_NAME };
