'use strict';

// Spin & Solve in a real browser: the turn clock follows the TV show. Nothing
// ticks while a player decides what to do, so it doesn't run before the first
// spin; it starts once the wheel stops (to call a letter) and when Solve is
// tapped, and stops again when the answer is in.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('the Spin & Solve clock waits for the first spin', async ({ page }) => {
  test.setTimeout(90000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/spinsolve.html');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // One player, the 30-second clock.
  while (await page.locator('#nameList .name-row').count() > 1) await page.locator('#nameList .name-row:last-child button').click();
  await page.locator('#timerSeg [data-secs="30"]').click();
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();

  // Before the first spin the clock is full and says whose move it is.
  const text = page.locator('#ttText');
  await expect(text).toContainText('spin, buy a vowel or solve');
  await page.waitForTimeout(2500);
  await expect(text).toContainText('spin, buy a vowel or solve');
  await expect(page.locator('#turnTimer')).toHaveClass(/paused/);

  // Tapping Solve starts it; backing out stops it again.
  await page.locator('#solveBtn').click();
  await expect(text).toContainText(/\d+s to solve/);
  await page.locator('#solveCancel').click();
  await expect(text).toContainText('spin, buy a vowel or solve');

  // Spin until the wheel lands on money (Bankrupt and Lose a Turn pass the
  // turn, which in a solo game is a strike, so stop before the third).
  for (let i = 0; i < 2 && !(await page.locator('#letterView').isVisible()); i++) {
    await expect(page.locator('#spinBtn')).toBeEnabled({ timeout: 15000 });
    await page.locator('#spinBtn').click();
    await expect(page.locator('#letterView, #spinBtn:enabled').first()).toBeVisible({ timeout: 15000 });
  }
  if (await page.locator('#letterView').isVisible()) {
    await expect(text).toContainText(/\d+s to call a letter/);
    await page.locator('#letterGrid button:not(:disabled)').first().click();
    await expect(page.locator('#letterView')).toBeHidden();
    // Whether the letter was there or not, the clock waits for the next move.
    await expect(text).toContainText('spin, buy a vowel or solve', { timeout: 15000 });
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
