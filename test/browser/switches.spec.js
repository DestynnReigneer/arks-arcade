'use strict';

// Switches and the banner from the sign-in service's admin console.
//
// The banner test answers /api/banner for its own page only (the server side
// is checked in the sign-in suite), so no other test running at the same time
// ever sees a banner appear and push its page down.
//
// The game test turns Dino Dash off for real, through the pretend sign-in
// service's /test/switches address (test/fake-arksid.js), then makes the
// arcade ask again straight away with a no-op save of its own game list,
// instead of waiting out the minute it keeps answers for.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const ID = `http://127.0.0.1:${PORT + 1}`;
const ADMIN = { 'X-Admin-Token': 'browser-test-admin' };
const BANNER = { id: 7, text: 'The arcade is getting an update tonight at 9.', tone: 'info', until: null, at: 1 };

test('the banner from the sign-in service shows at the top, and Hide tucks it away', async ({ page }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await page.route('**/api/banner', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ banner: BANNER }) }));
  await openPage(page, '/chess.html');
  const bar = page.locator('#arksBanner');
  await expect(bar).toContainText('The arcade is getting an update tonight at 9.');
  await expect(bar).toContainText('Heads up');
  expect(await page.evaluate(() => document.body.firstElementChild.id)).toBe('arksBanner');
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
  // It shows above the Who's playing card too. Hide it on the admin page, where
  // no card asks first; then it stays away on every page of this device.
  await openPage(page, '/admin.html');
  await bar.getByRole('button', { name: /Hide this message/ }).click();
  await expect(bar).toHaveCount(0);
  await openPage(page, '/');
  await page.waitForTimeout(500);
  await expect(page.locator('#arksBanner')).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

// This one changes what the pretend sign-in service says for every visitor,
// so it runs once, on the laptop size, and puts everything back afterwards.
test.describe('a switched-off game', () => {
  async function setSwitches(request, set) {
    expect((await request.post(`${ID}/test/switches`, { data: { set } })).ok()).toBe(true);
    const home = await (await request.get('/api/comm/admin/home-games', { headers: ADMIN })).json();
    const r = await request.post('/api/comm/admin/home-games', { headers: ADMIN, data: { order: home.order, hidden: home.hidden, closed: home.closed, sort: home.sort } });
    expect(r.ok()).toBe(true);
  }
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'laptop', 'changes shared state, so it runs on one size only'); });
  test.afterEach(async ({ request }, testInfo) => { if (testInfo.project.name === 'laptop') await setSwitches(request, {}); });

  test('shows the "Pardon our dust" sign', async ({ page, request }) => {
    await quietFonts(page);
    await setSwitches(request, { 'game.dino': { all: false } });
    await openPage(page, '/dino.html');
    const sign = page.locator('.dust-page');
    await expect(sign).toBeVisible();
    await expect(sign).toContainText('Dino Dash is getting some work done. Check back soon!');
    await expect(sign.getByRole('link', { name: 'Back to the arcade' })).toBeVisible();
    // Back on: the game is there again.
    await setSwitches(request, {});
    await openPage(page, '/dino.html');
    await page.waitForTimeout(500);
    await expect(page.locator('.dust-page')).toHaveCount(0);
  });
});
