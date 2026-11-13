'use strict';

// Clueless: the grid filler and the clue checks (no server needed), then the
// API against the real server: the same crossword for the same day, no
// letters before the finish, the server keeping the time, help costing time,
// the boards, and clue packs from admin.

const path = require('node:path');

async function run({ base, root }) {
  const grid = require(path.join(root, 'clueless/grid.js'));
  const maker = require(path.join(root, 'clueless/maker.js'));
  const clues = require(path.join(root, 'clueless/clues.js'));
  const API = base + '/api/clueless';
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function api(p, method = 'GET', body, headers = {}) {
    const go = () => fetch(API + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    // Making grids takes a few seconds, long enough for the server to close
    // the connection the earlier suites left open; one retry covers that.
    const res = await go().catch(go);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  }

  console.log('\n-- clueless: shapes and the filler --');
  let shapesOk = true;
  for (const size of [5, 7]) for (const s of grid.SHAPES[size]) if (grid.checkShape(s).length) shapesOk = false;
  ok('every shape has only 3+ letter words, every square in an across and a down word, and is the same upside down', shapesOk);
  ok('a shape with a 2-letter word is caught', grid.checkShape(['#....', '.....', '.....', '.....', '...##']).length > 0);

  const starter = new Map();
  for (const [w, c] of clues.starterClues()) starter.set(w, { kids: [c], grownup: [] });
  let valid = true, unique = true, clued = true, sizes = true, kidsOnly = true, made = 0;
  const why = [];
  for (let k = 0; k < 20; k++) {
    const d = new Date('2026-11-01T12:00:00');
    d.setDate(d.getDate() + k * 17);
    const day = d.toISOString().slice(0, 10);
    for (const level of maker.LEVEL_IDS) {
      const p = maker.makePuzzle(day, level, starter);
      if (!p) { valid = false; why.push(`${day} ${level} not made`); continue; }
      made++;
      if (p.size !== maker.LEVELS[level].size || p.letters.length !== p.size * p.size) sizes = false;
      const seen = new Set();
      for (const e of p.entries) {
        if (e.cells.map(i => p.letters[i]).join('') !== e.answer || e.answer.length < 3) valid = false;
        if (seen.has(e.answer)) { unique = false; why.push(`${day} ${level} repeats ${e.answer}`); }
        seen.add(e.answer);
        if (!starter.has(e.answer) || !e.clue) clued = false;
        if (level === 'mini' && e.answer.length > 5) kidsOnly = false;
      }
      // Every white square is in exactly one across and one down entry.
      for (let i = 0; i < p.letters.length; i++) {
        if (p.letters[i] === '#') continue;
        const a = p.entries.filter(e => e.dir === 'across' && e.cells.includes(i)).length;
        const dn = p.entries.filter(e => e.dir === 'down' && e.cells.includes(i)).length;
        if (a !== 1 || dn !== 1) valid = false;
      }
    }
  }
  ok('the built-in clues fill a mini and a adults\' grid on every day tried', valid && made === 40, why.slice(0, 3).join('; '));
  ok('every across and down entry is a word with a clue', clued);
  ok('no word appears twice in one grid', unique, why.slice(0, 3).join('; '));
  ok('the mini is 5 by 5 and the adults\' one 7 by 7', sizes && kidsOnly);
  const a1 = maker.makePuzzle('2026-12-25', 'big', starter), a2 = maker.makePuzzle('2026-12-25', 'big', starter);
  ok('the same day and level always make the same grid and clues', JSON.stringify(a1) === JSON.stringify(a2));
  ok('different days make different grids', maker.makePuzzle('2026-12-26', 'big', starter).letters !== a1.letters);
  // The order clues arrive in (the database's order) doesn't change anything.
  const shuffled = new Map([...starter.entries()].reverse());
  ok('…whatever order the clues come in', maker.makePuzzle('2026-12-25', 'big', shuffled).letters === a1.letters);
  ok('a pool too small to fill anything gives up instead of hanging', maker.makePuzzle('2026-12-25', 'mini', new Map([['CAT', { kids: ['Pet that purrs'], grownup: [] }]])) === null);
  const view = maker.publicView(a1);
  ok('what the page gets has the shape and clues but no letters', !/[A-Z]/.test(view.blocks) && !JSON.stringify(view).includes(a1.entries[0].answer) &&
    !('letters' in view) && view.across.every(e => !('answer' in e)));

  console.log('\n-- clueless: checking clues --');
  ok('every built-in clue passes the same checks as a pasted one',
    [...clues.starterClues()].every(([w, c]) => !clues.wordProblem(w) && !clues.clueProblem(w, c)));
  ok('the built-in set has a few hundred words or more', clues.starterClues().size >= 300, String(clues.starterClues().size));
  const pasted = clues.checkPaste([
    '1. APPLE: Fruit that keeps the doctor away',
    '- **RIVER**: Flowing water',
    'CAT: A cat says meow',
    'DOG: Dogs bark',
    'PLAY: Player\'s job',
    'HOUSE: Where the shit happens',
    'COLOR: The colour of the sky',
    'TIGER',
    'ZZZQX: Nonsense',
    'ELEPHANTS: Too long for the grid',
    'MOON: ' + 'x'.repeat(90),
    'APPLE: Red or green fruit'
  ].join('\n'));
  const reason = w => (pasted.skipped.find(s => s.word === w) || {}).reason || '';
  ok('lines with numbers, bullets and bold marks are read', pasted.keep.map(k => k.word).join() === 'APPLE,RIVER', JSON.stringify(pasted.keep));
  ok('a clue holding its own answer is skipped', /inside its own clue/.test(reason('CAT')) && /inside its own clue/.test(reason('DOG')));
  ok('…and so is one holding the start of the answer (PLAY in "Player")', /inside its own clue/.test(reason('PLAY')));
  ok('a clue with a word the kids blocklist removes is skipped', /blocks/.test(reason('HOUSE')), reason('HOUSE'));
  ok('a clue with a British spelling is skipped', /British/.test(reason('COLOR')), reason('COLOR'));
  ok('a word with no clue, a made-up word, a too-long word and a too-long clue are skipped',
    /missing/.test(reason('TIGER')) && /word list/.test(reason('ZZZQX')) && /letters/.test(reason('ELEPHANTS')) && /longer/.test(reason('MOON')));
  ok('the same word twice keeps the first', /twice/.test(reason('APPLE')));
  ok('a word only the unfiltered list has can\'t be a clued word', /family word list/.test(clues.wordProblem('SHIT') || ''));
  ok('JSON works too', clues.checkPaste('{"OCEAN": "The Pacific, for one", "SPOON": "Soup tool"}').keep.length === 2 &&
    clues.checkPaste('[{"word":"ocean","clue":"Big blue sea"}]').keep[0].word === 'OCEAN');
  ok('broken JSON says so', !!clues.checkPaste('{"OCEAN": ').error);

  console.log('\n-- clueless: the API --');
  const lv = await api('/levels');
  ok('levels lists the mini and the adults\' crossword, and what help costs', lv.status === 200 &&
    lv.data.levels.map(l => `${l.id}:${l.size}`).join() === 'mini:5,big:7' && lv.data.penalties.reveal === 15000);
  ok('an unknown level is refused', (await api('/start', 'POST', { level: 'huge' })).status === 400);

  const a = await api('/start', 'POST', { level: 'mini' });
  ok('starting hands out a run id, the shape and the clues', a.status === 200 && /^[0-9a-f]{32}$/.test(a.data.runId) &&
    a.data.puzzle.size === 5 && a.data.puzzle.across.length > 0 && a.data.day === lv.data.day);
  const ans = (await api(`/test/answer/${a.data.runId}`)).data.letters;
  ok('the test-only answer hook works under the test suite', typeof ans === 'string' && ans.length === 25);
  const answers = [];
  for (const e of [...a.data.puzzle.across, ...a.data.puzzle.down]) answers.push(e.cells.map(i => ans[i]).join(''));
  ok('…and the start never carries a letter of the answer', !/"(letters|answer|answers|solution)"/.test(a.text) &&
    !answers.some(w => a.text.includes(`"${w}"`)) && !/[A-Z]/.test(a.data.puzzle.blocks) && Object.keys(a.data.revealed).length === 0);
  const runView = await api(`/run/${a.data.runId}`);
  ok('…nor does reading the run back', !answers.some(w => runView.text.includes(`"${w}"`)) && !/"(letters|answers)"/.test(runView.text));
  const b = await api('/start', 'POST', { level: 'mini' });
  ok('everyone gets the same crossword today', JSON.stringify(b.data.puzzle) === JSON.stringify(a.data.puzzle) && b.data.runId !== a.data.runId);

  const blank = '.'.repeat(25);
  const firstWhite = ans.search(/[A-Z]/);
  const wrongGrid = ans.slice(0, firstWhite) + (ans[firstWhite] === 'A' ? 'B' : 'A') + ans.slice(firstWhite + 1);
  const bad = await api(`/run/${a.data.runId}/finish`, 'POST', { grid: wrongGrid });
  ok('a wrong grid is refused, and doesn\'t give away the answer', bad.status === 400 && bad.data.solved === false && !bad.text.includes(ans));
  ok('a half-empty grid is refused', (await api(`/run/${a.data.runId}/finish`, 'POST', { grid: blank })).status === 400);
  ok('a grid of the wrong size is refused', (await api(`/run/${a.data.runId}/finish`, 'POST', { grid: 'ABC' })).status === 400);
  const fast = await api(`/run/${a.data.runId}/finish`, 'POST', { grid: ans, timeMs: 1 });
  ok('a finish faster than anyone could type is turned away', fast.status === 400 && /faster/.test(fast.data.error), JSON.stringify(fast.data));

  // Help, decided and charged by the server.
  const chk = await api(`/run/${a.data.runId}/check`, 'POST', { scope: 'word', index: firstWhite, dir: 'across', grid: wrongGrid });
  ok('checking a word says which squares are wrong, without the right letters', chk.status === 200 && Array.isArray(chk.data.wrong) &&
    chk.data.penaltyMs === 10000 && chk.data.checks === 1 && !('letters' in chk.data));
  const chkAll = await api(`/run/${a.data.runId}/check`, 'POST', { scope: 'puzzle', grid: blank });
  ok('checking the whole puzzle costs 20 seconds', chkAll.data.penaltyMs === 30000 && chkAll.data.wrong.length === 0);
  ok('a check on a black square or with a made-up scope is refused',
    (await api(`/run/${a.data.runId}/check`, 'POST', { scope: 'square', index: ans.indexOf('#'), grid: blank })).status === 400 &&
    (await api(`/run/${a.data.runId}/check`, 'POST', { scope: 'everything', index: firstWhite, grid: blank })).status === 400);
  const rv = await api(`/run/${a.data.runId}/reveal`, 'POST', { scope: 'square', index: firstWhite });
  ok('revealing a square hands over that one letter and costs 15 seconds', rv.status === 200 &&
    JSON.stringify(rv.data.letters) === JSON.stringify({ [firstWhite]: ans[firstWhite] }) && rv.data.penaltyMs === 45000 && rv.data.reveals === 1);
  const again = await api(`/run/${a.data.runId}/reveal`, 'POST', { scope: 'square', index: firstWhite });
  ok('revealing it again costs nothing more', again.data.penaltyMs === 45000 && again.data.cost === 0);
  ok('revealed letters are remembered on the run', (await api(`/run/${a.data.runId}`)).data.revealed[firstWhite] === ans[firstWhite]);
  ok('the whole puzzle can\'t be revealed', (await api(`/run/${a.data.runId}/reveal`, 'POST', { scope: 'puzzle' })).status === 400);

  // Pausing stops the clock.
  await api(`/run/${a.data.runId}/pause`, 'POST', {});
  const p1 = (await api(`/run/${a.data.runId}`)).data.playMs;
  await wait(400);
  const p2 = (await api(`/run/${a.data.runId}`)).data.playMs;
  ok('a paused clock doesn\'t move', p1 === p2 && (await api(`/run/${a.data.runId}`)).data.paused);
  ok('a paused puzzle can\'t be finished or checked', (await api(`/run/${a.data.runId}/finish`, 'POST', { grid: ans })).status === 409 &&
    (await api(`/run/${a.data.runId}/check`, 'POST', { scope: 'puzzle', grid: blank })).status === 409);
  await api(`/run/${a.data.runId}/resume`, 'POST', {});
  await wait(600);
  const done = await api(`/run/${a.data.runId}/finish`, 'POST', { grid: ans.toLowerCase(), timeMs: 5 });
  ok('the right grid finishes it, with the time worked out on the server', done.status === 200 && done.data.finished &&
    done.data.timeMs >= 600 + 45000 && done.data.timeMs < 120000, JSON.stringify({ t: done.data.timeMs, e: done.data.error }));
  ok('…and only then come the letters', done.data.answers === ans);
  ok('help can\'t be asked for after the finish', (await api(`/run/${a.data.runId}/reveal`, 'POST', { scope: 'square', index: firstWhite })).status === 409);

  const saved = await api(`/run/${a.data.runId}/save`, 'POST', { initials: 'clu' });
  ok('a finished time goes on the board', saved.status === 201 && saved.data.dayRank >= 1 && saved.data.timeMs === done.data.timeMs);
  ok('…once', (await api(`/run/${a.data.runId}/save`, 'POST', { initials: 'CLU' })).status === 409);
  ok('an unfinished run can\'t be saved', (await api(`/run/${b.data.runId}/save`, 'POST', { initials: 'XYZ' })).status === 409);
  await wait(500);
  await api(`/run/${b.data.runId}/finish`, 'POST', { grid: ans });
  const twice = await api(`/run/${b.data.runId}/save`, 'POST', { initials: 'CLU' });
  ok('only a player\'s first finish of the day counts', twice.status === 409 && /first finish/.test(twice.data.error));
  const quick = await api(`/run/${b.data.runId}/save`, 'POST', { initials: 'QIK' });
  const board = (await api('/board?level=mini&scope=day')).data;
  ok('the board is quickest first', board.length >= 2 && board[0].timeMs <= board[1].timeMs && board[0].initials === 'QIK' && quick.status === 201);
  ok('…and says what help was used', board.find(r => r.initials === 'CLU').reveals === 1 && board.find(r => r.initials === 'CLU').checks === 2);
  ok('the all-time board works', (await api('/board?level=mini&scope=all')).data.length >= 2);
  ok('the run id is long and random, and a made-up one is refused', (await api('/run/0123456789abcdef0123456789abcdef')).status === 404);

  console.log('\n-- clueless: the adults\' crossword --');
  const big = await api('/start', 'POST', { level: 'big' });
  ok('the adults\' crossword is 7 by 7', big.status === 200 && big.data.puzzle.size === 7 && big.data.puzzle.blocks.length === 49);
  const bigAns = (await api(`/test/answer/${big.data.runId}`)).data.letters;
  ok('…and different from the mini', bigAns !== ans);

  console.log('\n-- clueless: crossing off solved clues --');
  // A grid with only some squares filled in from the answer.
  const only = (answer, keep) => [...answer].map((ch, i) => (ch !== '#' && keep.includes(i) ? ch : '.')).join('');
  const c = await api('/start', 'POST', { level: 'mini' });
  const e1 = c.data.puzzle.across[0];
  const s1 = await api(`/run/${c.data.runId}/solved`, 'POST', { grid: only(ans, e1.cells) });
  ok('on the mini, a right word is crossed off straight away', s1.status === 200 && s1.data.rule === 'word' &&
    s1.data.across.includes(e1.num), JSON.stringify(s1.data));
  ok('…and the answer never comes with it', !/"(letters|answer|answers)"/.test(s1.text) && !s1.text.includes(ans));
  const wrongWord = [...only(ans, e1.cells)];
  wrongWord[e1.cells[0]] = ans[e1.cells[0]] === 'A' ? 'B' : 'A';
  const s2 = await api(`/run/${c.data.runId}/solved`, 'POST', { grid: wrongWord.join('') });
  ok('one wrong letter and it isn\'t', s2.status === 200 && !s2.data.across.includes(e1.num) && !('wrong' in s2.data));
  ok('an empty grid has nothing crossed off', (await api(`/run/${c.data.runId}/solved`, 'POST', { grid: blank })).data.across.length === 0);

  const bp = big.data.puzzle, n7 = bp.size;
  // An across word sharing its row with another word: on the adults' crossword it waits for the whole row.
  const rowOf = e => [...Array(n7).keys()].map(k => e.row * n7 + k).filter(i => bigAns[i] !== '#');
  const shared = bp.across.find(e => rowOf(e).length > e.cells.length) || bp.across[0];
  const s3 = await api(`/run/${big.data.runId}/solved`, 'POST', { grid: only(bigAns, shared.cells) });
  ok('on the adults\' crossword the rule is the whole line', s3.data.rule === 'line');
  if (rowOf(shared).length > shared.cells.length) {
    ok('…so a right word alone isn\'t crossed off while its row has another word to fill', !s3.data.across.includes(shared.num), JSON.stringify(s3.data));
  }
  const s4 = await api(`/run/${big.data.runId}/solved`, 'POST', { grid: only(bigAns, rowOf(shared)) });
  ok('…and once the whole row is right, every across clue in it is', bp.across.filter(e => e.row === shared.row).every(e => s4.data.across.includes(e.num)), JSON.stringify(s4.data));
  const fullBig = await api(`/run/${big.data.runId}/solved`, 'POST', { grid: bigAns });
  ok('a fully right grid crosses off every clue', fullBig.data.across.length === bp.across.length && fullBig.data.down.length === bp.down.length);

  console.log('\n-- clueless: free play --');
  const f1 = await api('/start', 'POST', { level: 'mini', free: true });
  const f2 = await api('/start', 'POST', { level: 'mini', free: true });
  ok('free play hands out a crossword marked free', f1.status === 200 && f1.data.free === true && f1.data.puzzle.size === 5 && c.data.free === false);
  const f1Ans = (await api(`/test/answer/${f1.data.runId}`)).data.letters;
  const f2Ans = (await api(`/test/answer/${f2.data.runId}`)).data.letters;
  ok('New board (another free start) gives a different crossword, not today\'s', f1Ans !== f2Ans && f1Ans !== ans && f2Ans !== ans);
  ok('…and its start never carries a letter', !/"(letters|answer|answers)"/.test(f1.text));
  ok('a free crossword stays the same when you come back to it', JSON.stringify((await api(`/run/${f1.data.runId}`)).data.puzzle) === JSON.stringify(f1.data.puzzle));
  ok('today\'s puzzle is still today\'s after free play', (await api(`/test/answer/${(await api('/start', 'POST', { level: 'mini' })).data.runId}`)).data.letters === ans);
  await wait(500);
  const fDone = await api(`/run/${f1.data.runId}/finish`, 'POST', { grid: f1Ans });
  ok('a free crossword can be finished', fDone.status === 200 && fDone.data.finished && fDone.data.free);
  const fSave = await api(`/run/${f1.data.runId}/save`, 'POST', { initials: 'FRE' });
  ok('…but its time doesn\'t go on the board', fSave.status === 409 && /Free play/.test(fSave.data.error));
  const fBig = await api('/start', 'POST', { level: 'big', free: true });
  ok('free play works for the adults\' crossword too', fBig.status === 200 && fBig.data.free && fBig.data.puzzle.size === 7);

  console.log('\n-- clueless: clue packs in admin --');
  ok('the clue pack pages need the admin', (await api('/admin/batch?kind=kids')).status === 401 &&
    (await api('/admin/packs', 'POST', { label: 'x', kind: 'kids', text: 'APPLE: Fruit' })).status === 401);
  const batch = await api('/admin/batch?kind=kids&count=30', 'GET', null, ADMIN);
  ok('the prompt gets 30 words from the list, none with a built-in clue yet', batch.status === 200 && batch.data.words.length === 30 &&
    batch.data.words.every(w => !clues.starterClues().has(w) && !clues.wordProblem(w)));
  const pick = batch.data.words.slice(0, 6);
  const text = pick.map((w, i) => `${w}: Test clue number ${'abcdef'[i]} here`).join('\n') + '\nCAT: My cat';
  const pack = await api('/admin/packs', 'POST', { label: 'Test family clues', kind: 'kids', text }, ADMIN);
  ok('a pasted pack is checked and saved, with the bad lines listed', pack.status === 201 && pack.data.added === 6 &&
    pack.data.skipped.length === 1 && pack.data.skipped[0].word === 'CAT', JSON.stringify(pack.data));
  const summary = (await api('/admin/summary', 'GET', null, ADMIN)).data;
  ok('the summary counts the new clues', summary.kids === 6 && summary.starter === clues.starterClues().size);
  ok('the same pack again saves nothing new', (await api('/admin/packs', 'POST', { label: 'Again', kind: 'kids', text }, ADMIN)).status === 400);
  ok('a pack with too few good clues is refused, saying why', await api('/admin/packs', 'POST', { label: 'Tiny', kind: 'grownup', text: 'APPLE: An apple' }, ADMIN)
    .then(r => r.status === 400 && /at least 5/.test(r.data.error) && r.data.skipped[0].word === 'APPLE'));
  ok('a pack needs a name and a kind', (await api('/admin/packs', 'POST', { label: '', kind: 'kids', text }, ADMIN)).status === 400 &&
    (await api('/admin/packs', 'POST', { label: 'x', kind: 'adult', text }, ADMIN)).status === 400);
  const after = await api('/start', 'POST', { level: 'mini' });
  ok('today\'s crossword doesn\'t change when a pack is added', JSON.stringify(after.data.puzzle) === JSON.stringify(a.data.puzzle));
  const packs = (await api('/admin/packs', 'GET', null, ADMIN)).data;
  ok('the pack is listed', packs.length === 1 && packs[0].count === 6 && packs[0].kind === 'kids');
  ok('its clues can be read back', (await api(`/admin/packs/${packs[0].id}`, 'GET', null, ADMIN)).data.length === 6);
  await api(`/admin/packs/${packs[0].id}`, 'DELETE', null, ADMIN);
  ok('and deleted, clues and all', (await api('/admin/packs', 'GET', null, ADMIN)).data.length === 0 &&
    (await api('/admin/summary', 'GET', null, ADMIN)).data.kids === 0);

  console.log('\n-- clueless: letters that follow a profile --');
  const top = async (p, method = 'GET', body, headers = {}) => {
    const res = await fetch(base + '/api' + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const tokens = [];
  for (const name of ['Sync Ana', 'Sync Ben']) {
    const asked = await top('/profiles', 'POST', { name, avatar: 'shiba:1' });
    await top(`/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    tokens.push((await top(`/profiles/${asked.data.id}/use`, 'POST', {})).data.token);
  }
  const [anaT, benT] = tokens;
  const mine = await api('/start', 'POST', { level: 'mini', profileToken: anaT });
  ok('a profile\'s daily crossword is kept on the arcade', mine.data.syncs === true && mine.data.progress === null);
  const mineAns = (await api(`/test/answer/${mine.data.runId}`)).data.letters;
  const n = mine.data.puzzle.size * mine.data.puzzle.size;
  const typed = Array.from({ length: n }, (_, i) => (i < 3 ? (/^[A-Z]$/.test(mineAns[i]) ? mineAns[i] : 'Q') : ''));
  const sent = await api(`/run/${mine.data.runId}/progress`, 'POST', { letters: typed, pencil: [true], profileToken: anaT });
  ok('its letters can be saved', sent.status === 200 && sent.data.saved === true);
  const reopened = await api('/start', 'POST', { level: 'mini', profileToken: anaT });
  ok('…and opening it again (on any device) hands them back',
    reopened.data.runId === mine.data.runId && reopened.data.progress && reopened.data.progress.letters.slice(0, 3).join('') === typed.slice(0, 3).map((l, i) => (/^[A-Z]$/.test(mineAns[i]) ? l : '')).join(''));
  ok('another profile can\'t save over them', (await api(`/run/${mine.data.runId}/progress`, 'POST', { letters: typed, profileToken: benT })).status === 403);
  ok('letters that don\'t fit the crossword are refused', (await api(`/run/${mine.data.runId}/progress`, 'POST', { letters: ['A'], profileToken: anaT })).status === 400);
  const guestRun = await api('/start', 'POST', { level: 'mini' });
  ok('a guest\'s letters stay on the device', guestRun.data.syncs === false &&
    (await api(`/run/${guestRun.data.runId}/progress`, 'POST', { letters: typed, profileToken: anaT })).status === 409);
  const freeRun = await api('/start', 'POST', { level: 'mini', free: true, profileToken: anaT });
  ok('…and so does a free board', freeRun.data.syncs === false);

  console.log(`
  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
