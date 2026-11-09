'use strict';

// ARKS Launcher in a real browser: the 3D lane draws, balls launch up the lane and stop at a gate, the game ends when
// the balls run out, and the points go on the board. CabTest (cab-frame.js) steps the game by hand.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('playing ARKS Launcher and saving the points', async ({ page, isMobile }) => {
  test.setTimeout(120000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/launcher.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // The settings are on a setup screen before the game, never beside it while it's played.
  await expect(page.locator('.cab-setup')).toBeVisible();
  await expect(page.locator('.cab-stage')).toBeHidden();
  await page.locator('.cab-go').click();
  await expect(page.locator('.cab-setup')).toBeHidden();
  await expect(page.locator('.cab-stage canvas')).toBeVisible();
  if (isMobile) {
    const pad = await page.locator('.cab-pad button').first().boundingBox();
    expect(pad.height).toBeGreaterThanOrEqual(100);
  }

  await page.evaluate(() => CabTest.manual(true));
  // Launch every ball with a medium pull until the balls run out (a Super Bonus refills them, so stop after 40 tries).
  const played = await page.evaluate(() => {
    const g = CabTest.game; let n = 0;
    CabTest.step(3.5);
    while (!g.over && n < 40) {
      g.press(); CabTest.step(0.25 + Math.random() * 0.6); g.release(); n++;
      for (let k = 0; k < 200 && g.st !== 'ready' && !g.over; k++) CabTest.step(0.1);
    }
    CabTest.tick(0.1);
    return { n, score: g.score, over: g.over };
  });
  expect(played.over).toBe(true);
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 5000 });
  const points = Number((await page.locator('.over-panel .final-score').textContent()).replace(/,/g, ''));
  expect(points).toBe(played.score);

  const boxes = page.locator('.over-panel .ini');
  for (const [i, c] of ['L', 'N', 'C'].entries()) await boxes.nth(i).fill(c);
  await page.locator('.over-panel .save-btn').click();
  await expect.poll(async () => {
    const list = await (await page.request.get('/api/scores/launcher?board=points')).json();
    return list.some(r => r.initials === 'LNC' && r.score === points);
  }).toBe(true);
  expect(problems).toEqual([]);
});
