'use strict';

// Spin & Solve in a real browser: the turn clock follows the TV show. Nothing
// ticks while a player decides what to do, so it doesn't run before the first
// spin; it starts once the wheel stops (to call a letter) and when Solve is
// tapped, and stops again when the answer is in.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage, nextStep } = require('./helpers');

test('the Spin & Solve clock waits for the first spin', async ({ page }) => {
  test.setTimeout(90000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/spinsolve.html');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // One player, the 30-second clock.
  while (await page.locator('#nameList .name-row').count() > 1) await page.locator('#nameList .name-row:last-child button').click();
  await nextStep(page);
  await page.locator('#timerSeg [data-secs="30"]').click();
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();

  // Before the first spin the clock is full and says whose move it is.
  const text = page.locator('#ttText');
  await expect(text).toContainText('spin, buy a vowel or solve');
  await page.waitForTimeout(2500);
  await expect(text).toContainText('spin, buy a vowel or solve');
  await expect(page.locator('#turnTimer')).toHaveClass(/paused/);

  // Tapping Solve starts it; backing out stops it again.
  await page.locator('#solveBtn').click();
  await expect(text).toContainText(/\d+s to solve/);
  await page.locator('#solveCancel').click();
  await expect(text).toContainText('spin, buy a vowel or solve');

  // Spin until the wheel lands on money (Bankrupt and Lose a Turn pass the
  // turn, which in a solo game is a strike, so stop before the third).
  for (let i = 0; i < 2 && !(await page.locator('#letterView').isVisible()); i++) {
    await expect(page.locator('#spinBtn')).toBeEnabled({ timeout: 15000 });
    await page.locator('#spinBtn').click();
    await expect(page.locator('#letterView, #spinBtn:enabled').first()).toBeVisible({ timeout: 15000 });
  }
  if (await page.locator('#letterView').isVisible()) {
    await expect(text).toContainText(/\d+s to call a letter/);
    await page.locator('#letterGrid button:not(:disabled)').first().click();
    await expect(page.locator('#letterView')).toBeHidden();
    // Whether the letter was there or not, the clock waits for the next move.
    await expect(text).toContainText('spin, buy a vowel or solve', { timeout: 15000 });
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

// On a phone held upright, only the top half of the wheel shows and each player's
// total moves off their card into the top bar's menu, as Scores so far.
test('on a phone, the totals are in the menu and the wheel is cut at the hub', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'A phone-only layout.');
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/spinsolve.html');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await nextStep(page);
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();

  // The wheel's middle sits on the gold line at the bottom of its window, and the
  // top of the rim (with room for the pointer) is inside it.
  const fit = await page.evaluate(() => {
    const area = document.querySelector('#game > .wheel-area').getBoundingClientRect();
    const wheel = document.getElementById('wheel').getBoundingClientRect();
    const rim = document.querySelector('#wheelStatic circle[r="104"]').getBoundingClientRect();
    // area.bottom is under the 2px gold line; the middle sits right on top of it.
    return { mid: wheel.top + wheel.height / 2 - (area.bottom - 2), rimTop: rim.top - area.top };
  });
  expect(Math.abs(fit.mid)).toBeLessThan(2);
  expect(fit.rimTop).toBeGreaterThanOrEqual(14);
  await expect(page.locator('#playerList .pt').first()).toBeHidden();

  await page.locator('.ah-waffle').click();
  await page.locator('.ah-menu .grid button', { hasText: 'Scores so far' }).click();
  await expect(page.locator('#totalsView')).toBeVisible();
  await expect(page.locator('#totalsList li')).toHaveCount(await page.locator('#playerList li').count());
  await page.locator('#totalsClose').click();
  await expect(page.locator('#totalsView')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

// A two-line message under the wheel ("2 N's! Player 1, go again: ...") mustn't
// push the buttons off a short phone or make the wheel jump in size, and the turn
// clock is a bar you can read, not a sliver.
for (const [w, h] of [[412, 640], [360, 740], [390, 844]]) {
  test(`a long turn message keeps everything in place on a ${w}×${h} phone`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'A phone-only layout.');
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await quietFonts(page);
    await openPage(page, '/spinsolve.html');
    const guest = page.getByRole('button', { name: /Play as a guest/ });
    if (await guest.isVisible().catch(() => false)) {
      await guest.click();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
    }
    const close = page.locator('.tut-x');
    if (await close.isVisible().catch(() => false)) await close.click();
    await nextStep(page);
    await page.locator('#goBtn').click();
    await expect(page.locator('#game')).toBeVisible();
    await page.waitForTimeout(400);
    const wheelWidth = () => page.locator('#wheel').evaluate(el => el.getBoundingClientRect().width);
    const before = await wheelWidth();
    await page.locator('#turnLine').evaluate(el => { el.textContent = "2 N's! Player 1, go again: spin, buy a vowel, or solve."; });
    await page.waitForTimeout(300);
    expect(Math.abs((await wheelWidth()) - before)).toBeLessThan(2);
    for (const sel of ['#spinBtn', '#vowelBtn', '#solveBtn']) {
      const r = await page.locator(sel).boundingBox();
      expect(r.y + r.height, `${sel} runs off the bottom`).toBeLessThanOrEqual(h + 1);
    }
    const timer = await page.locator('#turnTimer').boundingBox();
    expect(timer && timer.width).toBeGreaterThan(150);
    await ctx.close();
  });
}
