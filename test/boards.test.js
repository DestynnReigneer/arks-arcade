'use strict';

// Taking a single score off a board from the admin page, and putting it back
// (arcade/score-admin.js): the score leaves the board and everyone's ranks,
// stays in the database, comes back exactly as it was, and only the admin
// can do any of it.

const path = require('node:path');

async function run({ base, root }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  async function call(p, method = 'GET', body, headers = {}) {
    const res = await fetch(base + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const admin = (p, method = 'GET', body) => call('/api/admin/scores' + p, method, body, ADMIN);

  console.log('\n-- boards: only the admin --');
  ok('the list of boards needs the admin password', (await call('/api/admin/scores')).status === 401);
  ok('…a wrong one is refused', (await call('/api/admin/scores', 'GET', null, { 'X-Admin-Token': 'nope' })).status === 401);

  console.log('\n-- boards: every game with a board is there --');
  const list = await admin('');
  const ids = list.status === 200 ? list.data.games.map(g => g.id) : [];
  const want = ['sudoku', 'clueless', 'tumbler', 'scuffle', 'wordless', 'spinsolve', 'chess', 'dino', 'trivia', 'snake', 'bricks', 'blocks', 'towers'];
  ok('Sudoku, Clueless, Tumbler Rumble, Shuffle Scuffle, Wordless and the older games are listed',
    want.every(id => ids.includes(id)), ids.join());
  const sudoku = list.data.games.find(g => g.id === 'sudoku');
  ok('Sudoku has a board per level, timed, by day', sudoku && sudoku.boards.map(b => b.id).join() === 'family,easy,medium,hard' && sudoku.unit === 'time' && sudoku.daily);
  ok('Snake\'s boards are its own (classic and wrap-around)', list.data.games.find(g => g.id === 'snake').boards.map(b => b.id).join() === 'classic,wrap');
  ok('Rambler is left to its own tab', !ids.includes('rambler'));

  console.log('\n-- boards: removing and putting back (the older games\' shared board) --');
  const top = (await call('/api/scores/snake', 'POST', { initials: 'TOP', score: 199990, board: 'classic' })).data;
  const two = (await call('/api/scores/snake', 'POST', { initials: 'TWO', score: 199980, board: 'classic' })).data;
  ok('two scores go on the Snake board', top.rank === 1 && two.rank === 2, JSON.stringify([top, two]));
  const seen = await admin('/snake?board=classic');
  ok('the admin sees the board best first, with ranks', seen.status === 200 && seen.data.rows[0].id === top.id && seen.data.rows[0].rank === 1 &&
    seen.data.rows[1].id === two.id && seen.data.unit === 'points', JSON.stringify(seen.data.rows.slice(0, 2)));
  ok('someone who isn\'t the admin can\'t remove a score', (await call(`/api/admin/scores/snake/${top.id}/remove`, 'POST', {})).status === 401);
  ok('…so it\'s still on the board', (await call('/api/scores/snake?board=classic')).data[0].id === top.id);
  ok('a score can\'t be removed through a different game', (await admin(`/dino/${top.id}/remove`, 'POST', {})).status === 404);
  const gone = await admin(`/snake/${top.id}/remove`, 'POST', {});
  ok('the admin removes one score', gone.status === 200 && gone.data.removed === true);
  const board = (await call('/api/scores/snake?board=classic')).data;
  ok('…and it\'s gone from the board', !board.some(r => r.id === top.id) && board[0].id === two.id);
  const newcomer = (await call('/api/scores/snake', 'POST', { initials: 'NEW', score: 199985, board: 'classic' })).data;
  ok('…and from the ranks (a score below it now ranks #1)', newcomer.rank === 1, JSON.stringify(newcomer));
  const after = await admin('/snake?board=classic');
  const kept = after.data.removed.find(r => r.id === top.id);
  ok('it\'s kept in the removed list, with who and when', !!kept && kept.initials === 'TOP' && kept.value === 199990 &&
    kept.removedBy === 'an admin script' && !!kept.removedAt, JSON.stringify(after.data.removed));
  ok('removing it again says it isn\'t on the board', (await admin(`/snake/${top.id}/remove`, 'POST', {})).status === 404);
  ok('someone who isn\'t the admin can\'t put it back', (await call(`/api/admin/scores/snake/${top.id}/restore`, 'POST', {})).status === 401);
  const back = await admin(`/snake/${top.id}/restore`, 'POST', {});
  ok('Put back returns it', back.status === 200 && back.data.restored === true);
  const restored = (await call('/api/scores/snake?board=classic')).data;
  ok('…to the top of the board, exactly as it was', restored[0].id === top.id && restored[0].initials === 'TOP' && restored[0].score === 199990);
  ok('…and it leaves the removed list', !(await admin('/snake?board=classic')).data.removed.some(r => r.id === top.id));
  ok('putting back something that isn\'t removed is a 404', (await admin(`/snake/${top.id}/restore`, 'POST', {})).status === 404);

  console.log('\n-- boards: a daily, timed board (Sudoku) --');
  const day = await call('/api/sudoku/board?level=family&scope=day');
  const fastest = day.data[0];
  ok('Sudoku\'s family board has times from the Sudoku tests', !!fastest && day.data.length >= 2, JSON.stringify(day.data));
  if (fastest) {
    const adminDay = await admin(`/sudoku?board=family&scope=day&day=${fastest.day}`);
    ok('the admin sees that day\'s Sudoku board fastest first', adminDay.data.rows[0].id === fastest.id && adminDay.data.unit === 'time' && adminDay.data.scope === 'day');
    await admin(`/sudoku/${fastest.id}/remove`, 'POST', {});
    const without = (await call('/api/sudoku/board?level=family&scope=day')).data;
    const allTime = (await call('/api/sudoku/board?level=family&scope=all')).data;
    ok('a removed Sudoku time leaves today\'s board and the all-time board', !without.some(r => r.id === fastest.id) && !allTime.some(r => r.id === fastest.id));
    ok('…and is listed as removed for that day', (await admin(`/sudoku?board=family&scope=day&day=${fastest.day}`)).data.removed.some(r => r.id === fastest.id));
    await admin(`/sudoku/${fastest.id}/restore`, 'POST', {});
    ok('putting it back puts it first again', (await call('/api/sudoku/board?level=family&scope=day')).data[0].id === fastest.id);
  }

  console.log('\n-- boards: a game added later is picked up on its own --');
  {
    // A new game's `<id>_scores` table, made straight in the test database.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(root, 'data', 'test.db'));
    db.exec(`CREATE TABLE IF NOT EXISTS laterball_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, initials TEXT NOT NULL,
      profile_name TEXT, score INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    const id = Number(db.prepare('INSERT INTO laterball_scores (day, initials, score) VALUES (?, ?, ?)').run('2026-11-01', 'LTR', 4321).lastInsertRowid);
    const games = (await admin('')).data.games;
    const later = games.find(g => g.id === 'laterball');
    ok('it\'s in the list, by day, in points', !!later && later.daily === true && later.unit === 'points', JSON.stringify(later));
    ok('…with its row', (await admin('/laterball')).data.rows.some(r => r.id === id && r.value === 4321));
    await admin(`/laterball/${id}/remove`, 'POST', {});
    ok('…which can be removed', !db.prepare('SELECT 1 FROM laterball_scores WHERE id = ?').get(id) && (await admin('/laterball')).data.removed.some(r => r.id === id));
    await admin(`/laterball/${id}/restore`, 'POST', {});
    ok('…and put back with the same id', db.prepare('SELECT initials, score FROM laterball_scores WHERE id = ?').get(id).score === 4321);
    // A game taken out of the arcade keeps its old scores in the database, but gets no board.
    db.exec(`CREATE TABLE IF NOT EXISTS moonshot_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, initials TEXT NOT NULL,
      profile_name TEXT, score INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    ok('a game taken out of the arcade (Moonshot) gets no board, though its old table is still there',
      !(await admin('')).data.games.some(g => g.id === 'moonshot'));
    db.close();
  }

  console.log('\n-- boards: Words with Family results --');
  {
    const people = [];
    for (const name of ['Fay', 'Gus']) {
      const asked = await call('/api/profiles', 'POST', { name: `BD ${name}`, avatar: 'shiba:1' });
      await call(`/api/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
      const used = await call(`/api/profiles/${asked.data.id}/use`, 'POST', {});
      people.push({ id: asked.data.id, h: { 'X-Profile-Token': used.data.token } });
    }
    const [fay, gus] = people;
    const game = await call('/api/crisscross/games', 'POST', { kind: 'online', seats: 2 }, fay.h);
    await call(`/api/crisscross/lobby/${game.data.game.joinCode}/join`, 'POST', {}, gus.h);
    await call(`/api/crisscross/games/${game.data.id}/resign`, 'POST', {}, gus.h);
    const wwf = (await admin('')).data.games.find(g => g.id === 'crisscross');
    ok('Words with Family is on the Boards tab with Best single word and Best game score',
      wwf && wwf.boards.map(b => b.id).join() === 'word,best', JSON.stringify(wwf));
    const best = await admin('/crisscross?board=best');
    const mine = best.data.rows.find(r => r.name === 'BD Fay');
    ok('…a finished game\'s result shows there with the player\'s name', !!mine && typeof mine.id === 'number', JSON.stringify(best.data.rows.slice(0, 3)));
    const winsOf = async who => {
      const b = (await call('/api/trophies', 'GET', null, who.h)).data.games.find(g => g.id === 'crisscross').boards.find(x => x.id === 'wins');
      return b.you ? b.you.value : 0;
    };
    ok('…and it counts as a win on the trophy page', await winsOf(fay) === 1);
    await admin(`/crisscross/${mine.id}/remove`, 'POST', {});
    ok('taking the result off removes the win too', await winsOf(fay) === 0);
    ok('…and lists it under removed', (await admin('/crisscross?board=best')).data.removed.some(r => r.id === mine.id));
    await admin(`/crisscross/${mine.id}/restore`, 'POST', {});
    ok('putting it back brings the win back', await winsOf(fay) === 1);
  }

  console.log('\n-- boards: Tower Defense\'s All levels keeps a carried-on game up to date --');
  {
    const post = body => call('/api/scores/towers', 'POST', body);
    ok('one map\'s board takes up to 100,000', (await post({ initials: 'MAP', score: 100000, board: 'meadow' })).status === 201);
    ok('…and refuses more, since no single map can give that', (await post({ initials: 'MAP', score: 100001, board: 'meadow' })).status === 400);
    ok('…and a map\'s board never hands out a run key', !('runKey' in (await post({ initials: 'MAP', score: 500, board: 'canyon' })).data));
    const first = await post({ initials: 'RUN', score: 20000, board: 'all', detail: 'Meadow' });
    ok('All levels takes a carried-on game and hands back its key', first.status === 201 && first.data.board === 'all' && /^[0-9a-f]{36}$/.test(first.data.runKey || ''), JSON.stringify(first.data));
    const run = { id: first.data.id, key: first.data.runKey };
    const raised = await post({ score: 45000, board: 'all', detail: 'Meadow and Canyon', run });
    ok('saving the same game again raises its own row', raised.status === 201 && raised.data.id === run.id && raised.data.score === 45000, JSON.stringify(raised.data));
    const rows = (await call('/api/scores/towers?board=all&limit=100')).data.filter(r => r.id === run.id);
    ok('…so the game is on the board once, with its new score and maps', rows.length === 1 && rows[0].score === 45000 && rows[0].detail === 'Meadow and Canyon' && rows[0].initials === 'RUN');
    ok('…and the key never shows on the board', !JSON.stringify(rows).includes(run.key));
    ok('a wrong key can\'t touch it', (await post({ score: 60000, board: 'all', run: { id: run.id, key: 'f'.repeat(36) } })).status === 404);
    ok('…nor can no key', (await post({ score: 60000, board: 'all', run: { id: run.id } })).status === 404);
    ok('a game\'s score can\'t go down', (await post({ score: 100, board: 'all', run })).status === 400);
    ok('a map\'s board doesn\'t take a run', (await post({ score: 60000, board: 'meadow', run })).status === 400);
    ok('All levels takes up to 300,000 (three maps)', (await post({ score: 300000, board: 'all', run })).status === 201);
    ok('…and no more', (await post({ score: 300001, board: 'all', run })).status === 400);
    const admin2 = (await admin('')).data.games.find(g => g.id === 'towers');
    ok('All levels is one of Tower Defense\'s boards on the Boards tab', admin2 && admin2.boards.some(b => b.id === 'all'), JSON.stringify(admin2 && admin2.boards));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
