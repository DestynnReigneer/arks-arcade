'use strict';

// The trophy page: the trophy on the home page opens it, every game has a
// card, a board opens to show its scores, grown-up boards stay locked until
// the PIN, the filters work, and daily games switch between Overall and Today.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage, chooser } = require('./helpers');

test.beforeEach(async ({ page }) => { await quietFonts(page); });

async function asGuest(page) {
  const pick = chooser(page);
  if (await pick.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Play as a guest/ }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(pick).toBeHidden();
  }
}

test('the trophy on the home page opens the trophy page', async ({ page }) => {
  await openPage(page, '/');
  await asGuest(page);
  await page.locator('#trophyLink').click();
  await page.waitForURL(/trophies\.html/);
  await expect(page.locator('h1')).toContainText('TROPHY');
});

test('every game has a card, boards open, and grown-up boards stay locked', async ({ page }) => {
  await openPage(page, '/trophies.html');
  await asGuest(page);
  const games = page.locator('.tr-game');
  await expect(games.first()).toBeVisible();
  for (const id of ['crisscross', 'sudoku', 'tumbler', 'racer', 'snake', 'trivia']) await expect(page.locator(`.tr-game[data-game="${id}"]`)).toHaveCount(1);
  // A guest sees the boards but no shelf.
  await expect(page.locator('#guestNote')).toBeVisible();
  await expect(page.locator('#shelf')).toBeHidden();

  // Opening a board shows its table and a Play button for that game.
  const snake = page.locator('.tr-game[data-game="snake"] .tr-board').first();
  await snake.locator('button').click();
  await expect(snake.locator('.tr-table')).toBeVisible();
  await expect(snake.getByRole('link', { name: /Play Snake/ })).toHaveAttribute('href', 'snake.html');

  // Know-It-All's adult board is locked, and tapping it asks first.
  const adult = page.locator('.tr-game[data-game="trivia"] .tr-board[data-board="adult"]');
  await expect(adult).toContainText('🔞');
  await adult.locator('button').click();
  await expect(page.locator('#pinView')).toBeVisible();
  await page.locator('#pinCancel').click();
  await expect(page.locator('#pinView')).toBeHidden();
  await expect(adult.locator('.tr-table')).toHaveCount(0);

  // Nothing runs off the side of a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the filters pick games, and daily games switch to Today', async ({ page }) => {
  await openPage(page, '/trophies.html');
  await asGuest(page);
  await expect(page.locator('.tr-game').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cabinet Games' }).click();
  await expect(page.locator('.tr-game[data-game="snake"]')).toHaveCount(0);
  await expect(page.locator('.tr-game[data-game="racer"]')).toHaveCount(1);
  // Only daily games have the switch.
  await expect(page.locator('.tr-game[data-game="racer"] .tr-seg')).toHaveCount(0);
  const tumbler = page.locator('.tr-game[data-game="tumbler"]');
  await tumbler.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(tumbler.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All Games' }).click();
  await expect(page.locator('.tr-game[data-game="snake"]')).toHaveCount(1);
});
