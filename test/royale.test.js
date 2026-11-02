'use strict';

// Roll Royale: the simulation (no server needed) and the API (against the
// real server). The same seed and times always give the same run, known
// press and release times land in known rings for a known score, times that
// couldn't happen are refused, and the boards keep the best scores first.

const path = require('node:path');

async function run({ base, root }) {
  const E = require(path.join(root, 'public/royale-engine.js'));
  const API = base + '/api/royale';
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  async function api(p, method = 'GET', body) {
    const res = await fetch(API + p, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const SEED = 12345;
  const refuses = (balls, opts, seed = SEED) => { try { E.replay(seed, balls, opts); return false; } catch (e) { return e.status === 400; } };

  console.log('\n-- royale: the simulation --');
  ok('the power meter climbs for a second, then comes back down', E.powerOf(0) === 0 && E.powerOf(500) === 0.5 &&
    E.powerOf(1000) === 1 && E.powerOf(1500) === 0.5 && E.powerOf(2000) === 0);
  // Ball 1 of seed 12345, worked out by hand. The arrow's starting point for
  // this seed is 0.980 of the way through its sway, and the ball is ready at
  // 1,500 ms. Pressing at 1,900 ms: 400 / 2,600 + 0.980 = 1.134 sways, which
  // is 0.134 of the way through one, so the arrow is at 2 x 0.268 - 1 = -0.465
  // (a bit left). Holding 533 ms fills the meter to 0.533, which sends the
  // ball 0.6 + 0.533 x 0.75 = 1.0 lane units: dead level with the middle of
  // the rings, and -0.465 x 0.22 = 0.102 to its left. That's past the 40 ring
  // (0.075) and inside the 30 ring (0.115).
  const KNOWN = [[1900, 2433], [5033, 5433], [8033, 8733], [11333, 12183], [14783, 15316], [17916, 18216], [20816, 21669], [24269, 24869], [27469, 28469]];
  const known = E.replay(SEED, KNOWN);
  ok('known press and release times land in known rings', known.rings.join() === '30,10,10,0,40,0,0,0,0', JSON.stringify(known));
  ok('…for a known score', known.score === 90 && known.jackpots === 0 && known.bulls === 0 && known.balls === 9);
  const s1 = E.create(SEED);
  const first = E.roll(s1, 1900, 2433);
  ok('the first of those, worked out by hand, is a 30', first.points === 30 && Math.abs(first.aim + 0.465) < 0.001 &&
    Math.abs(first.x + 0.102) < 0.001 && Math.abs(first.y - 1) < 0.001, JSON.stringify(first));
  ok('a ball too soft to reach the rings scores nothing', known.rings[5] === 0 && E.replay(SEED, KNOWN).rings[5] === 0);
  const a = E.replay(SEED, KNOWN), b = E.replay(SEED, KNOWN);
  ok('the same seed and times always give the same run', JSON.stringify(a) === JSON.stringify(b));
  ok('different seeds sway the arrow differently', E.replay(1, KNOWN).rings.join() !== known.rings.join() ||
    E.replay(2, KNOWN).rings.join() !== known.rings.join());

  const bulls = E.replay(SEED, E.perfectBalls(SEED, 'bull'));
  ok('nine balls in the middle ring score 450', bulls.score === 450 && bulls.bulls === 9 && bulls.rings.every(p => p === 50), JSON.stringify(bulls));
  const cups = E.replay(SEED, E.perfectBalls(SEED, 'cup'));
  ok('the jackpot cup is 100, and 200 on the three bonus balls, so nine jackpots score 1,200',
    cups.score === 6 * 100 + 3 * 200 && cups.jackpots === 9 && cups.rings.join() === '100,100,100,100,100,100,200,200,200', JSON.stringify(cups));
  ok('the cup only slides on the bonus balls', E.cupXAt(E.create(SEED), 5, 12345) === 0 && E.cupXAt(E.create(SEED), 6, 12345) !== E.cupXAt(E.create(SEED), 6, 13345));

  console.log('\n-- royale: impossible rolls --');
  const shift = (i, press, release) => KNOWN.map((p, j) => (j === i ? [press, release] : p));
  ok('a run that isn\'t exactly 9 balls is refused', refuses(KNOWN.slice(0, 8)) && refuses([...KNOWN, [40000, 40500]]) && refuses('nope'));
  ok('times that aren\'t whole milliseconds are refused', refuses(shift(0, 1900.5, 2433)) && refuses(shift(0, '1900', 2433)) && refuses(shift(0, -1, 600)));
  ok('a ball rolled before it was ready is refused', refuses(shift(0, 1400, 1933)) && refuses(shift(1, 4000, 4500)));
  ok('pressing and letting go quicker than anyone can is refused', refuses(shift(0, 1900, 1930)));
  ok('holding longer than the meter allows is refused', refuses(shift(0, 1900, 1900 + E.RULES.MAX_HOLD_MS + 1)));
  ok('a release before its press is refused', refuses(shift(0, 1900, 1800)));
  ok('rolls later than the run has really lasted are refused', refuses(KNOWN, { maxMs: 20000 }));
  ok('a run that fits in its real time is accepted', !refuses(KNOWN, { maxMs: 30000 }));

  console.log('\n-- royale: the API --');
  const started = (await api('/start', 'POST', {})).data;
  ok('starting a run hands out a long run id and a seed', /^[0-9a-f]{32}$/.test(started.runId) && Number.isInteger(started.seed));
  ok('…and turns on the page\'s test helper only because this is the test suite', started.testHook === true);
  const plan = E.perfectBalls(started.seed, 'bull');
  const done = await api(`/run/${started.runId}/finish`, 'POST', { balls: plan, score: 999999, rings: [100] });
  ok('finishing replays the rolls and the server works out the score (anything else sent is ignored)',
    done.status === 200 && done.data.score === 450 && done.data.rings.length === 9 && done.data.bulls === 9, JSON.stringify(done.data));
  const again = await api(`/run/${started.runId}/finish`, 'POST', { balls: E.perfectBalls(started.seed, 'cup') });
  ok('a finished run can\'t be finished again with better rolls', again.status === 200 && again.data.score === 450);

  const fast = (await api('/start', 'POST', {})).data;
  const bad = await api(`/run/${fast.runId}/finish`, 'POST', { balls: shift(0, 1900, 1930) });
  ok('the server refuses a press and release quicker than anyone can', bad.status === 400 && /quicker than anyone/.test(bad.data.error));
  const late = KNOWN.map(([p, r]) => [p + 200000, r + 200000]);
  const tooLong = await api(`/run/${fast.runId}/finish`, 'POST', { balls: late });
  ok('the server refuses rolls later than the run has really lasted on its own clock', tooLong.status === 400 && /longer than the run/.test(tooLong.data.error));
  ok('a made-up run id is a 404', (await api('/run/0123456789abcdef0123456789abcdef/finish', 'POST', { balls: KNOWN })).status === 404);
  ok('a score can\'t be saved before the run is over', (await api(`/run/${fast.runId}/save`, 'POST', { initials: 'NOP' })).status === 409);

  // Nine very soft rolls: every one falls short of the rings.
  const zero = (await api('/start', 'POST', {})).data;
  const soft = [];
  for (let i = 0, t = 1500; i < 9; i++) { soft.push([t, t + 100]); t += 100 + E.RULES.NEXT_MS; }
  const zeroDone = await api(`/run/${zero.runId}/finish`, 'POST', { balls: soft });
  ok('nine rolls that all fall short score nothing', zeroDone.status === 200 && zeroDone.data.score === 0, JSON.stringify(zeroDone.data));
  ok('…and a score of nothing can\'t go on the board', (await api(`/run/${zero.runId}/save`, 'POST', { initials: 'ZZZ' })).status === 400);

  ok('initials have to be 1-3 letters or numbers', (await api(`/run/${started.runId}/save`, 'POST', { initials: 'TOO LONG' })).status === 400);
  const saved = await api(`/run/${started.runId}/save`, 'POST', { initials: 'one' });
  ok('saving puts the score on the board, ranked', saved.status === 201 && saved.data.dayRank === 1 && saved.data.allRank === 1 && saved.data.score === 450, JSON.stringify(saved.data));
  ok('a score can only be saved once', (await api(`/run/${started.runId}/save`, 'POST', { initials: 'ONE' })).status === 409);
  const posts = await (await fetch(base + '/api/comm/posts')).json();
  ok('a new best score ever goes up on the Comm Center', posts.some(p => p.kind === 'highscore' && p.game === 'royale' && p.title.includes('ONE')));

  const better = (await api('/start', 'POST', {})).data;
  await api(`/run/${better.runId}/finish`, 'POST', { balls: E.perfectBalls(better.seed, 'cup') });
  const savedBetter = await api(`/run/${better.runId}/save`, 'POST', { initials: 'TWO' });
  ok('a better run goes above it', savedBetter.data.dayRank === 1 && savedBetter.data.allRank === 1 && savedBetter.data.score === 1200);
  const today = await api('/board?scope=day');
  ok('today\'s board is best first, with the jackpots each run hit', today.status === 200 && today.data.map(r => r.initials).join() === 'TWO,ONE' &&
    today.data[0].jackpots === 9 && today.data[1].jackpots === 0 && today.data[1].rings.length === 9, JSON.stringify(today.data));
  ok('the all-time board has the same runs', (await api('/board?scope=all')).data.map(r => r.score).join() === '1200,450');
  ok('an old day\'s board is empty, not an error', (await api('/board?scope=day&day=2001-01-01')).data.length === 0);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
