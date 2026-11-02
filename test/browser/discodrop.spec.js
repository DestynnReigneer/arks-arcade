'use strict';

// Disco Drop in a real browser: start a run, drop the first ball at a moment
// that lands it in the jackpot (the server's test-only hook, NODE_ENV=test,
// says when), see the jackpot celebrated, drop the other nine, and save the
// score to today's board.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('dropping balls in Disco Drop', async ({ page, isMobile }) => {
  test.setTimeout(75000);
  await quietFonts(page);
  const problems = watchProblems(page);
  // The page's clock, so the test can stop time at the right moment (below).
  // It runs at the normal speed until then.
  await page.clock.install();
  await openPage(page, '/discodrop.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play opens by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  await expect(page.locator('#dropBtn')).toBeEnabled();

  const drop = async () => {
    if (isMobile) await page.locator('#stage').tap({ position: { x: 60, y: 60 } });
    else await page.keyboard.press('Space');
  };

  // When should the first ball go to land in the jackpot? Aim for the middle
  // of a window that's wide enough to hit from a test.
  const runId = await page.evaluate(() => window.DiscoDropClock.runId());
  const now = await page.evaluate(() => window.DiscoDropClock.elapsed());
  const { windows } = await (await page.request.get(`/api/discodrop/test/jackpot/${runId}?after=${now + 3000}`)).json();
  const [lo, hi] = windows.find(([a, b]) => b - a >= 120);
  const aim = Math.floor((lo + hi) / 2);
  // Waiting for that moment and then pressing used to be a race: the press
  // takes a while to reach the page (on a busy machine, a tap took up to half
  // a second), so the ball sometimes let go after the jackpot cup had passed
  // and the test failed now and then. Instead the page's clock is stopped a
  // little early, the test waits until the arcade's own clock is past the
  // moment (a drop from the future is turned away), moves the page's clock
  // to exactly that moment, and drops the ball while time stands still. The
  // arcade still checks the drop as usual.
  await page.waitForFunction(t => window.DiscoDropClock.elapsed() >= t, aim - 2500, { polling: 'raf', timeout: 40000 });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const paused = await page.evaluate(() => window.DiscoDropClock.elapsed());
  // The page's clock jumped a second ahead, so the real moment comes a second later.
  await new Promise(done => setTimeout(done, aim - paused + 1000 + 150));
  await page.clock.runFor(aim - paused);
  expect(await page.evaluate(() => window.DiscoDropClock.elapsed())).toBe(aim);
  await drop();
  await page.clock.resume();
  await expect(page.locator('.fx-banner .fx-title')).toHaveText('JACKPOT!');
  await expect(page.locator('#score')).toHaveText('500');

  // The other nine, as soon as each new ball is on the arm.
  for (let i = 2; i <= 10; i++) {
    await expect(page.locator('#ball')).toHaveText(`${i} of 10`);
    await expect(page.locator('#dropBtn')).toBeEnabled();
    await drop();
  }

  await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
  const total = Number((await page.locator('#overScore').textContent()).replace(/,/g, ''));
  expect(total).toBeGreaterThanOrEqual(500);
  await expect(page.locator('#overChips span')).toHaveCount(10);

  await page.locator('#iniRow .ini').first().focus();
  await page.keyboard.type('DDT');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rankLine')).toHaveText(/best|#\d/);
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList')).toContainText('DDT');

  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});
