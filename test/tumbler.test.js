'use strict';

// Tumbler Rumble: the simulation (no server needed) and the API (against the
// real server). The same seed and taps always give the same run, a run keeps
// going until a miss and scores one per pin popped, the pins come in waves
// that get harder, ease off and get harder again, impossible taps are
// refused, and the boards keep the best scores first.

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
  const perfect3 = E.perfectTaps(SEED, 3), perfect25 = E.perfectTaps(SEED, 25);
  ok('perfect play gives one tap per pin', perfect3.length === 3 && perfect25.length === 25);
  const a = E.replay(SEED, perfect25), b = E.replay(SEED, perfect25);
  ok('the same seed and taps always give the same run', JSON.stringify(a) === JSON.stringify(b));
  ok('different seeds put the pins in different places',
    E.perfectTaps(1, 3).join() !== E.perfectTaps(2, 3).join() && E.perfectTaps(7, 5).join() === E.perfectTaps(7, 5).join());
  ok('the score is the number of pins popped, and the run keeps going with no break between pins',
    a.score === 25 && a.pops === 25 && a.wave === 3 && a.bullseyes === 25 && a.bestStreak === 25, JSON.stringify(a));
  ok('…and it ends only when the marker slips past the next pin', a.endedBy === 'slip');
  ok('the light starts moving after the 3, 2, 1 countdown, not before', perfect3[0] > E.RULES.LEAD_MS && E.RULES.LEAD_MS === 3 * E.RULES.COUNT_MS);

  // The waves: harder for 7 pins, easier for 3, each wave a bit harder than the last.
  const d = n => E.difficulty(n);
  ok('the first pin is the easiest there is: the slowest light and the widest pin',
    d(0) === 0 && E.speedAt(d(0)) * 1000 === E.RULES.SLOW_DEG_S && E.halfAt(d(0)) === E.RULES.WIDE_DEG);
  ok('each wave gets harder for 7 pins', d(1) > d(0) && d(6) > d(5) && d(16) > d(10) && d(26) > d(20));
  ok('…then eases off for the last 3', d(7) < d(6) && d(9) < d(7) && d(17) < d(16) && d(29) < d(26));
  ok('…and each wave starts and peaks harder than the one before', d(10) < d(20) && d(20) < d(30) && d(6) < d(16) && d(16) < d(26));
  ok('it tops out at the hardest there is, and still comes in waves', d(116) === 1 && d(216) === 1 && d(119) < 1 && E.halfAt(1) === E.RULES.NARROW_DEG);
  ok('later pins are faster and narrower, so the time to tap is shorter', (() => {
    const s0 = E.create(SEED);
    const s1 = E.create(SEED);
    for (const t of E.perfectTaps(SEED, 26)) E.tap(s1, t);
    return E.windowMs(s1) < E.windowMs(s0) / 1.4;
  })());

  // Moving the 5th tap off its pin.
  const early = perfect25.slice(0, 5);
  early[4] -= 250;
  const missed = E.replay(SEED, early);
  ok('a tap moved well before the pin ends the run there, as a miss', missed.score === 4 && missed.endedBy === 'miss', JSON.stringify(missed));
  const late = E.replay(SEED, perfect25.slice(0, 4));
  ok('no tap at all for a pin ends the run there, as a slip', late.score === 4 && late.endedBy === 'slip');
  const near = perfect3.slice();
  near[1] += 60;
  near[2] += 60;   // the third pin is placed from where the second one popped
  const nearRun = E.replay(SEED, near);
  ok('a tap a little off the middle still pops the pin, but isn\'t a bullseye', nearRun.score === 3 && nearRun.bullseyes === 2, JSON.stringify(nearRun));
  const tooLate = perfect3.slice(0, 2);
  tooLate.push(perfect3[2] + 400);
  ok('a tap after the marker has already slipped past is refused, since the page would never send it', refuses(tooLate));

  console.log('\n-- tumbler: impossible taps --');
  ok('taps that aren\'t whole milliseconds are refused', refuses([3500.5]) && refuses(['3500']) && refuses([-1]) && refuses('nope'));
  ok('two taps closer together than anyone can tap are refused', refuses([perfect3[0], perfect3[0] + 20]));
  ok('taps out of order are refused', refuses([perfect3[1], perfect3[0]]));
  ok('a tap during the countdown is refused', refuses([100]) && refuses([E.RULES.LEAD_MS - 1]));
  ok('taps after the run has ended are refused', refuses([...early, early[4] + 500]));
  ok('more taps than any run could have are refused', refuses(Array.from({ length: E.RULES.MAX_TAPS + 1 }, (_, i) => 3000 + i * 100)));
  ok('taps later than the run has really lasted are refused', refuses(perfect25, { maxMs: perfect25[5] }));
  ok('…and so is a run that ended later than that', refuses(perfect3, { maxMs: perfect3[2] + 10 }));
  ok('a run that fits in its real time is accepted', !refuses(perfect3, { maxMs: 60000 }));

  console.log('\n-- tumbler: the API --');
  const started = (await api('/start', 'POST', {})).data;
  ok('starting a run hands out a long run id and a seed', /^[0-9a-f]{32}$/.test(started.runId) && Number.isInteger(started.seed));
  ok('…and turns on the page\'s test helper only because this is the test suite', started.testHook === true);
  const runTaps = E.perfectTaps(started.seed, 3);
  const done = await api(`/run/${started.runId}/finish`, 'POST', { taps: runTaps, score: 999999, pops: 99 });
  ok('finishing replays the taps and the server works out the score (anything else sent is ignored)',
    done.status === 200 && done.data.score === 3 && done.data.pops === 3 && done.data.wave === 1 && done.data.endedBy === 'slip', JSON.stringify(done.data));
  const again = await api(`/run/${started.runId}/finish`, 'POST', { taps: E.perfectTaps(started.seed, 12) });
  ok('a finished run can\'t be finished again with better taps', again.status === 200 && again.data.score === 3);

  const fast = (await api('/start', 'POST', {})).data;
  const bad = await api(`/run/${fast.runId}/finish`, 'POST', { taps: [3300, 3310] });
  ok('the server refuses taps closer together than anyone can tap', bad.status === 400 && /closer together/.test(bad.data.error));
  const tooLong = await api(`/run/${fast.runId}/finish`, 'POST', { taps: [120000] });
  ok('the server refuses taps later than the run has really lasted on its own clock', tooLong.status === 400 && /longer than the run/.test(tooLong.data.error));
  ok('a made-up run id is a 404', (await api('/run/0123456789abcdef0123456789abcdef/finish', 'POST', { taps: [] })).status === 404);
  ok('a score can\'t be saved before the run is over', (await api(`/run/${fast.runId}/save`, 'POST', { initials: 'NOP' })).status === 409);

  const zero = (await api('/start', 'POST', {})).data;
  const zeroDone = await api(`/run/${zero.runId}/finish`, 'POST', { taps: [] });
  ok('no taps at all is a run that ends on the first pin with no score', zeroDone.data.score === 0 && zeroDone.data.wave === 1);
  ok('…and a score of nothing can\'t go on the board', (await api(`/run/${zero.runId}/save`, 'POST', { initials: 'ZZZ' })).status === 400);

  ok('initials have to be 1-3 letters or numbers', (await api(`/run/${started.runId}/save`, 'POST', { initials: 'TOO LONG' })).status === 400);
  const saved = await api(`/run/${started.runId}/save`, 'POST', { initials: 'one' });
  ok('saving puts the score on the board, ranked', saved.status === 201 && saved.data.dayRank === 1 && saved.data.allRank === 1 && saved.data.score === 3, JSON.stringify(saved.data));
  ok('a score can only be saved once', (await api(`/run/${started.runId}/save`, 'POST', { initials: 'ONE' })).status === 409);
  const posts = await (await fetch(base + '/api/comm/posts')).json();
  ok('a new best score ever goes up on the Comm Center', posts.some(p => p.kind === 'highscore' && p.game === 'tumbler' && p.title.includes('ONE')));

  const better = (await api('/start', 'POST', {})).data;
  await api(`/run/${better.runId}/finish`, 'POST', { taps: E.perfectTaps(better.seed, 12) });
  const savedBetter = await api(`/run/${better.runId}/save`, 'POST', { initials: 'TWO' });
  ok('a better run goes above it', savedBetter.data.dayRank === 1 && savedBetter.data.allRank === 1 && savedBetter.data.score === 12);
  const today = await api('/board?scope=day');
  ok('today\'s board is best first, with the wave each run reached', today.status === 200 && today.data.map(r => r.initials).join() === 'TWO,ONE' &&
    today.data[0].wave === 2 && today.data[1].wave === 1, JSON.stringify(today.data));
  ok('the all-time board has the same runs', (await api('/board?scope=all')).data.map(r => r.score).join() === '12,3');
  ok('an old day\'s board is empty, not an error', (await api('/board?scope=day&day=2001-01-01')).data.length === 0);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
