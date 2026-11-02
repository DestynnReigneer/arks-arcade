'use strict';

// Switches and the banner from the sign-in service's admin console. The
// pretend sign-in service's /test/... addresses (test/fake-arksid.js) play
// its admin: they turn a game off and put up a banner. A no-op save of the
// arcade's own game list makes the arcade ask again straight away instead of
// after the minute it keeps answers for.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const ID = `http://127.0.0.1:${PORT + 1}`;
const ADMIN = { 'X-Admin-Token': 'browser-test-admin' };

async function service(request, what, data) {
  expect((await request.post(`${ID}/test/${what}`, { data })).ok()).toBe(true);
  const home = await (await request.get('/api/comm/admin/home-games', { headers: ADMIN })).json();
  const r = await request.post('/api/comm/admin/home-games', { headers: ADMIN, data: { order: home.order, hidden: home.hidden, closed: home.closed, sort: home.sort } });
  expect(r.ok()).toBe(true);
}

// These change what the pretend sign-in service says for every visitor, so
// they run once (on the laptop size), one after the other, and never next to
// themselves on the phone size.
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'laptop', 'changes shared state, so it runs on one size only'); });
test.afterEach(async ({ request }, testInfo) => {
  if (testInfo.project.name !== 'laptop') return;
  await service(request, 'switches', { set: {} });
  await service(request, 'banner', { banner: null });
});

test('the banner from the sign-in service shows at the top, and Hide tucks it away', async ({ page, request }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await service(request, 'banner', { banner: { id: 7, text: 'The arcade is getting an update tonight at 9.', tone: 'info', until: null, at: Date.now() } });
  await openPage(page, '/chess.html');
  const bar = page.locator('#arksBanner');
  await expect(bar).toContainText('The arcade is getting an update tonight at 9.');
  await expect(bar).toContainText('Heads up');
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

test('a game switched off in the sign-in service shows the "Pardon our dust" sign', async ({ page, request }) => {
  await quietFonts(page);
  await service(request, 'switches', { set: { 'game.dino': { all: false } } });
  await openPage(page, '/dino.html');
  const sign = page.locator('.dust-page');
  await expect(sign).toBeVisible();
  await expect(sign).toContainText('Dino Dash is getting some work done. Check back soon!');
  await expect(sign.getByRole('link', { name: 'Back to the arcade' })).toBeVisible();
  // Back on: the game is there again.
  await service(request, 'switches', { set: {} });
  await openPage(page, '/dino.html');
  await page.waitForTimeout(500);
  await expect(page.locator('.dust-page')).toHaveCount(0);
});
