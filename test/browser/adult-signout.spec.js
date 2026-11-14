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

test('a tab that still holds an ended unlock locks itself on its next load, and can unlock again', async ({ browser }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const first = await ctx.newPage();
  await quietFonts(first);
  const closeHelp = async page => { const x = page.locator('.tut-x'); if (await x.isVisible().catch(() => false)) await x.click(); };

  // Alex unlocks Filthy in one tab.
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await first.goto('/auth/signin?return=/spinsolve.html');
  await first.waitForURL(u => new URL(u).pathname === '/spinsolve.html');
  await first.waitForLoadState('networkidle');
  await closeHelp(first);
  await first.locator('#levelList .level', { hasText: 'Filthy' }).click();
  await expect(first.locator('#levelList .level[aria-pressed=true]')).toContainText('Filthy', { timeout: 15000 });
  const old = await first.evaluate(() => sessionStorage.getItem('spin.adultPin'));
  expect(old).toBeTruthy();

  // In a second tab of the same browser, Alex signs out and back in. The first tab's unlock is now from a sign-in that's over.
  const second = await ctx.newPage();
  await quietFonts(second);
  await second.goto('/');
  await second.waitForLoadState('networkidle');
  await second.evaluate(() => { ArcadeProfile.open(); });
  await second.locator('.apf [data-out]').click();
  await second.waitForURL(u => new URL(u).pathname === '/signout');
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await second.goto('/auth/signin?return=/');
  await second.waitForURL(u => new URL(u).pathname === '/');
  await second.close();

  // The first tab is loaded again: it drops the old unlock by itself and shows the levels locked...
  await first.reload();
  // (The page loads itself once more while it does, so a read that lands mid-load is tried again.)
  await expect.poll(() => first.evaluate(() => sessionStorage.getItem('spin.adultPin')).catch(() => 'loading'), { timeout: 15000 }).toBeNull();
  await first.waitForLoadState('networkidle');
  await closeHelp(first);
  await expect(first.locator('#levelList .l-lock')).toHaveCount(3);
  // ...and one tap unlocks them again, with a new pass.
  await first.locator('#levelList .level', { hasText: 'Filthy' }).click();
  await expect(first.locator('#levelList .level[aria-pressed=true]')).toContainText('Filthy', { timeout: 15000 });
  const fresh = await first.evaluate(() => sessionStorage.getItem('spin.adultPin'));
  expect(fresh).toBeTruthy();
  expect(fresh).not.toBe(old);
  while (await first.locator('#nameList .name-row').count() > 1) await first.locator('#nameList .name-row:last-child button').click();
  await first.locator('#goBtn').click();
  await expect(first.locator('#game')).toBeVisible();
  await ctx.close();
});
