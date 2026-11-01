'use strict';

// The parts of the feedback card's server side that every ARKS app shares:
// the limits on pictures and text, checking a screenshot, cleaning the
// diagnostics the page collected, and the optional one-line Discord ping.
//
// Part of the shared kit: every app has this exact file in kit/feedback.js.
// Each app keeps its own routes and storage in its own feedback.js (who sent
// it, where it's saved, what the admin sees) and calls these helpers.

const MB = 1024 * 1024;
// The same numbers in every app (Destynn, 2026-11-01): a note is at most 5000
// characters, a screenshot at most 1.5 MB (the card shrinks it to fit before
// sending), and all the saved pictures together at most 500 MB. Past that,
// notes still arrive, just without their picture, so a flood of screenshots
// can't fill the disk.
const TEXT_MAX = 5000;
const NAME_MAX = 30;
const MAX_PICTURE = 1.5 * MB;
const PICTURE_CAP = 500 * MB;
// A JSON body that holds the biggest picture (base64 makes it a third
// bigger) plus the note and its details.
const BODY_LIMIT = '2.5mb';
// How a saved picture is named: the feedback's id and its type.
const PICTURE_FILE = /^\d+\.(png|jpg)$/;

// ---- Discord ----
// Only Discord's own webhook addresses, so the setting can't point the
// server anywhere else.
const WEBHOOK = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
function discordProblem(env = process.env) {
  const url = String(env.DISCORD_WEBHOOK_URL || '').trim();
  return !url || WEBHOOK.test(url) ? null
    : 'DISCORD_WEBHOOK_URL has to be a Discord webhook address, like https://discord.com/api/webhooks/123/abc, or blank.';
}
function createDiscord(env = process.env, fetchImpl = fetch) {
  const url = String(env.DISCORD_WEBHOOK_URL || '').trim();
  if (!url || !WEBHOOK.test(url)) return null;
  // Nobody gets pinged by name, whatever the feedback says.
  return line => fetchImpl(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: line.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => { /* Discord being down never stops feedback from saving */ });
}

// ---- Checking what the browser sent ----
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

// Only a PNG or JPEG data URL, checked by its first bytes, not its label.
// A picture over the limit throws with tooBig set, so an app can answer it
// with its own status code.
function readPicture(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw fail('The screenshot has to be a PNG or JPEG picture.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_PICTURE) {
    throw Object.assign(fail('That screenshot is bigger than 1.5 MB, which is too big to send. Try a smaller one, or crop it first.'), { tooBig: true });
  }
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw fail('The screenshot has to be a PNG or JPEG picture.');
  return { bytes, ext: png ? 'png' : 'jpg' };
}

// One line of plain text: no control characters, cut to n.
const str = (v, n) => (v === undefined || v === null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const bool = v => (typeof v === 'boolean' ? v : null);
const list = (v, n) => (Array.isArray(v) ? v.slice(-n) : []);
// A path and its # part, never the ? part, so nothing like a code, a token or
// a return address ends up in the details.
function cleanPath(v) {
  const s = String(v || '').replace(/\?[^#]*/, '').slice(0, 120);
  return /^\/[A-Za-z0-9._~\-/#%]*$/.test(s) ? s : '';
}

// The diagnostics the browser collected since the page loaded. Only these
// fields, each cut to size; an app adds what its own server knows.
function cleanDetails(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    page: cleanPath(d.page), view: str(d.view, 60),
    userAgent: str(d.userAgent, 300), platform: str(d.platform, 40), language: str(d.language, 20),
    timeZone: str(d.timeZone, 50), localTime: str(d.localTime, 40),
    screen: str(d.screen, 20), window: str(d.window, 20), pixelRatio: num(d.pixelRatio),
    touch: bool(d.touch), colorScheme: str(d.colorScheme, 10), reducedMotion: bool(d.reducedMotion),
    online: bool(d.online), connection: str(d.connection, 20),
    openForSeconds: num(d.openForSeconds), loadMs: num(d.loadMs),
    errors: list(d.errors, 10).map(e => ({ at: str(e && e.at, 30), message: str(e && e.message, 300), source: str(e && e.source, 200) })),
    requests: list(d.requests, 10).map(r => ({ at: str(r && r.at, 30), method: str(r && r.method, 8).toUpperCase(), path: cleanPath(r && r.path), status: num(r && r.status), ms: num(r && r.ms) }))
  };
}

// The feedback text keeps its line breaks; everything else is plain text.
// -> the text, or null when it's empty or longer than TEXT_MAX.
function cleanBody(v) {
  const s = String(v || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s && s.length <= TEXT_MAX ? s : null;
}

module.exports = {
  MB, TEXT_MAX, NAME_MAX, MAX_PICTURE, PICTURE_CAP, BODY_LIMIT, PICTURE_FILE,
  discordProblem, createDiscord, readPicture, cleanDetails, cleanBody, cleanPath, str, num, bool, list
};
