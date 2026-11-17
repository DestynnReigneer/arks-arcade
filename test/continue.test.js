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
  const game = await api('/api/crisscross/games', 'POST', { kind: 'online', seats: 2 }, Ana.h);
  const gid = game.data.id;
  const waitingRow = await mine(Ana);
  ok('the host\'s own lobby is in their Continue row while it waits for players', waitingRow.length === 1 && waitingRow[0].detail === 'Waiting for players' && !waitingRow[0].yourTurn,
    JSON.stringify(waitingRow));
  ok('…and it isn\'t in anyone else\'s', (await mine(Ben)).length === 0);
  await api(`/api/crisscross/lobby/${game.data.game.joinCode}/join`, 'POST', {}, Ben.h);
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

  // ---- leaving from the row (press and hold it) ----------------------------------------
  console.log('\n-- continue: leaving a game from the row --');
  const leave = (who, game, ref) => api('/api/continue/leave', 'POST', { game, ref }, who ? who.h : {});
  const ww = h => api('/api/crisscross/games', 'POST', { kind: 'online', seats: 2 }, h);
  ok('leaving needs a profile', (await leave(null, 'sudoku', 'easy')).status === 401);
  ok('…and a game it knows', (await leave(Ana, 'wordless', 'x')).status === 400 && (await leave(Ana, '__proto__', 'x')).status === 400);

  // Ana's own lobby that nobody joined closes.
  const lobby = (await ww(Ana.h)).data;
  const lobbyRow = (await mine(Ana)).find(g => g.ref === lobby.id);
  ok('a host\'s waiting lobby says leaving closes it', lobbyRow && lobbyRow.leave === 'close', JSON.stringify(lobbyRow));
  ok('…and says when it was opened, so two lobbies can be told apart', lobbyRow && Number.isFinite(lobbyRow.openedAt) && Math.abs(Date.now() - lobbyRow.openedAt) < 60000, JSON.stringify(lobbyRow));
  const closed = await leave(Ana, 'crisscross', lobby.id);
  ok('…and leaving closes it', closed.status === 200 && !closed.data.games.some(g => g.ref === lobby.id) &&
    (await api(`/api/crisscross/games/${lobby.id}`, 'GET', null, Ana.h)).status === 404);

  // Someone else's lobby: Ben joins Cy's three-seat lobby, then leaves it.
  const three = (await api('/api/crisscross/games', 'POST', { kind: 'online', seats: 3 }, Cy.h)).data;
  await api(`/api/crisscross/lobby/${three.game.joinCode}/join`, 'POST', {}, Ben.h);
  const benLobby = (await mine(Ben)).find(g => g.ref === three.id);
  ok('a lobby someone joined says leaving just leaves it', benLobby && benLobby.leave === 'lobby', JSON.stringify(benLobby));
  await leave(Ben, 'crisscross', three.id);
  ok('…and it stays open for its host', !(await mine(Ben)).some(g => g.ref === three.id) && (await mine(Cy)).some(g => g.ref === three.id));
  ok('nobody can leave a game they aren\'t in', (await leave(Ana, 'crisscross', three.id)).status === 403 && (await mine(Cy)).some(g => g.ref === three.id));
  await leave(Cy, 'crisscross', three.id);

  // A game of two ends, and the other player wins.
  const two = (await ww(Ana.h)).data;
  await api(`/api/crisscross/lobby/${two.game.joinCode}/join`, 'POST', {}, Ben.h);
  const twoRow = (await mine(Ben)).find(g => g.ref === two.id);
  ok('a game of two says leaving ends it, and who it is with', twoRow.leave === 'ends' && twoRow.others.join() === 'CT Ana', JSON.stringify(twoRow));
  await leave(Ben, 'crisscross', two.id);
  const ended = (await api(`/api/crisscross/games/${two.id}`, 'GET', null, Ana.h)).data;
  ok('…and leaving ends it, with the other player winning', ended.over && !(await mine(Ana)).some(g => g.ref === two.id), JSON.stringify(ended.over));
  ok('leaving a game that\'s already over is fine', (await leave(Ana, 'crisscross', two.id)).status === 200);

  // A game of three goes on without whoever leaves.
  const trio = (await api('/api/crisscross/games', 'POST', { kind: 'online', seats: 3 }, Ana.h)).data;
  await api(`/api/crisscross/lobby/${trio.game.joinCode}/join`, 'POST', {}, Ben.h);
  await api(`/api/crisscross/lobby/${trio.game.joinCode}/join`, 'POST', {}, Cy.h);
  ok('a game of three says the others keep playing', (await mine(Cy)).find(g => g.ref === trio.id).leave === 'continues');
  await leave(Cy, 'crisscross', trio.id);
  ok('…and they do', (await mine(Ana)).some(g => g.ref === trio.id) && (await mine(Ben)).some(g => g.ref === trio.id));
  await leave(Ana, 'crisscross', trio.id);

  // Giving up today's Sudoku starts it over.
  const before = (await mine(Ben)).find(g => g.game === 'sudoku');
  ok('a daily puzzle says leaving gives it up', before && before.leave === 'give-up' && before.ref === 'easy');
  ok('…nobody else can give it up for them', (await leave(Ana, 'sudoku', 'easy')).status === 200 && (await mine(Ben)).some(g => g.game === 'sudoku'));
  await leave(Ben, 'sudoku', 'easy');
  ok('…giving it up takes it off the row', !(await mine(Ben)).some(g => g.game === 'sudoku'));
  const again = await api('/api/sudoku/start', 'POST', { level: 'easy', profileToken: Ben.token });
  ok('…and starting again is a new run', again.status === 200 && again.data.runId !== sudoku.data.runId, JSON.stringify(again.data).slice(0, 120));
  await leave(Cy, 'clueless', 'mini');
  ok('giving up today\'s crossword works the same', !(await mine(Cy)).some(g => g.game === 'clueless'));

  // The give-up rule for daily puzzles: before a minute, the next try starts the
  // clock over (once); after a minute, it picks the clock up where it stopped; after
  // a second give-up, every try is just for fun. The suite's "minute" is 1.5 seconds.
  {
    const path = require('node:path');
    const gen = require(path.join(__dirname, '..', 'sudoku', 'generator.js'));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const asked = await api('/api/profiles', 'POST', { name: 'CT Dee', avatar: 'shiba:1' });
    await api(`/api/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    const used = await api(`/api/profiles/${asked.data.id}/use`, 'POST', {});
    const Dee = { token: used.data.token, h: { 'X-Profile-Token': used.data.token } };
    const startHard = async () => (await api('/api/sudoku/start', 'POST', { level: 'hard', profileToken: Dee.token })).data;
    const row = async () => (await mine(Dee)).find(g => g.game === 'sudoku' && g.ref === 'hard');

    const first = await startHard();
    ok('give-up rule: a quick first give-up offers a fresh clock', (await row()).giveUp === 'fresh', JSON.stringify(await row()));
    await leave(Dee, 'sudoku', 'hard');
    ok('…the old try can\'t be opened again', (await api(`/api/sudoku/run/${first.runId}`)).status === 404);
    await wait(300);
    const second = await startHard();
    ok('…the second try starts at 0:00', second.runId !== first.runId && second.playMs < 1000 && !second.unscored, JSON.stringify(second).slice(0, 160));
    ok('…and giving that up is the last scored try', (await row()).giveUp === 'last');
    await leave(Dee, 'sudoku', 'hard');
    const third = await startHard();
    ok('…the third try is just for fun', third.unscored === true && (await row()).giveUp === 'unscored');
    // Past the too-fast guard (20 ms a square in the suite).
    await wait(1500);
    const answer = gen.solve(third.puzzle.split('').map(Number)).join('');
    const done = await api(`/api/sudoku/run/${third.runId}/finish`, 'POST', { grid: answer });
    const saved = await api(`/api/sudoku/run/${third.runId}/save`, 'POST', { profileToken: Dee.token });
    ok('…it can still be solved, but the time won\'t go on the board', done.status === 200 && done.data.finished && saved.status === 409 && /Just for fun/.test(saved.data.error),
      `${done.status} ${saved.status} ${saved.text}`);

    // Playing as a guest doesn't get around it: a guest's time can't be saved as a profile.
    const asGuest = (await api('/api/sudoku/start', 'POST', { level: 'hard' })).data;
    await wait(1500);
    await api(`/api/sudoku/run/${asGuest.runId}/finish`, 'POST', { grid: gen.solve(asGuest.puzzle.split('').map(Number)).join('') });
    ok('a guest\'s solve can\'t be saved under a profile', (await api(`/api/sudoku/run/${asGuest.runId}/save`, 'POST', { profileToken: Dee.token })).status === 403);
    const deeFamily = (await api('/api/sudoku/start', 'POST', { level: 'family', profileToken: Dee.token })).data;
    await wait(1500);
    await api(`/api/sudoku/run/${deeFamily.runId}/finish`, 'POST', { grid: gen.solve(deeFamily.puzzle.split('').map(Number)).join('') });
    ok('…nor under someone else\'s profile', (await api(`/api/sudoku/run/${deeFamily.runId}/save`, 'POST', { profileToken: Ana.token })).status === 403);
    ok('…but it can go on under initials, like any guest', (await api(`/api/sudoku/run/${asGuest.runId}/save`, 'POST', { initials: 'GST' })).status === 201);

    // A first try given up after "a minute" carries its clock into the next try.
    const long = (await api('/api/sudoku/start', 'POST', { level: 'medium', profileToken: Dee.token })).data;
    await wait(1700);
    ok('a first give-up after a minute says the clock carries on', (await mine(Dee)).find(g => g.ref === 'medium').giveUp === 'carry');
    await leave(Dee, 'sudoku', 'medium');
    const carried = (await api('/api/sudoku/start', 'POST', { level: 'medium', profileToken: Dee.token })).data;
    ok('…the next try picks the clock up where it stopped', carried.runId !== long.runId && carried.playMs >= 1600 && carried.playMs < 3500 && !carried.unscored,
      String(carried.playMs));

    // Clueless follows the same rule.
    const c1 = (await api('/api/clueless/start', 'POST', { level: 'mini', profileToken: Dee.token })).data;
    await leave(Dee, 'clueless', 'mini');
    const c2 = (await api('/api/clueless/start', 'POST', { level: 'mini', profileToken: Dee.token })).data;
    await leave(Dee, 'clueless', 'mini');
    const c3 = (await api('/api/clueless/start', 'POST', { level: 'mini', profileToken: Dee.token })).data;
    ok('Clueless: two give-ups make the next crossword just for fun', c1.runId !== c2.runId && !c2.unscored && c3.unscored === true);
  }

  // Chess: resigning counts as a loss.
  const room = (await api('/api/chess/rooms', 'POST', {}, Ana.h)).data;
  const guest = (await api(`/api/chess/rooms/${room.code}/join`, 'POST', {}, Cy.h)).data;
  const seat = t => ({ playerId: t.playerId, token: t.token });
  await api(`/api/chess/rooms/${room.code}/ready`, 'POST', { ...seat(guest), ready: true });
  await api(`/api/chess/rooms/${room.code}/start`, 'POST', seat(room));
  const chessRow = (await mine(Cy)).find(g => g.game === 'chess');
  ok('a Chess game says leaving resigns', chessRow && chessRow.leave === 'resign' && chessRow.ref === room.code, JSON.stringify(chessRow));
  await leave(Cy, 'chess', room.code);
  const after = (await api(`/api/chess/rooms/${room.code}?playerId=${room.playerId}&token=${room.token}`)).data;
  ok('…and resigning ends it', after.ended && after.ended.reason === 'resignation' && !(await mine(Ana)).some(g => g.game === 'chess'),
    JSON.stringify(after.ended));

  // Spin & Solve: ending it throws the game away.
  const spinStart = (await api('/api/spinsolve/run/start', 'POST', { level: 'kids', names: ['Ana'], rounds: 3 }, Ana.h)).data;
  await api(`/api/spinsolve/run/${spinStart.id}/solve`, 'POST', { guess: 'NOT THE ANSWER' }, Ana.h);
  ok('a Spin & Solve game says leaving ends it', (await mine(Ana)).find(g => g.game === 'spinsolve').leave === 'end');
  ok('…nobody else can end it', (await leave(Ben, 'spinsolve', spinStart.id)).status === 200 && (await mine(Ana)).some(g => g.game === 'spinsolve'));
  await leave(Ana, 'spinsolve', spinStart.id);
  ok('…and ending it throws it away', !(await mine(Ana)).some(g => g.game === 'spinsolve') &&
    (await api(`/api/spinsolve/run/${spinStart.id}`, 'GET', null, Ana.h)).status === 404);

  return { pass, fail };
}

module.exports = { run };
