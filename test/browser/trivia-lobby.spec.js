'use strict';

// Know-It-All with each player on their own phone: a guest creates a lobby, a second
// phone finds it in List Hosted Games and joins, they chat, the joiner taps Ready and
// the host starts; then a third phone joins the game in progress.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function asGuest(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.apf')).toBeHidden();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}

test('Know-It-All: a lobby, Ready, the chat, starting, and joining a game in progress', async ({ browser }) => {
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [host, joiner, late] = await Promise.all(ctxs.map(c => c.newPage()));

  // Phone and laptop run at the same time on one server, so each host has its own name.
  const who = test.info().project.name === 'phone' ? 'Robin' : 'Riley';
  const hostProblems = await asGuest(host, '/trivia.html');
  await host.locator('#modeSeg [data-mode="host"]').click();
  await host.locator('#hostName').fill(who);
  await host.locator('#goBtn').click();
  await expect(host.locator('#lobbyTitle')).toHaveText('Your Know-It-All lobby');
  await expect(host.locator('#tvJoin')).toBeHidden();
  await expect(host.locator('#startBtn')).toHaveText('Waiting on players to join...');

  const joinProblems = await asGuest(joiner, '/trivia.html');
  await joiner.locator('#modeSeg [data-mode="join"]').click();
  const row = joiner.locator('#lobbyRows .lb-row', { hasText: `${who}'s lobby` });
  await row.click();
  await expect(joiner.locator('#detailsTitle')).toHaveText(`${who}'s Know-It-All lobby`);
  await joiner.locator('#joinName').fill('Alex');
  await joiner.locator('#joinBtn').click();
  await expect(joiner.locator('#lobbyTitle')).toHaveText(`${who}'s Know-It-All lobby`);
  await expect(host.locator('#lobbyPlayers')).toContainText('not ready');
  await expect(host.locator('#startBtn')).toBeDisabled();

  await joiner.locator('#lobbyChat input').fill('ready to win');
  await joiner.locator('#lobbyChat input').press('Enter');
  await expect(host.locator('#lobbyChat .lb-line').last()).toHaveText('Alex ready to win');

  await joiner.locator('#lobbyReadyBtn').click();
  await expect(host.locator('#startBtn')).toBeEnabled();
  await expect(host.locator('#startBtn')).toHaveText('Players Ready, Start Game!');
  await host.locator('#startBtn').click();
  await expect(host.locator('#play')).toBeVisible();
  await expect(joiner.locator('#play')).toBeVisible();

  // A third phone joins while it's going: from the next question, with 0 points.
  const lateProblems = await asGuest(late, '/trivia.html');
  await late.locator('#modeSeg [data-mode="join"]').click();
  await late.locator('#lobbyRows .lb-row', { hasText: `${who}'s lobby` }).click();
  await expect(late.locator('#dLate')).toBeVisible();
  await expect(late.locator('#joinBtn')).toHaveText('Join game in progress?');
  await late.locator('#joinName').fill('Jo');
  await late.locator('#joinBtn').click();
  await expect(late.locator('#play')).toBeVisible();

  expect(hostProblems, hostProblems.join('\n')).toEqual([]);
  expect(joinProblems, joinProblems.join('\n')).toEqual([]);
  expect(lateProblems, lateProblems.join('\n')).toEqual([]);
  for (const c of ctxs) await c.close();
});
