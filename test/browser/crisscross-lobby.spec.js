'use strict';

// Words with Family, each player on their own device: one person creates a
// lobby, the other finds it in List Hosted Games and joins, and the game
// starts. Nobody is picked from a list and nobody types a code.

const { test, expect } = require('@playwright/test');
const { quietFonts } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

async function signedIn(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await quietFonts(page);
  expect((await fake('/test/next-once', { as: who })).ok).toBe(true);
  await page.goto('/auth/signin?return=/crisscross.html');
  await page.waitForURL(u => new URL(u).pathname === '/crisscross.html');
  await page.waitForLoadState('networkidle');
  const help = page.locator('.tut-x');
  if (await help.isVisible().catch(() => false)) await help.click();
  return { ctx, page };
}

test('Words with Family: creating a lobby, finding it in List Hosted Games, and joining', async ({ browser }) => {
  test.skip(test.info().project.name !== 'phone', 'once is enough');
  test.setTimeout(60000);
  const host = await signedIn(browser, 'alex');

  // Alex creates a lobby for two. Nothing asks who to play with.
  await host.page.locator('#newOnlineBtn').click();
  await expect(host.page.locator('#newOnline')).toBeVisible();
  await expect(host.page.locator('#peopleList')).toHaveCount(0);
  await expect(host.page.locator('#newOnline')).not.toContainText('Who are you playing with?');
  await expect(host.page.locator('#seatsSeg [data-v="2"]')).toHaveAttribute('aria-pressed', 'true');
  await host.page.locator('#onlineGo').click();
  await expect(host.page.locator('#waiting')).toBeVisible();
  await expect(host.page.locator('#waitHint')).toContainText('List Hosted Games');
  await expect(host.page.locator('#joinQr')).toBeVisible();
  // The QR code is the only thing to pass along: no address on the screen, and no button that copies one.
  await expect(host.page.locator('#copyLink, #joinLink')).toHaveCount(0);
  await expect(host.page.locator('#waiting')).not.toContainText(/crisscross\.html|join=|Copy/);

  // Sam opens Words with Family, sees the lobby in List Hosted Games, and joins it. (Sam's account has no
  // photo. A profile with one would make the pages a visitor opens ask for a picture only signed-in people
  // can load, which the page test would count as a problem.)
  const joiner = await signedIn(browser, 'sam');
  const row = joiner.page.locator('#hostedList li', { hasText: "Alex's lobby" });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText('1 of 2 players');
  await row.click();
  await expect(joiner.page.locator('#inviteTitle')).toHaveText('Join game?');
  await joiner.page.locator('#inviteJoin').click();

  // Two seats, both taken: the game starts for both of them.
  await expect(joiner.page.locator('#game')).toBeVisible({ timeout: 20000 });
  await expect(host.page.locator('#game')).toBeVisible({ timeout: 40000 });
  await host.ctx.close();
  await joiner.ctx.close();
});
