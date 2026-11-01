'use strict';

// The extra parts of a feedback message sent from the bug's card
// (public/feedback.js): an optional screenshot, the page it came from, and a
// few details about the device. The Comm Center (comm.js) stores the message
// itself; this file checks and saves the rest.
//
// Pictures are saved as files in data/feedback/, named by the message's id,
// and only the admin page can open them.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'data', 'feedback');
// The same numbers in every app with the feedback card (2026-11-01) come from
// the shared kit (kit/feedback.js): one picture is at most 1.5 MB (the card
// shrinks screenshots to fit), and all the pictures together at most 500 MB.
// Past that, notes still arrive, just without their picture, so a flood of
// screenshots can't fill the disk. The kit also checks the picture and cleans
// the details the browser sent.
const kit = require('../kit/feedback');
const { MAX_PICTURE, BODY_LIMIT } = kit;
const MAX_TOTAL = process.env.NODE_ENV === 'test' && Number(process.env.FEEDBACK_PICTURES_MAX_BYTES) > 0
  ? Number(process.env.FEEDBACK_PICTURES_MAX_BYTES)   // the tests try a tiny cap
  : kit.PICTURE_CAP;
const { version } = require('../kit/version');

// Only a real PNG or JPEG. One over 1.5 MB is answered with 413 here, the same
// as a whole note too big to read.
function readPicture(dataUrl) {
  try {
    return kit.readPicture(dataUrl);
  } catch (err) {
    if (err.tooBig) err.status = 413;
    throw err;
  }
}

// How much the saved pictures take up, counted once from the folder and then
// kept up to date as pictures come and go.
let total = null;
function picturesTotal() {
  if (total !== null) return total;
  total = 0;
  try {
    for (const f of fs.readdirSync(DIR)) {
      if (/^\d+\.(png|jpg)$/.test(f)) { try { total += fs.statSync(path.join(DIR, f)).size; } catch { /* gone */ } }
    }
  } catch { /* no folder yet */ }
  return total;
}
// Whether one more picture of this size still fits under the cap.
const pictureFits = picture => picturesTotal() + picture.bytes.length <= MAX_TOTAL;

function savePicture(id, picture) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${id}.${picture.ext}`;
  fs.writeFileSync(path.join(DIR, file), picture.bytes);
  total = picturesTotal() + picture.bytes.length;
  return file;
}

function picturePath(file) {
  return file && /^\d+\.(png|jpg)$/.test(file) ? path.join(DIR, file) : null;
}

function removePicture(file) {
  const p = picturePath(file);
  if (!p) return;
  let size = 0;
  try { size = fs.statSync(p).size; } catch { return; }
  try { fs.rmSync(p, { force: true }); } catch { return; }
  if (total !== null) total = Math.max(0, total - size);
}

// The page's path only: no query string, so nothing like a room password or
// token ends up in the details.
function cleanPage(raw) {
  const p = String(raw || '').split(/[?#]/)[0].slice(0, 120);
  return /^\/[A-Za-z0-9._\-/]*$/.test(p) ? p : null;
}

function deviceOf(ua) {
  ua = String(ua || '');
  const kind = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'phone' : 'computer';
  const system = /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'unknown system';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'unknown browser';
  return `${kind}, ${system}, ${browser}`;
}

// Which build this is (see kit/version.js).
function appVersion(env) {
  const v = version(env);
  return { name: 'Arcade', version: v.version, commit: v.commit };
}

// Everything the admin sees under "Details": what the bug collected in the
// browser since the page loaded (only these fields, each cut to size), plus
// what the server knows itself. Nobody's name comes from here; comm.js takes
// that from the profile's token.
function details(req, sent = {}) {
  const d = kit.cleanDetails(sent);
  return {
    ...d,
    screen: d.screen.replace(/[^0-9x]/g, ''), window: d.window.replace(/[^0-9x]/g, ''),
    device: deviceOf(req.get('User-Agent')),
    version: version().version,
    app: appVersion(),
    server: { receivedAt: new Date().toISOString(), userAgent: kit.str(req.get('User-Agent'), 300) }
  };
}

module.exports = { readPicture, savePicture, picturePath, removePicture, pictureFits, picturesTotal, cleanPage, details, appVersion,
  MAX_PICTURE, MAX_TOTAL, BODY_LIMIT };
