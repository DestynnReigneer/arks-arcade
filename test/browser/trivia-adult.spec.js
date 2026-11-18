'use strict';

// Know-It-All's adult levels on the page: a guest picks Spicy with nothing to type,
// the Emoji Riddles chip shows a picture above the question, and a shared device takes
// up to 12 players.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function asGuest(page) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/trivia.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.apf')).toBeHidden();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}

test('Know-It-All: an emoji riddle shows its picture, and a shared device takes 12 players', async ({ page }) => {
  const problems = await asGuest(page);
  await page.locator('#levelList .level', { hasText: 'Spicy' }).click();
  const chip = page.locator('#genreChips button', { hasText: 'Emoji Riddles' });
  await expect(chip).toBeVisible();
  await chip.click();
  await page.locator('#goBtn').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#qPic')).toBeVisible();
  expect((await page.locator('#qPic').textContent()).trim().length).toBeGreaterThan(0);
  await expect(page.locator('#qText')).not.toBeEmpty();
  // The picture and the answers fit across the screen.
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
  page.once('dialog', d => d.accept());
  await page.locator('#quitBtn').click();
  await expect(page.locator('#setup')).toBeVisible();

  await page.locator('#modeSeg [data-mode="local"]').click();
  const add = page.locator('#addPlayerBtn');
  while (await add.isVisible()) await add.click();
  await expect(page.locator('#nameList .name-row')).toHaveCount(12);
  expect(problems, problems.join('\n')).toEqual([]);
});
