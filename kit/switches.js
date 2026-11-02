'use strict';

// Switches and the banner from ARKS ID's console (its contract v13), server
// to server.
//
// Switches: the app tells ARKS ID which of its features can be turned on or
// off (`features`), each with the app's own defaults, and ARKS ID's console
// lets the admin set each one for the whole app, for each role and for one
// person. When a page needs to know, the app asks for the answers that apply
// to the person signed in (or to nobody signed in) and keeps them for a
// minute, so a busy page doesn't ask on every request.
//
// The banner: one short message the admin types once in ARKS ID's console.
// Every app shows it at the top of its pages until it's cleared or it ends.
// The app asks for it about once a minute and hands it to its pages.
//
// When ARKS ID can't be reached, the last answer it gave keeps working. When
// there has never been one, or ARKS ID is older than contract v13 (a 404),
// these give back null and the app carries on with its own settings, exactly
// as it did before switches existed.
//
// Part of the shared kit: every app has this exact file in kit/switches.js.
// The app passes in how it talks to ARKS ID (`call`), so its own client, its
// app secret and its tests' pretend ARKS ID all stay in the app.
//
// createSwitches({ call, features, now, ttlMs, log })
//   call      async (method, path, body) -> { status, data }, where path is
//             what comes after /api/app ('/features', '/switches?…',
//             '/switches/import'). It throws when ARKS ID can't be reached.
//   features  () -> [{ key, name, group, about, on, roles: { guest, kid, teen, adult, admin } }]
//             what the app can switch, with its defaults: `on` for the whole
//             app, and each role's answer. `guest` means nobody signed in.
//   .forSession(sessionId | null) -> { switches: { key: true|false }, decided: [key…] } or null
//   .changed()   the list or a default changed: send it again now
//   .importOnce(settings) -> true when ARKS ID took it (see the contract)
//   .start() / .stop()
//
// createBanner({ call, now, ttlMs })
//   call      async (method, path) -> { status, data }; path is '/banner'
//   .get() -> { id, text, tone, until, at } or null
//   .forget()  ask again next time (the app's admin just saved something)

const crypto = require('node:crypto');

// How long an answer is kept before asking ARKS ID again.
const TTL_MS = 60 * 1000;
// The feature list goes again this often, in case ARKS ID was restarted from
// a backup or missed it.
const REGISTER_EVERY_MS = 30 * 60 * 1000;
// Answers kept for at most this many sessions at once; the oldest goes first.
const CACHE_MAX = 200;
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SESSION_RE = /^s_[A-Za-z0-9]{1,64}$/;
const ROLES = ['guest', 'kid', 'teen', 'adult', 'admin'];
const TONES = ['info', 'warning'];

// Only true/false answers for keys that look right.
function cleanAnswer(d) {
  if (!d || typeof d !== 'object' || !d.switches || typeof d.switches !== 'object') return null;
  const switches = {};
  for (const [k, v] of Object.entries(d.switches)) if (KEY_RE.test(k) && typeof v === 'boolean') switches[k] = v;
  const decided = (Array.isArray(d.decided) ? d.decided : []).filter(k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(switches, k));
  return { switches, decided };
}

// The app's list, checked and trimmed the way ARKS ID will store it.
function cleanFeatures(list) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || !KEY_RE.test(f.key) || seen.has(f.key)) continue;
    seen.add(f.key);
    const roles = {};
    for (const r of ROLES) roles[r] = !!(f.roles && f.roles[r]);
    out.push({
      key: f.key,
      name: String(f.name || f.key).slice(0, 60),
      group: String(f.group || '').slice(0, 40),
      about: String(f.about || '').slice(0, 300),
      on: f.on !== false,
      roles
    });
  }
  return out.slice(0, 200);
}

