'use strict';

// Passing feedback on to ARKS ID's one inbox (its contract v10), server to
// server, with a small queue for when ARKS ID can't be reached.
//
// When an app signs in through ARKS ID, the notes people send with the
// feedback card aren't stored in the app anymore. The app's server checks the
// note as before and hands it to ARKS ID, where the admin reads every app's
// feedback in one place. If ARKS ID doesn't answer, the note waits in a small
// table in the app's own database and is sent again a little later, so the
// person who sent it is told it arrived either way and nothing is lost.
//
// The person's "My feedback" list goes through here too: the app asks ARKS ID
// for their notes with the ARKS ID session it holds for them.
//
// Part of the shared kit: every app has this exact file in kit/feedback-relay.js.
// The app passes in how it talks to ARKS ID (`call`), so its own client, its
// app secret and its tests' pretend ARKS ID all stay in the app.
//
// createRelay({ db, call, now, log })
//   db    a node:sqlite database; the queue lives in its feedback_outbox table
//   call  async (method, path, body) -> { status, data }, where path is what
//         comes after /api/app/feedback. It throws when ARKS ID can't be reached.

const crypto = require('node:crypto');

// How long to wait before sending a queued note again: 30 seconds after the
// first miss, doubling each time, never more than 30 minutes apart.
const RETRY_FIRST_MS = 30 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;
// Each round sends at most this many, oldest first.
const ROUND = 20;
// With this many notes already waiting, a new one waits without its picture,
// so a long outage can't fill the disk with screenshots.
const QUEUE_PICTURES_MAX = 100;
// The app's own id for a note: random, so a note sent twice (a retry after an
// answer got lost) is recognized by ARKS ID and stored once.
const newRef = () => 'r_' + crypto.randomBytes(12).toString('hex');
const ID_RE = /^[1-9]\d{0,11}$/;
const SESSION_RE = /^s_[A-Za-z0-9]{1,64}$/;

