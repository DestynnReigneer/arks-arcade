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

// The whole menu, Cancel included, fits on the screen: low on a laptop, on a phone
// turned sideways, and after the phone turns while it's open.
for (const [label, size, touch] of [['a laptop', { width: 1366, height: 768 }, false], ['a phone turned sideways', { width: 844, height: 390 }, true], ['a small phone turned sideways', { width: 740, height: 360 }, true]]) {
  test(`the quick menu fits on ${label}`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here.');
    const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    await home(page);
    const last = page.locator('.games > .game').last();
    await last.scrollIntoViewIfNeeded();
    await last.click({ button: 'right' });
    await page.waitForTimeout(300);
    const box = await page.locator('.lp-card').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    const cancel = await page.locator('.lp-cancel').boundingBox();
    expect(cancel.y + cancel.height).toBeLessThanOrEqual(size.height + 1);
    await ctx.close();
  });
}

test('the quick menu is placed again when the phone turns', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The sizes are set here.');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await home(page);
  await page.locator('.game.sudoku').click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  const box = await page.locator('.lp-card').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(391);
  await ctx.close();
});

// A lobby link from the menu lands with what it opened in view, and the game's
// rules don't pop up over it on a first visit.
for (const [game, show] of [['rambler', '#startBtn'], ['trivia', '#goBtn']]) {
  test(`Create a game lobby in ${game} lands in view`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'A phone check.');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await quietFonts(page);
    await openPage(page, `/${game}.html?go=create`);
    const guest = page.getByRole('button', { name: /Play as a guest/ });
    if (await guest.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      await guest.click();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
    }
    await page.waitForTimeout(1500);
    await expect(page.locator('.tut-x')).toBeHidden();
    const r = await page.locator(show).boundingBox();
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBeLessThanOrEqual(844);
    await ctx.close();
  });
}

// A row in the Lobbies list has its own quick menu: join it, show its QR code, or go to
// that game to make your own lobby or read how to play.
test('a row in the Lobbies list opens its quick menu', async ({ page }) => {
  const problems = watchProblems(page);
  const room = {
    game: 'chess', label: 'Chess', emoji: '♞', page: 'chess.html', href: 'chess.html?join=ABCD',
    code: 'ABCD', host: 'Sam', players: 1, max: 2, status: 'open', detail: 'Multiplayer-Multiple devices'
  };
  await page.route('**/api/lobby', route => route.fulfill({ json: { rooms: [room], publicUrl: 'http://localhost' } }));
  await home(page);
  const row = page.locator('#lobbyList li').first();
  await expect(row).toContainText("Sam's game");

  await row.click({ button: 'right' });
  const card = page.locator('.lp-card');
  await expect(card).toContainText("Chess · Sam's game");
  for (const name of ['Join', 'Show QR code', 'Create a game lobby', 'How to play', 'Trophies']) {
    await expect(card.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible();
  }
  // The list refreshing every few seconds leaves the open menu alone.
  await page.waitForTimeout(5600);
  await expect(card).toBeVisible();

  await card.getByRole('menuitem', { name: /Show QR code/ }).click();
  const big = page.locator('.qr-big');
  await expect(big).toBeVisible();
  await expect(big.locator('img')).toHaveAttribute('src', /join%3DABCD/);
  await big.getByRole('button', { name: 'Close' }).click();
  await expect(big).toHaveCount(0);

  // A full lobby can't be joined, so its menu has no Join or QR code.
  room.status = 'full';
  await page.reload();
  await page.locator('#lobbyList li').first().click({ button: 'right' });
  await expect(card.getByRole('menuitem', { name: /Create a game lobby/ })).toBeVisible();
  await expect(card.getByRole('menuitem', { name: /Join/ })).toHaveCount(0);
  await expect(card.getByRole('menuitem', { name: /QR/ })).toHaveCount(0);
  await card.getByRole('menuitem', { name: /Create a game lobby/ }).click();
  await expect(page).toHaveURL(/chess\.html\?go=create/);
  expect(problems, problems.join('\n')).toEqual([]);
});
