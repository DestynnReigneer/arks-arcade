'use strict';

// ARKS ID photos and team pictures (2026-11-01): which picture addresses the
// arcade's server will fetch from ARKS ID, and the avatar id a profile gets
// when its account has a picture. Kept apart from arksid.js so it can be
// tested without a database. public/avatar-photo.js draws these avatars.

const crypto = require('node:crypto');
const Avatars = require('../public/avatars');

// The account's picture address, like "<ARKS_ID_URL>/avatars/u_7f3c9a2e1b.webp?v=3"
// or a team picture at "/avatars/teams/<name>.png", turned into the path to
// ask ARKS ID for. Anything on another site, or any other path: null.
function photoPath(image, base) {
  let u;
  try { u = new URL(String(image)); } catch { return null; }
  try { if (u.origin !== new URL(base).origin) return null; } catch { return null; }
  const own = /^\/avatars\/u_[A-Za-z0-9]{1,40}\.(webp|jpg)$/.test(u.pathname);
  const team = /^\/avatars\/teams\/[a-z0-9-]{1,40}\.png$/.test(u.pathname);
  if ((!own && !team) || !/^(\?v=\d{1,9})?$/.test(u.search)) return null;
  return u.pathname + u.search;
}
// The first bytes have to match the type ARKS ID said it is.
function looksLike(type, b) {
  if (type === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
}
// A profile's avatar when its account has a picture:
// "photo:<profile id>:<8 letters that change with each new picture>:<fallback>".
// The fallback is the icon (or character) to draw if the picture can't load.
// public/avatar-photo.js draws it in the browser.
const PHOTO_RE = /^photo:([A-Za-z0-9]{1,40}):([0-9a-f]{8}):(.+)$/;
const photoAvatar = (profileId, image, fallback) =>
  `photo:${profileId}:${crypto.createHash('sha256').update(String(image)).digest('hex').slice(0, 8)}:${fallback || Avatars.DEFAULT}`;
const isPhotoAvatar = id => {
  const m = PHOTO_RE.exec(String(id || ''));
  return !!m && Avatars.valid(m[3]);
};

module.exports = { photoPath, looksLike, photoAvatar, isPhotoAvatar };
