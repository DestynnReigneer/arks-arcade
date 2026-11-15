'use strict';

// A restart in the middle of things. The arcade is stopped the hard way (the
// way a power cut or a new image stops it) and started again on the same
// database, and the games it keeps have to come back exactly as they were:
// Spin & Solve games, and Shuffle Scuffle and Rambler rooms with a round going.

const path = require('node:path');

async function run({ base, root, restart }) {
  const scuffleGame = require(path.join(root, 'scuffle/game.js'));
  const solver = require(path.join(root, 'rambler/solver.js'));
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
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
  // The first thing a room's live updates send is the room as it stands.
  async function firstState(url) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(base + url, { signal: ac.signal });
      if (res.status !== 200) return { status: res.status };
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { status: 200 };
        buf += dec.decode(value, { stream: true });
        const m = buf.match(/event: state\ndata: (.*)\n\n/);
        if (m) return { status: 200, state: JSON.parse(m[1]) };
      }
    } catch { return { status: 0 }; } finally { clearTimeout(timer); ac.abort(); }
  }
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  const PIN = { 'X-Adult-Pin': '246810' };
  const seat = s => ({ playerId: s.playerId, token: s.token });
  const spin = (p, body, headers) => api(`/api/spinsolve/run${p}`, 'POST', body || {}, headers);
  const look = (id, headers) => api(`/api/spinsolve/run/${id}`, 'GET', null, headers);
  const answerOf = async id => (await api(`/api/spinsolve/test/answer/${id}`)).data.answer;

  console.log('\n-- restart: setting the games up --');
  // Spin & Solve. A profile, so the game is theirs and shows in their Continue row.
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
  ok('Spin & Solve: a strike in one game, the second player\'s turn in the other',
    before.state.strikes === 1 && beforeGuests.state.cur === 1 && adult.adult === true, JSON.stringify([before.state.strikes, beforeGuests.state.cur]));
  ok('nothing is in the Continue row for someone with no profile', (await api('/api/continue')).data.games.length === 0);

  // Shuffle Scuffle: a room in the middle of a round with a word found, a lobby nobody started, and an adult lobby.
  const scRoom = p => `/api/scuffle/rooms/${p}`;
  const sc = (await api('/api/scuffle/rooms', 'POST', { name: 'Sam', settings: { rounds: 3, seconds: 60, dictionary: 'kids' } })).data;
  const scAlex = (await api(scRoom(`${sc.code}/join`), 'POST', { name: 'Alex' })).data;
  await api(scRoom(`${sc.code}/start`), 'POST', seat(sc));
  const scSee = who => api(scRoom(`${sc.code}?playerId=${who.playerId}&token=${who.token}`));
  const scWords = scuffleGame.findWords((await scSee(sc)).data.round.letters, 'kids');
  const scFound = (await api(scRoom(`${sc.code}/word`), 'POST', { ...seat(scAlex), word: scWords[0] })).data;
  const scLobby = (await api('/api/scuffle/rooms', 'POST', { name: 'Robin', settings: { dictionary: 'kids' } })).data;
  const scAdult = (await api('/api/scuffle/rooms', 'POST', { name: 'Kim', settings: { dictionary: 'adult' }, password: 'limes' }, PIN)).data;
  const scBefore = (await scSee(scAlex)).data;
  ok('Shuffle Scuffle: a round is going, with a word found', scBefore.phase === 'playing' && scFound.ok === true && scBefore.mine.found.length === 1, JSON.stringify(scFound));

  // Rambler: a room in the middle of a round with words sent in, and a lobby nobody started.
  const rbRoom = p => `/api/rambler/rooms/${p}`;
  const rb = (await api('/api/rambler/rooms', 'POST', { name: 'Ada', size: 4, durationSec: 60 })).data;
  const rbBo = (await api(rbRoom(`${rb.code}/join`), 'POST', { name: 'Bo' })).data;
  const rbStarted = (await api(rbRoom(`${rb.code}/start`), 'POST', seat(rb))).data;
  const rbWords = solver.solveWords(rbStarted.board, { cols: 4, rows: 4 }, 'kids').filter(w => w.length >= 4).slice(0, 3);
  await api(rbRoom(`${rb.code}/words`), 'POST', { ...seat(rbBo), words: rbWords });
  const rbLobby = (await api('/api/rambler/rooms', 'POST', { name: 'Cy', size: 5, durationSec: 120 })).data;
  const rbEvents = who => firstState(rbRoom(`${rb.code}/events?playerId=${who.playerId}&token=${who.token}`));
  const rbBefore = (await rbEvents(rbBo)).state;
  ok('Rambler: a round is going, with words sent in', rbStarted.state === 'playing' && rbWords.length === 3 &&
    !!rbBefore && rbBefore.players.find(p => p.name === 'Bo').wordCount === 3, JSON.stringify(rbBefore && rbBefore.players));

  // A room is written down within a moment of changing. Then the plug is pulled,
  // and the arcade stays away for a few seconds, long enough to tell a clock that
  // stood still from one that kept running.
  await wait(900);
  const DOWN_MS = 4000;
  await restart({ downMs: DOWN_MS });
  const scAfter = await scSee(scAlex);
  const rbAfter = (await rbEvents(rbBo)).state;

  console.log('\n-- restart: Spin & Solve --');
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

  console.log('\n-- restart: Shuffle Scuffle --');
  const tally = snap => snap.players.map(p => `${p.name}:${p.score}:${p.count}`).join();
  ok('a room comes back in the middle of its round, on the same letters',
    scAfter.status === 200 && scAfter.data.phase === 'playing' && scAfter.data.index === scBefore.index && scAfter.data.round.letters === scBefore.round.letters,
    JSON.stringify(scAfter.data).slice(0, 200));
  ok('…with every seat, score and word found', tally(scAfter.data) === tally(scBefore) && scAfter.data.mine.found.length === 1 &&
    scAfter.data.mine.found[0].word === scBefore.mine.found[0].word, tally(scAfter.data));
  // The clock stood still while the arcade was away: what was left then is what's left now, give or take
  // the moments either side of the stop. A clock that had kept running would have lost the whole time away.
  const stoodStill = (was, is) => is > 0 && is <= was + 200 && is >= was - (DOWN_MS - 1000);
  const leftBefore = scBefore.endsAt - scBefore.serverNow, leftAfter = scAfter.data.endsAt - scAfter.data.serverNow;
  ok('…and the time that was left on the clock', stoodStill(leftBefore, leftAfter), `${leftBefore} ms before, ${leftAfter} ms after`);
  ok('the host is still the host, and a stranger still isn\'t let in',
    (await scSee(sc)).data.host === true && (await api(scRoom(`${sc.code}?playerId=${scAlex.playerId}&token=nope`))).status === 403);
  ok('a word found before the restart can\'t be found again', (await api(scRoom(`${sc.code}/word`), 'POST', { ...seat(scAlex), word: scWords[0] })).data.reason === 'again');
  const scMore = (await api(scRoom(`${sc.code}/word`), 'POST', { ...seat(sc), word: scWords[1] })).data;
  ok('…and the round plays on: a new word scores', scMore.ok === true && scMore.points > 0, JSON.stringify(scMore));
  ok('live updates start again for a seat from before the restart',
    (await firstState(scRoom(`${sc.code}/events?playerId=${scAlex.playerId}&token=${scAlex.token}`))).status === 200);
  const scListed = (await api('/api/scuffle/lobbies')).data.lobbies;
  ok('both rooms are still in List Hosted Games', scListed.some(l => l.code === sc.code && l.status === 'playing' && l.count === 2) &&
    scListed.some(l => l.code === scLobby.code && l.status === 'open' && l.host === 'Robin'), JSON.stringify(scListed).slice(0, 300));
  ok('a lobby nobody had started can still be joined and started',
    (await api(scRoom(`${scLobby.code}/join`), 'POST', { name: 'Late' })).status === 200 && (await api(scRoom(`${scLobby.code}/start`), 'POST', seat(scLobby))).status === 200);
  ok('an adult lobby still asks for its password, and still takes the right one',
    (await api(scRoom(`${scAdult.code}/join`), 'POST', { name: 'X' })).status === 401 &&
    (await api(scRoom(`${scAdult.code}/join`), 'POST', { name: 'X', password: 'limes' })).status === 200);
  // The host ends the round: the words and the scores are all there.
  await api(scRoom(`${sc.code}/next`), 'POST', seat(sc));
  const scReveal = (await scSee(sc)).data;
  ok('the round ends with everyone\'s words, found before the restart and after it', scReveal.phase === 'reveal' &&
    scReveal.reveal.players.find(p => p.name === 'Alex').words.includes(scWords[0]) && scReveal.reveal.players.find(p => p.name === 'Sam').words.includes(scWords[1]));

  console.log('\n-- restart: Rambler --');
  ok('a room comes back in the middle of its round, on the same board',
    !!rbAfter && rbAfter.state === 'playing' && JSON.stringify(rbAfter.board) === JSON.stringify(rbStarted.board) && rbAfter.boardId === rbStarted.boardId,
    JSON.stringify(rbAfter).slice(0, 200));
  ok('…with every seat and the words sent in', !!rbAfter && rbAfter.players.map(p => `${p.name}:${p.wordCount}`).join() === 'Ada:0,Bo:3' &&
    rbAfter.hostId === rb.playerId && rbAfter.you.name === 'Bo', JSON.stringify(rbAfter && rbAfter.players));
  const rbLeftBefore = rbBefore.endsAt - rbBefore.serverNow, rbLeftAfter = rbAfter ? rbAfter.endsAt - rbAfter.serverNow : -1;
  ok('…and the time that was left on the clock', stoodStill(rbLeftBefore, rbLeftAfter), `${rbLeftBefore} ms before, ${rbLeftAfter} ms after`);
  ok('words can still be checked against the board it had',
    (await api('/api/rambler/check', 'POST', { boardId: rbStarted.boardId, word: rbWords[0] })).data.valid === true);
  ok('…and sent in', (await api(rbRoom(`${rb.code}/words`), 'POST', { ...seat(rbBo), words: rbWords })).data.accepted === 3);
  await api(rbRoom(`${rb.code}/ready`), 'POST', seat(rb));
  const rbDone = (await api(rbRoom(`${rb.code}/ready`), 'POST', seat(rbBo))).data;
  ok('the round ends and is scored, with the words from before the restart',
    rbDone.state === 'results' && rbDone.results.results.find(r => r.name === 'Bo').words.filter(w => w.valid).length === 3, JSON.stringify(rbDone.results && rbDone.results.results).slice(0, 300));
  const rbListed = (await api('/api/rambler/lobbies')).data.lobbies;
  ok('both rooms are still in List Hosted Games', rbListed.some(l => l.code === rb.code && l.count === 2) &&
    rbListed.some(l => l.code === rbLobby.code && l.status === 'open' && l.host === 'Cy' && l.size === 5), JSON.stringify(rbListed).slice(0, 300));
  ok('a lobby nobody had started can still be joined', (await api(rbRoom(`${rbLobby.code}/join`), 'POST', { name: 'Late' })).status === 201);

  console.log('\n-- restart: played on, and stopped again --');
  // Spin & Solve: played on to the end.
  const solved = await spin(`/${mine.id}/solve`, { guess: answer }, kim);
  ok('Spin & Solve can be played on: the right answer solves the round', solved.status === 200 && solved.data.correct === true && solved.data.state.players[0].total >= 1000,
    JSON.stringify(solved.data).slice(0, 200));
  for (let round = 2; round <= 3; round++) {
    await spin(`/${mine.id}/next`, {}, kim);
    await spin(`/${mine.id}/solve`, { guess: await answerOf(mine.id) }, kim);
  }
  const over = (await spin(`/${mine.id}/next`, {}, kim)).data.state;
  ok('three rounds on, the game is over with its total', over.phase === 'over' && over.canSave === true && over.players[0].total >= 3000, JSON.stringify(over).slice(0, 200));
  const total = over.players[0].total;
  // The Rambler room is on its results, and the host of the other Scuffle room has left (the room passes on).
  await api(scRoom(`${scLobby.code}/leave`), 'POST', seat(scLobby));

  await wait(900);
  await restart();

  const stillOver = await look(mine.id, kim);
  ok('a finished Spin & Solve game waiting for its score comes back as well', stillOver.status === 200 && stillOver.data.state.phase === 'over' && stillOver.data.state.players[0].total === total);
  ok('…and it has left the Continue row', !(await api('/api/continue', 'GET', null, kim)).data.games.some(g => g.game === 'spinsolve'));
  const savedScore = await spin(`/${mine.id}/save`, {}, kim);
  ok('its score saves to the board', savedScore.status === 201, JSON.stringify(savedScore.data));
  ok('…and then the game is gone', (await look(mine.id, kim)).status === 404);
  ok('the guests\' game is still there after the second restart', (await look(guests.id)).status === 200);
  const scAgain = (await scSee(sc)).data;
  ok('the Shuffle Scuffle room is on its reveal, as it was left', scAgain.phase === 'reveal' && scAgain.reveal.players.length === 2 && tally(scAgain) === tally(scReveal));
  const rbAgain = (await rbEvents(rb)).state;
  ok('the Rambler room is on its results, as it was left', !!rbAgain && rbAgain.state === 'results' && rbAgain.results.results.length === 2 &&
    JSON.stringify(rbAgain.results.results.map(r => [r.name, r.score])) === JSON.stringify(rbDone.results.results.map(r => [r.name, r.score])));
  ok('the host can start the next Rambler round', (await api(rbRoom(`${rb.code}/next`), 'POST', seat(rb))).data.state === 'lobby');
  // Both rooms close when everyone leaves, and a closed room doesn't come back.
  for (const who of [scAlex, sc]) await api(scRoom(`${sc.code}/leave`), 'POST', seat(who));
  for (const who of [rbBo, rb]) await api(rbRoom(`${rb.code}/leave`), 'POST', seat(who));

  await restart();

  ok('a saved Spin & Solve game stays gone after another restart', (await look(mine.id, kim)).status === 404);
  ok('…and the others are still there', (await look(guests.id)).status === 200 && (await look(untouched.id)).status === 200);
  ok('rooms that closed stay closed', (await scSee(sc)).status === 404 && (await api(rbRoom(`${rb.code}/join`), 'POST', { name: 'X' })).status === 404);
  ok('a room whose host left before the restart came back with its new host',
    (await api('/api/scuffle/lobbies')).data.lobbies.some(l => l.code === scLobby.code && l.host === 'Late'));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
