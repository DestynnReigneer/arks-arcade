'use strict';

// The trophy page: every board on one page, your own place on each, adult
// boards locked until the PIN, and Words with Family's new boards.

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
  const trophies = (who, extra = {}) => api('/api/trophies', 'GET', null, { ...(who ? who.h : {}), ...extra });
  const boardOf = (page, game, board) => {
    const g = page.games.find(x => x.id === game);
    return g && g.boards.find(b => b.id === board);
  };

  console.log('\n-- trophies: every board on one page --');
  const ADMIN = { 'X-Admin-Token': 'test-admin-token' };
  const people = {};
  for (const name of ['Dee', 'Eli']) {
    const asked = await api('/api/profiles', 'POST', { name: `TR ${name}`, avatar: 'shiba:1' });
    await api(`/api/profiles/admin/${asked.data.id}/approve`, 'POST', {}, ADMIN);
    const used = await api(`/api/profiles/${asked.data.id}/use`, 'POST', {});
    people[name] = { id: asked.data.id, token: used.data.token, h: { 'X-Profile-Token': used.data.token } };
  }
  const { Dee, Eli } = people;
  // Earlier suites change the adult PIN, so set it here and put back what was there.
  const pinBefore = (await api('/api/comm/admin/adult-pin', 'GET', null, ADMIN)).data;
  await api('/api/comm/admin/adult-pin', 'POST', { pin: '246810' }, ADMIN);

  const guest = await trophies();
  ok('anyone can open the trophy page', guest.status === 200 && Array.isArray(guest.data.games) && guest.data.you === null, guest.text.slice(0, 200));
  const ids = guest.data.games.map(g => g.id);
  ok('every game with a board is on it', ['crisscross', 'sudoku', 'clueless', 'scuffle', 'rambler', 'tumbler', 'racer', 'bigswing', 'snake', 'chess', 'trivia', 'spinsolve']
    .every(id => ids.includes(id)), ids.join(','));
  const wwf = guest.data.games.find(g => g.id === 'crisscross');
  ok('Words with Family has its three boards', wwf && wwf.boards.map(b => b.id).join() === 'wins,best,word');
  ok('…and none of them is locked', wwf && wwf.boards.every(b => !b.locked && !b.adult));

  const lockedTrivia = boardOf(guest.data, 'trivia', 'adult');
  ok('an adult board is listed but locked without the PIN', lockedTrivia && lockedTrivia.locked && lockedTrivia.rows.length === 0);
  const wrongPin = boardOf((await trophies(null, { 'X-Adult-Pin': '000000' })).data, 'trivia', 'adult');
  ok('…a wrong PIN keeps it locked', wrongPin && wrongPin.locked);
  const rightPin = await trophies(null, { 'X-Adult-Pin': '246810' });
  ok('…the right PIN opens it', !boardOf(rightPin.data, 'trivia', 'adult').locked && rightPin.data.adultOpen === true);
  ok('the family board was never locked', !boardOf(guest.data, 'trivia', 'solo').locked);

  ok('typing the PIN on the page: a wrong one is refused', (await api('/api/trophies/unlock', 'POST', { pin: '000000' })).data.ok === false);
  ok('…and the right one works', (await api('/api/trophies/unlock', 'POST', { pin: '246810' })).data.ok === true);

  await api('/api/comm/admin/adult-pin', 'POST', { pin: '' }, ADMIN);
  ok("with no PIN set, an adult board still waits for a grown-up's tap", boardOf((await trophies()).data, 'trivia', 'adult').locked
    && !boardOf((await trophies(null, { 'X-Adult-Ok': 'yes' })).data, 'trivia', 'adult').locked);
  if (pinBefore && pinBefore.source !== 'none') await api('/api/comm/admin/adult-pin', 'POST', { pin: '246810' }, ADMIN);

  const sudoku = boardOf(guest.data, 'sudoku', 'easy');
  ok('daily games\' boards come with a Today list', sudoku && sudoku.daily && sudoku.today && Array.isArray(sudoku.today.rows));
  ok('other games\' boards don\'t', !boardOf(guest.data, 'snake', 'classic').today);

  // Dee takes #1 on Dino Dash with the most it allows; Eli is right behind.
  await api('/api/scores/dino', 'POST', { score: 9999999, board: 'run', profileToken: Dee.token });
  await api('/api/scores/dino', 'POST', { score: 9999990, board: 'run', profileToken: Eli.token });
  const dee = (await trophies(Dee)).data, eli = (await trophies(Eli)).data;
  const deeDino = boardOf(dee, 'dino', 'run'), eliDino = boardOf(eli, 'dino', 'run');
  ok('your own place shows on the board', deeDino.you && deeDino.you.rank === 1 && dee.you.name === 'TR Dee', JSON.stringify(deeDino.you));
  ok('…and your row is marked as yours', deeDino.rows.some(r => r.you && r.name === 'TR Dee') && !deeDino.rows.some(r => r.you && r.name !== 'TR Dee'));
  ok('the shelf counts the boards you hold', dee.shelf.gold >= 1 && dee.shelf.on >= 1 && dee.shelf.top3 >= dee.shelf.gold);
  ok('someone behind sees their real place', eliDino.you && eliDino.you.rank === 2 && eliDino.you.ahead && eliDino.you.ahead.name === 'TR Dee', JSON.stringify(eliDino.you));
  ok('the closest climb is the real gap to the one ahead', eli.closest && eli.closest.game === 'dino' && eli.closest.gap === 9 && eli.closest.name === 'TR Dee',
    JSON.stringify(eli.closest));
  ok('a guest has no shelf of their own', guest.data.shelf.on === 0 && guest.data.closest === null);

  const summary = await trophies(Dee, {});
  const small = await api('/api/trophies?summary=1', 'GET', null, Dee.h);
  ok('the top bar\'s number is the boards you\'re #1 on', small.data.gold === summary.data.shelf.gold && small.data.you === true);

  // A Words with Family game: Eli resigns, so Dee wins.
  const game = await api('/api/crisscross/games', 'POST', { kind: 'online', invite: [Eli.id] }, Dee.h);
  await api(`/api/crisscross/games/${game.data.id}/resign`, 'POST', {}, Eli.h);
  const after = (await trophies(Dee)).data;
  const won = boardOf(after, 'crisscross', 'wins');
  ok('a finished Words with Family game counts as a win', won.you && won.you.value === 1 && won.rows.some(r => r.you && r.value === 1), JSON.stringify(won));
  const lost = boardOf((await trophies(Eli)).data, 'crisscross', 'wins');
  ok('…and not for the one who resigned', !lost.you);
  ok('both players\' game scores are on Best game score', boardOf(after, 'crisscross', 'best').rows.filter(r => r.name === 'TR Dee' || r.name === 'TR Eli').length === 2);

  return { pass, fail };
}

module.exports = { run };
