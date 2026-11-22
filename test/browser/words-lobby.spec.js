'use strict';

// Shuffle Scuffle and Rambler with each player on their own device: a guest
// creates a lobby, a second device finds it in List Hosted Games and joins from
// its details card, and the host starts. Nobody types a code and none is shown.
// A third device joins the game that's already going. Then a host switches a
// lobby to the unfiltered word list, and the guest in it is moved out and told why.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

const closeHelp = async page => { const x = page.locator('.tut-x'); if (await x.isVisible().catch(() => false)) await x.click(); };

async function asGuest(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.apf')).toBeHidden();
  await closeHelp(page);
  // Rambler asks who's playing when the arcade has profiles and none is chosen.
  const carryOn = page.locator('#whoGuestBtn');
  if (await carryOn.isVisible().catch(() => false)) await carryOn.click();
  return problems;
}

// Nothing on the page is a box for a code, and nothing shows one.
async function noCodes(page) {
  await expect(page.locator('#joinCode, #joinCodeInput, #lobbyCode, #roomCode')).toHaveCount(0);
  await expect(page.locator('input.code-input:visible')).toHaveCount(0);
}

test('Shuffle Scuffle: a lobby with no code, found in List Hosted Games', async ({ browser }) => {
  test.setTimeout(60000);
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [host, joiner, late] = await Promise.all(ctxs.map(c => c.newPage()));
  // Phone and laptop run at the same time on one server, so each host has its own name.
  const who = test.info().project.name === 'phone' ? 'Wren' : 'Wren2';

  const hostProblems = await asGuest(host, '/scuffle.html');
  await host.locator('#modeSeg [data-mode="host"]').click();
  await expect(host.locator('#modeSeg [data-mode="host"]')).toContainText('Create a game lobby');
  await expect(host.locator('#goBtn')).toHaveText('Create lobby');
  await noCodes(host);
  await host.locator('#hostName').fill(who);
  await host.locator('#goBtn').click();
  await expect(host.locator('#lobby')).toBeVisible();
  await expect(host.locator('#lobbyTitle')).toHaveText('Your Shuffle Scuffle lobby');
  // The QR code is only for a TV.
  await expect(host.locator('#tvJoin')).toBeHidden();
  await noCodes(host);

  const joinProblems = await asGuest(joiner, '/scuffle.html');
  await joiner.locator('#modeSeg [data-mode="join"]').click();
  await expect(joiner.locator('#goBtn')).toBeHidden();
  await noCodes(joiner);
  const row = joiner.locator('#lobbyRows .lb-row', { hasText: `${who}'s lobby` });
  await expect(row).toContainText('1/12');
  await row.click();
  await expect(joiner.locator('#detailsTitle')).toHaveText(`${who}'s Shuffle Scuffle lobby`);
  await expect(joiner.locator('#dStatus')).toHaveText('Waiting for players');
  await expect(joiner.locator('#joinBtn')).toHaveText('Join lobby');
  await joiner.locator('#joinName').fill('Alex');
  await joiner.locator('#joinBtn').click();
  await expect(joiner.locator('#lobby')).toBeVisible();
  await expect(joiner.locator('#lobbyTitle')).toHaveText(`${who}'s Shuffle Scuffle lobby`);
  await expect(host.locator('#lobbyPlayers')).toContainText('Alex');

  await host.locator('#startBtn').click();
  await expect(host.locator('#play')).toBeVisible();
  await expect(joiner.locator('#play')).toBeVisible();

  // A third device finds the game that's already going and jumps in.
  const lateProblems = await asGuest(late, '/scuffle.html');
  await late.locator('#modeSeg [data-mode="join"]').click();
  const going = late.locator('#lobbyRows .lb-row', { hasText: `${who}'s lobby` });
  await expect(going).toContainText('Game started');
  await going.click();
  await expect(late.locator('#joinBtn')).toHaveText('Join game in progress?');
  await expect(late.locator('#dLate')).toBeVisible();
  await late.locator('#joinName').fill('Lee');
  await late.locator('#joinBtn').click();
  await expect(late.locator('#play')).toBeVisible();
  await expect(host.locator('#strip')).toContainText('Lee');

  expect(hostProblems, hostProblems.join('\n')).toEqual([]);
  expect(joinProblems, joinProblems.join('\n')).toEqual([]);
  expect(lateProblems, lateProblems.join('\n')).toEqual([]);
  for (const c of ctxs) await c.close();
});

