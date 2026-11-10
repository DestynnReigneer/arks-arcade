'use strict';

// The Continue row on the home page: each person's unfinished games, and
// nobody else's.

async function run({ base }) {
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
    return { status: res.status, data, text };
  }
  const mine = async who => (await api('/api/continue', 'GET', null, who ? who.h : {})).data.games;

  console.log('\n-- continue: your games in progress --');
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  const people = {};
  for (const name of ['Ana', 'Ben', 'Cy']) {
    const asked = await api('/api/profiles', 'POST', { name: `CT ${name}`, avatar: 'shiba:1' });
    await api(`/api/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    const used = await api(`/api/profiles/${asked.data.id}/use`, 'POST', {});
    people[name] = { id: asked.data.id, token: used.data.token, h: { 'X-Profile-Token': used.data.token } };
  }
  const { Ana, Ben, Cy } = people;

  const nobody = await api('/api/continue');
  ok('without a profile there is nothing to continue', nobody.status === 200 && Array.isArray(nobody.data.games) && nobody.data.games.length === 0);
  ok('a made-up token gets nothing either', (await api('/api/continue', 'GET', null, { 'X-Profile-Token': 'x.y' })).data.games.length === 0);
  ok('someone with no games gets an empty list', (await mine(Ana)).length === 0);

  // A Words with Family game between Ana and Ben. Ana hosts, so she's first.
  const game = await api('/api/crisscross/games', 'POST', { kind: 'online', invite: [Ben.id] }, Ana.h);
  const gid = game.data.id;
  const ana = await mine(Ana), ben = await mine(Ben);
  ok('a Words with Family game shows for the one whose move it is', ana.length === 1 && ana[0].game === 'crisscross' && ana[0].yourTurn && ana[0].detail === 'Your move',
    JSON.stringify(ana));
  ok('…named after who it\'s with', ana[0].title === 'Words with Family with CT Ben' && ben[0].title === 'Words with Family with CT Ana');
  ok('…and it opens that game', ana[0].href === `crisscross.html?game=${gid}`);
  ok('the other player sees it too, waiting on the first', ben.length === 1 && !ben[0].yourTurn && ben[0].detail === 'CT Ana\'s move', JSON.stringify(ben));
  ok('someone who isn\'t in the game doesn\'t see it', (await mine(Cy)).length === 0);

  // Today's Sudoku, started by Ben.
  const sudoku = await api('/api/sudoku/start', 'POST', { level: 'easy', profileToken: Ben.token });
  const benNow = await mine(Ben);
  const row = benNow.find(g => g.game === 'sudoku');
  ok('a Sudoku that was started shows up', sudoku.status === 200 && !!row && row.title === 'Sudoku, today\'s Easy Challenge' && row.href === 'sudoku.html?level=easy',
    JSON.stringify(benNow));
  ok('…with the time played so far', !!row && /^\d+:\d\d played so far$/.test(row.detail));
  ok('…only for the one who started it', !(await mine(Ana)).some(g => g.game === 'sudoku') && (await mine(Cy)).length === 0);
  // A guest's Sudoku belongs to no profile, so it's in nobody's list.
  await api('/api/sudoku/start', 'POST', { level: 'hard' });
  ok('a guest\'s puzzle is in nobody\'s list', !(await mine(Ben)).some(g => g.href === 'sudoku.html?level=hard'));

  // Today's crossword, started by Cy. A free board has no owner.
  const cross = await api('/api/clueless/start', 'POST', { level: 'mini', profileToken: Cy.token });
  await api('/api/clueless/start', 'POST', { level: 'mini', free: true });
  const cy = await mine(Cy);
  ok('a daily crossword that was started shows up', cross.status === 200 && cy.length === 1 && cy[0].game === 'clueless' && cy[0].href === 'clueless.html?level=mini',
    JSON.stringify(cy));

  ok('games waiting on you come first', (await mine(Ana))[0].yourTurn === true);
  const swap = await api(`/api/crisscross/games/${gid}`, 'GET', null, Ana.h);
  await api(`/api/crisscross/games/${gid}/swap`, 'POST', { tiles: swap.data.rack.slice(0, 1) }, Ana.h);
  const benTurn = await mine(Ben);
  ok('after a move it\'s the other player\'s turn in both lists', benTurn[0].game === 'crisscross' && benTurn[0].yourTurn && (await mine(Ana))[0].detail === 'CT Ben\'s move',
    JSON.stringify(benTurn));

  // A finished game leaves the row.
  await api(`/api/crisscross/games/${gid}/resign`, 'POST', {}, Ben.h);
  ok('a finished game leaves the row', !(await mine(Ana)).some(g => g.game === 'crisscross') && !(await mine(Ben)).some(g => g.game === 'crisscross'));

  return { pass, fail };
}

module.exports = { run };
