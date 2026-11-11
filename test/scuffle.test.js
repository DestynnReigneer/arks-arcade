'use strict';

// Shuffle Scuffle: the letters (no server needed), then the API against the
// real server: words checked there, scores kept there, the daily board, adult
// rules, and a room with two players.

const fs = require('node:fs');
const path = require('node:path');

async function run({ base, root }) {
  const game = require(path.join(root, 'scuffle/game.js'));
  const dictionary = require(path.join(root, 'rambler/dictionary.js'));
  const { today } = require(path.join(root, 'rambler/progress.js'));
  const API = base + '/api/scuffle';
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function api(p, method = 'GET', body, headers = {}) {
    const res = await fetch((p.startsWith('/api/') ? base : API) + p, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  const sorted = s => s.split('').sort().join('');

  console.log('\n-- scuffle: the letters --');
  const days = ['2026-11-01', '2026-11-02', '2027-03-15', '2028-02-29'];
  let shapes = true, words = true, fulls = true, kidsSafe = true;
  for (const day of days) {
    for (const r of game.dailyRounds(day)) {
      if (!/^[A-Z]{6,7}$/.test(r.letters) || sorted(r.letters) !== sorted(r.word) || r.letters === r.word) shapes = false;
      if (!r.words.length || r.words.some(w => w.length < 3 || !game.fitsLetters(w, r.letters) || !dictionary.isWord(w, 'kids'))) words = false;
      if (!r.full.includes(r.word) || r.full.some(w => w.length !== r.letters.length)) fulls = false;
      if (!dictionary.isWord(r.word, 'kids') || !dictionary.isCommon(r.word)) kidsSafe = false;
    }
  }
  ok('every round is a 6 or 7 letter word, mixed up', shapes);
  ok('every word in a round can be made from its letters and is on the list', words);
  ok('the full word (and any other word using every letter) is listed as a full word', fulls);
  ok('the daily\'s full words are everyday words on the kids list', kidsSafe);
  const lens = game.dailyRounds('2026-11-01').map(r => r.letters.length).join();
  ok('the daily starts with six letters and moves to seven', lens === '6,6,7,7', lens);
  ok('the same date always gives the same letters',
    game.dailyRounds('2026-12-25').map(r => r.letters).join() === game.dailyRounds('2026-12-25').map(r => r.letters).join());
  ok('different dates give different letters',
    game.dailyRounds('2026-12-25').map(r => r.letters).join() !== game.dailyRounds('2026-12-26').map(r => r.letters).join());
  ok('the family and the unfiltered daily each have their own letters',
    game.dailyRounds('2026-12-25', 'adult').map(r => r.letters).join() !== game.dailyRounds('2026-12-25', 'kids').map(r => r.letters).join());
  ok('…and each is the same all day',
    game.dailyRounds('2026-12-25', 'adult').map(r => r.letters).join() === game.dailyRounds('2026-12-25', 'adult').map(r => r.letters).join());
  const free = game.makeRounds({ count: 5, profile: 'kids' });
  ok('free play makes the rounds asked for', free.length === 5 && free.every(r => /^[A-Z]{6,7}$/.test(r.letters)));

  // The kids list never lets a blocked word through, even when the letters spell it.
  const blocked = fs.readFileSync(path.join(root, 'words/blocklist-kids.txt'), 'utf8').split('\n')
    .map(s => s.trim().toUpperCase()).filter(w => /^[A-Z]{3,6}$/.test(w) && dictionary.isWord(w, 'adult') && !dictionary.isWord(w, 'kids'));
  let kidsBlocked = 0, adultHas = 0, verdictBlocked = true;
  for (const w of blocked) {
    const letters = w + 'E';
    if (game.findWords(letters, 'kids').includes(w)) kidsBlocked++;
    if (game.findWords(letters, 'adult').includes(w)) adultHas++;
    const kidsRound = { letters, words: game.findWords(letters, 'kids') };
    if (game.checkWord(kidsRound, w, new Set()).ok) verdictBlocked = false;
  }
  ok(`the kids list finds none of the ${blocked.length} blocked words, even when the letters spell them`, blocked.length > 10 && kidsBlocked === 0);
  ok('…while the unfiltered list does find them', adultHas === blocked.length);
  ok('…and checking a blocked word on a kids round says no', verdictBlocked);
  const r0 = { letters: 'TAERCS', words: game.findWords('TAERCS', 'kids') };
  ok('a word needs letters that are there', game.checkWord(r0, 'CAST', new Set()).ok && game.checkWord(r0, 'CASTS', new Set()).reason === 'letters');
  ok('…at least 3 of them', game.checkWord(r0, 'AT', new Set()).reason === 'short');
  ok('…and to be a real word', game.checkWord(r0, 'TRACSE', new Set()).reason === 'unknown');
  ok('…found only once', game.checkWord(r0, 'CAST', new Set(['CAST'])).reason === 'again');
  ok('points go up with length, with 100 extra for the full word',
    game.pointsFor('CAT', 6) === 10 && game.pointsFor('CRATES', 6) === 160 && game.pointsFor('CRATES', 6, { first: true }) === 210);

  console.log('\n-- scuffle: on your own --');
  const cfg = await api('/config');
  ok('config lists the choices and the daily\'s fixed shape', cfg.status === 200 && cfg.data.daily.rounds === 4 && cfg.data.seconds.includes(75));
  const g = (await api('/solo', 'POST', { mode: 'free', dictionary: 'kids', rounds: 3, seconds: 2, score: 99999 })).data;
  ok('starting a game hands out a long random id, and no letters yet', /^[0-9a-f]{32}$/.test(g.gameId) && g.phase === 'ready' && !g.round);
  ok('…with the rounds and (test-only) seconds asked for', g.totalRounds === 3 && g.seconds === 2);
  ok('words are refused before a round starts', (await api(`/solo/${g.gameId}/word`, 'POST', { word: 'CAT' })).status === 409);
  const r1 = (await api(`/solo/${g.gameId}/next`, 'POST', {})).data;
  ok('the first round starts on the server with letters and a clock', r1.phase === 'playing' && /^[A-Z]{6}$/.test(r1.round.letters) && r1.round.endsAt > Date.now() - 5000);
  const all = game.findWords(r1.round.letters, 'kids');
  ok('…and doesn\'t give away its words', !('reveal' in r1 && r1.reveal) && !JSON.stringify(r1).includes(all.find(w => w.length === 6)));
  ok('…but says how many there are', r1.round.wordCount === all.length, `${r1.round.wordCount} vs ${all.length}`);
  const short = all.filter(w => w.length === 3)[0] || all[all.length - 1];
  const w1 = await api(`/solo/${g.gameId}/word`, 'POST', { word: short.toLowerCase(), points: 5000, score: 99999 });
  ok('a real word scores what the server says', w1.status === 200 && w1.data.ok && w1.data.points === game.POINTS[short.length] && w1.data.state.round.score === game.POINTS[short.length], JSON.stringify(w1.data).slice(0, 200));
  ok('…whatever points the browser sent', w1.data.state.total === 0 && w1.data.state.round.score < 1000);
  ok('the same word twice doesn\'t count', (await api(`/solo/${g.gameId}/word`, 'POST', { word: short })).data.reason === 'again');
  ok('a word using letters that aren\'t there is refused', (await api(`/solo/${g.gameId}/word`, 'POST', { word: 'ZZZQ' })).data.reason === 'letters');
  const full = all.find(w => w.length === 6);
  const wf = await api(`/solo/${g.gameId}/word`, 'POST', { word: full });
  ok('the full word scores its letters plus 100', wf.data.ok && wf.data.full && wf.data.points === game.POINTS[6] + 100);
  await wait(2000 + 1700);
  const late = await api(`/solo/${g.gameId}/word`, 'POST', { word: all.find(w => w !== short && w !== full) || 'CAT' });
  ok('once the clock runs out, words are refused', late.status === 409, JSON.stringify(late.data));
  const after = (await api(`/solo/${g.gameId}`)).data;
  ok('after the round, the full word and every word are shown', after.phase === 'reveal' && after.reveal.full.includes(full) && after.reveal.words.length === all.length);
  ok('…and the total is the server\'s sum', after.total === game.POINTS[short.length] + game.POINTS[6] + 100);
  await api(`/solo/${g.gameId}/next`, 'POST', {});
  await api(`/solo/${g.gameId}/stop`, 'POST', {});
  await api(`/solo/${g.gameId}/next`, 'POST', {});
  const ended = (await api(`/solo/${g.gameId}/stop`, 'POST', {})).data;
  ok('after the last round the game is over', ended.phase === 'over' && ended.past.length === 3);
  ok('there\'s no round after the last', (await api(`/solo/${g.gameId}/next`, 'POST', {})).status === 409);
  ok('free play can\'t go on the daily board', (await api(`/solo/${g.gameId}/save`, 'POST', { initials: 'FRE' })).status === 400);
  ok('a made-up game id is a 404', (await api('/solo/0123456789abcdef0123456789abcdef')).status === 404);

  console.log('\n-- scuffle: the daily --');
  const d = (await api('/solo', 'POST', { mode: 'daily', dictionary: 'kids', rounds: 7, seconds: 2 })).data;
  ok('the daily ignores the rounds and time asked for', d.mode === 'daily' && d.totalRounds === 4 && d.seconds === 75);
  const dr = (await api(`/solo/${d.gameId}/next`, 'POST', {})).data;
  ok('the daily\'s letters are the date\'s letters', dr.round.letters === game.dailyRounds(today())[0].letters);
  const dWords = game.findWords(dr.round.letters, 'kids');
  const dFull = dWords.find(w => w.length === dr.round.letters.length);
  await api(`/solo/${d.gameId}/word`, 'POST', { word: dFull });
  ok('a daily score can\'t be saved before the last round', (await api(`/solo/${d.gameId}/save`, 'POST', { initials: 'DAY' })).status === 409);
  await api(`/solo/${d.gameId}/stop`, 'POST', {});
  for (let i = 0; i < 3; i++) { await api(`/solo/${d.gameId}/next`, 'POST', {}); await api(`/solo/${d.gameId}/stop`, 'POST', {}); }
  ok('a daily score needs initials or a profile', (await api(`/solo/${d.gameId}/save`, 'POST', {})).status === 400);
  const saved = await api(`/solo/${d.gameId}/save`, 'POST', { initials: 'day', score: 999999 });
  ok('the daily goes on the board with the server\'s score', saved.status === 201 && saved.data.score === game.POINTS[dFull.length] + 100 && saved.data.dayRank === 1, JSON.stringify(saved.data));
  ok('…once', (await api(`/solo/${d.gameId}/save`, 'POST', { initials: 'ZZZ' })).status === 409);
  const d2 = (await api('/solo', 'POST', { mode: 'daily', dictionary: 'kids' })).data;
  for (let i = 0; i < 4; i++) { await api(`/solo/${d2.gameId}/next`, 'POST', {}); await api(`/solo/${d2.gameId}/stop`, 'POST', {}); }
  ok('only your first daily of the day counts', (await api(`/solo/${d2.gameId}/save`, 'POST', { initials: 'DAY' })).status === 409);
  ok('…but someone else can save theirs', (await api(`/solo/${d2.gameId}/save`, 'POST', { initials: 'NIL' })).status === 201);
  const board = (await api('/board?scope=day')).data;
  ok('today\'s board is highest first and tags the word list', board.length === 2 && board[0].initials === 'DAY' && board[0].score > board[1].score && board[0].dictionary === 'kids');
  ok('the all-time board has them too', (await api('/board?scope=all')).data.length === 2);
  ok('the family board is the default, and the unfiltered board is separate',
    (await api('/board?scope=day&dictionary=kids')).data.length === 2 && (await api('/board?scope=day&dictionary=adult')).data.length === 0);

  console.log('\n-- scuffle: which dailies are done --');
  const askedP = (await api('/api/profiles', 'POST', { name: 'Scuffle Sky', avatar: 'shiba:2' })).data;
  await api(`/api/profiles/admin/${askedP.id}/approve`, 'POST', {}, { 'X-Admin-Token': 'test-admin-token' });
  const sky = (await api(`/api/profiles/${askedP.id}/use`, 'POST', {})).data.token;
  const st0 = (await api('/daily-status', 'POST', { profileToken: sky })).data;
  ok('a profile starts the day with both dailies open', st0.kids === 'open' && st0.adult === 'open' && st0.day === today());
  ok('a guest is told both are open (their device keeps track)', (await api('/daily-status', 'POST', {})).data.kids === 'open');
  const sd = (await api('/solo', 'POST', { mode: 'daily', dictionary: 'kids', profileToken: sky })).data;
  await api(`/solo/${sd.gameId}/next`, 'POST', {});
  ok('a started daily is "playing", so it can be carried on', (await api('/daily-status', 'POST', { profileToken: sky })).data.kids === 'playing');
  for (let i = 0; i < 4; i++) { await api(`/solo/${sd.gameId}/stop`, 'POST', {}); await api(`/solo/${sd.gameId}/next`, 'POST', {}); }
  const st1 = (await api('/daily-status', 'POST', { profileToken: sky })).data;
  ok('a finished daily is "done", and the other list\'s daily is still open', st1.kids === 'done' && st1.adult === 'open', JSON.stringify(st1));
  const skyAgain = await api('/solo', 'POST', { mode: 'daily', dictionary: 'kids', profileToken: sky });
  ok('starting the finished one again hands back the finished game, not new letters', skyAgain.data.gameId === sd.gameId && skyAgain.data.phase === 'over');

  console.log('\n-- scuffle: adult words --');
  const PIN = { 'X-Adult-Pin': '246810' };
  ok('the unfiltered list needs the adult PIN on your own', (await api('/solo', 'POST', { mode: 'free', dictionary: 'adult' })).status === 403);
  ok('…and works with it', (await api('/solo', 'POST', { mode: 'free', dictionary: 'adult' }, PIN)).status === 201);
  ok('the unfiltered daily needs it too', (await api('/solo', 'POST', { mode: 'daily', dictionary: 'adult' })).status === 403);
  const ad = (await api('/solo', 'POST', { mode: 'daily', dictionary: 'adult', profileToken: sky }, PIN)).data;
  const adr = (await api(`/solo/${ad.gameId}/next`, 'POST', {})).data;
  ok('the unfiltered daily has its own letters', ad.mode === 'daily' && ad.dictionary === 'adult' &&
    adr.round.letters === game.dailyRounds(today(), 'adult')[0].letters && adr.round.letters !== dr.round.letters);
  for (let i = 0; i < 4; i++) { await api(`/solo/${ad.gameId}/stop`, 'POST', {}); await api(`/solo/${ad.gameId}/next`, 'POST', {}); }
  const adSaved = await api(`/solo/${ad.gameId}/save`, 'POST', { profileToken: sky });
  ok('…and its own board, so the same player can be on both today', adSaved.status === 201 && adSaved.data.dayRank === 1 &&
    (await api('/board?scope=day&dictionary=adult')).data.length === 1);
  const st2 = (await api('/daily-status', 'POST', { profileToken: sky })).data;
  ok('now both of that profile\'s dailies are done', st2.kids === 'done' && st2.adult === 'done');
  ok('a room on the unfiltered list needs the PIN', (await api('/rooms', 'POST', { name: 'H', settings: { dictionary: 'adult' }, password: 'limes' })).status === 403);
  const noPw = await api('/rooms', 'POST', { name: 'H', settings: { dictionary: 'adult' } }, PIN);
  ok('…and a lobby password', noPw.status === 400 && noPw.data.needsPassword === 'create');
  const adultRoom = (await api('/rooms', 'POST', { name: 'H', settings: { dictionary: 'adult' }, password: 'limes' }, PIN)).data;
  ok('a guest needs the lobby password to join', (await api(`/rooms/${adultRoom.code}/join`, 'POST', { name: 'Kid' })).status === 401);
  ok('…and gets in with it, no PIN needed', (await api(`/rooms/${adultRoom.code}/join`, 'POST', { name: 'Pal', password: 'limes' })).status === 200);
  const kidsRoom = (await api('/rooms', 'POST', { name: 'H2', settings: { dictionary: 'kids' } })).data;
  ok('a host can\'t switch a room to the unfiltered list without the PIN',
    (await api(`/rooms/${kidsRoom.code}/settings`, 'POST', { ...kidsRoom, settings: { dictionary: 'adult' }, password: 'pears' })).status === 403);

  console.log('\n-- scuffle: a room with two phones --');
  const host = (await api('/rooms', 'POST', { name: 'Sam', settings: { rounds: 3, seconds: 2, dictionary: 'kids' } })).data;
  ok('hosting gives a four-letter code', /^[A-Z2-9]{4}$/.test(host.code));
  const guest = (await api(`/rooms/${host.code}/join`, 'POST', { name: 'Alex' })).data;
  ok('a second phone joins with the code', guest.playerId && guest.playerId !== host.playerId);
  ok('the room is on the Join a game board', (await api('/api/lobby')).data.rooms.some(r => r.game === 'scuffle' && r.code === host.code));
  ok('only the host can start', (await api(`/rooms/${host.code}/start`, 'POST', guest)).status === 403);
  await api(`/rooms/${host.code}/start`, 'POST', host);
  const snapG = (await api(`/rooms/${host.code}?playerId=${guest.playerId}&token=${guest.token}`)).data;
  ok('both players get the same letters and clock', snapG.phase === 'playing' && /^[A-Z]{6}$/.test(snapG.round.letters));
  const rw = game.findWords(snapG.round.letters, 'kids');
  const rFull = rw.find(w => w.length === 6);
  const hostFull = (await api(`/rooms/${host.code}/word`, 'POST', { ...host, word: rFull, points: 9999 })).data;
  ok('the first to find the full word gets the bonus', hostFull.ok && hostFull.first && hostFull.points === game.POINTS[6] + 150);
  const guestFull = (await api(`/rooms/${host.code}/word`, 'POST', { ...guest, word: rFull })).data;
  ok('the second still scores it, without the first-place bonus', guestFull.ok && !guestFull.first && guestFull.points === game.POINTS[6] + 100);
  ok('a word can\'t be found twice by the same player', (await api(`/rooms/${host.code}/word`, 'POST', { ...guest, word: rFull })).data.reason === 'again');
  ok('a stranger can\'t send words', (await api(`/rooms/${host.code}/word`, 'POST', { playerId: guest.playerId, token: 'nope', word: rFull })).status === 403);
  const mid = (await api(`/rooms/${host.code}?playerId=${guest.playerId}&token=${guest.token}`)).data;
  ok('players see each other\'s counts and scores, not their words',
    mid.players.find(p => p.name === 'Sam').count === 1 && mid.players.find(p => p.name === 'Sam').gotFull && !mid.reveal &&
    mid.round.firstFull === 'Sam' && mid.mine.found.length === 1);
  await wait(2000 + 1800);
  const rev = (await api(`/rooms/${host.code}?playerId=${host.playerId}&token=${host.token}`)).data;
  ok('when the clock runs out the server ends the round and shows the words', rev.phase === 'reveal' && rev.reveal.full.includes(rFull) && rev.reveal.words.length === rw.length);
  ok('…with the scores it kept', rev.players.find(p => p.name === 'Sam').score === game.POINTS[6] + 150 && rev.players.find(p => p.name === 'Alex').score === game.POINTS[6] + 100);
  ok('words after the round are refused', (await api(`/rooms/${host.code}/word`, 'POST', { ...guest, word: rFull })).status === 409);
  ok('only the host moves on', (await api(`/rooms/${host.code}/next`, 'POST', guest)).status === 403);
  await api(`/rooms/${host.code}/next`, 'POST', host);
  ok('the next round starts with new letters', (await api(`/rooms/${host.code}?playerId=${host.playerId}&token=${host.token}`)).data.index === 1);
  await api(`/rooms/${host.code}/done`, 'POST', host);
  await api(`/rooms/${host.code}/done`, 'POST', guest);
  ok('when everyone is done the round ends early', (await api(`/rooms/${host.code}?playerId=${host.playerId}&token=${host.token}`)).data.phase === 'reveal');
  await api(`/rooms/${host.code}/next`, 'POST', host);
  await api(`/rooms/${host.code}/next`, 'POST', host);
  const over = (await api(`/rooms/${host.code}?playerId=${host.playerId}&token=${host.token}`)).data;
  ok('after the last round the game is over', over.phase === 'over' && over.reveal);
  const again = await api(`/rooms/${host.code}/start`, 'POST', host);
  const fresh = (await api(`/rooms/${host.code}?playerId=${host.playerId}&token=${host.token}`)).data;
  ok('the host can play again, scores back to zero', again.status === 200 && fresh.phase === 'playing' && fresh.index === 0 && fresh.players.every(p => p.score === 0));
  await api(`/rooms/${host.code}/leave`, 'POST', host);
  ok('when the host leaves, the room passes to the next player',
    (await api(`/rooms/${host.code}?playerId=${guest.playerId}&token=${guest.token}`)).data.host === true);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
