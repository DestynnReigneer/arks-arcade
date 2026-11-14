'use strict';

// Joining a adults game from a phone. Guests still get in with the lobby
// password the host made up, as always. But with ARKS ID sign-in on, a phone
// that is signed in as a kid or a teen, or a TV, is turned away from a
// adults room whatever it types: joining a game plays as the phone's own
// owner, and it never unlocks anything. (Know-It-All does the same check in
// trivia/routes.js.)
//
//   use(whoIs)                 whoIs(req) -> { account, tv } or null (server.js)
//   await refuseKids(req, adult)   throws a 403 for those phones when adult is true
//   await isAdult(req)         true when this device is signed in as an adult

let whoIs = null;
function use(fn) { whoIs = typeof fn === 'function' ? fn : null; }

async function refuseKids(req, adult) {
  if (!adult || !whoIs) return;
  let me = null;
  try { me = await whoIs(req); } catch { me = null; }
  if (me && (me.tv || !['admin', 'adult'].includes(me.account && me.account.role))) {
    throw Object.assign(new Error('This is an adult game, so it\'s only for adult accounts.'), { status: 403 });
  }
}

// Is this device signed in with ARKS ID as an adult (or an admin)? A TV never
// is, and with sign-in off nobody is, because nobody can be told apart then.
async function isAdult(req) {
  if (!whoIs) return false;
  let me = null;
  try { me = await whoIs(req); } catch { me = null; }
  return !!(me && !me.tv && me.account && ['admin', 'adult'].includes(me.account.role));
}

module.exports = { use, refuseKids, isAdult };
