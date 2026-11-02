'use strict';

// Moonshot: the pitches and the scoring (no server needed) and the API
// (against the real server). The same seed always throws the same pitches,
// known swing times always give the same hits and score, the server's score
// is its own replay of the swing times, swings that couldn't have happened
// are refused, and the boards come back in order.

const path = require('node:path');

async function run({ base, root }) {
  const E = require(path.join(root, 'public/moonshot-engine.js'));
  const API = base + '/api/moonshot';
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function api(p, method = 'GET', body) {
    const res = await fetch(API + p, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
  // Swing times from offsets (ms from perfect) per pitch; null lets a pitch go by.
  const swingsFor = (p, offsets) => offsets.map((o, k) => (o === null ? null : p.pitches[k].plate + o)).filter(t => t !== null);

  console.log('\n-- moonshot: the pitches --');
  const a = E.plan(123456), b = E.plan(123456), c = E.plan(654321);
  ok('the same seed always throws the same pitches', JSON.stringify(a) === JSON.stringify(b));
  ok('a different seed throws different pitches', JSON.stringify(a) !== JSON.stringify(c));
  ok('a run is twelve pitches', a.pitches.length === 12 && E.PITCHES === 12);
  ok('the first pitch is always a fastball, to get you started', [1, 2, 3, 99, 123456].every(s => E.plan(s).pitches[0].type === 'fastball'));
  ok('pitches 1-4 are level 1, 5-8 level 2 and 9-12 level 3', a.pitches.map(p => p.level).join('') === '111122223333');
  ok('every pitch leaves after its windup, reaches the plate, then its chance to swing closes, in order',
    a.pitches.every((p, i) => p.start < p.release && p.release < p.plate && p.close === p.plate + E.LATE_MS &&
      (!i || p.start === a.pitches[i - 1].close + E.AFTER_MS)));
  ok('the run ends when the last pitch\'s chance to swing closes', a.end === a.pitches[11].close);
  // Over many seeds: all three kinds show up, later pitches are faster, a run lasts about a minute.
  const seen = new Set();
  let faster = true, length = true;
  for (let s = 1; s <= 300; s++) {
    const p = E.plan(s);
    for (const x of p.pitches) seen.add(x.type);
    for (const type of Object.keys(E.TYPES)) {
      const by = lvl => p.pitches.filter(x => x.type === type && x.level === lvl).map(x => x.travel);
      const one = by(1), three = by(3);
      if (one.length && three.length && Math.min(...one) <= Math.max(...three)) faster = false;
    }
    if (p.end < 40000 || p.end > 70000) length = false;
  }
  ok('fastballs, changeups and curveballs all come up', seen.size === 3, [...seen].join());
  ok('each kind of pitch is faster at level 3 than at level 1', faster);
  ok('a run lasts about a minute', length);
  ok('only curveballs bend', a.pitches.every(p => (p.type === 'curve') === (p.bend !== 0)));

  console.log('\n-- moonshot: timing and scoring --');
  ok('a swing right on time is a home run', E.kindOf(0) === 'homer' && E.kindOf(-25) === 'homer' && E.kindOf(25) === 'homer');
  ok('the further off, the smaller the hit',
    ['triple', 'double', 'single', 'grounder', 'foul', 'whiff'].every((k, i) => E.kindOf([26, 51, 81, 121, 161, 211][i]) === k &&
      E.kindOf(-[50, 80, 120, 160, 210, 400][i]) === k));
  const perfect = swingsFor(a, Array(12).fill(0));
  const all = E.replay(123456, perfect);
  ok('twelve perfect swings are twelve home runs and the most a run can score',
    all.homers === 12 && all.bestStreak === 12 && all.total === E.MAX_SCORE, `${all.total} vs ${E.MAX_SCORE}`);
  ok('the most a run can score is 6,700', E.MAX_SCORE === 6700);
  const triples = E.replay(123456, swingsFor(a, Array(12).fill(30)));
  ok('twelve swings 30 ms late are twelve triples worth 60 x the level', triples.results.every(r => r.kind === 'triple' && !r.early) && triples.total === 60 * 24);
  const singles = E.replay(123456, swingsFor(a, Array(12).fill(-100)));
  ok('twelve swings 100 ms early are twelve singles', singles.results.every(r => r.kind === 'single' && r.early) && singles.total === 25 * 24);
  // A known run: HR, HR (streak +50), let one go, double, then level 2: HR, HR
  // (+50), foul, a swing far too early, then level 3: HR, grounder, single, HR.
  const offsets = [0, 10, null, -60, -20, 5, 180, -300, 0, 140, -110, 24];
  const known = E.replay(123456, swingsFor(a, offsets));
  const expectKinds = 'homer homer taken double homer homer foul whiff homer grounder single homer';
  const expectPoints = [100, 150, 0, 40, 200, 300, 4, 0, 300, 15, 75, 300];
  ok('known swing times give known hits', known.results.map(r => r.kind).join(' ') === expectKinds, known.results.map(r => r.kind).join(' '));
  ok('…and known points, with the streak bonus and the level', known.results.map(r => r.points).join() === expectPoints.join(),
    known.results.map(r => r.points).join());
  ok('…and the total is the sum', known.total === expectPoints.reduce((n, x) => n + x, 0) && known.total === 1484, String(known.total));
  ok('…and it counts six home runs, two in a row at most', known.homers === 6 && known.bestStreak === 2);
  ok('replaying the same swing times gives the same result', JSON.stringify(known) === JSON.stringify(E.replay(123456, swingsFor(a, offsets))));
  // "So close" is only for a real near miss.
  const near = E.replay(123456, swingsFor(a, [35, 40, -26, 45, -300, null]));
  ok('"so close" is said for a hit just outside the home-run window, with the real gap',
    near.results[0].near && near.results[0].missedBy === 10 && near.results[1].near && near.results[2].near && near.results[2].missedBy === 1);
  ok('…but not for one further off, a whiff or a pitch let go by', !near.results[3].near && !near.results[4].near && !near.results[5].near);
  let honest = true;
  for (let s = 1; s <= 200; s++) {
    const p = E.plan(s);
    const r = E.replay(s, swingsFor(p, p.pitches.map((x, k) => ((s * 37 + k * 53) % 450) - 230)));
    for (const x of r.results) if (x.near && (x.homer || x.kind === 'taken' || x.missedBy > E.NEAR_MS)) honest = false;
  }
  ok('"so close" is never said for a home run or anything far off', honest);
  ok('a pitch with nothing swung at it, whose chance has passed, is a strike',
    E.replay(1, [], E.plan(1).pitches[2].close + 1).results.map(r => r.kind).join() === 'taken,taken,taken');
  ok('a pitch still on its way isn\'t counted yet', E.replay(1, [], E.plan(1).pitches[0].plate).results.length === 0);
  ok('a run with no swings at all is finished at the end, with nothing scored',
    (r => r.finished && r.total === 0 && r.results.length === 12)(E.replay(1, [])));

  console.log('\n-- moonshot: impossible swings --');
  const p1 = E.plan(1);
  ok('a swing before the first pitch leaves the machine is refused', throwsCode(() => E.replay(1, [p1.pitches[0].release - 1]), 'between'));
  ok('a swing between two pitches is refused', throwsCode(() => E.replay(1, [p1.pitches[0].close + 5]), 'between'));
  ok('two swings at one pitch are refused', throwsCode(() => E.replay(1, [p1.pitches[0].plate - 50, p1.pitches[0].plate]), 'between'));
  ok('swings out of order are refused', throwsCode(() => E.replay(1, [p1.pitches[1].plate, p1.pitches[0].plate]), 'between'));
  ok('a swing after the last pitch is refused', throwsCode(() => E.replay(1, [p1.end + 1]), 'done'));
  ok('a thirteenth swing is refused', throwsCode(() => E.replay(1, [...swingsFor(p1, Array(12).fill(0)), p1.end + 3000]), 'done'));
  ok('a time that isn\'t a whole number of milliseconds is refused', throwsCode(() => E.replay(1, [p1.pitches[0].plate + 0.5]), 'bad'));
  ok('a negative time is refused', throwsCode(() => E.replay(1, [-5]), 'bad'));

  console.log('\n-- moonshot: the API --');
  const rules = await api('/rules');
  ok('the rules say twelve pitches and what each hit is worth', rules.status === 200 && rules.data.pitches === 12 && rules.data.kinds.homer.points === 100);

  // A second run, started now, for a swing that arrives too late (at the end).
  const s2Start = Date.now();
  const s2 = (await api('/start', 'POST', {})).data;
  const s = (await api('/start', 'POST', {})).data;
  ok('starting hands out a run id and a seed', /^[0-9a-f]{32}$/.test(s.runId) && Number.isInteger(s.seed) && s.times.length === 0 && s.results.length === 0);
  ok('the test suite gets the test hook', s.testHook === true);
  ok('a run that isn\'t over can\'t be saved', (await api(`/run/${s.runId}/save`, 'POST', { initials: 'ABC' })).status === 409);
  const sp = E.plan(s.seed);
  const later = await api(`/run/${s.runId}/swing`, 'POST', { t: 500000 });
  ok('a swing later than the run has been going is refused', later.status === 400 && /later/.test(later.data.error), JSON.stringify(later.data));
  ok('a swing with no time is refused', (await api(`/run/${s.runId}/swing`, 'POST', {})).status === 400);
  const early = await api(`/run/${s.runId}/swing`, 'POST', { t: sp.pitches[0].release - 10 });
  ok('a swing before the first pitch is refused', early.status === 400 && /between pitches/.test(early.data.error), JSON.stringify(early.data));

  // The whole known run (the suite lets swings run ahead of the clock).
  const swings = swingsFor(sp, offsets);
  let last = null, first = null;
  for (const [i, t] of swings.entries()) {
    // A made-up score along with the time is ignored.
    last = await api(`/run/${s.runId}/swing`, 'POST', { t, score: 99999, total: 99999, kind: 'homer' });
    if (!i) first = last;
    if (last.status !== 200) break;
    if (i === 1) {
      const twice = await api(`/run/${s.runId}/swing`, 'POST', { t: t + 30 });
      ok('a second swing at the same pitch is refused', twice.status === 400, JSON.stringify(twice.data));
    }
    if (i === 2) ok('a pitch let go by comes back as a strike with the next swing', last.data.taken.length === 1 && last.data.taken[0].kind === 'taken' && last.data.result.kind === 'double');
  }
  ok('the first swing, right on time, is a home run', first.data.result.kind === 'homer' && first.data.total === 100);
  const expect = E.replay(s.seed, swings);
  ok('every swing counts and the run is finished', last.status === 200 && last.data.finished && last.data.left === 0, JSON.stringify(last.data));
  ok('the server\'s score is the replay of the swing times', last.data.total === expect.total && last.data.total === known.total, `${last.data.total} vs ${expect.total}`);
  const view = (await api(`/run/${s.runId}`)).data;
  ok('the run remembers every pitch the way the replay says', JSON.stringify(view.results) === JSON.stringify(expect.results) && view.finished);
  ok('a thirteenth swing is refused', (await api(`/run/${s.runId}/swing`, 'POST', { t: sp.end + 2000 })).status === 409);

  // The boards.
  ok('initials must be 1-3 letters or numbers', (await api(`/run/${s.runId}/save`, 'POST', { initials: 'a!' })).status === 400);
  const saved = await api(`/run/${s.runId}/save`, 'POST', { initials: 'ms1', score: 99999 });
  ok('a finished run saves with initials, with the replay\'s score', saved.status === 201 && saved.data.score === expect.total && saved.data.homers === 6 && saved.data.dayRank >= 1, JSON.stringify(saved.data));
  ok('…once', (await api(`/run/${s.runId}/save`, 'POST', { initials: 'MS1' })).status === 409);
  const day = (await api('/board?scope=day')).data;
  ok('today\'s board shows it', day.some(r => r.id === saved.data.id && r.initials === 'MS1' && r.score === expect.total && r.homers === 6 && r.bestStreak === 2));
  const allBoard = (await api('/board?scope=all')).data;
  ok('the all-time board shows it too', allBoard.some(r => r.id === saved.data.id));
  ok('boards are sorted best first', [day, allBoard].every(rows => rows.every((r, i) => !i || rows[i - 1].score >= r.score)));
  // A smaller score finds out exactly how far behind the next one up it is.
  const s4 = (await api('/start', 'POST', {})).data;
  const p4 = E.plan(s4.seed);
  await api(`/run/${s4.runId}/swing`, 'POST', { t: p4.pitches[0].plate - 100 });
  await api(`/run/${s4.runId}/swing`, 'POST', { t: p4.pitches[11].plate - 400 });
  ok('a swing after the last pitch is turned away', (await api(`/run/${s4.runId}/swing`, 'POST', { t: p4.end + 1 })).status === 409);
  const small = await api(`/run/${s4.runId}/save`, 'POST', { initials: 'MS2' });
  const above = (await api('/board?scope=day&limit=100')).data.filter(r => r.score > 25).map(r => r.score);
  ok('a run with one single saves 25 points, and says how far behind the next score up it is',
    small.status === 201 && small.data.score === 25 && small.data.dayRank > 1 && small.data.nextUp === Math.min(...above) - 25, JSON.stringify(small.data));

  // Pausing stops the run's clock on the server too.
  const s3 = (await api('/start', 'POST', {})).data;
  const s3Start = Date.now();
  const paused = await api(`/run/${s3.runId}/pause`, 'POST', {});
  ok('a run can be paused', paused.status === 200 && paused.data.paused);
  await wait(400);
  const whilePaused = await api(`/run/${s3.runId}/swing`, 'POST', { t: E.plan(s3.seed).pitches[0].plate });
  ok('a swing while paused is refused', whilePaused.status === 409 && /paused/.test(whilePaused.data.error));
  const resumed = await api(`/run/${s3.runId}/resume`, 'POST', {});
  ok('…and carries on, with the paused time left off its clock', resumed.status === 200 && !resumed.data.paused &&
    resumed.data.clockMs <= Date.now() - s3Start - 350, JSON.stringify(resumed.data));

  ok('an unknown run is turned away', (await api('/run/' + 'f'.repeat(32) + '/swing', 'POST', { t: 500 })).status === 404);
  const hook = await api(`/test/homer/${s2.runId}?after=0`);
  ok('the test-only hook gives the perfect moment for the first pitch', hook.status === 200 && hook.data.n === 1 && hook.data.perfect === E.plan(s2.seed).pitches[0].plate);

  // A swing that arrives more than ten seconds after it happened isn't a
  // swing that just happened, so it's refused.
  const old = E.plan(s2.seed).pitches[0].plate;
  await wait(Math.max(0, old + 10000 + 400 - (Date.now() - s2Start)));
  const stale = await api(`/run/${s2.runId}/swing`, 'POST', { t: old });
  ok('a swing that arrives far too late is refused', stale.status === 400 && /too long/.test(stale.data.error), JSON.stringify(stale.data));

  console.log(`
  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
