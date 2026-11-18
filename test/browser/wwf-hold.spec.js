'use strict';

// Words with Family's list of your games has the same press-and-hold menu as the home
// page's Continue row: Resume, and leaving the game (here, closing your own lobby).

const { test, expect } = require('@playwright/test');
const { quietFonts } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

test('holding a game in Words with Family opens Resume and Close lobby', async ({ browser }) => {
  test.skip(test.info().project.name !== 'phone', 'once is enough');
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await quietFonts(page);
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await page.goto('/auth/signin?return=/crisscross.html');
  await page.waitForURL(u => new URL(u).pathname === '/crisscross.html');
  await page.waitForLoadState('networkidle');
  const help = page.locator('.tut-x');
  if (await help.isVisible().catch(() => false)) await help.click();

  // Alex creates a lobby, then comes back to the list of games.
  await page.locator('#newOnlineBtn').click();
  await page.locator('#onlineGo').click();
  await expect(page.locator('#waiting')).toBeVisible();
  await page.goto('/crisscross.html');
  const row = page.locator('#mineList li', { hasText: 'Waiting' }).first();
  await expect(row).toBeVisible({ timeout: 20000 });

  await row.click({ button: 'right' });
  const card = page.locator('.lp-card');
  await expect(card.getByRole('menuitem', { name: /Resume/ })).toBeVisible();
  await card.getByRole('menuitem', { name: /Close lobby/ }).click();
  await expect(card).toContainText('Close this lobby? Nobody can join after this.');
  await card.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#mineList li', { hasText: 'Waiting' })).toHaveCount(0, { timeout: 20000 });
  await ctx.close();
});
