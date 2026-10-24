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
const MAX_PICTURE = 3 * 1024 * 1024;
const VERSION = require('../package.json').version;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Only a PNG or JPEG data URL, checked by its first bytes, not its label.
function readPicture(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw fail('The screenshot has to be a PNG or JPEG picture.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_PICTURE) throw fail('That screenshot is too big. Try a smaller one.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw fail('The screenshot has to be a PNG or JPEG picture.');
  return { bytes, ext: png ? 'png' : 'jpg' };
}

function savePicture(id, picture) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${id}.${picture.ext}`;
  fs.writeFileSync(path.join(DIR, file), picture.bytes);
  return file;
}

function picturePath(file) {
  return file && /^\d+\.(png|jpg)$/.test(file) ? path.join(DIR, file) : null;
}

function removePicture(file) {
  const p = picturePath(file);
  if (p) fs.rm(p, { force: true }, () => {});
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

// Everything the admin sees under "Details", built on the server so the
// sender can't put anything else in it.
function details(req, sent = {}) {
  return {
    screen: String(sent.screen || '').slice(0, 20).replace(/[^0-9x]/g, ''),
    device: deviceOf(req.get('User-Agent')),
    version: VERSION
  };
}

module.exports = { readPicture, savePicture, picturePath, removePicture, cleanPage, details };
