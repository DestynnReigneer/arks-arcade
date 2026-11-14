'use strict';

// Joining a adults game from a phone. Guests still get in with the lobby
// password the host made up, as always. But with ARKS ID sign-in on, a phone
// that is signed in as a kid or a teen, or a TV, is turned away from a
// adults room whatever it types: joining a game plays as the phone's own
// owner, and it never unlocks anything. (Know-It-All does the same check in
// trivia/routes.js.)
//
//   use(whoIs, stillAdult)    whoIs(req) -> { account, tv, sessionId } or null, and
//                              stillAdult(sessionId) -> true or false (both from server.js)
//   await who(req)             who this device is signed in as, or null
//   refuse(me, adult)          throws a 403 for a kid's, a teen's or a TV's device when adult is true
//   await refuseKids(req, adult)   who() and refuse() together
//   signinOf(me)               the sign-in's id when it's an adult's (never a TV's), or null
//   stillAdult(sessionId)      is that sign-in still going, and still an adult's?

const ADULTS = ['admin', 'adult'];
let whoIs = null;
let askAgain = null;
function use(fn, still) {
  whoIs = typeof fn === 'function' ? fn : null;
  askAgain = typeof still === 'function' ? still : null;
}

// With sign-in off this is always null, because nobody can be told apart then.
async function who(req) {
  if (!whoIs) return null;
  try { return await whoIs(req); } catch { return null; }
}

function refuse(me, adult) {
  if (!adult || !whoIs) return;
  if (me && (me.tv || !ADULTS.includes(me.account && me.account.role))) {
    throw Object.assign(new Error('This is an adult game, so it\'s only for adult accounts.'), { status: 403 });
  }
}

async function refuseKids(req, adult) {
  if (!adult || !whoIs) return;
  refuse(await who(req), adult);
}

// A seat keeps this, and not just "was an adult when they joined", so the
// question can be asked again later (signed out since? no longer an adult?).
const signinOf = me => (me && !me.tv && me.sessionId && me.account && ADULTS.includes(me.account.role) ? me.sessionId : null);
const stillAdult = sessionId => !!(sessionId && askAgain && askAgain(sessionId));

module.exports = { use, who, refuse, refuseKids, signinOf, stillAdult };
