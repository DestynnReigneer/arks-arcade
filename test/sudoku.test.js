'use strict';

// Sudoku: the puzzle maker (no server needed) and the API (against the real
// server): one answer per puzzle, the same puzzle for the same day, the
// server keeping the time, and the boards in the right order.

const path = require('node:path');

async function run({ base, root }) {
  const gen = require(path.join(root, 'sudoku/generator.js'));
  const API = base + '/api/sudoku';
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
  const digits = s => s.split('').map(Number);

  console.log('\n-- sudoku: making puzzles --');
  const days = ['2026-11-01', '2026-11-02', '2027-02-28'];
  let unique = true, consistent = true, tiers = true, clues = true;
  for (const day of days) {
    for (const level of gen.LEVEL_IDS) {
      const p = gen.generate(day, level);
      const puzzle = digits(p.puzzle), solution = digits(p.solution);
      if (gen.countSolutions(puzzle, 2) !== 1) unique = false;
      // Every given is the answer's number, and the answer is a real sudoku.
      if (puzzle.some((v, i) => v && v !== solution[i])) consistent = false;
      for (const unit of gen.UNITS) if (new Set(unit.map(i => solution[i])).size !== 9) consistent = false;
      if (p.tier !== gen.LEVELS[level].tier || gen.grade(puzzle) !== p.tier) tiers = false;
      if (p.clues < gen.LEVELS[level].minClues || p.clues !== puzzle.filter(Boolean).length) clues = false;
    }
  }
  ok('every puzzle has exactly one answer', unique);
  ok('the given numbers match the answer, and the answer is a valid grid', consistent);
  ok('each level is graded by the tricks it needs (family 1, easy 2, medium 3, hard 4)', tiers);
  ok('clue counts are honest and never below the level\'s floor', clues);
  ok('the same day and level always make the same puzzle',
    gen.generate('2026-11-05', 'hard').puzzle === gen.generate('2026-11-05', 'hard').puzzle);
  ok('different days make different puzzles', gen.generate('2026-11-05', 'easy').puzzle !== gen.generate('2026-11-06', 'easy').puzzle);
  ok('different levels on the same day make different puzzles', gen.generate('2026-11-05', 'easy').puzzle !== gen.generate('2026-11-05', 'medium').puzzle);
  const fam = gen.generate('2026-11-05', 'family'), hard = gen.generate('2026-11-05', 'hard');
  ok('family starts with more numbers than hard', fam.clues > hard.clues + 10, `${fam.clues} vs ${hard.clues}`);
  const t0 = Date.now();
  for (const level of gen.LEVEL_IDS) gen.generate('2031-07-04', level);
  ok('making a whole day\'s puzzles is quick (under 2 seconds)', Date.now() - t0 < 2000, `${Date.now() - t0}ms`);

  console.log('\n-- sudoku: the API --');
  const lv = await api('/levels');
  ok('levels lists family, easy, medium and hard', lv.status === 200 && lv.data.levels.map(l => l.id).join() === 'family,easy,medium,hard');
  ok('…and says what help costs', lv.data.penalties.hint === 30000 && lv.data.penalties.check === 15000 && lv.data.penalties.mistake === 10000);
  ok('an unknown level is refused', (await api('/start', 'POST', { level: 'nightmare' })).status === 400);

  const a = (await api('/start', 'POST', { level: 'family' })).data;
  ok('starting hands out a puzzle and a run id', /^[0-9a-f]{32}$/.test(a.runId) && /^[0-9]{81}$/.test(a.puzzle) && a.day === lv.data.day);
  ok('…without the answer', !('solution' in a) && !JSON.stringify(a).includes(gen.generate(a.day, 'family').solution));
  ok('…and it\'s the date\'s puzzle, the same for everyone', a.puzzle === gen.generate(a.day, 'family').puzzle);
  const answer = gen.solve(digits(a.puzzle)).join('');

  const wrong = answer.split('');
  const spot = wrong.findIndex((v, i) => a.puzzle[i] === '0');
  wrong[spot] = String((Number(wrong[spot]) % 9) + 1);
  const bad = await api(`/run/${a.runId}/finish`, 'POST', { grid: wrong.join('') });
  ok('a wrong grid is refused', bad.status === 400 && bad.data.solved === false);
  const changedGiven = answer.split('');
  const g0 = changedGiven.findIndex((v, i) => a.puzzle[i] !== '0');
  changedGiven[g0] = String((Number(changedGiven[g0]) % 9) + 1);
  ok('changing a starting number is refused', (await api(`/run/${a.runId}/finish`, 'POST', { grid: changedGiven.join('') })).status === 400);
  ok('a half-empty grid is refused', (await api(`/run/${a.runId}/finish`, 'POST', { grid: a.puzzle })).status === 400);
  const fast = await api(`/run/${a.runId}/finish`, 'POST', { grid: answer, timeMs: 1 });
  ok('a finish faster than anyone could fill the squares is turned away', fast.status === 400 && /faster/.test(fast.data.error), JSON.stringify(fast.data));

  const chk = await api(`/run/${a.runId}/check`, 'POST', { grid: wrong.join('') });
  ok('Check marks the wrong number', chk.status === 200 && chk.data.wrong.length === 1 && chk.data.wrong[0] === spot);
  ok('…and adds 15 seconds', chk.data.penaltyMs === 15000 && chk.data.checks === 1);
  const liveWrong = await api(`/run/${a.runId}/cell`, 'POST', { index: spot, value: Number(wrong[spot]) });
  ok('a wrong number shown as you go adds 10 seconds', liveWrong.data.right === false && liveWrong.data.penaltyMs === 25000);
  const liveRight = await api(`/run/${a.runId}/cell`, 'POST', { index: spot, value: Number(answer[spot]) });
  ok('…and a right one costs nothing', liveRight.data.right === true && liveRight.data.penaltyMs === 25000);
  const h = await api(`/run/${a.runId}/hint`, 'POST', { grid: a.puzzle });
  ok('a hint gives the right number for an empty square and adds 30 seconds',
    h.status === 200 && a.puzzle[h.data.index] === '0' && String(h.data.value) === answer[h.data.index] && h.data.penaltyMs === 55000);
  const fix = await api(`/run/${a.runId}/hint`, 'POST', { grid: wrong.join('') });
  ok('…and fixes a wrong number first', fix.data.fixing === true && fix.data.index === spot);

  const paused = await api(`/run/${a.runId}/pause`, 'POST', {});
  ok('pausing stops the clock', paused.data.paused === true);
  await wait(300);
  ok('…so time doesn\'t pass while paused', (await api(`/run/${a.runId}`)).data.playMs === paused.data.playMs);
  ok('…and the puzzle can\'t be finished while paused', (await api(`/run/${a.runId}/finish`, 'POST', { grid: answer })).status === 409);
  ok('…until it carries on', (await api(`/run/${a.runId}/resume`, 'POST', {})).data.paused === false);

  // Wait long enough to pass the minimum (the test server's is 20ms a square).
  const empties = 81 - a.clues;
  await wait(empties * 20 + 300);
  const done = await api(`/run/${a.runId}/finish`, 'POST', { grid: answer, timeMs: 1, elapsedMs: 1, playMs: 1 });
  ok('the right grid finishes the puzzle', done.status === 200 && done.data.finished === true);
  ok('the server works out the time itself (a time sent by the browser is ignored)',
    done.data.timeMs >= empties * 20 + 300 + 70000 && done.data.timeMs === done.data.playMs + done.data.penaltyMs, JSON.stringify(done.data));
  ok('a finished puzzle takes no more hints', (await api(`/run/${a.runId}/hint`, 'POST', { grid: answer })).status === 409);

  ok('a time needs initials or a profile', (await api(`/run/${a.runId}/save`, 'POST', {})).status === 400);
  const saved = await api(`/run/${a.runId}/save`, 'POST', { initials: 'slo' });
  ok('saving puts it on the board', saved.status === 201 && saved.data.dayRank === 1 && saved.data.allRank === 1);
  ok('the same run can\'t be saved twice', (await api(`/run/${a.runId}/save`, 'POST', { initials: 'ZZZ' })).status === 409);
  const unfinished = (await api('/start', 'POST', { level: 'family' })).data;
  ok('a run that isn\'t finished can\'t be saved', (await api(`/run/${unfinished.runId}/save`, 'POST', { initials: 'AAA' })).status === 409);

  // A quicker run (no help) beats the slower one with help, and the board
  // lists the fastest first.
  const b = (await api('/start', 'POST', { level: 'family' })).data;
  await wait(empties * 20 + 50);
  const bDone = await api(`/run/${b.runId}/finish`, 'POST', { grid: answer });
  ok('a second player finishes too', bDone.status === 200 && bDone.data.penaltyMs === 0);
  await api(`/run/${b.runId}/save`, 'POST', { initials: 'QIK' });
  const again = (await api('/start', 'POST', { level: 'family' })).data;
  await wait(empties * 20 + 50);
  await api(`/run/${again.runId}/finish`, 'POST', { grid: answer });
  const twice = await api(`/run/${again.runId}/save`, 'POST', { initials: 'QIK' });
  ok('only the first finish of the day counts for the same player', twice.status === 409 && /first finish/.test(twice.data.error));
  const today = await api('/board?level=family&scope=day');
  ok('today\'s board is fastest first', today.status === 200 && today.data.length === 2 &&
    today.data[0].initials === 'QIK' && today.data[1].initials === 'SLO' && today.data[0].timeMs < today.data[1].timeMs, JSON.stringify(today.data));
  ok('…and says how much help each time used', today.data[1].hints === 2 && today.data[1].checks === 1 && today.data[1].mistakes === 1);
  const all = await api('/board?level=family&scope=all');
  ok('the all-time board lists the same times, fastest first', all.data.map(r => r.initials).join() === 'QIK,SLO');
  ok('other levels\' boards are separate', (await api('/board?level=hard&scope=all')).data.length === 0);
  ok('an old day\'s board is empty, not an error', (await api('/board?level=family&scope=day&day=2001-01-01')).data.length === 0);
  ok('a made-up run id is a 404', (await api('/run/0123456789abcdef0123456789abcdef')).status === 404);

  console.log('\n-- sudoku: progress follows a profile --');
  // One profile (the arcade allows only a few profile requests an hour per address).
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(r => r.json());
  const asked = await post('/api/profiles', { name: 'Sudoku Sam', avatar: 'shiba:3' });
  await post(`/api/profiles/admin/${asked.id}/approve`, {}, { 'X-Admin-Token': 'test-admin-token' });
  const sam = (await post(`/api/profiles/${asked.id}/use`, {})).token;
  const phone = (await api('/start', 'POST', { level: 'easy', profileToken: sam })).data;
  ok('a profile\'s run says its progress is kept on the arcade', phone.syncs === true && phone.progress === null, JSON.stringify({ syncs: phone.syncs, progress: phone.progress }));
  const easyAnswer = gen.solve(digits(phone.puzzle)).join('');
  // Fill in the first three empty squares, with a pencil mark and a wrong-number mark.
  const fill = phone.puzzle.split('');
  const empties3 = [];
  for (let i = 0; i < 81 && empties3.length < 3; i++) if (phone.puzzle[i] === '0') { fill[i] = easyAnswer[i]; empties3.push(i); }
  const notesSent = new Array(81).fill(0);
  const pencil = phone.puzzle.split('').findIndex((v, i) => v === '0' && !empties3.includes(i));
  notesSent[pencil] = (1 << 2) | (1 << 7);
  const sent = await api(`/run/${phone.runId}/progress`, 'POST', { grid: fill.join(''), notes: notesSent, marks: { [empties3[0]]: 'hinted', 99: 'wrong', 5: 'sparkly' }, profileToken: sam });
  ok('the page can save its progress for the profile', sent.status === 200 && sent.data.saved === true, JSON.stringify(sent.data));
  const laptop = (await api('/start', 'POST', { level: 'easy', profileToken: sam })).data;
  ok('opening the puzzle on another device carries on the same run', laptop.runId === phone.runId);
  ok('…with the numbers filled in so far', laptop.progress && laptop.progress.grid === fill.join(''), JSON.stringify(laptop.progress));
  ok('…the pencil marks', laptop.progress && laptop.progress.notes[pencil] === notesSent[pencil] && laptop.progress.notes.length === 81);
  ok('…and only the square marks that make sense', laptop.progress && JSON.stringify(laptop.progress.marks) === JSON.stringify({ [empties3[0]]: 'hinted' }), JSON.stringify(laptop.progress && laptop.progress.marks));
  ok('reopening by run id hands the progress back too', (await api(`/run/${phone.runId}`)).data.progress.grid === fill.join(''));
  await api(`/run/${phone.runId}/pause`, 'POST', {});
  const resumed = await api(`/run/${phone.runId}/resume`, 'POST', {});
  ok('carrying on after a pause hands back the latest progress', resumed.data.progress && resumed.data.progress.grid === fill.join(''));
  ok('a checked number or a pause doesn\'t carry the progress (it only comes back when needed)',
    !('progress' in (await api(`/run/${phone.runId}/pause`, 'POST', {})).data));
  await api(`/run/${phone.runId}/resume`, 'POST', {});
  ok('saving progress needs the profile\'s sign-in', (await api(`/run/${phone.runId}/progress`, 'POST', { grid: fill.join('') })).status === 403);
  ok('…and a made-up one is refused', (await api(`/run/${phone.runId}/progress`, 'POST', { grid: fill.join(''), profileToken: 'x.y' })).status === 403);
  ok('a board that isn\'t 81 squares is refused', (await api(`/run/${phone.runId}/progress`, 'POST', { grid: '123', profileToken: sam })).status === 400);
  ok('pencil marks that aren\'t 81 small numbers are refused', (await api(`/run/${phone.runId}/progress`, 'POST', { grid: fill.join(''), notes: [1, 2], profileToken: sam })).status === 400);
  const guest = (await api('/start', 'POST', { level: 'easy' })).data;
  ok('a guest\'s run keeps its progress on the device only', guest.syncs === false &&
    (await api(`/run/${guest.runId}/progress`, 'POST', { grid: guest.puzzle })).status === 409);
  // Saved progress never decides anything: a whole solved board saved as
  // progress doesn't finish the puzzle, and the finish still checks what's sent.
  await api(`/run/${phone.runId}/progress`, 'POST', { grid: easyAnswer, profileToken: sam });
  const stillOpen = (await api(`/run/${phone.runId}`)).data;
  ok('saving a full, right board as progress doesn\'t finish the puzzle', stillOpen.finished === false && stillOpen.timeMs === null);
  ok('…and the finish still needs the whole board sent and checked', (await api(`/run/${phone.runId}/finish`, 'POST', {})).status === 400 &&
    (await api(`/run/${phone.runId}/finish`, 'POST', { grid: phone.puzzle })).status === 400);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
