'use strict';

// The home page's game cards and their quick menu (press and hold, or right-click):
// Play, today's levels, the lobby choices, How to play, Trophies, and arranging your
// games (Move to the front, Move to the bottom, Reorder games), with Cancel at the
// bottom. A guest's order stays on the device, so it survives a reload.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function home(page) {
  await quietFonts(page);
  await openPage(page, '/');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  await expect(page.locator('.games .game.sudoku')).toBeVisible();
}
const order = page => page.locator('.games > .game').evaluateAll(cards => cards.map(c => c.classList[1]));

test('a game card opens its quick menu, and Cancel closes it', async ({ page }) => {
  const problems = watchProblems(page);
  await home(page);
  await expect(page.locator('.game.sudoku .short')).toBeVisible();
  await expect(page.locator('.game.sudoku .meta')).toHaveCount(0);

  await page.locator('.game.sudoku').click({ button: 'right' });
  const card = page.locator('.lp-card');
  await expect(card).toBeVisible();
  for (const name of ['Play', 'How to play', 'Trophies', 'Move to the front', 'Move to the bottom', 'Reorder games']) {
    await expect(card.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(card).toContainText("Jump to today's puzzle");
  await expect(card.getByRole('menuitem', { name: 'Hard', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toBeHidden();

  // Chess has its lobby choices, and Dare Devil has no Trophies.
  await page.locator('.game.chess').click({ button: 'right' });
  await expect(card.getByRole('menuitem', { name: /Create a game lobby/ })).toBeVisible();
  await expect(card.getByRole('menuitem', { name: /List Hosted Games/ })).toBeVisible();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.game.daredevil').click({ button: 'right' });
  await expect(card.getByRole('menuitem', { name: /Trophies/ })).toHaveCount(0);
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Today's Hard puzzle goes straight to it.
  await page.locator('.game.sudoku').click({ button: 'right' });
  await card.getByRole('menuitem', { name: 'Hard', exact: true }).click();
  await expect(page).toHaveURL(/sudoku\.html\?level=hard/);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('How to play from the quick menu opens the game with its rules showing', async ({ page }) => {
  await home(page);
  await page.locator('.game.snake').click({ button: 'right' });
  await page.locator('.lp-card').getByRole('menuitem', { name: /How to play/ }).click();
  await expect(page).toHaveURL(/snake\.html/);
  await expect(page.locator('.tut-card, .tut').first()).toBeVisible();
  await expect(page).not.toHaveURL(/go=help/);
});

test('pinning, sinking and reordering games stays put after a reload', async ({ page }) => {
  const problems = watchProblems(page);
  await home(page);
  const card = page.locator('.lp-card');

  await page.locator('.game.sudoku').click({ button: 'right' });
  await card.getByRole('menuitem', { name: /Move to the front/ }).click();
  expect((await order(page))[0]).toBe('sudoku');
  await expect(page.locator('.game.sudoku .pin')).toBeVisible();

  await page.locator('.game.chess').click({ button: 'right' });
  await card.getByRole('menuitem', { name: /Move to the bottom/ }).click();
  expect((await order(page)).at(-1)).toBe('chess');

  await page.reload();
  await expect(page.locator('.game.sudoku .pin')).toBeVisible();
  const kept = await order(page);
  expect(kept[0]).toBe('sudoku');
  expect(kept.at(-1)).toBe('chess');

  // Reorder games: dotted outlines, and Cancel puts it all back.
  await page.locator('.game.dino').click({ button: 'right' });
  await card.getByRole('menuitem', { name: /Reorder games/ }).click();
  await expect(page.locator('.games.reorder')).toBeVisible();
  await expect(page.locator('.reorder-bar')).toBeVisible();
  await page.locator('.game.snake').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  expect(await order(page)).not.toEqual(kept);
  await page.locator('.reorder-bar .rb-cancel').click();
  expect(await order(page)).toEqual(kept);
  await expect(page.locator('.games.reorder')).toHaveCount(0);

  // Moving a game in front of the pinned one unpins it; Done keeps the new order.
  await page.locator('.game.dino').click({ button: 'right' });
  await card.getByRole('menuitem', { name: /Reorder games/ }).click();
  await page.locator('.game.bricks').focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  await page.locator('.reorder-bar .rb-done').click();
  const done = await order(page);
  expect(done[0]).toBe('bricks');
  await expect(page.locator('.game.sudoku .pin')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.games > .game').first()).toHaveClass(/bricks/);
  expect(problems, problems.join('\n')).toEqual([]);
});
