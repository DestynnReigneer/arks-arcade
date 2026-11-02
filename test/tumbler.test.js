'use strict';

// Tumbler Rumble: the simulation (no server needed) and the API (against the
// real server). The same seed and taps always give the same run, a perfect
// list of taps scores exactly what the rules say, taps moved off a pin end
// the run on the right lock, impossible taps are refused, and the boards
// keep the best scores first.

const path = require('node:path');

async function run({ base, root }) {
  const E = require(path.join(root, 'public/tumbler-engine.js'));
  const API = base + '/api/tumbler';
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
  const refuses = (taps, opts) => { try { E.replay(12345, taps, opts); return false; } catch (e) { return e.status === 400; } };

  console.log('\n-- tumbler: the simulation --');
  const SEED = 12345;
  const perfect1 = E.perfectTaps(SEED, 1), perfect3 = E.perfectTaps(SEED, 3);
  ok('the first lock needs 3 pins, then one more each lock', perfect1.length === 3 && perfect3.length === 3 + 4 + 5);
  const a = E.replay(SEED, perfect3), b = E.replay(SEED, perfect3);
  ok('the same seed and taps always give the same run', JSON.stringify(a) === JSON.stringify(b));
  ok('different seeds put the pins in different places',
    E.perfectTaps(1, 1).join() !== E.perfectTaps(2, 1).join() && E.perfectTaps(7, 2).join() === E.perfectTaps(7, 2).join());
  // Lock 1: 3 bullseyes in a row (10 + 10, 10 + 20, 10 + 30) and 50 for opening it.
  const one = E.replay(SEED, perfect1);
  ok('a perfect first lock scores 140', one.score === 140 && one.level === 2 && one.locks === 1 && one.pins === 3 && one.bullseyes === 3, JSON.stringify(one));
  ok('…and the run then ends when the marker slips past the next pin', one.endedBy === 'slip');
  // Lock 2: 4 pins at 20 + 20 x streak (4, then capped at 5) and 100; lock 3: 5 pins at 30 + 30 x 5 and 150.
  ok('a perfect three locks score 1,750', a.score === 140 + (100 + 120 * 3 + 100) + (180 * 5 + 150) && a.level === 4 && a.bestStreak === 12, JSON.stringify(a));
  ok('the marker speeds up every lock and tops out', E.speedOf(2) > E.speedOf(1) && E.speedOf(20) === E.speedOf(40));

  // Moving the 5th tap (lock 2, its second pin) off the pin.
  const early = perfect3.slice(0, 5);
  early[4] -= 150;
  const missed = E.replay(SEED, early);
  ok('a tap moved well before the pin ends the run on lock 2, as a miss', missed.level === 2 && missed.pins === 4 && missed.endedBy === 'miss' && missed.score === 140 + 100, JSON.stringify(missed));
  const late = E.replay(SEED, perfect3.slice(0, 4));
  ok('no tap at all for that pin ends the run on lock 2, as a slip', late.level === 2 && late.pins === 4 && late.endedBy === 'slip');
  const near = perfect1.slice();
  near[1] += 30;
  near[2] += 30;   // the third pin is placed from where the second one popped
  const nearRun = E.replay(SEED, near);
  ok('a tap a little off the middle still pops the pin, but isn\'t a bullseye', nearRun.level === 2 && nearRun.bullseyes === 2 && nearRun.score === 20 + 10 + 20 + 50, JSON.stringify(nearRun));
  const tooLate = perfect1.slice(0, 2);
  tooLate.push(perfect1[2] + 200);
  ok('a tap after the marker has already slipped past is refused, since the page would never send it', refuses(tooLate));

  console.log('\n-- tumbler: impossible taps --');
  ok('taps that aren\'t whole milliseconds are refused', refuses([2500.5]) && refuses(['2500']) && refuses([-1]) && refuses('nope'));
  ok('two taps closer together than anyone can tap are refused', refuses([perfect1[0], perfect1[0] + 20]));
  ok('taps out of order are refused', refuses([perfect1[1], perfect1[0]]));
  ok('a tap before the lock starts turning is refused', refuses([100]));
  ok('taps after the run has ended are refused', refuses([...early, early[4] + 500]));
  ok('more taps than any run could have are refused', refuses(Array.from({ length: E.RULES.MAX_TAPS + 1 }, (_, i) => 3000 + i * 100)));
  ok('taps later than the run has really lasted are refused', refuses(perfect3, { maxMs: perfect3[5] }));
  ok('…and so is a run that ended later than that', refuses(perfect1, { maxMs: perfect1[2] + 10 }));
  ok('a run that fits in its real time is accepted', !refuses(perfect1, { maxMs: 60000 }));

  console.log('\n-- tumbler: the API --');
  const started = (await api('/start', 'POST', {})).data;
  ok('starting a run hands out a long run id and a seed', /^[0-9a-f]{32}$/.test(started.runId) && Number.isInteger(started.seed));
  ok('…and turns on the page\'s test helper only because this is the test suite', started.testHook === true);
  const runTaps = E.perfectTaps(started.seed, 1);
  const done = await api(`/run/${started.runId}/finish`, 'POST', { taps: runTaps, score: 999999, level: 99 });
  ok('finishing replays the taps and the server works out the score (anything else sent is ignored)',
    done.status === 200 && done.data.score === 140 && done.data.level === 2 && done.data.pins === 3, JSON.stringify(done.data));
  const again = await api(`/run/${started.runId}/finish`, 'POST', { taps: E.perfectTaps(started.seed, 3) });
  ok('a finished run can\'t be finished again with better taps', again.status === 200 && again.data.score === 140);

  const fast = (await api('/start', 'POST', {})).data;
  // 2300 ms is before any first pin can be reached, so it's a miss, not a slip.
  const bad = await api(`/run/${fast.runId}/finish`, 'POST', { taps: [2300, 2310] });
  ok('the server refuses taps closer together than anyone can tap', bad.status === 400 && /closer together/.test(bad.data.error));
  const tooLong = await api(`/run/${fast.runId}/finish`, 'POST', { taps: [120000] });
  ok('the server refuses taps later than the run has really lasted on its own clock', tooLong.status === 400 && /longer than the run/.test(tooLong.data.error));
  ok('a made-up run id is a 404', (await api('/run/0123456789abcdef0123456789abcdef/finish', 'POST', { taps: [] })).status === 404);
  ok('a score can\'t be saved before the run is over', (await api(`/run/${fast.runId}/save`, 'POST', { initials: 'NOP' })).status === 409);

  const zero = (await api('/start', 'POST', {})).data;
  const zeroDone = await api(`/run/${zero.runId}/finish`, 'POST', { taps: [] });
  ok('no taps at all is a run that ends on the first pin with no score', zeroDone.data.score === 0 && zeroDone.data.level === 1);
  ok('…and a score of nothing can\'t go on the board', (await api(`/run/${zero.runId}/save`, 'POST', { initials: 'ZZZ' })).status === 400);

  ok('initials have to be 1-3 letters or numbers', (await api(`/run/${started.runId}/save`, 'POST', { initials: 'TOO LONG' })).status === 400);
  const saved = await api(`/run/${started.runId}/save`, 'POST', { initials: 'one' });
  ok('saving puts the score on the board, ranked', saved.status === 201 && saved.data.dayRank === 1 && saved.data.allRank === 1 && saved.data.score === 140, JSON.stringify(saved.data));
  ok('a score can only be saved once', (await api(`/run/${started.runId}/save`, 'POST', { initials: 'ONE' })).status === 409);
  const posts = await (await fetch(base + '/api/comm/posts')).json();
  ok('a new best score ever goes up on the Comm Center', posts.some(p => p.kind === 'highscore' && p.game === 'tumbler' && p.title.includes('ONE')));

  const better = (await api('/start', 'POST', {})).data;
  await api(`/run/${better.runId}/finish`, 'POST', { taps: E.perfectTaps(better.seed, 3) });
  const savedBetter = await api(`/run/${better.runId}/save`, 'POST', { initials: 'TWO' });
  ok('a better run goes above it', savedBetter.data.dayRank === 1 && savedBetter.data.allRank === 1 && savedBetter.data.score === 1750);
  const today = await api('/board?scope=day');
  ok('today\'s board is best first, with the lock each run reached', today.status === 200 && today.data.map(r => r.initials).join() === 'TWO,ONE' &&
    today.data[0].level === 4 && today.data[1].level === 2, JSON.stringify(today.data));
  ok('the all-time board has the same runs', (await api('/board?scope=all')).data.map(r => r.score).join() === '1750,140');
  ok('an old day\'s board is empty, not an error', (await api('/board?scope=day&day=2001-01-01')).data.length === 0);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
