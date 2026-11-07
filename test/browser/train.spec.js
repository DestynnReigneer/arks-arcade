'use strict';

// ARKS Train Station in a real browser: the 3D station draws with the arcade's car names, balls drop into the train,
// the game ends when the 15 balls are gone, and the points go on the board. CabTest (cab-frame.js) steps the game by hand.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('playing ARKS Train Station and saving the points', async ({ page, isMobile }) => {
  test.setTimeout(120000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/train.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  await expect(page.locator('.cab-stage canvas')).toBeVisible();
  if (isMobile) {
    const pad = await page.locator('.cab-pad button').first().boundingBox();
    expect(pad.height).toBeGreaterThanOrEqual(100);
  }

  await page.locator('.cab-go').click();
  await page.evaluate(() => CabTest.manual(true));
  // The cars carry the arcade's names (from /api/train-cars), not just the ones in the code.
  const names = (await (await page.request.get('/api/train-cars')).json()).cars.map(c => c.name).join();
  expect(await page.evaluate(() => CabTest.game.carObjs.map(c => c.name).join())).toBe(names);
  // Drop all 15 balls a second and a half apart, until the game ends (All Aboard would add 15 more, so stop after 60).
  const played = await page.evaluate(() => {
    const g = CabTest.game; let n = 0;
    CabTest.step(4);
    while (!g.over && n < 60) {
      if (!g.ballSt && g.left > 0) { g.press(); n++; }
      CabTest.step(1.5);
    }
    CabTest.step(5); CabTest.tick(0.1);
    return { n, score: g.score, over: g.over };
  });
  expect(played.over).toBe(true);
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 5000 });
  const points = Number((await page.locator('.over-panel .final-score').textContent()).replace(/,/g, ''));
  expect(points).toBe(played.score);

  const boxes = page.locator('.over-panel .ini');
  for (const [i, c] of ['T', 'R', 'N'].entries()) await boxes.nth(i).fill(c);
  await page.locator('.over-panel .save-btn').click();
  await expect.poll(async () => {
    const list = await (await page.request.get('/api/scores/train?board=points')).json();
    return list.some(r => r.initials === 'TRN' && r.score === points);
  }).toBe(true);
  expect(problems).toEqual([]);
});
