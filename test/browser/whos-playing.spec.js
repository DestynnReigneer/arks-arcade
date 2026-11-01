'use strict';

// "Who's playing?" has to be answered before anyone can play. With sign-in on
// and nobody chosen yet, it can't be closed with Escape or a tap outside, the
// keyboard can't reach anything behind it, and opening a game's address
// directly asks too.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage, chooser } = require('./helpers');

test.beforeEach(async ({ page }) => { await quietFonts(page); });

test('Escape and a tap outside don\'t close it', async ({ page }) => {
  await openPage(page, '/');
  await expect(chooser(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chooser(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(chooser(page)).toBeVisible();
  // A tap near the bottom corner, well outside the card.
  const size = page.viewportSize();
  await page.mouse.click(size.width - 5, size.height - 5);
  await expect(chooser(page)).toBeVisible();
});

test('Tab stays inside it, and the games behind it can\'t be reached', async ({ page }) => {
  await openPage(page, '/');
  await expect(chooser(page)).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 4 === 3 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('.apf')), `after key ${i + 1}, focus left the card`).toBe(true);
  }
  // The game cards are marked inert: they can't take focus, so Enter can't open one.
  const game = page.locator('a.game').first();
  expect(await game.evaluate(a => !!a.closest('[inert]'))).toBe(true);
  await game.evaluate(a => a.focus());
  expect(await page.evaluate(() => !!document.activeElement.closest('.apf'))).toBe(true);
  await page.keyboard.press('Enter');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('opening a game\'s address directly asks first', async ({ page }) => {
  await openPage(page, '/snake.html');
  await expect(chooser(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chooser(page)).toBeVisible();
});

test('playing as a guest closes it and gives the page back', async ({ page }) => {
  await openPage(page, '/');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(chooser(page)).toBeHidden();
  expect(await page.evaluate(() => document.querySelectorAll('body > [inert]').length)).toBe(0);
  // And a game page opened next doesn't ask again.
  await openPage(page, '/snake.html');
  await page.waitForTimeout(500);
  await expect(chooser(page)).toBeHidden();
});
