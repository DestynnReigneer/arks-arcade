'use strict';

// Clueless Crosswords in a real browser: start today's family mini, type every letter
// through the page (the on-screen keyboard on a phone, the real keyboard on a
// laptop) and see it solved. The letters come from a hook the server only
// has under the test suite (NODE_ENV=test).

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('solving the family mini in Clueless', async ({ page, isMobile }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/clueless.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play opens by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  await expect(page.locator('#clueText')).not.toHaveText(/Tap Start/);

  if (isMobile) {
    // On a phone the clue bar, the grid and the keyboard all fit on the screen.
    const bar = await page.locator('#clueBar').boundingBox();
    const keys = await page.locator('#keys').boundingBox();
    const grid = await page.locator('#grid').boundingBox();
    expect(bar.y + bar.height).toBeLessThanOrEqual(grid.y + 1);
    expect(grid.y + grid.height).toBeLessThanOrEqual(keys.y);
    expect(keys.y + keys.height).toBeLessThanOrEqual(844 + 1);
  }

  const runId = await page.evaluate(() => Object.keys(localStorage).filter(k => /^clueless\.current\.\d/.test(k)).map(k => localStorage.getItem(k))[0]);
  expect(runId).toMatch(/^[0-9a-f]{32}$/);
  const { letters } = await (await page.request.get(`/api/clueless/test/answer/${runId}`)).json();

  const cells = page.locator('#grid .cl-cell');
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] === '#') continue;
    const cell = cells.nth(i);
    if (!/\bsel\b/.test(await cell.getAttribute('class'))) await cell.click();
    if (isMobile) await page.locator(`#keys [data-key="${letters[i]}"]`).tap();
    else await page.keyboard.press(letters[i].toLowerCase());
  }

  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#overTitle')).toContainText('solved');
  await expect(page.locator('#overTime')).toHaveText(/^\d+:\d{2}$/);
  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});

// Typing never changes the size of a square, a right word is crossed off,
// and free play's New board swaps the crossword until the first letter.
test('Clueless Crosswords: steady squares, crossed-off clues and New board', async ({ page, isMobile }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/clueless.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect(page).toHaveTitle('Clueless Crosswords');

  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  const runId = await page.evaluate(() => Object.keys(localStorage).filter(k => /^clueless\.current\.\d/.test(k)).map(k => localStorage.getItem(k))[0]);
  const { letters } = await (await page.request.get(`/api/clueless/test/answer/${runId}`)).json();
  const sizes = () => page.locator('#grid .cl-cell').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return `${r.width.toFixed(1)}x${r.height.toFixed(1)}`; }).join());
  const before = await sizes();

  // Across is one color and down another.
  const across = await page.locator('.cl-cell.sel').evaluate(e => getComputedStyle(e).backgroundColor);
  await page.locator('#dirBtn').click();
  const down = await page.locator('.cl-cell.sel').evaluate(e => getComputedStyle(e).backgroundColor);
  if (await page.locator('#dirBtn small').textContent() === 'Down') expect(down).not.toBe(across);
  // On a phone the clue lists are in the top bar's menu, so open them there first.
  if (!(await page.locator('#acrossList li').first().isVisible())) {
    await page.locator('.ah-waffle').click();
    await page.getByRole('button', { name: /All the clues/ }).click();
  }
  await page.locator('#acrossList li').first().click();
  // Picking a clue there closes the list, back to the grid.
  await expect(page.locator('body')).not.toHaveClass(/cl-clues-open/);

  // Type the first across word right: it's crossed off, and no square moved.
  const first = await page.evaluate(() => {
    const li = document.querySelector('#acrossList li');
    return li.querySelector('b').textContent;
  });
  const sel = () => page.locator('.cl-cell.sel').evaluate(e => [...e.parentNode.children].indexOf(e));
  const wordLen = await page.locator('.cl-cell.word').count();
  for (let k = 0; k < wordLen; k++) {
    const i = await sel();
    if (isMobile) await page.locator(`#keys [data-key="${letters[i]}"]`).tap();
    else await page.keyboard.press(letters[i].toLowerCase());
  }
  await expect(page.locator('#acrossList li.solved').first()).toContainText(first);
  expect(await sizes()).toBe(before);

  // Free play: New board until the first letter.
  await page.locator('#modeSeg button', { hasText: 'Free play' }).click();
  await page.locator('#coverBtn').click();
  await expect(page.locator('#freeBar')).toBeVisible();
  await expect(page.locator('#dayLabel')).toHaveText('Free play');
  const clues = () => page.locator('.cl-lists li').allTextContents().then(t => t.join('|'));
  const one = await clues();
  await page.locator('#newBoardBtn').click();
  await expect.poll(clues).not.toBe(one);
  if (isMobile) await page.locator('#keys [data-key="E"]').tap();
  else await page.keyboard.press('e');
  await expect(page.locator('#freeBar')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});
