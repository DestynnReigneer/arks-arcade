'use strict';

// Chess's results, with Back to setup and Play again on the screen. The games on
// the shared end window (end-window.js) are checked in end-window.spec.js.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function openGame(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}

// Presses a key until the game has started. (Picking "Play as a guest" can
// take a moment to settle, and a press before that does nothing.)
async function startWith(page, key, playing) {
  await expect(async () => {
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => document.body.dataset.state), { timeout: 1500 }).toBe(playing);
  }).toPass({ timeout: 10000 });
}

// Where the board is on the page, to check it doesn't move when the game ends.
const boardTop = (page, board) => page.locator(board).evaluate(e => e.getBoundingClientRect().top + window.scrollY);

// Every button is fully on the screen and below the top bar, the panel pops up
// over the page, and the board is where it was before the game ended.
async function expectOnTop(page, { panel, board, buttons, boardWas }) {
  await page.waitForTimeout(900);
  const view = await page.evaluate(() => ({ h: window.innerHeight, bar: document.querySelector('.ah').getBoundingClientRect().bottom }));
  for (const sel of buttons) {
    const box = await page.locator(sel).boundingBox();
    expect(box, `${sel} is showing`).not.toBeNull();
    expect(box.y, `${sel} is below the top bar`).toBeGreaterThanOrEqual(view.bar - 1);
    expect(box.y + box.height, `${sel} is on the screen`).toBeLessThanOrEqual(view.h);
  }
  if (board) {
    expect(await page.locator(panel).evaluate(e => getComputedStyle(e).position), 'the end panel pops up').toBe('fixed');
    expect(await boardTop(page, board), "the board didn't move").toBeCloseTo(boardWas, 0);
    await page.locator(`${panel} .end-peek`).click();
    await expect(page.locator(panel)).toBeHidden();
    await page.locator('.end-pill').click();
    await expect(page.locator(panel)).toBeVisible();
  }
}

test('Chess: Back to setup and Play again are at the top of the results', async ({ page }) => {
  const problems = await openGame(page, '/chess.html');
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('#resignBtn').click();
  // Resign asks on the page, in the arcade's own card.
  await page.locator('.ab-confirm [data-leave]').click();
  await expect(page.locator('#overView')).toBeVisible({ timeout: 10000 });
  await expectOnTop(page, { buttons: ['#menuBtn', '#againBtn'] });
  await page.locator('#menuBtn').click();
  await expect(page.locator('#setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});
