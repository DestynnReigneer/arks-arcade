'use strict';

// Who can't play an adult game: a kid's or a teen's device (the maintainer,
// 2026-11-15). Everyone else can, guests and TVs included, and nobody types a
// password. A device is a kid's when it's signed in to a kid's or a teen's ARKS
// ID account, or when nobody is signed in and ARKS ID says the device belongs
// to a kid or a teen (a kid's own device can't play as a guest, so this is
// mostly the signed-in case).
//
//   use(whoIs, deviceOf)        whoIs(req) -> { account, tv } or null; deviceOf(req) -> { known, ownerRole } or null
//   await kid(req)               true for a kid's or a teen's device
//   refuse(isKid, adult)         throws a 403 when adult is true and the device is a kid's
//   await refuseKids(req, adult) kid() and refuse() together
//
// Without ARKS ID nobody can be told apart, so nobody counts as a kid here;
// adult levels are off on such an arcade anyway (arcade/adult-pin.js).

const ADULTS = ['admin', 'adult'];
let whoIs = null;
let deviceOf = null;
function use(fn, dev) {
  whoIs = typeof fn === 'function' ? fn : null;
  deviceOf = typeof dev === 'function' ? dev : null;
}

async function kid(req) {
  if (!whoIs) return false;
  let me = null;
  try { me = await whoIs(req); } catch { me = null; }
  if (me) return !me.tv && !ADULTS.includes(me.account && me.account.role);
  let d = null;
  try { d = deviceOf ? deviceOf(req) : null; } catch { d = null; }
  return !!(d && d.known && d.ownerRole && !ADULTS.includes(d.ownerRole));
}

function refuse(isKid, adult) {
  if (adult && isKid) throw Object.assign(new Error('Adult games aren\'t available on a kid\'s account.'), { status: 403 });
}

async function refuseKids(req, adult) {
  if (!adult) return;
  refuse(await kid(req), adult);
}

module.exports = { use, kid, refuse, refuseKids };
