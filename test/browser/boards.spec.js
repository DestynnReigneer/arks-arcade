'use strict';

// The admin page's Boards tab: take one score off a board with two taps, see
// it in the list underneath, and put it back.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

test('the admin takes one score off a board with two taps, and puts it back', async ({ page }, info) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  // Each screen size gets its own initials and board, so the two runs never trip over each other.
  const ini = info.project.name === 'phone' ? 'PHN' : 'LAP';
  const board = info.project.name === 'phone' ? 'classic' : 'wrap';
  const posted = await (await page.request.post('/api/scores/snake', { data: { initials: ini, score: 199000, board } })).json();
  expect(posted.rank).toBe(1);
  // Signing in through the page's own request sets the admin cookie for the page too.
  expect((await page.request.post('/api/admin/login', { data: { password: 'browser-test-admin' } })).ok()).toBe(true);
  await openPage(page, '/admin.html');
  await page.locator('#tabBoards').click();
  await page.locator('#boardsGame').selectOption('snake');
  await page.locator('#boardsBoard').selectOption(board);
  const row = page.locator('#boardsList .row', { hasText: ini });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('#1');

  // The first tap only asks.
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(row.getByRole('button')).toHaveText('Tap again to remove');
  await expect(page.locator('#boardsList .row', { hasText: ini })).toHaveCount(1);
  // The second one does it.
  await row.getByRole('button').click();
  await expect(page.locator('#boardsList .row', { hasText: ini })).toHaveCount(0);
  const gone = page.locator('#boardsRemoved .row', { hasText: ini });
  await expect(gone).toContainText('taken off');
  await expect(gone).toContainText('by the admin page');
  const live = await (await page.request.get(`/api/scores/snake?board=${board}`)).json();
  expect(live.some(r => r.id === posted.id)).toBe(false);

  await gone.getByRole('button', { name: 'Put back' }).click();
  await expect(page.locator('#boardsList .row', { hasText: ini })).toHaveCount(1);
  await expect(page.locator('#boardsRemoved .row', { hasText: ini })).toHaveCount(0);
  const back = await (await page.request.get(`/api/scores/snake?board=${board}`)).json();
  expect(back[0].id).toBe(posted.id);

  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
  expect(problems, problems.join('\n')).toEqual([]);
});