function createRelay({ db, call, now = Date.now, log = msg => console.warn(msg) }) {
  db.exec(`CREATE TABLE IF NOT EXISTS feedback_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_ref TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    last_error TEXT
  )`);

  const waiting = () => db.prepare('SELECT COUNT(*) AS n FROM feedback_outbox').get().n;

  // One try. -> { id, pictureDropped } when ARKS ID took it, { rejected, error }
  // when it refused the note itself (400), or { retry, error } for anything
  // that might work later (can't reach it, a wrong secret, too many at once,
  // ARKS ID having a problem).
  async function post(payload) {
    let r;
    try { r = await call('POST', '', payload); } catch (err) { return { retry: true, error: `ARKS ID couldn't be reached (${err.message})` }; }
    const d = r.data || {};
    if ((r.status === 200 || r.status === 201) && Number.isInteger(d.id) && d.id > 0) return { id: d.id, pictureDropped: !!d.pictureDropped };
    if (r.status === 400 || r.status === 413) return { rejected: true, error: typeof d.error === 'string' ? d.error : 'ARKS ID turned the note down.' };
    // 404: this ARKS ID is older than contract v10 and has no inbox yet (the
    // app was updated first). A queued note keeps waiting for it; a new one
    // goes back to the app, which keeps it in its own inbox as before.
    if (r.status === 404) return { retry: true, older: true, error: 'ARKS ID has no feedback inbox yet (it is older than contract v10)' };
    return { retry: true, error: `ARKS ID answered ${r.status}` };
  }

  function queue(payload, error) {
    let pictureDropped = false;
    if (payload.picture && waiting() >= QUEUE_PICTURES_MAX) { payload = { ...payload, picture: null }; pictureDropped = true; }
    db.prepare('INSERT OR IGNORE INTO feedback_outbox (app_ref, payload, created_at, tries, next_at, last_error) VALUES (?, ?, ?, 1, ?, ?)')
      .run(payload.appRef, JSON.stringify(payload), now(), now() + RETRY_FIRST_MS, error);
    return { queued: true, pictureDropped };
  }

  // A new note from the feedback card, already checked by the app:
  // { kind, body, picture, details, person }. -> { id } (ARKS ID's number for
  // it), { queued: true } (it waits and goes later), { older: true } (ARKS ID
  // has no inbox yet, so the app keeps the note itself), or { error } (ARKS ID
  // refused it, with a sentence the app can show). pictureDropped can ride
  // along with the first two.
  async function send(note) {
    const payload = { ...note, appRef: newRef(), sentAt: now() };
    const r = await post(payload);
    if (r.id) return { id: r.id, pictureDropped: r.pictureDropped };
    if (r.rejected) return { error: r.error };
    if (r.older) return { older: true };
    return queue(payload, r.error);
  }

  // Sends what's waiting, oldest first. A note ARKS ID refuses outright is
  // dropped (and logged), since sending it again would get the same answer.
  let busy = false;
  async function flush() {
    if (busy) return { sent: 0, waiting: waiting() };
    busy = true;
    let sent = 0;
    try {
      const rows = db.prepare('SELECT * FROM feedback_outbox WHERE next_at <= ? ORDER BY id LIMIT ?').all(now(), ROUND);
      for (const row of rows) {
        let payload;
        try { payload = JSON.parse(row.payload); } catch { payload = null; }
        if (!payload) { db.prepare('DELETE FROM feedback_outbox WHERE id = ?').run(row.id); continue; }
        const r = await post(payload);
        if (r.id || r.rejected) {
          db.prepare('DELETE FROM feedback_outbox WHERE id = ?').run(row.id);
          if (r.id) sent++;
          else log(`A waiting feedback note was dropped because ARKS ID turned it down: ${r.error}`);
          continue;
        }
        const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(row.tries, 10));
        db.prepare('UPDATE feedback_outbox SET tries = tries + 1, next_at = ?, last_error = ? WHERE id = ?').run(now() + wait, r.error, row.id);
        // ARKS ID is still away: the rest can wait for the next round.
        break;
      }
    } finally { busy = false; }
    return { sent, waiting: waiting() };
  }

  let timer = null;
  function start(everyMs = 60 * 1000) {
    if (timer) return;
    timer = setInterval(() => { flush().catch(err => log(`Sending waiting feedback failed: ${err.message}`)); }, everyMs);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  // ---- The person's own notes, through the ARKS ID session the app holds ----
  // Each answers { status, data } as ARKS ID sent it (data.error is a
  // sentence ready to show), and throws when ARKS ID can't be reached.
  const badId = { status: 404, data: { error: "That feedback isn't there anymore." } };
  const noSession = { status: 401, data: { error: 'Sign in first.' } };
  const ask = async (method, path, body) => {
    const r = await call(method, path, body);
    return { status: r.status, data: r.data && typeof r.data === 'object' ? r.data : {} };
  };
  const q = session => '?session=' + encodeURIComponent(session);
  const checks = (session, id) => (!SESSION_RE.test(String(session || '')) ? noSession : id !== undefined && !ID_RE.test(String(id)) ? badId : null);
  const person = {
    mine: (session, view) => checks(session) || ask('GET', q(session) + '&view=' + (view === 'archive' ? 'archive' : 'open')),
    thread: (session, id) => checks(session, id) || ask('GET', '/' + id + q(session)),
    edit: (session, id, body) => checks(session, id) || ask('PUT', '/' + id, { session, body }),
    reply: (session, id, body) => checks(session, id) || ask('POST', '/' + id + '/replies', { session, body }),
    remove: (session, id) => checks(session, id) || ask('DELETE', '/' + id + q(session))
  };

  return { send, flush, start, stop, waiting, ...person };
}

module.exports = { createRelay, RETRY_FIRST_MS, RETRY_MAX_MS, QUEUE_PICTURES_MAX };
