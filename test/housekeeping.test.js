'use strict';

// Rambler's housekeeping (rambler/housekeeping.js): /healthz only looks now,
// and a once-a-minute timer rolls the season over and refreshes the theme pack.

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

async function run({ base, root }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };

  console.log('\n-- /healthz no longer rolls the season over --');
  {
    // The running test server's own database. Its housekeeping timer is
    // slowed to once an hour for the suite, so nothing else rolls it over.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(root, 'data', 'test.db'));
    const open = () => db.prepare('SELECT * FROM seasons WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').get();
    const before = open();
    ok('there is an open season to try it on', !!before);
    if (before) {
      db.prepare('UPDATE seasons SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 60000).toISOString(), before.id);
      const answers = [];
      for (let i = 0; i < 3; i++) answers.push((await fetch(base + '/healthz')).status);
      ok('/healthz still answers 200', answers.every(s => s === 200), answers.join());
      const after = open();
      ok('…and the overdue season is still the open one (healthz left it alone)', after && after.id === before.id && !after.ended_at,
        JSON.stringify(after));
      db.prepare('UPDATE seasons SET ends_at = ? WHERE id = ?').run(before.ends_at, before.id);
    }
    db.close();
  }

  console.log('\n-- the housekeeping timer rolls it over --');
  {
    // In a separate process with its own throwaway database, so it can end
    // seasons without touching the test server's.
    const file = 'test-housekeeping.db';
    const clean = () => { for (const end of ['', '-journal', '-wal', '-shm']) { try { fs.unlinkSync(path.join(root, 'data', file + end)); } catch { /* not there */ } } };
    clean();
    const child = `
      const db = require('./db');
      const seasons = require('./rambler/seasons');
      const hk = require('./rambler/housekeeping');
      const past = () => new Date(Date.now() - 1000).toISOString();
      const out = {};
      const first = seasons.ensure();
      out.notDue = hk.tick() === null && db.currentSeason().id === first.id;
      db.updateSeason(first.id, { endsAt: past() });
      const rolled = hk.tick();
      const second = db.currentSeason();
      out.rolled = !!rolled && second.id !== first.id && !!db.getSeason(first.id).endedAt;
      out.nextEnds = !!second.endsAt && new Date(second.endsAt).getTime() > Date.now();
      out.everyMs = hk.EVERY_MS;
      db.updateSeason(second.id, { endsAt: past() });
      hk.start({ every: 50 });
      setTimeout(() => {
        hk.stop();
        out.timer = db.currentSeason().id !== second.id && !!db.getSeason(second.id).endedAt;
        console.log(JSON.stringify(out));
      }, 400);
    `;
    const r = spawnSync(process.execPath, ['-e', child], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, NODE_ENV: 'test', RAMBLER_DB: file }
    });
    let out = {};
    try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
    ok('the housekeeping check ran', r.status === 0 && Object.keys(out).length > 0, (r.stderr || r.stdout || '').slice(0, 400));
    ok('a season that isn\'t due yet is left alone', out.notDue === true);
    ok('an overdue season is ended and the next one opened', out.rolled === true);
    ok('…and the new one has its own end date in the future', out.nextEnds === true);
    ok('the timer runs once a minute', out.everyMs === 60000);
    ok('the timer itself rolls an overdue season over', out.timer === true);
    clean();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
