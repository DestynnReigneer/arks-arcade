'use strict';

// Chess on two phones with the lobby: a guest hosts, a second phone opens the
// shared link and joins, they chat (the family filter stars out a swear), the
// joiner sees the host's setting but no host buttons, and the host starts.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function asGuest(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}

test('Chess: hosting, joining from a link, the chat and starting', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const joinCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const joiner = await joinCtx.newPage();

  const hostProblems = await asGuest(host, '/chess.html');
  await host.locator('#modeSeg [data-mode="host"]').click();
  await host.locator('#hostName').fill('Sam');
  await host.locator('#goBtn').click();
  await expect(host.locator('#lobbyHost')).toBeVisible();
  await expect(host.locator('#lobbyStart')).toBeDisabled();
  const code = (await host.locator('#lobbyCode').textContent()).trim();
  expect(code).toMatch(/^[A-Z0-9]{4}$/);
  await host.locator('#lobbyColorSeg [data-color="b"]').click();

  // The link the host shares opens the join screen with the code filled in.
  const joinProblems = await asGuest(joiner, `/chess.html?room=${code}`);
  await expect(joiner.locator('#joinCode')).toHaveValue(code);
  await joiner.locator('#joinName').fill('Milo');
  await joiner.locator('#goBtn').click();
  await expect(joiner.locator('#lobbyGuest')).toBeVisible();
  await expect(joiner.locator('#lobbyHost')).toBeHidden();
  await expect(joiner.locator('#lobbyWait')).toHaveText('Waiting for Sam to start…');
  await expect(joiner.locator('#lobbySettings')).toContainText('You play as White');

  // The host sees Milo arrive and can start.
  await expect(host.locator('#lobbySeats')).toContainText('Milo');
  await expect(host.locator('#lobbyStart')).toBeEnabled();

  // The chat, both ways, with the family filter.
  await joiner.locator('#lobbyChat input').fill('well shit, good luck');
  await joiner.locator('#lobbyChat input').press('Enter');
  await expect(host.locator('#lobbyChat .lb-line').last()).toHaveText('Milo well s***, good luck');
  await host.locator('#lobbyChat .lb-quick button', { hasText: 'GG' }).click();
  await expect(joiner.locator('#lobbyChat .lb-line').last()).toHaveText('Sam GG');

  await host.locator('#lobbyStart').click();
  await expect(host.locator('#game')).toBeVisible();
  await expect(joiner.locator('#game')).toBeVisible();
  await expect(joiner.locator('#statusLine')).toHaveText('Your move');
  await expect(joiner.locator('#gameChat')).toContainText('The game started');

  expect(hostProblems, hostProblems.join('\n')).toEqual([]);
  expect(joinProblems, joinProblems.join('\n')).toEqual([]);
  await hostCtx.close();
  await joinCtx.close();
});
