'use strict';

// A restart in the middle of things. The arcade is stopped the hard way (the
// way a power cut or a new image stops it) and started again on the same
// database, and the games it keeps have to come back exactly as they were.

async function run({ base, restart }) {
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  async function api(p, method = 'GET', body, headers = {}) {
    const res = await fetch(base + p, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  const PIN = { 'X-Adult-Pin': '246810' };
  const spin = (p, body, headers) => api(`/api/spinsolve/run${p}`, 'POST', body || {}, headers);
  const look = (id, headers) => api(`/api/spinsolve/run/${id}`, 'GET', null, headers);
  const answerOf = async id => (await api(`/api/spinsolve/test/answer/${id}`)).data.answer;

  console.log('\n-- restart: Spin & Solve --');
  // A profile, so the game is theirs and shows in their Continue row.
  const asked = await api('/api/profiles', 'POST', { name: 'RS Kim', avatar: 'shiba:1' });
  await api(`/api/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
  const kim = { 'X-Profile-Token': (await api(`/api/profiles/${asked.data.id}/use`, 'POST', {})).data.token };

  const mine = (await spin('/start', { level: 'kids', names: ['Kim'], rounds: 3 }, kim)).data;
  const guests = (await spin('/start', { level: 'kids', names: ['Gus', 'Ana'], rounds: 3 })).data;
  const untouched = (await spin('/start', { level: 'kids', names: ['Lee'], rounds: 1 })).data;
  const adult = (await spin('/start', { level: 'spicy', names: ['Kim'], rounds: 1 }, PIN)).data;
  // A move in each: a wrong answer is a strike when playing alone, and passes the turn with two players.
  await spin(`/${mine.id}/solve`, { guess: 'NOT THE ANSWER' }, kim);
  await spin(`/${guests.id}/solve`, { guess: 'NOT THE ANSWER' });
  await spin(`/${adult.id}/solve`, { guess: 'NOT THE ANSWER' }, PIN);
  const before = (await look(mine.id, kim)).data;
  const beforeGuests = (await look(guests.id)).data;
  const answer = await answerOf(mine.id);
  ok('the games are set up: a strike in one, the second player\'s turn in the other',
    before.state.strikes === 1 && beforeGuests.state.cur === 1 && adult.adult === true, JSON.stringify([before.state.strikes, beforeGuests.state.cur]));
  ok('nothing is in the Continue row for someone with no profile', (await api('/api/continue')).data.games.length === 0);

  await restart();

  const after = await look(mine.id, kim);
  ok('a game comes back after a restart, exactly as it was',
    after.status === 200 && JSON.stringify(after.data.state) === JSON.stringify(before.state) && after.data.level === 'kids',
    JSON.stringify(after.data).slice(0, 300));
  ok('…with its strike, its puzzle still hidden, and its jokes',
    after.data.state.strikes === 1 && after.data.state.board === before.state.board && !('answer' in after.data.state) && after.data.banter.jokes.length >= 20);
  const afterGuests = await look(guests.id);
  ok('a guest\'s game with two players comes back too, on the same player\'s turn',
    afterGuests.status === 200 && JSON.stringify(afterGuests.data.state) === JSON.stringify(beforeGuests.state));
  ok('…and so does a game nobody had moved in yet', (await look(untouched.id)).status === 200);
  ok('an adult game still needs the pass after a restart', (await look(adult.id)).status === 403 && (await look(adult.id, PIN)).status === 200);
  ok('the puzzle is the same one', (await answerOf(mine.id)) === answer);

  const row = (await api('/api/continue', 'GET', null, kim)).data.games.find(g => g.game === 'spinsolve');
  ok('a profile\'s game that was played is in their Continue row', !!row && row.title === 'Spin & Solve' &&
    /^Round 1 of 3, \$[\d,]+ so far$/.test(row.detail) && row.href === `spinsolve.html?game=${mine.id}`, JSON.stringify(row));
  ok('…and only one of them: the untouched game and the guests\' games aren\'t there',
    (await api('/api/continue', 'GET', null, kim)).data.games.filter(g => g.game === 'spinsolve').length === 1);

  // Played on to the end, saved, and gone for good.
  const solved = await spin(`/${mine.id}/solve`, { guess: answer }, kim);
  ok('the game can be played on: the right answer solves the round', solved.status === 200 && solved.data.correct === true && solved.data.state.players[0].total >= 1000,
    JSON.stringify(solved.data).slice(0, 200));
  for (let round = 2; round <= 3; round++) {
    await spin(`/${mine.id}/next`, {}, kim);
    await spin(`/${mine.id}/solve`, { guess: await answerOf(mine.id) }, kim);
  }
  const over = (await spin(`/${mine.id}/next`, {}, kim)).data.state;
  ok('three rounds on, the game is over with its total', over.phase === 'over' && over.canSave === true && over.players[0].total >= 3000, JSON.stringify(over).slice(0, 200));
  const total = over.players[0].total;

  await restart();

  const stillOver = await look(mine.id, kim);
  ok('a finished game waiting for its score comes back as well', stillOver.status === 200 && stillOver.data.state.phase === 'over' && stillOver.data.state.players[0].total === total);
  ok('…and it has left the Continue row', !(await api('/api/continue', 'GET', null, kim)).data.games.some(g => g.game === 'spinsolve'));
  const savedScore = await spin(`/${mine.id}/save`, {}, kim);
  ok('its score saves to the board', savedScore.status === 201, JSON.stringify(savedScore.data));
  ok('…and then the game is gone', (await look(mine.id, kim)).status === 404);
  ok('the guests\' game is still there after the second restart', (await look(guests.id)).status === 200);

  await restart();

  ok('a saved game stays gone after another restart', (await look(mine.id, kim)).status === 404);
  ok('…and the others are still there', (await look(guests.id)).status === 200 && (await look(untouched.id)).status === 200);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
