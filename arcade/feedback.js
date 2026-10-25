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

// Which build this is. CI bakes the git commit into the image (GIT_SHA).
function appVersion(env = process.env) {
  const sha = String(env.GIT_SHA || '').trim();
  return { name: 'Arcade', version: VERSION, commit: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 12) : 'dev' };
}

// One line of plain text: no control characters, cut to n.
const str = (v, n) => (v === undefined || v === null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const bool = v => (typeof v === 'boolean' ? v : null);
const list = (v, n) => (Array.isArray(v) ? v.slice(-n) : []);
// A path and its # part, never the ? part.
function cleanPath(v) {
  const s = String(v || '').replace(/\?[^#]*/, '').slice(0, 120);
  return /^\/[A-Za-z0-9._~\-/#%]*$/.test(s) ? s : '';
}

// Everything the admin sees under "Details": what the bug collected in the
// browser since the page loaded (only these fields, each cut to size), plus
// what the server knows itself. Nobody's name comes from here; comm.js takes
// that from the profile's token.
function details(req, sent = {}) {
  const d = sent && typeof sent === 'object' ? sent : {};
  return {
    page: cleanPath(d.page), view: str(d.view, 60),
    userAgent: str(d.userAgent, 300), platform: str(d.platform, 40), language: str(d.language, 20),
    timeZone: str(d.timeZone, 50), localTime: str(d.localTime, 40),
    screen: str(d.screen, 20).replace(/[^0-9x]/g, ''), window: str(d.window, 20).replace(/[^0-9x]/g, ''), pixelRatio: num(d.pixelRatio),
    touch: bool(d.touch), colorScheme: str(d.colorScheme, 10), reducedMotion: bool(d.reducedMotion),
    online: bool(d.online), connection: str(d.connection, 20),
    openForSeconds: num(d.openForSeconds), loadMs: num(d.loadMs),
    errors: list(d.errors, 10).map(e => ({ at: str(e && e.at, 30), message: str(e && e.message, 300), source: str(e && e.source, 200) })),
    requests: list(d.requests, 10).map(r => ({ at: str(r && r.at, 30), method: str(r && r.method, 8).toUpperCase(), path: cleanPath(r && r.path), status: num(r && r.status), ms: num(r && r.ms) })),
    device: deviceOf(req.get('User-Agent')),
    version: VERSION,
    app: appVersion(),
    server: { receivedAt: new Date().toISOString(), userAgent: str(req.get('User-Agent'), 300) }
  };
}

module.exports = { readPicture, savePicture, picturePath, removePicture, cleanPage, details, appVersion };
