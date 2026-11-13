'use strict';

// Chess with each player on their own phone: a guest creates a lobby, a second
// phone finds it in List Hosted Games, opens its details and joins, they chat (the
// family filter stars out a swear), the joiner sees the host's setting but no host
// buttons and taps Ready, and only then can the host start.

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

test('Chess: creating a lobby, finding it, Ready, the chat and starting', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const joinCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const joiner = await joinCtx.newPage();

  const hostProblems = await asGuest(host, '/chess.html');
  await expect(host.locator('#setup h2')).toHaveText('Choose game mode');
  await host.locator('#modeSeg [data-mode="host"]').click();
  await expect(host.locator('#create h2')).toHaveText('Set Chess Settings');
  await expect(host.locator('#whoSeg [data-who="anyone"]')).toHaveAttribute('aria-pressed', 'true');
  await host.locator('#hostName').fill('Sam');
  await host.locator('#createColorSeg [data-color="b"]').click();
  await host.locator('#createBtn').click();
  await expect(host.locator('#lobbyTitle')).toHaveText('Your Chess lobby');
  await expect(host.locator('#lobbyCount')).toHaveText('1 of 2 players · Anyone can join');
  await expect(host.locator('#lobbySeats .lb-open')).toBeVisible();
  await expect(host.locator('#lobbyStart')).toBeDisabled();
  await expect(host.locator('#lobbyStart')).toHaveText('Waiting on players to join...');

  // The second phone finds it in the list and opens its details.
  const joinProblems = await asGuest(joiner, '/chess.html');
  await joiner.locator('#modeSeg [data-mode="find"]').click();
  const row = joiner.locator('#lobbyRows .lb-row', { hasText: 'Sam\'s lobby' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('1/2');
  await row.click();
  await expect(joiner.locator('#detailsTitle')).toHaveText('Sam\'s Chess lobby');
  await expect(joiner.locator('#dYou')).toHaveText('White (Sam chose Black)');
  await expect(joiner.locator('#dStatus')).toHaveText('Waiting for players');
  await joiner.locator('#joinName').fill('Milo');
  await joiner.locator('#joinBtn').click();
  await expect(joiner.locator('#lobbyGuest')).toBeVisible();
  await expect(joiner.locator('#lobbyHost')).toBeHidden();
  await expect(joiner.locator('#lobbyTitle')).toHaveText('Sam\'s Chess lobby');
  await expect(joiner.locator('#lobbySettings')).toContainText('You play White.');

  // Milo is in but not ready, so the host still can't start.
  await expect(host.locator('#lobbySeats')).toContainText('Milo');
  await expect(host.locator('#lobbySeats')).toContainText('NOT READY');
  await expect(host.locator('#lobbyStart')).toBeDisabled();
  await expect(host.locator('#lobbyStart')).toHaveText('Waiting on players to be ready...');

  // The chat, both ways, with the family filter.
  await joiner.locator('#lobbyChat input').fill('well shit, good luck');
  await joiner.locator('#lobbyChat input').press('Enter');
  await expect(host.locator('#lobbyChat .lb-line').last()).toHaveText('Milo well s***, good luck');
  await host.locator('#lobbyChat .lb-quick button', { hasText: 'GG' }).click();
  await expect(joiner.locator('#lobbyChat .lb-line').last()).toHaveText('Sam GG');

  // The emoji picker: every standard emoji in groups; tapping one types it.
  await joiner.locator('#lobbyChat .lb-emo-btn').click();
  await expect(joiner.locator('#lobbyChat .lb-emo-grid button').first()).toBeVisible();
  expect(await joiner.locator('#lobbyChat .lb-emo-tabs button').count()).toBeGreaterThanOrEqual(6);
  await joiner.locator('#lobbyChat .lb-emo-tabs button[data-id="food"]').click();
  await joiner.locator('#lobbyChat .lb-emo-grid button', { hasText: '🍕' }).click();
  await joiner.locator('#lobbyChat input').press('Enter');
  await expect(host.locator('#lobbyChat .lb-line').last()).toHaveText('Milo 🍕');

  // Ready lights up the host's start button.
  await joiner.locator('#readyBtn').click();
  await expect(joiner.locator('#lobbyWait')).toHaveText('Waiting for Sam to start the game…');
  await expect(host.locator('#lobbyStart')).toBeEnabled();
  await expect(host.locator('#lobbyStart')).toHaveText('Players Ready, Start Game!');

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