function createSwitches({ call, features, now = Date.now, ttlMs = TTL_MS, log = msg => console.warn(msg) }) {
  const cache = new Map();          // session id or '' -> { at, answer }
  let sent = '';                    // a fingerprint of the list ARKS ID last took
  let sentAt = 0;
  let older = false;                // ARKS ID said 404: it has no switches yet
  let told = '';
  const say = msg => { if (msg !== told) { told = msg; if (msg) log(msg); } };
  const fingerprint = list => crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex');

  // Sends the list when it changed, or every half hour. -> true when ARKS ID has it.
  async function register(force = false) {
    const list = cleanFeatures(features());
    const fp = fingerprint(list);
    if (!force && fp === sent && now() - sentAt < REGISTER_EVERY_MS) return true;
    let r;
    try { r = await call('PUT', '/features', { features: list }); } catch (err) {
      say(`The switch list couldn't reach ARKS ID (${err.message}). It will try again in a minute.`);
      return false;
    }
    if (r.status === 404) { older = true; say('ARKS ID doesn\'t have switches yet (it is older than contract v13). The app keeps its own settings.'); return false; }
    if (r.status !== 200) { say(`ARKS ID answered ${r.status} to the switch list.`); return false; }
    older = false;
    sent = fp; sentAt = now();
    say('');
    return true;
  }

  // The answers for one person (their ARKS ID session id) or for nobody signed in (null).
  async function forSession(sessionId) {
    const key = typeof sessionId === 'string' && SESSION_RE.test(sessionId) ? sessionId : '';
    const kept = cache.get(key);
    if (kept && now() - kept.at < ttlMs) return kept.answer;
    // Can't reach it: the last answer (or none) stands for another minute,
    // so pages don't each wait for ARKS ID while it's down.
    const miss = () => {
      const answer = kept ? kept.answer : null;
      keep(answer);
      return answer;
    };
    const keep = answer => {
      cache.delete(key);
      cache.set(key, { at: now(), answer });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    };
    let r;
    try { r = await call('GET', '/switches' + (key ? `?session=${encodeURIComponent(key)}` : ''), undefined); } catch {
      return miss();
    }
    if (r.status === 404) { older = true; cache.clear(); return null; }
    const answer = r.status === 200 ? cleanAnswer(r.data) : null;
    if (!answer) return miss();
    older = false;
    keep(answer);
    return answer;
  }

  // The app's list or one of its defaults changed (a game turned off in its
  // own admin page, a link added): forget the kept answers and send it now.
  function changed() {
    cache.clear();
    return register(true).catch(() => false);
  }

  // Settings the app kept itself before ARKS ID had switches, copied over
  // once. ARKS ID only fills in a feature nobody has set there yet.
  // settings: { key: { roles: { kid: true, … }, people: { u_…: 'on' | 'off' } } }
  // -> true when ARKS ID took it, false to try again later.
  async function importOnce(settings) {
    if (!(await register())) return false;
    let r;
    try { r = await call('POST', '/switches/import', { features: settings }); } catch { return false; }
    if (r.status === 200) { cache.clear(); return true; }
    return false;
  }

  let timer = null;
  function start(everyMs = 60 * 1000) {
    if (timer) return;
    const first = setTimeout(() => { register().catch(() => {}); }, 3000);
    if (first.unref) first.unref();
    timer = setInterval(() => { register().catch(() => {}); }, everyMs);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { register, forSession, changed, importOnce, start, stop, older: () => older };
}

// The banner, asked for at most once a minute. A banner whose end time has
// passed is never handed on, even from the kept copy.
function cleanBanner(b, t) {
  if (!b || typeof b !== 'object') return null;
  const text = typeof b.text === 'string' ? b.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : '';
  if (!text || !Number.isSafeInteger(b.id)) return null;
  const until = Number.isSafeInteger(b.until) ? b.until : null;
  if (until !== null && until <= t) return null;
  return { id: b.id, text, tone: TONES.includes(b.tone) ? b.tone : 'info', until, at: Number.isSafeInteger(b.at) ? b.at : null };
}

function createBanner({ call, now = Date.now, ttlMs = TTL_MS }) {
  let kept = null;      // { at, banner }
  let asking = null;
  async function ask() {
    let r;
    // Can't reach it: the kept banner (or none) stands for another minute.
    try { r = await call('GET', '/banner'); } catch { kept = { at: now(), banner: kept ? kept.banner : null }; return; }
    if (r.status === 404) { kept = { at: now(), banner: null }; return; }
    if (r.status !== 200 || !r.data || typeof r.data !== 'object') return;
    kept = { at: now(), banner: cleanBanner(r.data.banner, now()) };
  }
  async function get() {
    if (!kept || now() - kept.at >= ttlMs) {
      // One question at a time, however many pages ask at once.
      if (!asking) asking = ask().finally(() => { asking = null; });
      await asking;
    }
    return kept ? cleanBanner(kept.banner, now()) : null;
  }
  return { get, forget: () => { kept = null; } };
}

module.exports = { createSwitches, createBanner, cleanFeatures, cleanAnswer, cleanBanner, TTL_MS, ROLES };
