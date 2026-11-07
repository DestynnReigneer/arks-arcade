'use strict';

// Big Swing in a real browser: the 3D cage draws, a swing hits the ball, a game ends after three outs, and the score
// goes on the board. CabTest (cab-frame.js) steps the game by hand, so the test doesn't wait on real pitches.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('playing Big Swing and saving the runs', async ({ page, isMobile }) => {
  test.setTimeout(120000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/bigswing.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // The 3D view is there, and on a phone the game and its big button fit on the screen.
  await expect(page.locator('.cab-stage canvas')).toBeVisible();
  if (isMobile) {
    const pad = await page.locator('.cab-pad button').first().boundingBox();
    expect(pad.height).toBeGreaterThanOrEqual(100);
  }

  await page.locator('.cab-go').click();
  await page.evaluate(() => CabTest.manual(true));
  // A real swing: wait for the pitch, pull back, and let go as the ball reaches the plate.
  const hit = await page.evaluate(() => {
    const g = CabTest.game;
    CabTest.tick(3.5);
    for (let k = 0; k < 600 && g.phase !== 'pitch'; k++) CabTest.step(1 / 30);
    g.press(); CabTest.step(0.6);
    for (let k = 0; k < 400 && g.phase === 'pitch' && g.b.position.z < 5.0; k++) CabTest.step(1 / 120);
    g.release(); CabTest.step(0.3);
    return g.phase;
  });
  expect(['roll', 'fly']).toContain(hit);

  // Three outs end the game.
  await page.evaluate(() => {
    const g = CabTest.game;
    CabTest.step(4);
    g.runs = Math.max(g.runs, 3);
    for (let i = 0; i < 3; i++) g.out('OUT!');
    CabTest.tick(0.2);
  });
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 5000 });
  const runs = Number(await page.locator('.over-panel .final-score').textContent());
  expect(runs).toBeGreaterThanOrEqual(3);

  const boxes = page.locator('.over-panel .ini');
  for (const [i, c] of ['B', 'S', 'W'].entries()) await boxes.nth(i).fill(c);
  await page.locator('.over-panel .save-btn').click();
  await expect.poll(async () => {
    const list = await (await page.request.get('/api/scores/bigswing?board=runs')).json();
    return list.some(r => r.initials === 'BSW' && r.score === runs);
  }).toBe(true);
  expect(problems).toEqual([]);
});
