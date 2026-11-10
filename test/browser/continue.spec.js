'use strict';

// The Continue row on the home page: it stays out of the way until someone
// has a game in progress, then lists them with a Play button each. What goes
// in the list is the server's job (test/continue.test.js), so here the list
// is handed to the page and only the page is checked.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage, chooser } = require('./helpers');

const GAMES = [
  { game: 'crisscross', title: 'Words with Family with Ben', detail: 'Your move', href: 'crisscross.html?game=abc', yourTurn: true, updatedAt: 2 },
  { game: 'sudoku', title: 'Sudoku, today\'s Easy', detail: '4:12 on the clock', href: 'sudoku.html?level=easy', yourTurn: false, updatedAt: 1 }
];

test.beforeEach(async ({ page }) => { await quietFonts(page); });

test('the Continue row is hidden when there is nothing to continue', async ({ page }) => {
  await openPage(page, '/');
  await expect(page.locator('#continue')).toBeHidden();
});

test('the Continue row lists your games and opens the one you tap', async ({ page }) => {
  let asked = null;
  await page.route('**/api/continue', route => {
    asked = route.request().headers()['x-profile-token'] || null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games: GAMES }) });
  });
  await openPage(page, '/');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Wait until the guest is saved, so the next step doesn't get written over.
  await expect(chooser(page)).toBeHidden();
  // The page asks with the token of whoever is playing, and only then.
  await page.evaluate(() => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('arcade.profile') || '{}') || {}; } catch { /* start clean */ }
    localStorage.setItem('arcade.profile', JSON.stringify({ ...p, id: p.id || 'p1', name: p.name || 'Ana', token: 'test.token' }));
  });
  await openPage(page, '/');
  const row = page.locator('#continue');
  await expect(row).toBeVisible();
  expect(asked).toBe('test.token');
  const items = row.locator('li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Words with Family with Ben');
  await expect(items.nth(0)).toContainText('Your move');
  await expect(items.nth(1)).toContainText('4:12 on the clock');
  // Nothing runs off the side of a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await items.nth(1).getByRole('link', { name: 'Play' }).click();
  await page.waitForURL(/sudoku\.html\?level=easy/);
});