test('Rambler: a lobby with no code, found in List Hosted Games', async ({ browser }) => {
  test.setTimeout(60000);
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [host, joiner, late] = await Promise.all(ctxs.map(c => c.newPage()));
  const who = test.info().project.name === 'phone' ? 'Robin' : 'Robin2';

  const hostProblems = await asGuest(host, '/rambler.html');
  await host.locator('#modeList .no-tv[data-mode="room"]').click();
  await expect(host.locator('#modeList .no-tv[data-mode="room"]')).toContainText('Create a game lobby');
  await expect(host.locator('#startBtn')).toHaveText('Create lobby');
  await noCodes(host);
  await host.locator('#nameInput').fill(who);
  await host.locator('#startBtn').click();
  await expect(host.locator('#lobbyScreen')).toBeVisible();
  await expect(host.locator('#lobbyTitle')).toHaveText('Your Rambler lobby');
  await expect(host.locator('#tvJoin')).toBeHidden();
  await noCodes(host);

  const joinProblems = await asGuest(joiner, '/rambler.html');
  await joiner.locator('#modeList [data-mode="find"]').click();
  await expect(joiner.locator('#modeList [data-mode="find"]')).toContainText('List Hosted Games');
  // The list replaces the game's own settings and its start button.
  await expect(joiner.locator('#startBtn')).toBeHidden();
  await expect(joiner.locator('#sizeSeg')).toBeHidden();
  await noCodes(joiner);
  const row = joiner.locator('#hostedRows .hosted-row', { hasText: `${who}'s lobby` });
  await expect(row).toContainText('1/8');
  await row.click();
  await expect(joiner.locator('#hostedTitle')).toHaveText(`${who}'s Rambler lobby`);
  await expect(joiner.locator('#hStatus')).toHaveText('Waiting for players');
  await expect(joiner.locator('#hostedJoinBtn')).toHaveText('Join lobby');
  await joiner.locator('#hostedName').fill('Alex');
  await joiner.locator('#hostedJoinBtn').click();
  await expect(joiner.locator('#lobbyScreen')).toBeVisible();
  await expect(joiner.locator('#lobbyTitle')).toHaveText(`${who}'s Rambler lobby`);
  await expect(host.locator('#lobbyRoster')).toContainText('Alex');

  // Leaving a lobby goes back to setup (on a phone, its first step: one tap on List Hosted Games
  // shows the list again), and the lobby can be joined again.
  await joiner.locator('#leaveRoomBtn').click();
  await expect(joiner.locator('#setupScreen')).toBeVisible();
  if (await joiner.locator('#setupScreen.on-step-1').count()) await joiner.locator('#modeList [data-mode="find"]').click();
  await expect(joiner.locator('#hostedField')).toBeVisible();
  await expect(host.locator('#lobbyRoster')).not.toContainText('Alex');
  await joiner.locator('#hostedRows .hosted-row', { hasText: `${who}'s lobby` }).click();
  await joiner.locator('#hostedJoinBtn').click();
  await expect(joiner.locator('#lobbyScreen')).toBeVisible();
  await expect(host.locator('#lobbyRoster')).toContainText('Alex');

  await host.locator('#lobbyStartBtn').click();
  await expect(host.locator('#playScreen')).toBeVisible();
  await expect(joiner.locator('#playScreen')).toBeVisible();
  await expect(host.locator('#turnName')).toHaveText('Your lobby');
  await expect(joiner.locator('#turnName')).toHaveText(`${who}'s lobby`);

  // A third device finds the round that's being played and joins it, on the same board.
  const lateProblems = await asGuest(late, '/rambler.html');
  await late.locator('#modeList [data-mode="find"]').click();
  const going = late.locator('#hostedRows .hosted-row', { hasText: `${who}'s lobby` });
  await expect(going).toContainText('Game started');
  await going.click();
  await expect(late.locator('#hostedJoinBtn')).toHaveText('Join game in progress?');
  await expect(late.locator('#hLate')).toBeVisible();
  await late.locator('#hostedName').fill('Lee');
  await late.locator('#hostedJoinBtn').click();
  await expect(late.locator('#playScreen')).toBeVisible();
  expect(await late.locator('#board').textContent()).toBe(await host.locator('#board').textContent());
  await expect(host.locator('#playRoster')).toContainText('Lee');

  expect(hostProblems, hostProblems.join('\n')).toEqual([]);
  expect(joinProblems, joinProblems.join('\n')).toEqual([]);
  expect(lateProblems, lateProblems.join('\n')).toEqual([]);
  for (const c of ctxs) await c.close();
});

