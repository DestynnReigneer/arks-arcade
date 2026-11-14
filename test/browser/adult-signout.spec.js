'use strict';

// Signing out locks the adult levels again. An adult unlocks Filthy in Spin &
// Solve, then signs out from the profile card. The pass that tab was holding
// is gone, the server refuses it from anywhere, and whoever uses the tab next
// (a guest here) finds every adult level locked.

const { test, expect } = require('@playwright/test');
const { quietFonts } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

test('signing out locks the adult levels for whoever uses the device next', async ({ browser }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await quietFonts(page);

  // Alex, an adult, signs in and opens Spin & Solve's Filthy level.
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await page.goto('/auth/signin?return=/spinsolve.html');
  await page.waitForURL(u => new URL(u).pathname === '/spinsolve.html');
  await page.waitForLoadState('networkidle');
  const help = page.locator('.tut-x');
  if (await help.isVisible().catch(() => false)) await help.click();
  await page.locator('#levelList .level', { hasText: 'Filthy' }).click();
  await expect(page.locator('#levelList .level[aria-pressed=true]')).toContainText('Filthy', { timeout: 15000 });
  const pass = await page.evaluate(() => sessionStorage.getItem('spin.adultPin'));
  expect(pass, 'the tab holds an adult pass').toBeTruthy();

  // Signing out, the way the profile card's button does it.
  await page.evaluate(() => { ArcadeProfile.open(); });
  await page.locator('.apf [data-out]').click();
  // The arcade sends the browser on to ARKS ID's own sign-out page.
  await page.waitForURL(u => new URL(u).pathname === '/signout');

  // The server won't take that pass anymore, from this browser or any other.
  const elsewhere = await browser.newContext();
  const start = await elsewhere.request.post(`http://localhost:${PORT}/api/spinsolve/run/start`, { data: { level: 'filthy', names: ['Someone'] }, headers: { 'X-Adult-Pin': pass } });
  expect(start.status()).toBe(403);
  expect(JSON.stringify(await start.json())).not.toContain('banter');
  await elsewhere.close();

  // The same tab, next person: a guest finds all three adult levels locked.
  await page.goto('/spinsolve.html');
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => sessionStorage.getItem('spin.adultPin')), 'the pass left the tab with the sign-in').toBeNull();
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  if (await help.isVisible().catch(() => false)) await help.click();
  await expect(page.locator('#levelList .l-lock')).toHaveCount(3);
  await ctx.close();
});
