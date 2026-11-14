'use strict';

// Bucket Drop in a real browser: the 3D turntable draws, balls drop and some land in the cups, the time runs out, the
// arcade's jackpot grows by 10, and the points go on the board. CabTest (cab-frame.js) steps the game by hand.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('playing Bucket Drop and saving the points', async ({ page, isMobile }) => {
  test.setTimeout(120000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/bucketdrop.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // Everyone plays it the same way, so there's no setup screen and nothing to choose: the game is right there.
  await expect(page.locator('.cab-stage canvas')).toBeVisible();
  await expect(page.locator('.cab-setup')).toBeHidden();
  await expect(page.locator('.cab-opts select, .cab-opts button')).toHaveCount(0);
  if (isMobile) {
    const pad = await page.locator('.cab-pad button').first().boundingBox();
    expect(pad.height).toBeGreaterThanOrEqual(100);
  }
  await page.locator('.cab-go').click();
  const before = (await (await page.request.get('/api/cab-jackpot/bucketdrop')).json()).amount;

  await page.evaluate(() => CabTest.manual(true));
  // Drop 20 balls a third of a second apart, then let the clock run out.
  const caught = await page.evaluate(() => {
    const g = CabTest.game;
    CabTest.step(3.5);
    for (let i = 0; i < 20; i++) { g.press(); CabTest.step(0.33); }
    CabTest.step(30); CabTest.tick(0.1);
    return g.caught;
  });
  expect(caught).toBeGreaterThan(0);
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 5000 });
  const points = Number((await page.locator('.over-panel .final-score').textContent()).replace(/,/g, ''));
  expect(points).toBeGreaterThanOrEqual(caught * 10);
  // at least 10 more (the phone and laptop runs can play at the same time, each adding 10)
  await expect.poll(async () => (await (await page.request.get('/api/cab-jackpot/bucketdrop')).json()).amount).toBeGreaterThanOrEqual(before + 10);

  const boxes = page.locator('.over-panel .ini');
  for (const [i, c] of ['B', 'D', 'R'].entries()) await boxes.nth(i).fill(c);
  await page.locator('.over-panel .save-btn').click();
  await expect.poll(async () => {
    const list = await (await page.request.get('/api/scores/bucketdrop?board=big-fast')).json();
    return list.some(r => r.initials === 'BDR' && r.score === points);
  }).toBe(true);
  expect(problems).toEqual([]);
});
