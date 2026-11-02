'use strict';

// Moonshot in a real browser: start a run, swing at the first pitch at the
// perfect moment (the server's test-only hook, NODE_ENV=test, says when) and
// see the home run celebrated, let the rest of the pitches go by, and save
// the score to today's board.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('hitting a home run in Moonshot', async ({ page, isMobile }) => {
  test.setTimeout(110000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/moonshot.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play opens by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  if (isMobile) {
    // On a phone the whole cage and the SWING button fit on the screen.
    const btn = await page.locator('#swingBtn').boundingBox();
    expect(btn.y + btn.height).toBeLessThanOrEqual(844);
  }

  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  const runId = await page.evaluate(() => window.MoonshotClock.runId());
  const { n, perfect } = await (await page.request.get(`/api/moonshot/test/homer/${runId}?after=0`)).json();
  expect(n).toBe(1);

  // Wait in the page until the ball reaches the ring, then swing there and
  // then, through the page's own handlers (a press on the SWING button on a
  // phone, Space on a laptop). Doing it from inside the page keeps the
  // browser's round trips out of the timing.
  await page.evaluate(([at, phone]) => new Promise(resolve => {
    const go = () => {
      const left = at - window.MoonshotClock.elapsed();
      if (left > 30) { setTimeout(go, Math.min(left - 25, 200)); return; }
      while (window.MoonshotClock.elapsed() < at) { /* the last few ms */ }
      if (phone) document.getElementById('swingBtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      resolve();
    };
    go();
  }), [perfect, isMobile]);
  await expect(page.locator('.fx-banner .fx-title')).toHaveText('HOME RUN!');
  await expect(page.locator('#score')).toHaveText('100');

  // Nobody swings at the other eleven, so each is a strike, and the run ends.
  await expect(page.locator('#over')).toBeVisible({ timeout: 80000 });
  await expect(page.locator('#overScore')).toHaveText('100');
  await expect(page.locator('#overChips span')).toHaveCount(12);
  await expect(page.locator('#overChips span.homer')).toHaveCount(1);

  await page.locator('#iniRow .ini').first().focus();
  await page.keyboard.type('MST');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rankLine')).toHaveText(/best|#\d/);
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList')).toContainText('MST');

  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});
