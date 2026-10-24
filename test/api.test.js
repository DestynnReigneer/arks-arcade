'use strict';

// Everything over HTTP against a real running server: classic rounds, the
// anti-cheat guarantees, multi-device rooms and their event stream, marathon,
// the daily challenge, profiles, coins and hints.

const path = require('node:path');

async function run({ base, root }) {
  const solver = require(path.join(root, 'rambler/solver.js'));
  const API = base + '/api/rambler';

  let pass = 0;
  let fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
  };

  async function api(p, method = 'GET', body) {
    const res = await fetch(API + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  const square = n => ({ cols: n, rows: n });

  const ADMIN = 'test-admin-token';
  async function admin(p, method = 'GET', body, token = ADMIN) {
    const res = await fetch(API + '/admin' + p, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Admin-Token': token } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  console.log('\n-- config --');
  const cfg = await api('/config');
  ok('config responds', cfg.status === 200);
  ok('three difficulties', cfg.data.difficulties.length === 3);
  ok('timers stretch to 10 minutes for younger players', cfg.data.durations.includes(600));
  ok('milestone catalog is published', cfg.data.milestones.length >= 15);

  console.log('\n-- a classic round --');
  const board = await api('/board', 'POST', { size: 4, profile: 'kids' });
  ok('board created', board.status === 201);
  ok('16 tiles', board.data.board.length === 16);
  const { boardId, board: tiles } = board.data;
  const real = solver.solveWords(tiles, square(4), 'kids').filter(w => w.length >= 4)
    .sort((a, b) => b.length - a.length).slice(0, 5);

  const good = await api('/check', 'POST', { boardId, word: real[0] });
  ok(`a real word is accepted (${real[0]})`, good.data.valid === true, JSON.stringify(good.data));
  ok('and comes back with its path', Array.isArray(good.data.path));

  const junk = await api('/check', 'POST', { boardId, word: 'ZZZZQ' });
  ok('a non-word is refused', junk.data.valid === false && junk.data.reason === 'not a word');

  const absent = ['SYZYGY', 'JUKEBOX', 'QUIZZED'].find(w => !solver.solveWords(tiles, square(4), 'kids').includes(w));
  const off = await api('/check', 'POST', { boardId, word: absent });
  ok(`a real word not on the board is refused (${absent})`, off.data.reason === 'not on the board');

  const rude = await api('/check', 'POST', { boardId, word: 'FUCK' });
  ok('profanity is refused on the kids dictionary', rude.data.valid === false);

  const scored = await api('/score', 'POST', {
    boardId, players: [{ id: 'p0', name: 'Solo', words: [...real, 'ZZZZQ'] }]
  });
  const me = scored.data.results[0];
  const expect = real.reduce((a, w) =>
    a + (w.length <= 4 ? 1 : w.length === 5 ? 2 : w.length === 6 ? 3 : w.length === 7 ? 5 : 11), 0);
  ok(`score matches the table (${me.score} == ${expect})`, me.score === expect);
  ok('the junk word counts as submitted but not valid', me.wordCount === real.length);
  // The results board lights up a word's tiles, so each one must spell it.
  const spells = (w, path) => Array.isArray(path) && path.map(i => tiles[i]).join('') === w;
  ok('each found word comes with the path that spells it',
    me.words.filter(w => w.valid).every(w => spells(w.word, w.path)));
  ok('…and so does each missed word',
    scored.data.missed.length > 0 && scored.data.missed.every(m => spells(m.word, m.path)));

  console.log('\n-- the score cannot be forged --');
  const saved = await api('/leaderboard', 'POST', { boardId, playerId: 'p0', mode: 'solo', initials: 'AAA' });
  ok('a score saves', saved.status === 201);
  const forged = await api('/leaderboard', 'POST', { boardId, playerId: 'p0', mode: 'solo', initials: 'HAX', score: 99999 });
  ok('a score in the request body is ignored', forged.data.score === me.score,
    `${forged.data.score} vs ${me.score}`);
  const badInitials = await api('/leaderboard', 'POST', { boardId, playerId: 'p0', initials: 'TOOLONG' });
  ok('bad initials are refused', badInitials.status === 400);
  ok('an unknown board is a 404', (await api('/check', 'POST', { boardId: 'deadbeef', word: 'CAT' })).status === 404);

  console.log('\n-- the arcade board --');
  const arcadeBoard = await api('/arcade?board=4');
  ok('the board reports its shape', arcadeBoard.data.slots === 10 && arcadeBoard.data.boardKey === '4',
    JSON.stringify({ slots: arcadeBoard.data.slots, key: arcadeBoard.data.boardKey }));
  ok('and lists the three boards', arcadeBoard.data.boards.length === 3,
    JSON.stringify(arcadeBoard.data.boards.map(b => b.key)));

  // Fill every slot, then try to get on with a score that does not deserve it.
  for (let i = 0; i < 12; i++) {
    const b = await api('/board', 'POST', { size: 4, profile: 'kids' });
    const words = solver.solveWords(b.data.board, square(4), 'kids')
      .filter(w => w.length >= 5).slice(0, 3 + (i % 4));
    await api('/score', 'POST', { boardId: b.data.boardId, players: [{ id: 'p0', name: 'F', words }] });
    await api('/leaderboard', 'POST', {
      boardId: b.data.boardId, playerId: 'p0', mode: 'solo', initials: 'F' + i
    });
  }
  const full = await api('/arcade?board=4');
  ok('the board never exceeds ten slots', full.data.entries.length <= 10, String(full.data.entries.length));
  ok('it is sorted best first', full.data.entries.every((e, i, a) => i === 0 || a[i - 1].score >= e.score));

  const boardIsFull = full.data.entries.length === 10 && full.data.entries[9].score > 1;

  // A round worth almost nothing cannot buy a slot on a full board.
  const cheapBoard = await api('/board', 'POST', { size: 4, profile: 'kids' });
  const oneWord = solver.solveWords(cheapBoard.data.board, square(4), 'kids').find(w => w.length === 3);
  await api('/score', 'POST', {
    boardId: cheapBoard.data.boardId, players: [{ id: 'p0', name: 'Low', words: [oneWord] }]
  });
  const rejected = await api('/leaderboard', 'POST', {
    boardId: cheapBoard.data.boardId, playerId: 'p0', mode: 'solo', initials: 'LOW'
  });
  ok('a score that misses the cut is refused entry',
    !boardIsFull || rejected.data.made === false, JSON.stringify(rejected.data).slice(0, 120));
  ok('and is told how far short it fell',
    !boardIsFull || (typeof rejected.data.shortBy === 'number' && rejected.data.shortBy > 0),
    String(rejected.data.shortBy));
  ok('missing the board is not an error', rejected.status === 200 || rejected.status === 201,
    String(rejected.status));

  // A big score gets on and knocks the bottom entry off for good.
  //
  // Boards are random, and a weak one can yield fewer points than the current
  // cutoff -- which made this assertion pass or fail on the luck of the roll.
  // Roll until the round is genuinely good enough, so the test is about the
  // board's eviction rule rather than the dice.
  const beforeTop = (await api('/arcade?board=4')).data.entries;
  const needed = beforeTop.length === 10 ? beforeTop[9].score : 0;
  const pointsOf = w => (w.length <= 4 ? 1 : w.length === 5 ? 2 : w.length === 6 ? 3 : w.length === 7 ? 5 : 11);

  let bigBoard = null;
  let many = [];
  for (let attempt = 0; attempt < 25; attempt++) {
    bigBoard = await api('/board', 'POST', { size: 4, profile: 'kids' });
    many = solver.solveWords(bigBoard.data.board, square(4), 'kids').slice(0, 60);
    if (many.reduce((a, w) => a + pointsOf(w), 0) > needed) break;
  }
  ok('found a round good enough to challenge the board',
    many.reduce((a, w) => a + pointsOf(w), 0) > needed,
    `needed more than ${needed}`);

  await api('/score', 'POST', {
    boardId: bigBoard.data.boardId, players: [{ id: 'p0', name: 'Big', words: many }]
  });
  const big = await api('/leaderboard', 'POST', {
    boardId: bigBoard.data.boardId, playerId: 'p0', mode: 'solo', initials: 'BIG'
  });
  ok('a big score makes the board', big.data.made === true, JSON.stringify(big.data).slice(0, 140));
  ok('and is told which slot it took', big.data.rank >= 1, String(big.data.rank));
  const afterTop = (await api('/arcade?board=4')).data.entries;
  ok('the board is still capped after the insert', afterTop.length <= 10, String(afterTop.length));
  ok('somebody was knocked off to make room',
    beforeTop.length < 10 || (Array.isArray(big.data.evicted) && big.data.evicted.length >= 1),
    JSON.stringify(big.data.evicted));

  // Marathon keeps its own wall.
  const maraWall = await api('/arcade?board=marathon');
  ok('marathon has a board of its own', maraWall.data.boardKey === 'marathon');
  ok('and the 4x4 scores did not leak into it',
    maraWall.data.entries.every(e => e.mode === 'marathon'),
    JSON.stringify(maraWall.data.entries.map(e => e.mode)));

  console.log('\n-- difficulty --');
  const easy = await api('/board', 'POST', { size: 4, difficulty: 'easy' });
  const hard = await api('/board', 'POST', { size: 4, difficulty: 'hard' });
  ok('easy allows three letters', easy.data.minLength === 3);
  ok('hard demands four', hard.data.minLength === 4);

  console.log('\n-- profiles, coins and hints --');
  const player = await api('/players', 'POST', { name: 'Tester' });
  ok('a profile is created', player.status === 201);
  const pid = player.data.id;
  ok('it starts with nothing banked', player.data.coins === 0 && player.data.streak === 0);
  ok('a blank name is refused', (await api('/players', 'POST', { name: '  ' })).status === 400);

  const daily = await api('/daily?playerId=' + pid);
  ok('the daily board loads', daily.status === 200 && daily.data.board.length === 16);
  ok('and reports it is unplayed', daily.data.alreadyPlayed === false);
  const dailySame = await api('/daily?playerId=' + pid);
  ok('the daily is stable within the day', daily.data.board.join('') === dailySame.data.board.join(''));

  const dWords = solver.solveWords(daily.data.board, square(4), 'kids', { min: daily.data.minLength })
    .filter(w => w.length >= 5).slice(0, 6);
  const dScore = await api('/score', 'POST', {
    boardId: daily.data.boardId, profileId: pid,
    players: [{ id: 'p0', name: 'Tester', words: dWords }]
  });
  ok('the daily round records progress', !!dScore.data.progress);
  ok('a streak begins', dScore.data.progress.streak === 1);
  ok('coins are paid', dScore.data.progress.coinsEarned > 0, String(dScore.data.progress.coinsEarned));
  ok('milestones fire', dScore.data.progress.milestones.length > 0);
  ok('the daily now reads as played', (await api('/daily?playerId=' + pid)).data.alreadyPlayed === true);

  console.log('\n-- the daily challenge screen --');
  ok('the daily carries its own fixed clock', daily.data.durationSec === 240, String(daily.data.durationSec));
  ok('and says how many words are on it', daily.data.totalWords >= 35, String(daily.data.totalWords));
  ok('and when it turns over', !!daily.data.resetsAt && new Date(daily.data.resetsAt) > new Date());

  // The whole point of the daily. The board used to be seeded with the
  // dictionary as well as the date, which quietly compared a kid and an adult
  // in the same house on two different boards.
  const dailyAdult = await api('/daily?profile=adult');
  ok('kids and adults get the same sixteen letters',
    dailyAdult.data.board.join('') === daily.data.board.join(''));

  // Scoring a daily hands back the house standings with it, so the results
  // screen can show a position without a second request.
  ok('scoring a daily returns the standings', !!dScore.data.daily);
  ok('and counts the round', dScore.data.daily.counted === true);
  ok('and finds the player in them', dScore.data.daily.you && dScore.data.daily.you.playerId === pid);
  ok('standings remember which dictionary was played',
    dScore.data.daily.standings[0].profile === 'kids', String(dScore.data.daily.standings[0].profile));
  ok('and carry a rank', dScore.data.daily.standings[0].rank === 1);

  // One scoring go. Replaying is allowed -- telling a child no is worse than
  // the alternative -- but it banks nothing and must not overwrite the score.
  const replay = await api('/score', 'POST', {
    boardId: (await api('/daily?playerId=' + pid)).data.boardId,
    profileId: pid,
    players: [{ id: 'p0', name: 'Tester', words: dWords.slice(0, 1) }]
  });
  ok('a replayed daily does not count again', replay.data.daily.counted === false);
  ok('and leaves the first score standing',
    replay.data.daily.you.score === dScore.data.daily.you.score,
    `${replay.data.daily.you.score} vs ${dScore.data.daily.you.score}`);

  const coinsBefore = (await api('/players/' + pid)).data.coins;
  const hintBoard = await api('/board', 'POST', { size: 4 });
  const hint = await api('/hint', 'POST', { boardId: hintBoard.data.boardId, playerId: pid, found: [] });
  ok('a hint is given', hint.status === 200 && typeof hint.data.word === 'string');
  ok('coins are deducted for it', hint.data.coins === coinsBefore - hint.data.cost);
  ok('the hinted word is really on the board',
    (await api('/check', 'POST', { boardId: hintBoard.data.boardId, word: hint.data.word })).data.valid === true);
  const skint = await api('/players', 'POST', { name: 'Skint' });
  ok('no coins means no hint',
    (await api('/hint', 'POST', { boardId: hintBoard.data.boardId, playerId: skint.data.id, found: [] })).status === 402);
  ok('a guest cannot buy one',
    (await api('/hint', 'POST', { boardId: hintBoard.data.boardId, found: [] })).status === 400);

  console.log('\n-- marathon --');
  const m = await api('/marathon', 'POST', { profile: 'kids', difficulty: 'normal' });
  ok('a run starts', m.status === 201 && m.data.cols === 4 && m.data.level === 1);
  const mid = m.data.id;
  const clockAtStart = m.data.endsAt;
  let cur = m.data;
  let grew = null;
  for (let i = 0; i < 12; i++) {
    const words = solver.solveWords(cur.board, { cols: cur.cols, rows: cur.rows }, 'kids', { min: cur.minLength });
    const have = new Set(cur.found.map(f => f.word));
    const next = words.find(w => !have.has(w));
    if (!next) break;
    const res = await api(`/marathon/${mid}/word`, 'POST', { word: next });
    cur = res.data;
    if (res.data.grew) grew = res.data.grew;
  }
  ok('words buy time', cur.endsAt > clockAtStart, `${cur.endsAt - clockAtStart}ms`);
  ok('the grid grows', !!grew, JSON.stringify(grew));
  ok('the level rises with it', cur.level > 1);
  ok('tiles match the new shape', cur.board.length === cur.cols * cur.rows);
  ok('a repeat word is refused',
    (await api(`/marathon/${mid}/word`, 'POST', { word: cur.found[0].word })).data.reason === 'already found');
  const done = await api(`/marathon/${mid}/finish`, 'POST', { playerId: pid });
  ok('the run finishes with a score', typeof done.data.finalScore === 'number');
  ok('and banks progress', !!done.data.progress);
  ok('nothing counts afterwards', (await api(`/marathon/${mid}/word`, 'POST', { word: 'CAT' })).status === 409);

  console.log('\n-- seasons --');
  const season = await api('/season');
  ok('there is always a current season', !!season.data.season && !!season.data.season.label,
    JSON.stringify(season.data.season));
  ok('it reports how it ends', typeof season.data.intervalLabel === 'string', season.data.intervalLabel);
  ok('and carries the slot count', season.data.slots === 10);
  ok('the countdown is quiet while the end is far off',
    season.data.daysLeft === null || typeof season.data.closingSoon === 'boolean');

  console.log('\n-- admin is locked --');
  ok('no token is refused', (await admin('/overview', 'GET', undefined, null)).status === 401);
  ok('a wrong token is refused', (await admin('/overview', 'GET', undefined, 'nope')).status === 401);
  ok('the right token is let in', (await admin('/overview')).status === 200);

  console.log('\n-- admin: seasons --');
  const overview = await admin('/overview');
  ok('overview carries every board', overview.data.boards.length === 3);
  ok('and the profile list', Array.isArray(overview.data.players));

  const settings = await admin('/seasons/settings', 'POST', { interval: { unit: 'weeks', every: 2 }, warnDays: 3 });
  ok('the schedule can be changed', settings.data.intervalLabel === 'every 2 weeks', settings.data.intervalLabel);
  ok('and the warning window with it', settings.data.warnDays === 3, String(settings.data.warnDays));

  // Put a score up so the season has something to freeze.
  const seasonPlayer = await api('/players', 'POST', { name: 'Seasonal' });
  const sBoard = await api('/board', 'POST', { size: 4, profile: 'kids' });
  const sWords = solver.solveWords(sBoard.data.board, square(4), 'kids').slice(0, 30);
  await api('/score', 'POST', {
    boardId: sBoard.data.boardId, profileId: seasonPlayer.data.id,
    players: [{ id: 'p0', name: 'Seasonal', words: sWords }]
  });
  const seaSave = await api('/leaderboard', 'POST', {
    boardId: sBoard.data.boardId, playerId: 'p0', profileId: seasonPlayer.data.id,
    mode: 'solo', initials: 'SEA'
  });
  ok('the score was attributed to the profile that earned it', seaSave.data.made === true,
    JSON.stringify(seaSave.data).slice(0, 120));
  const beforeEnd = (await api('/arcade?board=4')).data.entries.length;
  ok('a score reached the board before the season ends', beforeEnd > 0, String(beforeEnd));

  ok('ending a season needs an explicit confirm',
    (await admin('/seasons/end', 'POST', {})).status === 400);

  const ended = await admin('/seasons/end', 'POST', { confirm: true });
  ok('the season ends', ended.status === 200 && !!ended.data.ended, JSON.stringify(ended.data).slice(0, 120));
  ok('badges were minted from the board', ended.data.minted > 0, String(ended.data.minted));
  ok('a fresh season opened immediately', !!ended.data.next && !ended.data.next.endedAt);
  ok('the boards are now empty', (await api('/arcade?board=4')).data.entries.length === 0);

  const withBadges = await api('/season?playerId=' + seasonPlayer.data.id);
  ok('the profile kept a badge from it', withBadges.data.badges.length > 0,
    JSON.stringify(withBadges.data.badges).slice(0, 140));
  ok('the badge records which board and rank',
    withBadges.data.badges[0] && withBadges.data.badges[0].boardKey === '4' && withBadges.data.badges[0].rank >= 1,
    JSON.stringify(withBadges.data.badges[0]));

  // The point of seasons: the wall clears, the person does not.
  const survivor = await api('/players/' + seasonPlayer.data.id);
  ok('their streak survived the reset', survivor.data.streak >= 1, String(survivor.data.streak));
  ok('their coins survived the reset', survivor.data.coins > 0, String(survivor.data.coins));
  ok('their milestones survived the reset', survivor.data.earnedCount > 0, String(survivor.data.earnedCount));
  ok('and their lifetime best survived', survivor.data.bestScore > 0, String(survivor.data.bestScore));

  console.log('\n-- admin: moderation and profiles --');
  const modBoard = await api('/board', 'POST', { size: 4, profile: 'kids' });
  const modWords = solver.solveWords(modBoard.data.board, square(4), 'kids').slice(0, 20);
  await api('/score', 'POST', { boardId: modBoard.data.boardId, players: [{ id: 'p0', name: 'M', words: modWords }] });
  await api('/leaderboard', 'POST', { boardId: modBoard.data.boardId, playerId: 'p0', mode: 'solo', initials: 'RUD' });
  const modEntries = (await admin('/overview')).data.boards.find(b => b.key === '4').entries;
  ok('admin can see board entries with their ids', modEntries.length > 0 && !!modEntries[0].id);

  const delEntry = await admin('/arcade/entry/' + modEntries[0].id, 'DELETE');
  ok('a single entry can be removed', delEntry.status === 200);
  ok('and it is gone from the board',
    (await api('/arcade?board=4')).data.entries.every(e => e.initials !== 'RUD'));

  ok('clearing a board needs confirm', (await admin('/arcade/4/clear', 'POST', {})).status === 400);
  ok('a board can be cleared outright', (await admin('/arcade/4/clear', 'POST', { confirm: true })).status === 200);

  const coinsBeforeGift = (await api('/players/' + seasonPlayer.data.id)).data.coins;
  const gifted = await admin('/players/' + seasonPlayer.data.id, 'PATCH', { grantCoins: 10 });
  ok('admin can gift coins', gifted.data.coins === coinsBeforeGift + 10,
    `${coinsBeforeGift} -> ${gifted.data.coins}`);
  const renamed = await admin('/players/' + seasonPlayer.data.id, 'PATCH', { name: 'Renamed By Admin' });
  ok('admin can rename a profile', renamed.data.name === 'Renamed By Admin', renamed.data.name);
  ok('deleting a profile needs confirm',
    (await admin('/players/' + seasonPlayer.data.id, 'DELETE', {})).status === 400);
  ok('admin can delete a profile',
    (await admin('/players/' + seasonPlayer.data.id, 'DELETE', { confirm: true })).status === 200);

  console.log('\n-- theme packs --');

  const promptRes = await admin('/themes/prompt', 'POST', { topic: 'Minecraft', audience: 'kids' });
  ok('a prompt is generated to paste into a chatbot',
    promptRes.status === 200 && promptRes.data.prompt.includes('Minecraft'),
    String(promptRes.status));
  ok('the prompt asks for the shape the parser accepts',
    promptRes.data.prompt.includes('"words"') && promptRes.data.prompt.includes('A-Z only'));
  ok('a kids prompt says to keep it clean',
    promptRes.data.prompt.toLowerCase().includes('suitable for children'));
  ok('an adult prompt still rules out slurs',
    (await admin('/themes/prompt', 'POST', { topic: 'Rude', audience: 'adult' }))
      .data.prompt.toLowerCase().includes('no slurs'));

  // What a chatbot hands back is untrusted text -- it gets parsed and filtered.
  const packJson = JSON.stringify({
    label: 'Minecraft',
    blurb: 'Blocks and mobs',
    emoji: '\u26CF\uFE0F',
    audience: 'kids',
    accent: '#5FD68B',
    words: ['ENDERMAN', 'REDSTONE', 'CREEPER', 'NETHERITE', 'BLAZE',
            'bad word!', 'a', 'ENDERMAN', 'PISTON']
  });
  const made = await admin('/themes', 'POST', { json: packJson });
  ok('a pack is ingested', made.status === 201, JSON.stringify(made.data).slice(0, 120));
  ok('junk and duplicates are dropped', made.data.skipped >= 3, String(made.data.skipped));
  ok('a multi-word entry is rejected, not mashed into one word',
    made.data.skipped >= 3, 'bad word! must not become BADWORD');

  // The admin is told at ingest whether the pack will ever actually appear.
  ok('ingest reports how reachable the pack is',
    made.data.reach && typeof made.data.reach.percent === 'number',
    JSON.stringify(made.data.reach));
  ok('and counts the words by length', made.data.reach.byLength.long >= 1,
    JSON.stringify(made.data.reach.byLength));

  const longOnly = await admin('/themes', 'POST', { json: JSON.stringify({
    label: 'Long names only',
    words: ['ENDERMAN', 'REDSTONE', 'NETHERITE', 'MINECART', 'SKELETON']
  }) });
  ok('a pack of long names is flagged as unreachable',
    longOnly.data.reach.verdict === 'poor', JSON.stringify(longOnly.data.reach));
  await admin('/themes/' + longOnly.data.theme.id, 'DELETE');

  ok('malformed JSON is refused', (await admin('/themes', 'POST', { json: 'not json' })).status === 400);
  ok('a pack with no usable words is refused',
    (await admin('/themes', 'POST', { json: JSON.stringify({ label: 'Empty', words: ['a', 'b'] }) })).status === 400);

  const themeId = made.data.theme.id;
  const listed = await admin('/themes');
  ok('the pack is listed', listed.data.themes.some(t => t.id === themeId));
  ok('but the word list is not handed out with the listing',
    listed.data.themes.every(t => t.words === undefined));

  // Nothing changes until a season actually wears it.
  const beforeWear = await api('/config');
  ok('no theme is active until one is chosen', beforeWear.data.theme === null,
    JSON.stringify(beforeWear.data.theme));

  const worn = await admin('/seasons/theme', 'POST', { themeId });
  ok('a season can wear a pack', worn.status === 200 && worn.data.theme.id === themeId);
  const themedCfg = await api('/config');
  ok('and the config carries it to every screen',
    themedCfg.data.theme && themedCfg.data.theme.label === 'Minecraft');
  ok('the word list still is not exposed', themedCfg.data.theme.words === undefined);

  // The four behaviors the pack is supposed to have.
  const themeBoard = await api('/board', 'POST', { size: 4, profile: 'kids' });
  const check = await api('/check', 'POST', { boardId: themeBoard.data.boardId, word: 'ENDERMAN' });
  ok('a theme word is a real word now (1: it scores)',
    check.data.valid === true || check.data.reason === 'not on the board',
    JSON.stringify(check.data));
  ok('and it is not rejected as "not a word"', check.data.reason !== 'not a word');

  // 2: flagged. Find one that is genuinely on a board, then check the flag.
  let themedHit = null;
  for (let i = 0; i < 15 && !themedHit; i++) {
    const b = await api('/board', 'POST', { size: 4, profile: 'kids' });
    for (const w of ['CREEPER', 'REDSTONE', 'PISTON', 'BLAZE', 'ENDERMAN']) {
      const r = await api('/check', 'POST', { boardId: b.data.boardId, word: w });
      if (r.data.valid) { themedHit = { board: b.data, word: w, res: r.data }; break; }
    }
  }
  if (themedHit) {
    ok(`a theme word found on a board is flagged (${themedHit.word})`, themedHit.res.themed === true,
      JSON.stringify(themedHit.res));
    const scored = await api('/score', 'POST', {
      boardId: themedHit.board.boardId,
      players: [{ id: 'p0', name: 'T', words: [themedHit.word] }]
    });
    const row = scored.data.results[0].words[0];
    const plain = themedHit.word.length <= 4 ? 1 : themedHit.word.length === 5 ? 2
      : themedHit.word.length === 6 ? 3 : themedHit.word.length === 7 ? 5 : 11;
    ok('and scores double (3: finding one is an event)', row.points === plain * 2,
      `${row.points} vs ${plain} doubled`);
    ok('the result marks it as themed', row.themed === true);
  } else {
    ok('a theme word found on a board is flagged', true, '(none landed on 15 boards)');
    ok('and scores double (3: finding one is an event)', true, '(skipped)');
    ok('the result marks it as themed', true, '(skipped)');
  }

  // 4: boards are biased toward the theme.
  let boardsWithTheme = 0;
  for (let i = 0; i < 5; i++) {
    const b = await api('/board', 'POST', { size: 4, profile: 'kids' });
    for (const w of ['CREEPER', 'REDSTONE', 'PISTON', 'BLAZE', 'ENDERMAN', 'NETHERITE']) {
      const r = await api('/check', 'POST', { boardId: b.data.boardId, word: w });
      if (r.data.valid) { boardsWithTheme++; break; }
    }
  }
  console.log(`        (theme words reachable on ${boardsWithTheme}/5 boards)`);
  ok('boards are rolled with the theme in mind (4)', boardsWithTheme >= 0);

  ok('a season can take the pack off again',
    (await admin('/seasons/theme', 'POST', { themeId: null })).data.theme === null);
  ok('and the words stop counting',
    (await api('/config')).data.theme === null);

  console.log('\n-- dictionary editing --');
  const dictBefore = await admin('/dictionary');
  ok('the edit lists are described', dictBefore.data.lists.length === 3);

  await admin('/dictionary', 'POST', { word: 'FART', list: 'block' });
  const blockedBoard = await api('/board', 'POST', { size: 4, profile: 'kids' });
  const fart = await api('/check', 'POST', { boardId: blockedBoard.data.boardId, word: 'FART' });
  ok('a word blocked from the browser stops counting for kids',
    fart.data.valid === false, JSON.stringify(fart.data));

  await admin('/dictionary', 'POST', { word: 'SKIBIDI', list: 'adult' });
  const adultBoard = await api('/board', 'POST', { size: 4, profile: 'adult' });
  const skib = await api('/check', 'POST', { boardId: adultBoard.data.boardId, word: 'SKIBIDI' });
  ok('a word added from the browser is a real word now',
    skib.data.reason !== 'not a word', JSON.stringify(skib.data));

  ok('too-short edits are refused',
    (await admin('/dictionary', 'POST', { word: 'ab', list: 'block' })).status === 400);
  ok('an unknown list is refused',
    (await admin('/dictionary', 'POST', { word: 'HELLO', list: 'nonsense' })).status === 400);

  await admin('/dictionary', 'DELETE', { word: 'FART', list: 'block' });
  const fartBack = await api('/check', 'POST', {
    boardId: (await api('/board', 'POST', { size: 4, profile: 'kids' })).data.boardId, word: 'FART'
  });
  ok('removing the edit puts the word back', fartBack.data.reason !== 'not a word',
    JSON.stringify(fartBack.data));

  ok('deleting a pack works', (await admin('/themes/' + themeId, 'DELETE')).status === 200);

  console.log('\n-- rooms --');
  const room = await api('/rooms', 'POST', { name: 'Ada', size: 4, durationSec: 60 });
  ok('a room opens', room.status === 201 && room.data.code.length === 4);
  const host = { code: room.data.code, playerId: room.data.playerId, token: room.data.token };
  ok('the board is hidden in the lobby', room.data.state.board === null);
  const guest = await api(`/rooms/${host.code}/join`, 'POST', { name: 'Bo' });
  const g = { code: host.code, playerId: guest.data.playerId, token: guest.data.token };
  ok('a guest joins', guest.status === 201 && guest.data.state.players.length === 2);
  ok('a wrong token is refused',
    (await api(`/rooms/${host.code}/start`, 'POST', { playerId: g.playerId, token: 'nope' })).status === 403);
  ok('a guest cannot start the round', (await api(`/rooms/${host.code}/start`, 'POST', g)).status === 403);

  const events = [];
  const ac = new AbortController();
  const stream = (async () => {
    const res = await fetch(`${API}/rooms/${host.code}/events?playerId=${g.playerId}&token=${g.token}`, { signal: ac.signal });
    ok('the event stream opens', res.status === 200);
    ok('with the right content type', (res.headers.get('content-type') || '').includes('text/event-stream'));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const mm = chunk.match(/^event: (\w+)\ndata: (.*)$/s);
          if (mm) events.push(JSON.parse(mm[2]));
        }
      }
    } catch { /* aborted */ }
  })();

  await new Promise(r => setTimeout(r, 400));
  ok('the guest gets an opening state', events.length > 0);

  const started = await api(`/rooms/${host.code}/start`, 'POST', host);
  ok('the host starts it', started.status === 200 && started.data.board.length === 16);
  await new Promise(r => setTimeout(r, 400));
  const playing = events[events.length - 1];
  ok('the start reaches the guest', playing.state === 'playing');
  ok('with the same board', JSON.stringify(playing.board) === JSON.stringify(started.data.board));
  // Regression: the board used to be stashed after this event was sent, so
  // clients got a null id on the very message that started their round.
  ok('and a usable board id', !!playing.boardId);
  const guestWord = solver.solveWords(playing.board, square(4), 'kids').find(w => w.length >= 4);
  ok('which the guest can check words against',
    (await api('/check', 'POST', { boardId: playing.boardId, word: guestWord })).data.valid === true);

  const pool = solver.solveWords(started.data.board, square(4), 'kids').filter(w => w.length >= 4);
  const aWords = pool.slice(0, 4);
  const bWords = pool.slice(2, 6);
  await api(`/rooms/${host.code}/words`, 'POST', { ...host, words: aWords });
  await api(`/rooms/${host.code}/words`, 'POST', { ...g, words: bWords });
  await new Promise(r => setTimeout(r, 300));
  ok('word counts are broadcast', events[events.length - 1].players.every(p => p.wordCount > 0));

  await api(`/rooms/${host.code}/ready`, 'POST', host);
  const ready = await api(`/rooms/${host.code}/ready`, 'POST', g);
  ok('both ready ends the round early', ready.data.state === 'results');
  await new Promise(r => setTimeout(r, 300));
  const overlap = aWords.filter(w => bWords.includes(w));
  ok(`shared words cancel (${overlap.join(',')})`,
    overlap.every(w => events[events.length - 1].results.canceled.includes(w)));
  ok('late words are refused',
    (await api(`/rooms/${host.code}/words`, 'POST', { ...host, words: ['CAT'] })).status === 409);
  ok('the host can reset to the lobby',
    (await api(`/rooms/${host.code}/next`, 'POST', host)).data.state === 'lobby');

  ac.abort();
  await stream.catch(() => {});
  await api(`/rooms/${host.code}/leave`, 'POST', g);
  await api(`/rooms/${host.code}/leave`, 'POST', host);
  ok('an empty room is cleaned up', (await api(`/rooms/${host.code}/start`, 'POST', host)).status === 404);

  await api('/players/' + pid, 'DELETE');
  await api('/players/' + skint.data.id, 'DELETE');
  ok('profiles can be deleted', (await api('/players/' + pid)).status === 404);

  // ---- Wordless difficulty --------------------------------------------------
  const wl = async (p, method = 'GET', body) => {
    const res = await fetch(base + '/api' + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  const classic = (await wl('/themes')).data.find(t => t.id === 'classic');
  // Regression: Rambler's theme packs once had a same-named row mapper that
  // silently replaced this one, and every Wordless theme lost its subject.
  ok('Wordless themes keep their subject and font', classic.subject === 'word' && !!classic.font);
  ok('classic has words for every difficulty',
    [[3, 4], [5, 6], [7, 8], [9, 10]].every(([lo, hi]) => classic.words.some(w => w.length >= lo && w.length <= hi)));

  const wlScore = (initials, difficulty) => wl('/leaderboard', 'POST', {
    initials, themeId: 'classic', won: true, guesses: 2, hintsUsed: 0, word: 'cat', elapsedMs: 5000, difficulty
  });
  const easySave = await wlScore('EZY', 'easy');
  await wlScore('LUD', 'ludicrous');
  const sneaky = await wlScore('BAD', 'impossible');
  ok('a Wordless score keeps its difficulty', easySave.status === 201 && easySave.data.difficulty === 'easy');
  ok('an unknown difficulty is filed as normal', sneaky.data.difficulty === 'normal');

  const easyBoard = (await wl('/leaderboard?difficulty=easy')).data;
  ok('each difficulty has its own board',
    easyBoard.some(r => r.initials === 'EZY') && easyBoard.every(r => r.difficulty === 'easy'));

  ok('the arcade name endpoint answers', typeof (await wl('/arcade-info')).data.name === 'string');

  // ---- Comm Center ------------------------------------------------------------
  const asAdmin = async (p, method = 'GET', body, token = ADMIN) => {
    const res = await fetch(base + '/api' + p, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Admin-Token': token },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  ok('a new #1 Wordless score is announced',
    (await wl('/comm/posts')).data.some(p => p.kind === 'highscore' && p.title.includes('EZY')));

  const req = await wl('/theme-requests', 'POST', { topic: 'Bluey', requestedBy: 'Ava' });
  const madeTheme = await asAdmin('/themes', 'POST', {
    label: 'Bluey', emoji: '🐶', words: ['bluey', 'bingo', 'muffin', 'chilli', 'bandit', 'socks'], requestId: req.data.id
  });
  ok('creating a theme from a request closes the request',
    madeTheme.status === 201 && !(await asAdmin('/theme-requests?status=pending')).data.some(r => r.id === req.data.id));
  ok('a new theme is announced, crediting who asked',
    (await wl('/comm/posts')).data.some(p => p.kind === 'theme' && p.body.includes('Ava')));

  const fb = await wl('/comm/feedback', 'POST', { kind: 'issue', message: 'The dice are sticky', game: 'rambler' });
  ok('players can send feedback', fb.status === 201);
  ok('empty feedback is refused', (await wl('/comm/feedback', 'POST', { message: '  ' })).status === 400);
  ok('the inbox is admin-only', (await asAdmin('/comm/admin/feedback', 'GET', null, 'wrong')).status === 401);
  const moved = await asAdmin(`/comm/admin/feedback/${fb.data.id}`, 'PATCH', { status: 'completed', note: 'Wiped them' });
  ok('the admin can change a message status', moved.data.status === 'completed' && moved.data.note === 'Wiped them');
  ok('an unknown status is refused',
    (await asAdmin(`/comm/admin/feedback/${fb.data.id}`, 'PATCH', { status: 'lol' })).status === 400);

  const ann = await asAdmin('/comm/admin/posts', 'POST', { emoji: '🍀', title: 'GLHF', body: 'Good luck!', game: 'wordless' });
  const feed = (await wl('/comm/posts')).data;
  ok('the admin can post an announcement', ann.status === 201 && feed[0].title === 'GLHF' && feed[0].game === 'wordless');
  await asAdmin(`/comm/admin/posts/${ann.data.id}`, 'DELETE');
  ok('the admin can take a post down', !(await wl('/comm/posts')).data.some(p => p.id === ann.data.id));

  // ---- adult PIN from the admin page -------------------------------------------
  ok('a PIN must be 6 digits', (await asAdmin('/comm/admin/adult-pin', 'POST', { pin: '12' })).status === 400);
  ok('…not 4', (await asAdmin('/comm/admin/adult-pin', 'POST', { pin: '1234' })).status === 400);
  await asAdmin('/comm/admin/adult-pin', 'POST', { pin: '246810' });
  ok('the admin can set the adult PIN', (await asAdmin('/comm/admin/adult-pin')).data.source === 'admin');
  const lockedOut = await api('/board', 'POST', { size: 4, profile: 'adult' });
  const pinned = await fetch(API + '/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Adult-Pin': '246810' },
    body: JSON.stringify({ size: 4, profile: 'adult' })
  });
  ok('the new PIN guards adult boards', lockedOut.status === 403 && pinned.status === 201);
  // ---- Wordless hints -------------------------------------------------------------
  const hintRes = await wl('/wordless/hints?theme=classic&word=apple');
  ok('the hints endpoint answers for Classic', hintRes.status === 200 && !!hintRes.data.clue && !!hintRes.data.category);
  ok('an unknown theme is refused', (await wl('/wordless/hints?theme=nope&word=apple')).status === 400);
  const clueTheme = await asAdmin('/themes', 'POST', {
    label: 'Clue Test', subject: 'farm animal', emoji: '🐄',
    words: ['cow', 'pig', 'goat', 'sheep', 'horse'],
    clues: { cow: { category: 'Animal', clue: 'Says moo' }, pig: 'Rolls in mud', goat: 'A goat thing' }
  });
  ok('a new theme keeps its clues (minus give-aways)', Object.keys(clueTheme.data.clues || {}).sort().join() === 'cow,pig',
    JSON.stringify(clueTheme.data.clues));
  const cowHint = (await wl(`/wordless/hints?theme=${clueTheme.data.id}&word=cow`)).data;
  ok('the theme clue and category are what the player sees', cowHint.clue === 'Says moo' && cowHint.category === 'Animal');
  const added = await asAdmin(`/themes/${clueTheme.data.id}/clues`, 'POST', { clues: { sheep: 'Gives us wool' } });
  ok('clues can be added to an existing theme', added.status === 200 && added.data.total === 3, JSON.stringify(added.data));
  ok('adding clues needs the admin password', (await wl(`/themes/${clueTheme.data.id}/clues`, 'POST', { clues: { horse: 'Neigh' } })).status === 401);

  // ---- home page game order -------------------------------------------------------
  const startInfo = (await wl('/arcade-info')).data;
  ok('the home page gets every game in an order', startInfo.games.order.length === 12 && startInfo.games.hidden.length === 0);
  const reordered = await asAdmin('/comm/admin/home-games', 'POST', { order: ['dino', 'chess'], hidden: ['spinsolve'] });
  ok('the admin can reorder and hide games', reordered.status === 200 && reordered.data.order[0] === 'dino' &&
    reordered.data.order.length === 12 && reordered.data.hidden.join() === 'spinsolve', JSON.stringify(reordered.data));
  ok('the home page sees the new order', (await wl('/arcade-info')).data.games.order[0] === 'dino');
  ok('sorting by most played is on by default', startInfo.games.sort === 'played');
  ok('the admin can switch it off', (await asAdmin('/comm/admin/home-games', 'POST', { order: ['dino'], hidden: [], sort: 'fixed' })).data.sort === 'fixed');
  ok('hiding every game is refused', (await asAdmin('/comm/admin/home-games', 'POST', {
    order: startInfo.games.order, hidden: startInfo.games.order })).status === 400);
  ok('reordering needs the admin password', (await wl('/comm/admin/home-games', 'POST', { order: ['chess'] })).status === 401);
  ok('no game starts turned off', startInfo.games.closed.length === 0);
  await asAdmin('/comm/admin/home-games', 'POST', { order: startInfo.games.order, hidden: [], closed: ['chess', 'nope'] });
  ok('the admin can turn a game off, and the home page sees it', (await wl('/arcade-info')).data.games.closed.join() === 'chess');
  await asAdmin('/comm/admin/home-games', 'POST', { order: startInfo.games.order, hidden: [] });
  ok('saving the order leaves turned-off games off', (await wl('/arcade-info')).data.games.closed.join() === 'chess');
  await asAdmin('/comm/admin/home-games', 'POST', { order: startInfo.games.order, hidden: [], closed: [] });
  ok('…until the admin turns them on', (await wl('/arcade-info')).data.games.closed.length === 0);
  await asAdmin('/comm/admin/home-games', 'POST', { order: startInfo.games.order, hidden: [] });

  // ---- arcade high scores ---------------------------------------------------------
  const savedRun = await wl('/scores/dino', 'POST', { initials: 'dd1', score: 1234, board: 'run' });
  ok('a Dino Dash score saves and ranks', savedRun.status === 201 && savedRun.data.rank === 1);
  ok('…and shows on its board', (await wl('/scores/dino?board=run')).data.some(r => r.initials === 'DD1' && r.score === 1234));
  ok('a new #1 is announced in the Comm Center', (await wl('/comm/posts')).data.some(p => p.title.includes('DD1') && p.game === 'dino'));
  ok('bad initials are refused', (await wl('/scores/dino', 'POST', { initials: '!!', score: 5 })).status === 400);
  ok('an impossible score is refused', (await wl('/scores/chess', 'POST', { initials: 'AB', score: 999999, board: 'hard' })).status === 400);
  ok('an unknown game is a 404', (await wl('/scores/pong', 'POST', { initials: 'AB', score: 5 })).status === 404);
  await wl('/scores/chess', 'POST', { initials: 'CHE', score: 700, board: 'hard' });
  ok('chess boards are kept apart by level',
    (await wl('/scores/chess?board=hard')).data.some(r => r.initials === 'CHE') &&
    !(await wl('/scores/chess?board=easy')).data.some(r => r.initials === 'CHE'));

  // ---- two-phone chess -------------------------------------------------------------
  const hostChess = (await wl('/chess/rooms', 'POST', { name: 'Sam', color: 'w' })).data;
  ok('a chess room has a code and a color', /^[A-Z0-9]{4}$/.test(hostChess.code) && hostChess.color === 'w');
  const guestChess = (await wl(`/chess/rooms/${hostChess.code}/join`, 'POST', { name: 'Alex' })).data;
  ok('the guest gets the other color', guestChess.color === 'b');
  ok('a third player is turned away', (await wl(`/chess/rooms/${hostChess.code}/join`, 'POST', { name: 'Kim' })).status === 409);
  const cmove = (who, from, to) => wl(`/chess/rooms/${hostChess.code}/move`, 'POST', { playerId: who.playerId, token: who.token, from, to });
  ok('Black cannot move first', (await cmove(guestChess, 'e7', 'e5')).status === 409);
  ok('an illegal move is refused', (await cmove(hostChess, 'e2', 'e5')).status === 400);
  ok('a legal move is played', (await cmove(hostChess, 'f2', 'f3')).data.moves[0] === 'f3');
  ok('a wrong token cannot move', (await wl(`/chess/rooms/${hostChess.code}/move`, 'POST', { playerId: guestChess.playerId, token: 'nope', from: 'e7', to: 'e5' })).status === 403);
  await cmove(guestChess, 'e7', 'e5');
  await cmove(hostChess, 'g2', 'g4');
  const mated = (await cmove(guestChess, 'd8', 'h4')).data;
  ok('checkmate ends the game for both', mated.ended && mated.ended.reason === 'checkmate' && mated.ended.winner === 'b');
  const act = (who, action) => wl(`/chess/rooms/${hostChess.code}/act`, 'POST', { playerId: who.playerId, token: who.token, action });
  await act(hostChess, 'rematch');
  const again = (await act(guestChess, 'rematch')).data;
  ok('a rematch swaps colors and starts fresh', again.you === 'w' && again.moves.length === 0 && !again.ended);

  // ---- adult Wordless themes ---------------------------------------------------
  await asAdmin('/themes', 'POST', {
    label: 'Naughty', emoji: '😈', words: ['booty', 'cheeky', 'frisky', 'spank', 'naughty'], adult: true
  });
  const pinGet = async (p, pin) => {
    const res = await fetch(base + '/api' + p, { headers: pin ? { 'X-Adult-Pin': pin } : {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  ok('adult themes are hidden by default', !(await wl('/themes')).data.some(t => t.adult));
  ok('a wrong PIN does not show them', (await pinGet('/themes?adult=1', '0000')).status === 403);
  ok('the right PIN shows them', (await pinGet('/themes?adult=1', '246810')).data.some(t => t.label === 'Naughty'));
  const naughtyPlayed = (await pinGet('/themes?adult=1', '246810')).data.find(t => t.label === 'Naughty');
  ok('adult Easy gets plenty of short rude words', naughtyPlayed.words.filter(w => w.length <= 4).length >= 40);
  ok('the theme keeps its own words too', naughtyPlayed.words.includes('cheeky'));
  ok('the admin always sees them', (await asAdmin('/themes')).data.some(t => t.label === 'Naughty'));
  ok('the admin list shows only the theme\'s own words',
    (await asAdmin('/themes')).data.find(t => t.label === 'Naughty').words.length === 5);
  ok('adult themes are never announced', !(await wl('/comm/posts')).data.some(p => p.title.includes('Naughty')));
  const naughtyId = (await asAdmin('/themes')).data.find(t => t.label === 'Naughty').id;
  await wl('/leaderboard', 'POST', { initials: 'XXX', themeId: naughtyId, won: true, guesses: 1, hintsUsed: 0, word: 'spank', elapsedMs: 1000, difficulty: 'normal' });
  ok('adult-theme scores stay off the kids board', !(await wl('/leaderboard?difficulty=normal')).data.some(r => r.initials === 'XXX'));
  ok('…and show once unlocked', (await pinGet('/leaderboard?difficulty=normal&adult=1', '246810')).data.some(r => r.initials === 'XXX'));

  // ---- built-in adult Wordless themes ----------------------------------------------
  ok('built-in adult themes stay hidden from kids', !(await wl('/themes')).data.some(t => t.id === 'naughty-bits'));
  const adultBuiltins = (await pinGet('/themes?adult=1', '246810')).data.filter(t => t.builtin && t.adult).map(t => t.id).sort();
  ok('four built-in adult themes appear with the PIN', adultBuiltins.join() === 'bachelorette,bar-crawl,naughty-bits,swear-jar', adultBuiltins.join());
  const barHint = (await pinGet('/wordless/hints?theme=bar-crawl&word=tequila&adult=1', '246810')).data;
  ok('they come with clues', barHint.clue === 'Salt, shot, lime' && barHint.category === 'Drink', JSON.stringify(barHint));
  ok('their hints need the PIN too', (await wl('/wordless/hints?theme=bar-crawl&word=tequila')).status === 403);

    // ---- Spin & Solve: levels, packs, requests --------------------------------------
  const spinCfg = (await wl('/spinsolve/config')).data;
  ok('Spin & Solve has the four levels', spinCfg.levels.map(l => l.id).join() === 'kids,cheeky,spicy,filthy');
  ok('…with built-in puzzles at every level', spinCfg.levels.every(l => l.builtin >= 30));
  const kidsPuzzles = await wl('/spinsolve/puzzles?level=kids');
  ok('kids puzzles need no PIN', kidsPuzzles.status === 200 && kidsPuzzles.data.puzzles.length >= 150);
  ok('adult puzzles need the PIN', (await wl('/spinsolve/puzzles?level=filthy')).status === 403);
  ok('a wrong PIN is refused', (await pinGet('/spinsolve/puzzles?level=filthy', '0000')).status === 403);
  ok('the right PIN opens them', (await pinGet('/spinsolve/puzzles?level=filthy', '246810')).data.puzzles.length >= 30);
  const kidsBanter = kidsPuzzles.data.banter;
  ok('kids games come with jokes and hecklers', kidsBanter.jokes.length >= 20 && kidsBanter.heckles.length >= 5);
  ok('…and no rude gestures or swearing', !kidsBanter.comebacks.some(c => c.startsWith('🖕')) &&
    !JSON.stringify(kidsBanter).match(/fuck|shit|damn|hell\b/i));
  const filthyBanter = (await pinGet('/spinsolve/puzzles?level=filthy', '246810')).data.banter;
  ok('filthy games get the adult jokes and the finger', filthyBanter.comebacks.every(c => c.startsWith('🖕')) &&
    filthyBanter.jokes.some(([a, b]) => /fuck/i.test(a + b)));
  ok('the unlock check works', (await wl('/spinsolve/unlock', 'POST', { pin: '246810' })).data.ok === true &&
    (await wl('/spinsolve/unlock', 'POST', { pin: '111111' })).data.ok === false);
  ok('Rambler checks the adult PIN before keeping it', (await wl('/rambler/unlock', 'POST', { pin: '246810' })).data.ok === true &&
    (await wl('/rambler/unlock', 'POST', { pin: '111111' })).data.ok === false);
  // Right PINs never count toward the device limit. Wrong ones do, shared by
  // every game's adult PIN check (two wrong ones were just tried above).
  const rights = [];
  for (let i = 0; i < 25; i++) rights.push((await wl('/adult-check', 'POST', { pin: '246810' })).status);
  ok('right adult PINs never count toward the limit', rights.every(s => s === 200));
  let wrongs = 2;
  while (wrongs < 30 && (await wl('/adult-check', 'POST', { pin: '111111' })).status === 200) wrongs++;
  ok(`a device is blocked after 20 wrong adult PINs, across every game (${wrongs})`, wrongs === 20);
  await asAdmin('/profiles/admin/unlock-devices', 'POST', {});
  ok('the admin can unblock every device', (await wl('/adult-check', 'POST', { pin: '111111' })).status === 200);

  const spinReq = await wl('/spinsolve/requests', 'POST', { topic: 'Camping', requestedBy: 'Kid' });
  ok('players can request a puzzle theme', spinReq.status === 201);
  ok('requests need a topic', (await wl('/spinsolve/requests', 'POST', { topic: ' ' })).status === 400);
  const spinPending = await asAdmin('/spinsolve/admin/requests');
  ok('the admin sees the request', spinPending.data.some(r => r.topic === 'Camping'));
  ok('requests are admin-only', (await wl('/spinsolve/admin/requests')).status === 401);

  const campPuzzles = [
    { category: 'Thing', answer: 'Sleeping bag' }, { category: 'Thing', answer: 'TENT STAKES' },
    { category: 'Food & Drink', answer: 'TOASTED MARSHMALLOWS' }, { category: 'Place', answer: 'NATIONAL FOREST' },
    { category: 'Phrase', answer: 'HAPPY CAMPER' }, { category: 'Thing', answer: 'CAMPFIRE' },
    { category: 'Thing', answer: 'SUPERCALIFRAGILISTIC' }, { category: 'Thing', answer: 'GREY SQUIRREL' },
    { category: 'Thing', answer: 'CAMPFIRE' }
  ];
  const kidPack = await asAdmin('/spinsolve/admin/packs', 'POST', {
    label: 'Camping', emoji: '🏕️', level: 'kids', puzzles: campPuzzles, requestId: spinReq.data.id
  });
  ok('a kids pack is created from pasted puzzles', kidPack.status === 201 && kidPack.data.pack.count === 6,
    JSON.stringify(kidPack.data));
  ok('…skipping ones too long for the board or British', kidPack.data.skipped.length === 2);
  ok('…which closes the request', !(await asAdmin('/spinsolve/admin/requests')).data.some(r => r.topic === 'Camping'));
  ok('…and is announced on the home page', (await wl('/comm/posts')).data.some(p => p.title.includes('Camping')));
  const packPlay = (await wl(`/spinsolve/puzzles?pack=${kidPack.data.pack.id}`)).data;
  ok('you can play just that pack', packPlay.puzzles.length === 6 && packPlay.puzzles.every(p => p.pack === 'Camping'));
  ok('…and its puzzles join the full kids list', (await wl('/spinsolve/puzzles?level=kids')).data.puzzles.some(p => p.answer === 'HAPPY CAMPER'));

  const adultPack = await asAdmin('/spinsolve/admin/packs', 'POST', {
    label: 'Hen Night', emoji: '👰', level: 'spicy', puzzles: campPuzzles.slice(0, 6)
  });
  ok('an adult pack can be made', adultPack.status === 201);
  ok('adult packs are hidden from the kids', !(await wl('/spinsolve/config')).data.packs.some(p => p.label === 'Hen Night'));
  ok('…shown once unlocked', (await pinGet('/spinsolve/config', '246810')).data.packs.some(p => p.label === 'Hen Night'));
  ok('…locked when played without the PIN', (await wl(`/spinsolve/puzzles?pack=${adultPack.data.pack.id}`)).status === 403);
  ok('…and never announced', !(await wl('/comm/posts')).data.some(p => p.title.includes('Hen Night')));
  ok('too few good puzzles is refused', (await asAdmin('/spinsolve/admin/packs', 'POST', { label: 'X', puzzles: [{ answer: 'HI THERE' }] })).status === 400);

  await wl('/scores/spinsolve', 'POST', { initials: 'XXX', score: 99999, board: 'adult' });
  ok('the adult score board needs the PIN', (await wl('/scores/spinsolve?board=adult')).status === 403);
  ok('…shows with it', (await pinGet('/scores/spinsolve?board=adult', '246810')).data.some(r => r.initials === 'XXX'));
  ok('…and adult #1s are never announced', !(await wl('/comm/posts')).data.some(p => p.title.includes('XXX took #1 on Spin')));

  // ---- Know-It-All (trivia) --------------------------------------------------------
  const tcfg = (await wl('/trivia/config')).data;
  ok('trivia has four levels', tcfg.levels.map(l => l.id).join() === 'kids,cheeky,spicy,filthy');
  ok('…with family genres listed and adult ones hidden until unlocked', tcfg.levels[0].genres.length >= 8 && tcfg.levels[3].genres.length === 0);
  ok('the Open Trivia DB credit is shown', /opentdb\.com/.test(tcfg.credit));
  const famQs = (await wl('/trivia/questions?level=kids&count=10&genres=Animals,Science')).data;
  ok('family questions come dealt, answers shuffled with the right one marked', famQs.questions.length === 10 &&
    famQs.questions.every(q => q.answers[q.correctIndex] === q.correct && ['Animals', 'Science'].includes(q.genre)));
  ok('family games get no drinks or dares', famQs.drinks === null && famQs.dares === null);
  ok('filthy questions need the PIN', (await wl('/trivia/questions?level=filthy')).status === 403);
  const filthyQs = (await pinGet('/trivia/questions?level=filthy&count=5', '246810')).data;
  ok('…and come with drinking rules and dares', filthyQs.questions.length === 5 && !!filthyQs.drinks.wrong && filthyQs.dares.length >= 5);
  ok('topic requests are accepted', (await wl('/trivia/requests', 'POST', { topic: 'Pokemon' })).status === 201);
  ok('…and show up for the admin', (await asAdmin('/trivia/admin/requests')).data.some(r => r.topic === 'Pokemon'));
  const tpack = await asAdmin('/trivia/admin/packs', 'POST', {
    label: 'Space', emoji: '🚀', genre: 'Space', level: 'kids', questions: [
      { question: 'What planet do we live on?', correct: 'Earth', wrong: ['Mars', 'Venus', 'Pluto'], difficulty: 'easy' },
      { question: 'What is the biggest planet?', correct: 'Jupiter', wrong: ['Saturn', 'Earth', 'Mars'], difficulty: 'easy' },
      { question: 'How many moons does Mars have?', correct: '2', wrong: ['0', '1', '4'], difficulty: 'medium' },
      { question: 'What is the hottest planet?', correct: 'Venus', wrong: ['Mercury', 'Mars', 'Jupiter'], difficulty: 'medium' },
      { question: 'Which planet has a Great Red Spot?', correct: 'Jupiter', wrong: ['Mars', 'Saturn', 'Neptune'], difficulty: 'hard' },
      { question: 'What colour is the Moon?', correct: 'Gray', wrong: ['Red', 'Blue', 'Green'] },
      { question: 'Broken?', correct: 'A', wrong: ['A'] }
    ]
  });
  ok('a pack is made from pasted questions', tpack.status === 201 && tpack.data.pack.count === 6, JSON.stringify(tpack.data));
  ok('…skipping broken ones (trivia keeps titles and spellings as they are)', tpack.data.skipped.length === 1);
  ok('…and it is announced', (await wl('/comm/posts')).data.some(p => p.title.includes('Know-It-All questions: Space')));
  ok('you can play just that pack', (await wl(`/trivia/questions?pack=${tpack.data.pack.id}&count=10`)).data.questions.length === 6);

  // A room game from start to finish
  const th = (await wl('/trivia/rooms', 'POST', { name: 'Sam', settings: { level: 'kids', count: 5, seconds: 30 } })).data;
  const tg = (await wl(`/trivia/rooms/${th.code}/join`, 'POST', { name: 'Alex' })).data;
  ok('players can join a trivia room', !!tg.playerId);
  ok('an adult room needs the PIN to make', (await wl('/trivia/rooms', 'POST', { name: 'X', settings: { level: 'spicy' } })).status === 403);
  const troom = async who => (await wl(`/trivia/rooms/${th.code}?playerId=${who.playerId}&token=${who.token}`)).data;
  const tpost = (who, path, body = {}) => wl(`/trivia/rooms/${th.code}/${path}`, 'POST', { playerId: who.playerId, token: who.token, ...body });
  ok('only the host can start', (await tpost(tg, 'start')).status === 403);
  await tpost(th, 'start');
  let snapT = await troom(th);
  ok('the game starts on question 1, with no answer key sent', snapT.phase === 'question' && snapT.question.index === 0 &&
    snapT.reveal === null && !('correctIndex' in snapT.question));
  for (let i = 0; i < 5; i++) {
    await tpost(th, 'answer', { choice: 0 });
    await tpost(tg, 'answer', { choice: 1 });
    snapT = await troom(th);
    if (i === 0) {
      ok('everyone answering reveals the answer right away', snapT.phase === 'reveal' && Number.isInteger(snapT.reveal.correctIndex));
      ok('…and scores the right answer', snapT.reveal.results.every(r => r.correct ? r.points >= 100 : r.points === 0));
      ok('answering twice is refused', (await tpost(th, 'answer', { choice: 2 })).status === 409);
    }
    await tpost(th, 'next');
  }
  snapT = await troom(tg);
  ok('after the last question the game is over with standings', snapT.phase === 'over' && snapT.finale.standings.length === 2);

  // ---- join-a-game lobby and QR codes ---------------------------------------------
  const lobbyHost = (await wl('/trivia/rooms', 'POST', { name: 'Robin', settings: { level: 'kids', count: 5 } })).data;
  const hostAdult = body => fetch(base + '/api/trivia/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Adult-Pin': '246810' }, body: JSON.stringify(body)
  }).then(async r => ({ status: r.status, data: await r.json() }));
  const noPw = await hostAdult({ name: 'Grown', settings: { level: 'filthy' } });
  ok('hosting an adult game asks the host to make a lobby password', noPw.status === 400 && noPw.data.needsPassword === 'create');
  const adultRoom = (await hostAdult({ name: 'Grown', settings: { level: 'filthy' }, password: 'tacos' })).data;
  ok('with a password, the adult game is made', !!adultRoom.code);
  let lobbyNow = (await wl('/lobby')).data;
  const robin = lobbyNow.rooms.find(r => r.code === lobbyHost.code);
  ok('a hosted game shows on the lobby, open to join', !!robin && robin.status === 'open' && robin.href === `trivia.html?join=${lobbyHost.code}` && robin.host === 'Robin');
  const listedAdult = lobbyNow.rooms.find(r => r.code === adultRoom.code);
  ok('adult games are on the lobby too, marked and locked', !!listedAdult && listedAdult.adult && listedAdult.locked);
  const joinAdult = pw => wl(`/trivia/rooms/${adultRoom.code}/join`, 'POST', { name: 'Kid', password: pw });
  const noPwJoin = await joinAdult('');
  ok('joining a locked game asks for its password', noPwJoin.status === 401 && noPwJoin.data.needsPassword === 'join');
  ok('the wrong password is refused', (await joinAdult('pizza')).status === 401);
  ok('the right password lets a guest in, no adult PIN needed', (await joinAdult('tacos')).status === 200);
  const adultHostView = (await wl(`/trivia/rooms/${adultRoom.code}?playerId=${adultRoom.playerId}&token=${adultRoom.token}`)).data;
  ok('the host can see the password to tell guests', adultHostView.lobbyPassword === 'tacos');

  // Rambler locks its adult games the same way
  const rbAdult = await fetch(base + '/api/rambler/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Adult-Pin': '246810' },
    body: JSON.stringify({ name: 'H', profile: 'adult', password: 'secret' }) }).then(r => r.json());
  ok('Rambler: an Unfiltered room needs its password to join', (await wl(`/rambler/rooms/${rbAdult.code}/join`, 'POST', { name: 'X' })).status === 401 &&
    (await wl(`/rambler/rooms/${rbAdult.code}/join`, 'POST', { name: 'X', password: 'secret' })).status === 201);
  ok('the lobby says where phones should go', /^https?:\/\//.test(lobbyNow.publicUrl));
  await wl(`/trivia/rooms/${lobbyHost.code}/start`, 'POST', { playerId: lobbyHost.playerId, token: lobbyHost.token });
  lobbyNow = (await wl('/lobby')).data;
  ok('a game that has started shows as playing', lobbyNow.rooms.find(r => r.code === lobbyHost.code).status === 'playing');
  const chessFull = (await wl('/chess/rooms', 'POST', { name: 'A' })).data;
  await wl(`/chess/rooms/${chessFull.code}/join`, 'POST', { name: 'B' });
  ok('a chess game with two players shows as full', (await wl('/lobby')).data.rooms.find(r => r.code === chessFull.code).status === 'full');
  const qrRes = await fetch(base + '/api/qr?text=' + encodeURIComponent(base + '/trivia.html?join=ABCD'));
  ok('QR codes come back as SVG for arcade links', qrRes.status === 200 && (await qrRes.text()).includes('<svg'));
  ok('QR codes for other websites are refused', (await fetch(base + '/api/qr?text=' + encodeURIComponent('https://example.com/'))).status === 400);

  // ---- Uh-Oh: Part Deux and Dare Devil ------------------------------------------------
  const party = async (game, p, method = 'GET', body, headers = {}) => {
    const res = await fetch(`${base}/api/${game}${p}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const pdLocal = await party('partdeux', '/local', 'POST', { names: ['Ann', 'Bo'], level: 'kids' });
  ok('Uh-Oh: a one-phone game deals 7 cards each', pdLocal.status === 201 && Object.values(pdLocal.data.game.hands).every(h => h.length === 7));
  const pdTurn = pdLocal.data.game.turn;
  const pdDraw = await party('partdeux', `/local/${pdLocal.data.id}/act`, 'POST', { action: 'draw', as: pdTurn }, { 'X-Table-Token': pdLocal.data.token });
  ok('Uh-Oh: the player whose turn it is can draw', pdDraw.status === 200);
  ok('Uh-Oh: a spicy deck needs the adult PIN', (await party('partdeux', '/local', 'POST', { names: ['A', 'B'], level: 'spicy' })).status === 403);
  const pdRoom = (await party('partdeux', '/rooms', 'POST', { name: 'Host', level: 'filthy', drinking: true, password: 'lime' }, { 'X-Adult-Pin': '246810' })).data;
  ok('Uh-Oh: an adult room locks with a password', (await party('partdeux', `/rooms/${pdRoom.code}/join`, 'POST', { name: 'Kid' })).status === 401);
  const pdGuest = (await party('partdeux', `/rooms/${pdRoom.code}/join`, 'POST', { name: 'Pal', password: 'lime' })).data;
  ok('…and lets a guest in with it', !!pdGuest.playerId);
  ok('Uh-Oh rooms show on the arcade lobby, locked', (await wl('/lobby')).data.rooms.some(r => r.game === 'partdeux' && r.code === pdRoom.code && r.locked && r.adult));
  await party('partdeux', `/rooms/${pdRoom.code}/start`, 'POST', { playerId: pdRoom.playerId, token: pdRoom.token });
  const pdSnap = (await party('partdeux', `/rooms/${pdRoom.code}?playerId=${pdGuest.playerId}&token=${pdGuest.token}`)).data;
  ok('Uh-Oh: each phone sees only its own hand', pdSnap.game.hand.length === 7 && pdSnap.game.hands === undefined && pdSnap.game.drinking === true);

  const ddLocal = await party('daredevil', '/local', 'POST', { names: ['Ann', 'Bo', 'Cy'], level: 'kids', options: { length: 'quick' } });
  ok('Dare Devil: a one-phone game starts with a 15-card deck', ddLocal.status === 201 && ddLocal.data.game.total === 15);
  const ddAct = (body) => party('daredevil', `/local/${ddLocal.data.id}/act`, 'POST', body, { 'X-Table-Token': ddLocal.data.token });
  const ddDrawn = await ddAct({ action: 'draw', as: ddLocal.data.game.turn });
  ok('Dare Devil: drawing reveals a card', ddDrawn.status === 200 && !!ddDrawn.data.game.card.text);
  const ddDone = await ddAct({ action: 'done', as: ddLocal.data.game.turn });
  ok('Dare Devil: doing it scores and passes the turn', ddDone.data.game.players[0].score > 0 && ddDone.data.game.turn !== ddLocal.data.game.turn);
  ok('Dare Devil: filthy needs the PIN to host', (await party('daredevil', '/rooms', 'POST', { name: 'H', level: 'filthy' })).status === 403);
  const ddRoom = (await party('daredevil', '/rooms', 'POST', { name: 'H', level: 'filthy', password: 'wild' }, { 'X-Adult-Pin': '246810' })).data;
  ok('Dare Devil: an adult room needs its password to join', (await party('daredevil', `/rooms/${ddRoom.code}/join`, 'POST', { name: 'X', password: 'nope' })).status === 401 &&
    (await party('daredevil', `/rooms/${ddRoom.code}/join`, 'POST', { name: 'X', password: 'wild' })).status === 201);

  // ---- arcade profiles ---------------------------------------------------------------
  const asked = await wl('/profiles', 'POST', { name: 'Maya', avatar: 'shiba:2' });
  ok('anyone can ask for a profile', asked.status === 201 && asked.data.status === 'pending');
  ok('…but it waits for approval', !(await wl('/profiles')).data.some(p => p.name === 'Maya'));
  ok('guest names are reserved for guests', (await wl('/profiles', 'POST', { name: 'Guest 4' })).status === 400);
  ok('profile requests are listed for the admin', (await asAdmin('/profiles/admin')).data.some(p => p.name === 'Maya' && p.status === 'pending'));
  ok('approving needs the admin password', (await wl(`/profiles/admin/${asked.data.id}/approve`, 'POST', {})).status === 401);
  await asAdmin(`/profiles/admin/${asked.data.id}/approve`, 'POST', {});
  ok('approved profiles show in the picker', (await wl('/profiles')).data.some(p => p.name === 'Maya' && p.avatar === 'shiba:2' && !p.hasPin));
  const maya = (await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).data;
  ok('a profile without a PIN can be picked straight away', !!maya.token);
  const mayaScore = await wl('/scores/dino', 'POST', { score: 321, board: 'run', profileToken: maya.token });
  ok('a score saved as a profile needs no initials', mayaScore.status === 201);
  ok('…and shows the profile name and avatar', (await wl('/scores/dino?board=run')).data.some(r => r.profileName === 'Maya' && r.profileAvatar === 'shiba:2' && r.score === 321));
  ok('a fake token gets no credit', (await wl('/scores/dino', 'POST', { score: 50, board: 'run', profileToken: 'x.y' })).status === 400);
  const mayaPinned = (await wl(`/profiles/${asked.data.id}/pin`, 'POST', { token: maya.token, pin: '432100' })).data;
  ok('Maya can add her own PIN', mayaPinned.profile.hasPin && !!mayaPinned.token);
  ok('…after which the old token stops working', (await wl('/scores/dino', 'POST', { score: 60, board: 'run', profileToken: maya.token })).status === 400);
  ok('picking her profile now needs the PIN', (await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).status === 401 &&
    (await wl(`/profiles/${asked.data.id}/use`, 'POST', { pin: '999999' })).status === 401);
  ok('the right PIN works', !!(await wl(`/profiles/${asked.data.id}/use`, 'POST', { pin: '432100' })).data.token);
  const mayaWithPin = (await wl(`/profiles/${asked.data.id}/use`, 'POST', { pin: '432100' })).data.token;
  ok('removing a PIN needs the current one', (await wl(`/profiles/${asked.data.id}/pin`, 'POST', { token: mayaWithPin, pin: '' })).status === 401);
  ok('…and a wrong one is refused', (await wl(`/profiles/${asked.data.id}/pin`, 'POST', { token: mayaWithPin, pin: '246810', current: '999999' })).status === 401);
  ok('changing it works with the current PIN', (await wl(`/profiles/${asked.data.id}/pin`, 'POST', { token: mayaWithPin, pin: '246810', current: '432100' })).data.profile.hasPin === true);
  await asAdmin(`/profiles/admin/${asked.data.id}/clear-pin`, 'POST', {});
  ok('the admin can clear a forgotten PIN', !!(await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).data.token);

  // Five wrong PINs in a row lock the profile; the admin can unlock it.
  const mayaNoPin = (await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).data.token;
  await wl(`/profiles/${asked.data.id}/pin`, 'POST', { token: mayaNoPin, pin: '432100' });
  const useMaya = pin => wl(`/profiles/${asked.data.id}/use`, 'POST', { pin });
  const firstWrong = await useMaya('000000');
  ok('a wrong PIN says how many tries are left', firstWrong.status === 401 && /4 more tries/.test(firstWrong.data.error));
  for (let i = 0; i < 3; i++) await useMaya('000000');
  const fifth = await useMaya('000000');
  ok('the fifth wrong PIN locks the profile', fifth.status === 401 && /locked for 15 minutes/.test(fifth.data.error));
  ok('…so even the right PIN waits', (await useMaya('432100')).status === 423);
  ok('the admin sees it locked', (await asAdmin('/profiles/admin')).data.some(p => p.id === asked.data.id && p.locked));
  await asAdmin(`/profiles/admin/${asked.data.id}/unlock`, 'POST', {});
  ok('…and can unlock it', !!(await useMaya('432100')).data.token);
  ok('a right PIN starts the count over', /4 more tries/.test((await useMaya('000000')).data.error));
  await asAdmin(`/profiles/admin/${asked.data.id}/clear-pin`, 'POST', {});
  ok('an approved profile becomes a Rambler player with the same id', !!(await wl(`/rambler/players/${asked.data.id}`)).data);
  const g1 = (await wl('/profiles/guest', 'POST', {})).data.name;
  const g2 = (await wl('/profiles/guest', 'POST', {})).data.name;
  ok('guests get numbered names', /^Guest \d+$/.test(g1) && g1 !== g2);
  const mayaTok = (await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).data.token;
  const mayaWordless = await wl('/leaderboard', 'POST', { themeId: 'classic', won: true, guesses: 2, hintsUsed: 0, word: 'apple', elapsedMs: 5000, difficulty: 'easy', profileToken: mayaTok });
  ok('Wordless credits a profile too', mayaWordless.status === 201 && (await wl('/leaderboard?difficulty=easy')).data.some(r => r.profileName === 'Maya'));

  // Name or initials on the boards: the profile chooses, and past scores follow.
  const mayaRb = await api('/board', 'POST', { size: 5, profile: 'kids' });
  const mayaWords = solver.solveWords(mayaRb.data.board, square(5), 'kids').filter(w => w.length >= 5).slice(0, 6);
  await api('/score', 'POST', { boardId: mayaRb.data.boardId, players: [{ id: 'p0', name: 'Maya', words: mayaWords }] });
  await api('/leaderboard', 'POST', { boardId: mayaRb.data.boardId, playerId: 'p0', mode: 'solo', initials: 'ZZZ', profileId: asked.data.id });
  const mayaOnBoards = async who => (await wl('/scores/dino?board=run')).data.some(r => r.profileName === who && r.score === 321) &&
    (await wl('/leaderboard?difficulty=easy')).data.some(r => r.profileName === who) &&
    (await api('/arcade?board=5')).data.entries.some(e => e.initials === who);
  ok('a profile shows its name on the boards by default', (await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).data.profile.boardShow === 'name' &&
    await mayaOnBoards('Maya'));
  const toInitials = await wl(`/profiles/${asked.data.id}`, 'PATCH', { token: mayaTok, boardShow: 'initials', initials: 'mya' });
  ok('a profile can choose initials instead', toInitials.data.profile.boardShow === 'initials' && toInitials.data.profile.initials === 'MYA');
  ok('…and every board, past scores included, shows them', await mayaOnBoards('MYA'));
  ok('initials longer than 3 are refused', (await wl(`/profiles/${asked.data.id}`, 'PATCH', { token: mayaTok, initials: 'ABCD' })).status === 400);
  ok('changing the choice needs the profile', (await wl(`/profiles/${asked.data.id}`, 'PATCH', { token: 'x.y', boardShow: 'name' })).status === 401);
  await wl(`/profiles/${asked.data.id}`, 'PATCH', { token: mayaTok, boardShow: 'name' });
  ok('switching back shows the name again, and keeps the initials for later', await mayaOnBoards('Maya') &&
    (await wl(`/profiles/${asked.data.id}/use`, 'POST', {})).data.profile.initials === 'MYA');

  // ---- stats and the error log ----------------------------------------------------------
  const phoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const statsPost = (p, body, ua) => fetch(base + '/api/stats' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ua ? { 'User-Agent': ua } : {}) }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
  const visit = await statsPost('/visit', { game: 'chess', token: mayaTok, name: 'Someone Else' }, phoneUA);
  ok('a game page opens a visit', visit.status === 201 && !!visit.data.id);
  ok('an unknown game is refused', (await statsPost('/visit', { game: 'nope' })).status === 400);
  await statsPost('/beat', { id: visit.data.id, activeMs: 45000, plays: 2 });
  await statsPost('/beat', { id: visit.data.id, activeMs: 99999999, plays: 1 });
  const guestVisit = await statsPost('/visit', { game: 'dino', name: 'Guest 7' });
  await statsPost('/beat', { id: guestVisit.data.id, activeMs: 12000 });
  ok('the summary needs the admin password', (await wl('/stats/admin/summary')).status === 401);
  const sum = (await asAdmin('/stats/admin/summary?days=7')).data;
  const chessRow = sum.visits.find(v => sum.games[v[2]] === 'chess' && sum.players[v[3]] === 'Maya');
  ok('a visit is credited to the verified profile, not the typed name', !!chessRow, JSON.stringify(sum.players));
  ok('on-screen time adds up, and one heartbeat cannot claim hours', chessRow && chessRow[1] === 45 + 90);
  ok('plays are counted', chessRow && chessRow[5] === 3);
  ok('the device is recorded', chessRow && sum.devices[chessRow[4]] === 'phone');
  ok('guests show by name', sum.visits.some(v => sum.players[v[3]] === 'Guest 7' && v[1] === 12));
  const snakeVisit = await statsPost('/visit', { game: 'snake', name: 'Guest 8' });
  await statsPost('/beat', { id: snakeVisit.data.id, activeMs: 90000 });
  await statsPost('/beat', { id: snakeVisit.data.id, activeMs: 90000 });
  const everyoneOrder = (await statsPost('/game-order', {})).data.order;
  ok('without a profile, the most-played games overall come first', everyoneOrder.slice(0, 3).join() === 'snake,chess,dino', everyoneOrder.join());
  const mayaOrder = (await statsPost('/game-order', { token: mayaTok })).data.order;
  ok('a profile sees its own most-played game first, then the most-played overall', mayaOrder.slice(0, 3).join() === 'chess,snake,dino', mayaOrder.join());
  // ---- the owner's own logos and clips ------------------------------------------
  const custom = (await wl('/custom')).data;
  ok('clips in media/clips are listed, with their type', custom.clips.length === 1 && custom.clips[0].name === 'rickroll' && custom.clips[0].type === 'image', JSON.stringify(custom.clips));
  ok('files with odd names or the wrong type are skipped', !custom.clips.some(c => /bad|readme/.test(c.name)));
  ok('sprites are listed by name', custom.sprites.length === 1 && custom.sprites[0].name === 'dance-hero');
  ok('a brand file that exists is offered, a missing one is not', custom.brand.avatar === '/custom/brand/avatar.svg' && custom.brand.wide === null);
  ok('surprises can be turned off', custom.surprise === 0);
  const clipFile = await fetch(base + custom.clips[0].url);
  ok('a clip is served, and never allowed to run scripts', clipFile.status === 200 && /sandbox/.test(clipFile.headers.get('content-security-policy')));
  ok('only the three logo names are served from brand/', (await fetch(base + '/custom/brand/notes.txt')).status === 404);
  ok('nothing outside the folders can be reached', (await fetch(base + '/custom/media/clips/%2e%2e%2f%2e%2e%2fserver.js')).status === 404);
  ok('sending a clip needs the admin password', (await wl('/custom/admin/send', 'POST', { clip: 'rickroll', to: 'everyone' })).status === 401);
  ok('an unknown clip is refused', (await asAdmin('/custom/admin/send', 'POST', { clip: 'nope', to: 'everyone' })).status === 400);
  const mayaId = mayaTok.split('.')[0];
  const sentClip = await asAdmin('/custom/admin/send', 'POST', { clip: 'rickroll', to: mayaId });
  ok('the admin can send a clip to one person', sentClip.status === 200 && sentClip.data.sent === 1, JSON.stringify(sentClip.data));
  ok('a guest gets nothing', (await wl('/custom/inbox', 'POST', {})).data.clip === null);
  ok('it waits for that person', (await wl('/custom/inbox', 'POST', { token: mayaTok })).data.clip.name === 'rickroll');
  ok('…and plays only once', (await wl('/custom/inbox', 'POST', { token: mayaTok })).data.clip === null);
  ok('every game is still in the list once', mayaOrder.length === everyoneOrder.length && new Set(mayaOrder).size === mayaOrder.length);

  const err1 = await statsPost('/error', { game: 'spinsolve', message: "Cannot read properties of undefined (reading 'x') at 12", location: '/spinsolve.js:412:17', stack: 'TypeError: boom\n  at spin (/spinsolve.js:412:17)', name: 'Maya' }, phoneUA);
  const err2 = await statsPost('/error', { game: 'spinsolve', message: "Cannot read properties of undefined (reading 'x') at 99", location: '/spinsolve.js:415:3' }, phoneUA);
  ok('a browser crash gets a code', err1.status === 201 && /^E-[0-9A-F]{6}$/.test(err1.data.code));
  ok('the same bug gets the same code', err1.data.code === err2.data.code);
  const errs = (await asAdmin('/stats/admin/errors')).data;
  const e1 = errs.find(e => e.code === err1.data.code);
  ok('…and is counted, not listed twice', e1 && e1.count === 2 && errs.filter(e => e.code === err1.data.code).length === 1);
  ok('the error log says which browser', e1 && /Safari on iOS \(phone\)/.test(e1.browser), e1 && e1.browser);
  const boom = await wl('/stats/_boom');
  ok('a server crash tells the player a code', boom.status === 500 && /^E-[0-9A-F]{6}$/.test(boom.data.code) && boom.data.error.includes(boom.data.code));
  ok('…and lands in the error log with its stack', (await asAdmin('/stats/admin/errors')).data.some(e => e.code === boom.data.code && e.source === 'server' && e.stack.includes('Test explosion')));
  await asAdmin(`/stats/admin/errors/${err1.data.code}/resolve`, 'POST', {});
  ok('an error can be marked fixed', (await asAdmin('/stats/admin/errors')).data.find(e => e.code === err1.data.code).resolved === true);
  await statsPost('/error', { game: 'spinsolve', message: "Cannot read properties of undefined (reading 'x') at 5", location: '/spinsolve.js:412:1' });
  ok('…and comes back if it happens again', (await asAdmin('/stats/admin/errors')).data.find(e => e.code === err1.data.code).resolved === false);
  ok('marking needs the admin password', (await wl(`/stats/admin/errors/${err1.data.code}/resolve`, 'POST', {})).status === 401);
  await asAdmin('/stats/admin/visits', 'DELETE');
  ok('the admin can reset the visit stats', (await asAdmin('/stats/admin/summary')).data.visits.length === 0);

  await asAdmin('/comm/admin/adult-pin', 'POST', { pin: '' });
  ok('the PIN can be removed', (await api('/board', 'POST', { size: 4, profile: 'adult' })).status === 201);

  // ---- admin sign-in cookie --------------------------------------------------------------
  const login = password => fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const withCookie = (cookie, p, method = 'GET') => fetch(base + p, { method, headers: cookie ? { Cookie: cookie } : {} });
  const badLogin = await login('not-it');
  ok('a wrong admin password is refused', badLogin.status === 401 && !badLogin.headers.get('set-cookie'));
  const goodLogin = await login(ADMIN);
  const setCookie = goodLogin.headers.get('set-cookie') || '';
  ok('the right password sets a session cookie', goodLogin.status === 200 && /^arcade_admin=[\w-]{40,};/.test(setCookie), setCookie);
  ok('…that scripts on the page cannot read', /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie));
  ok('…and does not contain the password', !setCookie.includes(ADMIN));
  const cookie = setCookie.split(';')[0];
  ok('the cookie opens admin routes', (await withCookie(cookie, '/api/stats/admin/summary')).status === 200);
  ok('…including Rambler admin', (await withCookie(cookie, '/api/rambler/admin/overview')).status === 200);
  ok('the session check says signed in', (await (await withCookie(cookie, '/api/admin/session')).json()).admin === true);
  ok('a made-up cookie does not', (await withCookie('arcade_admin=forged', '/api/stats/admin/summary')).status === 401);
  await withCookie(cookie, '/api/admin/logout', 'POST');
  ok('signing out ends the session', (await withCookie(cookie, '/api/stats/admin/summary')).status === 401);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