// The lobbies of the word games have no button for the word list yet, so the host's
// page asks the server the way a button would: with the host's own seat and adult pass.
for (const game of [
  { id: 'scuffle', path: '/scuffle.html', name: 'Shuffle Scuffle', store: 'scuffle.room' },
  { id: 'rambler', path: '/rambler.html', name: 'Rambler' }
]) {
  test(`${game.name}: the host switches to the unfiltered words, and a kid is moved out and told why`, async ({ browser }) => {
    test.skip(test.info().project.name !== 'laptop', 'once is enough');
    test.setTimeout(60000);
    const ctxs = await Promise.all([browser.newContext({ viewport: { width: 1280, height: 800 } }), browser.newContext({ viewport: { width: 1280, height: 800 } })]);
    const [host, guest] = await Promise.all(ctxs.map(c => c.newPage()));
    await quietFonts(host);

    // Alex, an adult, signs in and creates a family lobby. The page's own request tells the test which seat is the host's.
    expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
    await host.goto(`/auth/signin?return=${game.path}`);
    await host.waitForURL(u => new URL(u).pathname === game.path);
    await host.waitForLoadState('networkidle');
    await closeHelp(host);
    const made = host.waitForResponse(r => r.url().endsWith(`/api/${game.id}/rooms`) && r.request().method() === 'POST');
    if (game.id === 'scuffle') {
      await host.locator('#modeSeg [data-mode="host"]').click();
      await host.locator('#goBtn').click();
      await expect(host.locator('#lobby')).toBeVisible();
    } else {
      await host.locator('#modeList .no-tv[data-mode="room"]').click();
      await host.locator('#startBtn').click();
      await expect(host.locator('#lobbyScreen')).toBeVisible();
    }
    const seat = await (await made).json();

    // Milo, a kid signed in on their own device, finds it in List Hosted Games and joins.
    expect((await fake('/test/next-once', { as: 'milo' })).ok).toBe(true);
    await guest.goto(`/auth/signin?return=${game.path}`);
    await guest.waitForURL(u => new URL(u).pathname === game.path);
    await guest.waitForLoadState('networkidle');
    await closeHelp(guest);
    if (game.id === 'scuffle') {
      await guest.locator('#modeSeg [data-mode="join"]').click();
      await guest.locator('#lobbyRows .lb-row', { hasText: "Alex's lobby" }).click();
      if (await guest.locator('#joinName').isVisible().catch(() => false)) await guest.locator('#joinName').fill('Milo');
      await guest.locator('#joinBtn').click();
      await expect(guest.locator('#lobby')).toBeVisible();
      await expect(host.locator('#lobbyPlayers')).toContainText('Milo');
    } else {
      await guest.locator('#modeList [data-mode="find"]').click();
      await guest.locator('#hostedRows .hosted-row', { hasText: "Alex's lobby" }).click();
      if (await guest.locator('#hostedName').isVisible().catch(() => false)) await guest.locator('#hostedName').fill('Milo');
      await guest.locator('#hostedJoinBtn').click();
      await expect(guest.locator('#lobbyScreen')).toBeVisible();
      await expect(host.locator('#lobbyRoster')).toContainText('Milo');
    }

    // The host switches the lobby to the unfiltered words. No password.
    const status = await host.evaluate(async ({ id, seat }) => {
      const pass = (await (await fetch('/api/arksid/adult-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).pass;
      const body = id === 'scuffle'
        ? { playerId: seat.playerId, token: seat.token, settings: { dictionary: 'adult' } }
        : { playerId: seat.playerId, token: seat.token, profile: 'adult' };
      const r = await fetch(`/api/${id}/rooms/${seat.code}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Adult-Pin': pass }, body: JSON.stringify(body) });
      return r.status;
    }, { id: game.id, seat });
    expect(status).toBe(200);

    // The guest is back on the setup screen, with the reason; the host reads who left.
    const why = 'The host switched the game mode to adult, you have been removed.';
    const note = 'Milo was removed, the host switched game mode to adult.';
    if (game.id === 'scuffle') {
      await expect(guest.locator('#toast')).toHaveText(why);
      await expect(guest.locator('#setup')).toBeVisible();
      await expect(guest.locator('#lobby')).toBeHidden();
      await expect(host.locator('#toast')).toHaveText(note);
      await expect(host.locator('#lobbyPlayers')).not.toContainText('Milo');
      await expect(host.locator('#lobbySettings')).toContainText('unfiltered words');
    } else {
      await expect(guest.locator('#setupMsg')).toHaveText(why);
      await expect(guest.locator('#setupScreen')).toBeVisible();
      await expect(guest.locator('#lobbyScreen')).toBeHidden();
      await expect(host.locator('#lobbyNotice')).toHaveText(note);
      await expect(host.locator('#lobbyRoster')).not.toContainText('Milo');
    }
    for (const c of ctxs) await c.close();
  });
}
