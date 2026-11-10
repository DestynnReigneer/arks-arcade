'use strict';

// Tumbler Rumble in a real browser: start a run, watch the 3, 2, 1
// countdown with the POP button dimmed, pop three pins through the page (a
// tap on the POP button on a phone, Space on a laptop), let the run end, and
// save the score the server worked out. When
// to tap comes from a helper the page only has under the test suites (the
// server turns it on only when NODE_ENV=test).

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('a countdown, then three pops in Tumbler Rumble', async ({ page, isMobile }) => {
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

  // The countdown: the button is dimmed, can't be pressed and counts down,
  // then lights up as POP! when the light starts moving.
  const pop = page.locator('#popBtn');
  await expect(pop).toBeDisabled();
  await expect(pop).toHaveText(/^[123]$/);
  await expect(pop).toHaveText('POP!', { timeout: 5000 });
  await expect(pop).toBeEnabled();

  for (let pin = 0; pin < 3; pin++) {
    await expect(page.locator('#hudPops')).toHaveText(String(pin));
    if (pin === 1) await expect(page.locator('#hudPace')).toHaveText('Harder');
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
  await expect(page.locator('#hudPops')).toHaveText('3');

  // Nobody taps the fourth pin, so the marker slips past it and the run ends.
  await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overTitle')).toContainText('slipped past');
  await expect(page.locator('#overDetail')).toContainText('popped 3 locks in a row and made it to wave 1');
  await expect(page.locator('#overScore')).toHaveText('3');
  await expect(pop).toBeDisabled();

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
