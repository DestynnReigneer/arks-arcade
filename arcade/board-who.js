'use strict';

// Who a score goes on a high-score board as. Every game's board asks this one
// place, so they all agree:
//
//   - Signed in (the profile token checks out): the profile. The board shows
//     the profile's name (or the initials it chose in its settings) and avatar.
//   - A guest: the name they're playing under (ArcadeProfile.name() on the
//     page), with their avatar if it's one of the arcade's own.
//   - A TV: the person picked on the end card's "Who played?" (playedBy, a
//     profile id). The TV is signed in as itself, so its scores don't go under
//     the TV's name. Only a TV's own token can name someone else, and only an
//     approved profile that isn't a TV. Nobody types initials. (Initials sent by
//     a page loaded before the picker still work.)
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

// Does this profile belong to a TV's own account (ARKS ID contract v14)?
// The accounts table is only there with ARKS ID on; without it there are no TVs.
function isTv(profileId) {
  const db = require('../db');
  try {
    const r = db.db.prepare(`SELECT a.kind FROM arcade_profiles p JOIN arcade_id_accounts a ON a.user_id = p.arksid_user
      WHERE p.id = ? AND p.status = 'approved'`).get(String(profileId || ''));
    return !!r && r.kind === 'tv';
  } catch { return false; }
}

// The people a TV can save a score under: every approved profile that isn't a TV.
function tvPlayers() {
  const db = require('../db');
  const { pub } = require('./profiles');
  return db.db.prepare("SELECT * FROM arcade_profiles WHERE status = 'approved' ORDER BY name COLLATE NOCASE").all()
    .filter(r => !isTv(r.id)).map(r => { const p = pub(r); return { id: p.id, name: p.name, avatar: p.avatar }; });
}

// A TV saving a score under the person who played (the end card's "Who played?").
// by: the profile the request is signed in as, which has to be a TV's.
function playedOn(by, playedBy) {
  if (!by || !isTv(by.id)) throw fail('Only a TV can put a score under someone else.', 403);
  const db = require('../db');
  const { pub } = require('./profiles');
  const r = db.db.prepare("SELECT * FROM arcade_profiles WHERE id = ? AND status = 'approved'").get(String(playedBy).slice(0, 40));
  if (!r || isTv(r.id)) throw fail('That person isn\'t on this arcade.', 400);
  return pub(r);
}

// -> { profile, initials, name, avatar, key }
//   profile: the verified profile (on a TV, the person picked), or null for a guest
//   name/avatar: what the board shows (null for a TV's initials)
//   key: one person's key, for boards that keep one score per person per day
// playedBy: on a TV, the profile id of who played (see playedOn).
function boardWho({ profileToken, profile = undefined, name, avatar, initials, playedBy } = {}) {
  let me = profile !== undefined ? profile : profileToken ? require('./profiles').verify(profileToken) : null;
  if (playedBy !== undefined && playedBy !== null && playedBy !== '') me = playedOn(me, playedBy);
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

module.exports = { boardWho, initialsOf, cleanName, NO_NAME, isTv, tvPlayers };
