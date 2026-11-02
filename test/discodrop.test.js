'use strict';

// Disco Drop: the motion (no server needed) and the API (against the real
// server). The same seed and drop times always give the same result, the
// server's score is its own replay of the drop times, drops that couldn't
// have happened are refused, and the boards come back in order.

const path = require('node:path');

async function run({ base, root }) {
  const E = require(path.join(root, 'public/discodrop-engine.js'));
  const API = base + '/api/discodrop';
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
  // Ten drops one second and a bit apart, starting at `from`.
  const steady = (from, gap = E.MIN_GAP_MS + 13) => Array.from({ length: E.DROPS }, (_, i) => from + i * gap);

  console.log('\n-- disco drop: the motion --');
  const a = E.plan(123456), b = E.plan(123456), c = E.plan(654321);
  ok('the same seed always plans the same run', JSON.stringify(a) === JSON.stringify(b));
  ok('a different seed plans a different run', JSON.stringify(a) !== JSON.stringify(c));
  ok('every lap of cups has exactly one jackpot cup', a.phases.every(p => p.layout.filter(x => x.kind === 'jackpot').length === 1));
  ok('the cups fill the belt with no gaps', a.phases.every(p => p.layout.reduce((n, x) => n + x.width, 0) === E.BELT));
  ok('the cups speed up as the run goes on', Math.abs(a.phases[9].speed) > Math.abs(a.phases[0].speed) + 200);
  ok('the arm holds still for the first three balls, then slides',
    a.phases.slice(0, 3).every(p => p.armSpeed === 0) && a.phases.slice(3).every(p => p.armSpeed > 0));
  ok('the cups shuffle after the balls the rules say', a.phases.filter(p => p.shuffled).map(p => p.k).join() === E.SHUFFLE_AFTER.join());
  ok('the last three balls score double', a.phases.map(p => p.double ? 1 : 0).join('') === '0000000111');

  const times = steady(400);
  const r1 = E.replay(123456, times), r2 = E.replay(123456, times);
  ok('replaying the same drop times gives the same landings and score', JSON.stringify(r1) === JSON.stringify(r2));
  ok('a run of ten drops is finished', r1.finished && r1.results.length === 10);
  ok('the total is the sum of every ball\'s points', r1.total === r1.results.reduce((n, x) => n + x.points, 0));
  ok('doubled balls score twice the cup', r1.results.every(x => x.points === x.value * (x.double ? 2 : 1)));
  // Over many seeds, the replay scores come from real landings.
  let honestNear = true, jackpotsSeen = 0, sane = true;
  for (let s = 1; s <= 300; s++) {
    const r = E.replay(s, steady(350 + (s % 97) * 7));
    for (const x of r.results) {
      if (x.jackpot) jackpotsSeen++;
      if (x.near && (x.jackpot || x.kind === undefined)) honestNear = false;
      if (x.x < E.ARM_LEFT || x.x > E.ARM_RIGHT) sane = false;
    }
    if (r.total < 0 || r.total > E.MAX_SCORE) sane = false;
  }
  ok('balls always leave from the arm\'s track, and totals stay in range', sane);
  ok('jackpots happen, but not often by chance', jackpotsSeen > 0 && jackpotsSeen < 300, String(jackpotsSeen));
  ok('"so close" is only ever said for a ball that missed the jackpot', honestNear);

  // The jackpot windows the browser test uses really are jackpots.
  const wins = E.jackpotWindows(99, [], 0, 15000);
  ok('the jackpot finder finds windows', wins.length >= 1);
  ok('…and a drop in the middle of one lands in the jackpot',
    wins.every(([lo, hi]) => E.replay(99, [Math.floor((lo + hi) / 2)]).results[0].jackpot));
  ok('…and a drop just outside one does not', wins.every(([lo]) => !E.replay(99, [lo - 1]).results[0].jackpot));

  console.log('\n-- disco drop: impossible drops --');
  ok('a drop before the first ball is on the arm is refused', throwsCode(() => E.replay(1, [E.RELOAD_MS - 1]), 'soon'));
  ok('two drops closer together than a ball takes to fall and reload are refused',
    throwsCode(() => E.replay(1, [500, 500 + E.MIN_GAP_MS - 1]), 'soon'));
  ok('two drops exactly that far apart are fine', !throwsCode(() => E.replay(1, [500, 500 + E.MIN_GAP_MS]), 'soon'));
  ok('an eleventh ball is refused', throwsCode(() => E.replay(1, [...steady(400), 400 + 11 * 2000]), 'done'));
  ok('a time that isn\'t a whole number of milliseconds is refused', throwsCode(() => E.replay(1, [500.5]), 'bad'));
  ok('a negative time is refused', throwsCode(() => E.replay(1, [-5]), 'bad'));

  console.log('\n-- disco drop: the API --');
  const rules = await api('/rules');
  ok('the rules say ten balls and what each cup is worth', rules.status === 200 && rules.data.drops === 10 && rules.data.cups.jackpot.value === 500);

  const started = Date.now();
  const s = (await api('/start', 'POST', {})).data;
  // A second run, started now, for a drop that arrives too late (below).
  const s2Start = Date.now();
  const s2 = (await api('/start', 'POST', {})).data;
  ok('starting hands out a run id and a seed', /^[0-9a-f]{32}$/.test(s.runId) && Number.isInteger(s.seed) && s.times.length === 0);
  ok('a run that isn\'t over can\'t be saved', (await api(`/run/${s.runId}/save`, 'POST', { initials: 'ABC' })).status === 409);

  const future = await api(`/run/${s.runId}/drop`, 'POST', { t: 60000 });
  ok('a drop later than the run has been going is refused', future.status === 400 && /later/.test(future.data.error), JSON.stringify(future.data));
  ok('a drop with no time is refused', (await api(`/run/${s.runId}/drop`, 'POST', {})).status === 400);
  ok('a drop before the ball is ready is refused', (await api(`/run/${s.runId}/drop`, 'POST', { t: 10 })).status === 400);

  // Wait long enough for ten drops to have happened, then send them all.
  const plan = steady(400);
  await wait(plan[9] + 150 - (Date.now() - started));
  const tooClose = await api(`/run/${s.runId}/drop`, 'POST', { t: plan[0] });
  ok('the first drop counts', tooClose.status === 200 && tooClose.data.left === 9, JSON.stringify(tooClose.data));
  const close = await api(`/run/${s.runId}/drop`, 'POST', { t: plan[0] + 500 });
  ok('a second drop half a second after the first is refused (the ball was still falling)', close.status === 400 && /before the ball/.test(close.data.error));
  let last = null;
  for (let i = 1; i < 10; i++) {
    // A made-up score along with the time is ignored.
    last = await api(`/run/${s.runId}/drop`, 'POST', { t: plan[i], score: 99999, total: 99999 });
    if (last.status !== 200) break;
  }
  ok('all ten drops count', last.status === 200 && last.data.finished && last.data.left === 0, JSON.stringify(last.data));
  const expect = E.replay(s.seed, plan);
  ok('the server\'s score is the replay of the drop times', last.data.total === expect.total, `${last.data.total} vs ${expect.total}`);
  const view = (await api(`/run/${s.runId}`)).data;
  ok('the run remembers every ball where the replay says it landed',
    JSON.stringify(view.results) === JSON.stringify(expect.results) && view.finished);
  ok('an eleventh drop is refused', (await api(`/run/${s.runId}/drop`, 'POST', { t: plan[9] + 2000 })).status === 409);

  // The boards.
  const bad = await api(`/run/${s.runId}/save`, 'POST', { initials: 'a!' });
  ok('initials must be 1-3 letters or numbers', bad.status === 400);
  const saved = await api(`/run/${s.runId}/save`, 'POST', { initials: 'dd1', score: 99999 });
  ok('a finished run saves with initials', saved.status === 201 && saved.data.score === expect.total && saved.data.dayRank >= 1, JSON.stringify(saved.data));
  ok('…once', (await api(`/run/${s.runId}/save`, 'POST', { initials: 'DD1' })).status === 409);
  const day = (await api('/board?scope=day')).data;
  ok('today\'s board shows it, with the score from the replay', day.some(r => r.id === saved.data.id && r.initials === 'DD1' && r.score === expect.total));
  const all = (await api('/board?scope=all')).data;
  ok('the all-time board shows it too', all.some(r => r.id === saved.data.id));
  ok('boards are sorted best first', [day, all].every(rows => rows.every((r, i) => !i || rows[i - 1].score >= r.score)));

  // A drop that arrives more than ten seconds after it happened isn't a drop
  // that just happened, so it's refused.
  await wait(Math.max(0, 10000 + 400 + 300 - (Date.now() - s2Start)));
  const stale = await api(`/run/${s2.runId}/drop`, 'POST', { t: 400 });
  ok('a drop that arrives far too late is refused', stale.status === 400 && /too long/.test(stale.data.error), JSON.stringify(stale.data));
  ok('an unknown run is turned away', (await api('/run/' + 'f'.repeat(32) + '/drop', 'POST', { t: 500 })).status === 404);
  ok('the test-only jackpot finder answers under the test suite',
    Array.isArray((await api(`/test/jackpot/${s2.runId}`)).data.windows));

  console.log(`
  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
