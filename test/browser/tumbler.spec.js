'use strict';

// Tumbler Rumble in a real browser: start a run, pop every pin on the first
// lock through the page (a tap on the POP button on a phone, Space on a
// laptop), let the run end, and save the score the server worked out. When
// to tap comes from a helper the page only has under the test suites (the
// server turns it on only when NODE_ENV=test).

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('popping the first lock in Tumbler Rumble', async ({ page, isMobile }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/tumbler.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play opens by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  if (isMobile) {
    // On a phone the whole lock and the POP button fit on the screen.
    const pop = await page.locator('#popBtn').boundingBox();
    expect(pop.y + pop.height).toBeLessThanOrEqual(844);
  }

  // Start the run with a real tap or key press. (Picking "Play as a guest"
  // can take a moment to settle, so this tries again if the first press
  // landed too early; a press while the lock is getting ready does nothing.)
  await expect(async () => {
    if (isMobile) await page.locator('#popBtn').tap();
    else await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => !!window.TumblerTest), { timeout: 1500 }).toBe(true);
  }).toPass({ timeout: 10000 });

  for (let pin = 0; pin < 3; pin++) {
    // Wait in the page until the marker is on the pin, then tap there and
    // then, through the page's own handlers (a pointer press on the POP
    // button on a phone, Space on a laptop). Doing it from inside the page
    // keeps the browser's round trips out of the timing.
    await page.evaluate(phone => new Promise(resolve => {
      const go = () => {
        const ms = window.TumblerTest.msToNextPin();
        if (ms > 3) { setTimeout(go, Math.min(ms - 2, 40)); return; }
        if (phone) document.getElementById('popBtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        else window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        resolve();
      };
      go();
    }), isMobile);
  }
  await expect(page.locator('#hudLevel')).toHaveText('2');
  await expect(page.locator('#hudPins')).toHaveText('4');

  // Nobody taps on lock 2, so the marker slips past its first pin.
  await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overTitle')).toContainText('slipped past');
  await expect(page.locator('#overDetail')).toContainText('reached lock 2, popped 3 pins');
  const score = Number((await page.locator('#hudScore').textContent()).replace(/,/g, ''));
  expect(score).toBeGreaterThanOrEqual(80);

  const boxes = page.locator('#iniRow .ini');
  await boxes.nth(0).fill('T');
  await boxes.nth(1).fill('R');
  await boxes.nth(2).fill('B');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rankLine')).toContainText(/#\d+|best Tumbler Rumble score ever/);
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList li.me')).toContainText('TRB');

  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});
