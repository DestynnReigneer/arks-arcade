'use strict';

// ARKS Racer in a real browser: the 3D track draws, the gas moves the car, a tap on the right half steers it right and
// the steering bar shows it, and a finished race's time reads as a time and goes on that track's board, fastest first.
// CabTest (cab-frame.js) steps the game by hand; the race itself is finished by hand, since driving three laps would
// need an autopilot.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('driving ARKS Racer and saving a time', async ({ page, isMobile }) => {
  test.setTimeout(120000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/racer.html');
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
  // The gas gets the car going.
  const speed = await page.evaluate(() => { const g = CabTest.game; CabTest.step(4); g.steer('gas', true); CabTest.step(1.5); return g.v; });
  expect(speed).toBeGreaterThan(10);

  // A tap held on the right half of the game steers right, and the steering bar shows it.
  const box = await page.locator('.cab-stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
  await page.mouse.down();
  const steer = await page.evaluate(() => { CabTest.step(0.3); CabTest.tick(0); return CabTest.game.sv; });
  await page.mouse.up();
  expect(steer).toBeGreaterThan(0.2);
  await expect(page.locator('.cab-wheelbar')).toBeVisible();

  // Finish the race by hand: 55.123 seconds on Sunset Strip.
  await page.evaluate(() => {
    const g = CabTest.game;
    g.steer('gas', false);
    g.lap = 3; g.total = 55.123; g.best = 18.2; g.result = 'Finished in 55.12s.'; g.over = true;
    CabTest.tick(0); // no time passes, so the race stays at 55.123
  });
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.over-panel .final-score')).toHaveText('0:55.12');

  const boxes = page.locator('.over-panel .ini');
  for (const [i, c] of ['R', 'C', 'E'].entries()) await boxes.nth(i).fill(c);
  await page.locator('.over-panel .save-btn').click();
  await expect.poll(async () => {
    const list = await (await page.request.get('/api/scores/racer?board=sunset')).json();
    return list.some(r => r.initials === 'RCE' && r.score === 55123);
  }).toBe(true);
  // The board shows times, not raw numbers.
  await expect(page.locator('.overlay:not(.hidden) .scores .pts').first()).toHaveText(/^\d+:\d\d\.\d\d$/);
  expect(problems).toEqual([]);
});
