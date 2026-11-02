'use strict';

// Clueless in a real browser: start today's family mini, type every letter
// through the page (the on-screen keyboard on a phone, the real keyboard on a
// laptop) and see it solved. The letters come from a hook the server only
// has under the test suite (NODE_ENV=test).

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('solving the family mini in Clueless', async ({ page, isMobile }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/clueless.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play opens by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  await expect(page.locator('#clueText')).not.toHaveText(/Tap Start/);

  if (isMobile) {
    // On a phone the clue bar, the grid and the keyboard all fit on the screen.
    const bar = await page.locator('#clueBar').boundingBox();
    const keys = await page.locator('#keys').boundingBox();
    const grid = await page.locator('#grid').boundingBox();
    expect(bar.y + bar.height).toBeLessThanOrEqual(grid.y + 1);
    expect(grid.y + grid.height).toBeLessThanOrEqual(keys.y);
    expect(keys.y + keys.height).toBeLessThanOrEqual(844 + 1);
  }

  const runId = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('clueless.current.')).map(k => localStorage.getItem(k))[0]);
  expect(runId).toMatch(/^[0-9a-f]{32}$/);
  const { letters } = await (await page.request.get(`/api/clueless/test/answer/${runId}`)).json();

  const cells = page.locator('#grid .cl-cell');
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] === '#') continue;
    const cell = cells.nth(i);
    if (!/\bsel\b/.test(await cell.getAttribute('class'))) await cell.click();
    if (isMobile) await page.locator(`#keys [data-key="${letters[i]}"]`).tap();
    else await page.keyboard.press(letters[i].toLowerCase());
  }

  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#overTitle')).toContainText('solved');
  await expect(page.locator('#overTime')).toHaveText(/^\d+:\d{2}$/);
  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});
