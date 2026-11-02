'use strict';

// Roll Royale in a real browser: start a run, roll the first ball into the
// middle ring through the page (a press on the ROLL button on a phone, Space
// on a laptop), roll the other 8 softly, and save the score the server
// worked out. When to press and how long to hold comes from a helper the
// page only has under the test suites (the server turns it on only when
// NODE_ENV=test).

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('rolling a run of Roll Royale', async ({ page, isMobile }) => {
  test.setTimeout(90000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/royale.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play opens by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  if (isMobile) {
    // On a phone the whole lane and the ROLL button fit on the screen.
    const roll = await page.locator('#rollBtn').boundingBox();
    expect(roll.y + roll.height).toBeLessThanOrEqual(844);
  }

  // Start the run with a real press. (Picking "Play as a guest" can take a
  // moment to settle, so this tries again if the first press landed too early.)
  await expect(async () => {
    if (isMobile) await page.locator('#rollBtn').tap();
    else await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => !!window.RoyaleTest), { timeout: 1500 }).toBe(true);
  }).toPass({ timeout: 10000 });

  // Each ball: wait in the page until the planned moment, press, wait out the
  // planned hold, and let go, through the page's own handlers (a pointer on
  // the ROLL button on a phone, Space on a laptop). Doing it inside the page
  // keeps the browser's round trips out of the timing.
  const roll = (target, phone) => page.evaluate(([target, phone]) => new Promise(resolve => {
    const T = window.RoyaleTest;
    const btn = document.getElementById('rollBtn');
    const press = () => (phone ? btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      : window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    const release = () => (phone ? window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
      : window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })));
    const until = (at, then) => {
      const go = () => {
        const ms = at - T.gameTime();
        if (ms > 2) { setTimeout(go, Math.min(ms - 1, 40)); return; }
        then();
      };
      go();
    };
    const waitReady = () => {
      const ms = T.msToReady();
      const st = T.state();
      if (ms > 0 || st.landed < st.ball) { setTimeout(waitReady, 30); return; }
      if (target === 'soft') {
        press();
        const at = T.gameTime() + 150;
        until(at, () => { release(); resolve(); });
        return;
      }
      const plan = T.plan(target);
      until(plan.pressAt, () => {
        press();
        const at = T.gameTime() + plan.holdMs;
        until(at, () => { release(); resolve(); });
      });
    };
    waitReady();
  }), [target, phone]);

  await roll('bull', isMobile);
  // The first ball drops into the middle ring (or right next to it).
  await expect.poll(() => page.evaluate(() => window.RoyaleTest.state().rings[0]), { timeout: 5000 }).toBeGreaterThanOrEqual(40);
  const first = await page.evaluate(() => window.RoyaleTest.state().rings[0]);
  await expect(page.locator('#hudLast')).toHaveText(String(first));
  await expect(page.locator('#hudBall')).toHaveText('2');

  for (let i = 1; i < 9; i++) await roll('soft', isMobile);

  await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overTitle')).toContainText('all 9 balls');
  await expect(page.locator('#tally li')).toHaveCount(9);
  await expect(page.locator('#tally li').first()).toHaveText(String(first));
  // The soft rolls all fall short, so the server's score is the first ball's.
  await expect(page.locator('#hudScore')).toHaveText(String(first));

  const boxes = page.locator('#iniRow .ini');
  await boxes.nth(0).fill('R');
  await boxes.nth(1).fill('O');
  await boxes.nth(2).fill('L');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rankLine')).toContainText(/#\d+|best Roll Royale score ever/);
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList li.me')).toContainText('ROL');

  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});
