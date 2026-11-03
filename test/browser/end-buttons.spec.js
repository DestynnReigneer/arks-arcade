'use strict';

// When a game ends, Play again (and Back to setup, where a game has one)
// sits above the board, on the screen without any scrolling, on a phone
// (390 by 844) and on a laptop.

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

// Every button is fully on the screen, below the top bar, and the end panel
// ends before the board starts.
async function expectOnTop(page, { panel, board, buttons }) {
  // Wait for the panel's own scroll into view to finish.
  await page.waitForTimeout(900);
  const view = await page.evaluate(() => ({ h: window.innerHeight, bar: document.querySelector('.ah').getBoundingClientRect().bottom }));
  for (const sel of buttons) {
    const box = await page.locator(sel).boundingBox();
    expect(box, `${sel} is showing`).not.toBeNull();
    expect(box.y, `${sel} is below the top bar`).toBeGreaterThanOrEqual(view.bar - 1);
    expect(box.y + box.height, `${sel} is on the screen`).toBeLessThanOrEqual(view.h);
  }
  if (board) {
    const p = await page.locator(panel).boundingBox();
    const b = await page.locator(board).boundingBox();
    expect(p.y + p.height, 'the end panel is above the board').toBeLessThanOrEqual(b.y + 1);
  }
}

test('Snake: Play again is above the board when a run ends', async ({ page }) => {
  const problems = await openGame(page, '/snake.html');
  await startWith(page, 'ArrowUp', 'playing');
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 20000 });
  await expectOnTop(page, { panel: '.over-panel', board: '#stage', buttons: ['.over-panel .again-btn'] });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Dino Dash: Run again is above the desert when a run ends', async ({ page }) => {
  const problems = await openGame(page, '/dino.html');
  await startWith(page, 'Space', 'running');
  await expect(page.locator('#overPanel')).toBeVisible({ timeout: 30000 });
  await expectOnTop(page, { panel: '#overPanel', board: '.dino-stage', buttons: ['#againBtn'] });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Tumbler Rumble: Play again is above the lock when a run ends', async ({ page }) => {
  const problems = await openGame(page, '/tumbler.html');
  await expect(async () => {
    await page.locator('#stage').click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.state), { timeout: 1500 }).toBe('playing');
  }).toPass({ timeout: 10000 });
  // Nobody taps, so the marker slips past the first pin and the run ends.
  await expect(page.locator('#over')).toBeVisible({ timeout: 20000 });
  await expectOnTop(page, { panel: '#over', board: '#zone', buttons: ['#againBtn'] });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Chess: Back to setup and Play again are at the top of the results', async ({ page }) => {
  const problems = await openGame(page, '/chess.html');
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  page.on('dialog', d => d.accept());
  await page.locator('#resignBtn').click();
  await expect(page.locator('#overView')).toBeVisible({ timeout: 10000 });
  await expectOnTop(page, { buttons: ['#menuBtn', '#againBtn'] });
  await page.locator('#menuBtn').click();
  await expect(page.locator('#setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});
