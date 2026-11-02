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
  const want = ['sudoku', 'clueless', 'tumbler', 'discodrop', 'royale', 'scuffle', 'wordless', 'spinsolve', 'chess', 'dino', 'trivia', 'snake', 'bricks', 'blocks', 'towers'];
  ok('Sudoku, Clueless, Tumbler Rumble, Disco Drop, Roll Royale, Shuffle Scuffle, Wordless and the older games are listed',
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
    db.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
