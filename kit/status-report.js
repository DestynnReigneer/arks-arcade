'use strict';

// Telling ARKS ID how this app is doing (its contract v12), server to server.
//
// Every few minutes the app's server sends one small report: which build is
// running, how long it has been up, how big its database is, and how much room
// is left on the disk its data lives on. ARKS ID's admin console shows every
// app's latest report on one page, and an app that stops reporting shows up
// there as "not reporting".
//
// The app can also tell ARKS ID about something worth a look on its security
// page, like someone opening the app's admin console (`event`). An event that
// can't be sent right away waits in memory and goes with the next report, so
// a short outage doesn't lose it. Nothing here is ever shown to the family.
//
// Part of the shared kit: every app has this exact file in kit/status-report.js.
// The app passes in how it talks to ARKS ID (`call`), so its own client, its
// app secret and its tests' pretend ARKS ID all stay in the app. ARKS ID uses
// collectStatus() for its own numbers and never reports to itself.
//
// collectStatus({ dbFile })
//   -> { version, commit, built, node, dbBytes, diskFreeBytes, diskTotalBytes, uptimeSec }
//   Any number it can't work out is null.
//
// createStatusReporter({ call, dbFile, now, log })
//   call    async (path, body) -> { status, data }, where path is '/status' or
//           '/event' (what comes after /api/app). It throws when ARKS ID can't
//           be reached.
//   dbFile  the app's SQLite file; its folder is where the disk space is measured.

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('./version');

// How often a report goes: a few minutes, so a stopped app is noticed within
// the quarter of an hour ARKS ID waits before saying "not reporting".
const EVERY_MS = 5 * 60 * 1000;
// Events waiting for ARKS ID, at most. When more pile up, the oldest goes.
const EVENTS_MAX = 20;
// The kinds of event ARKS ID knows about (contract v12).
const KINDS = ['console-opened'];

const sizeOf = file => { try { return fs.statSync(file).size; } catch { return 0; } };

// The database's size on disk, counting the write-ahead log SQLite keeps next
// to it (a busy app can have a lot waiting there). null when there's no file.
function dbBytes(dbFile) {
  if (!dbFile || dbFile === ':memory:' || !fs.existsSync(dbFile)) return null;
  return sizeOf(dbFile) + sizeOf(dbFile + '-wal');
}

// Free and total space on the disk that holds the database's folder. "Free"
// is what this app may still write (statfs's bavail), not counting the space
// the system keeps back for itself.
function disk(dbFile) {
  if (!dbFile || dbFile === ':memory:') return { free: null, total: null };
  try {
    const s = fs.statfsSync(path.dirname(path.resolve(dbFile)));
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return { free: null, total: null };
  }
}

function collectStatus({ dbFile } = {}) {
  const v = version();
  const d = disk(dbFile);
  return {
    version: v.version,
    commit: v.commit,
    built: v.built,
    node: v.node,
    dbBytes: dbBytes(dbFile),
    diskFreeBytes: d.free,
    diskTotalBytes: d.total,
    uptimeSec: Math.round(process.uptime())
  };
}

function createStatusReporter({ call, dbFile, now = Date.now, log = msg => console.warn(msg) }) {
  const waiting = [];
  let told = '';
  // One line in the log when something changes, not one every five minutes.
  const say = msg => { if (msg !== told) { told = msg; if (msg) log(msg); } };

  // Sends the waiting events, oldest first. Stops at the first one that
  // can't get through; ARKS ID refusing one outright (400) drops it.
  async function sendEvents() {
    while (waiting.length) {
      let r;
      try { r = await call('/event', waiting[0]); } catch { return; }
      if (r.status === 200 || r.status === 201 || r.status === 400) { waiting.shift(); continue; }
      return;
    }
  }

  // One report. -> true when ARKS ID took it.
  async function report() {
    await sendEvents();
    let r;
    try { r = await call('/status', collectStatus({ dbFile })); } catch (err) {
      say(`The status report couldn't reach ARKS ID (${err.message}). It will try again in a few minutes.`);
      return false;
    }
    if (r.status === 200) { say(''); return true; }
    // 404: this ARKS ID is older than contract v12 and doesn't take reports yet.
    say(r.status === 404
      ? 'ARKS ID doesn\'t take status reports yet (it is older than contract v12). The app keeps trying.'
      : `ARKS ID answered ${r.status} to the status report.`);
    return false;
  }

  // Something for ARKS ID's security page. kind: 'console-opened'.
  // fields: { how: 'own-pin' | 'app-pin', person: { user: 'u_…' } | {}, where: 'a few words' }
  function event(kind, fields = {}) {
    if (!KINDS.includes(kind)) throw new Error(`Unknown event kind: ${kind}`);
    waiting.push({ kind, ...fields, at: now() });
    while (waiting.length > EVENTS_MAX) waiting.shift();
    sendEvents().catch(() => {});
  }

  let timer = null;
  function start(everyMs = EVERY_MS) {
    if (timer) return;
    // The first report goes a few seconds after starting, so the console
    // shows a restarted app as up straight away.
    const first = setTimeout(() => { report().catch(() => {}); }, 5000);
    if (first.unref) first.unref();
    timer = setInterval(() => { report().catch(() => {}); }, everyMs);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { report, event, start, stop, waiting: () => waiting.length };
}

module.exports = { collectStatus, createStatusReporter, EVERY_MS, EVENTS_MAX, KINDS };
