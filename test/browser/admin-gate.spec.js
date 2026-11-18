'use strict';

// The admin page's way in, for someone who isn't the admin: the not-the-admin
// card, its link to recovery, and the Click Here card when the password is
// wrong too. (An ARKS ID admin going straight in is in test/arksid.test.js.)

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

test.beforeEach(async ({ page }) => { await quietFonts(page); });

test('someone who is not the admin gets the not-the-admin card, then recovery, then where to look', async ({ page }) => {
  await openPage(page, '/admin.html');
  const nope = page.locator('#gateNope');
  await expect(nope).toBeVisible();
  await expect(nope).toContainText('U n0 1337, 4DmiN');
  await expect(nope.getByRole('button', { name: 'Oops, back to safety' })).toBeVisible();
  await expect(page.locator('#adminContent')).toBeHidden();
  // The link leads to recovery: the PIN pad when there's an admin PIN, the password otherwise.
  await page.locator('#nopeRecover').click();
  await expect(page.locator('#gatePin, #gatePw').locator('visible=true').first()).toBeVisible();
  if (await page.locator('#gatePin').isVisible()) await page.locator('#usePw').click();
  await expect(page.locator('#gatePw')).toBeVisible();
  await page.locator('#tokenInput').fill('not the admin password');
  await page.locator('#unlockBtn').click();
  await expect(page.locator('#gateHelp')).toBeVisible();
  await expect(page.locator('#helpLink')).toHaveAttribute('href', /arks-arcade\/blob\/main\/docs\/SETUP\.md#3-the-env-file/);
  await expect(page.locator('#adminContent')).toBeHidden();
  // Nothing runs off the side of a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the admin page opens with the password, every tab is there, and Lock closes it again', async ({ page }) => {
  expect((await page.request.post('/api/admin/login', { data: { password: 'browser-test-admin' } })).ok()).toBe(true);
  await openPage(page, '/admin.html');
  await expect(page.locator('#adminContent')).toBeVisible();
  for (const tab of ['tabArcade', 'tabBoards', 'tabStats', 'tabGames', 'tabRambler', 'tabWordless', 'tabSpin', 'tabTrivia', 'tabClueless']) {
    await page.locator('#' + tab).click();
    await expect(page.locator('#' + tab)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#tabArcade').click();
  await expect(page.locator('#arcadePanel')).toBeVisible();
  await expect(page.locator('#lockBtn')).toBeVisible();
  await page.locator('#lockBtn').click();
  await expect(page.locator('#adminContent')).toBeHidden();
  await expect(page.locator('#lockScreen')).toBeVisible();
});

// The Game settings tab: change the line under a game's name, Save, and the home page
// shows it. Clearing the box puts back the line the game came with.
test('the Game settings tab changes a game card line on the home page', async ({ page }, info) => {
  // It changes a line every page shares, so one project runs it (two at once would race).
  test.skip(info.project.name !== 'phone', 'One project is enough.');
  expect((await page.request.post('/api/admin/login', { data: { password: 'browser-test-admin' } })).ok()).toBe(true);
  await openPage(page, '/admin.html');
  await page.locator('#tabGames').click();
  const box = page.locator('#blurb-snake');
  await expect(box).toBeVisible();
  const original = await box.inputValue();
  await expect(page.locator('#trainCars .train-name')).toHaveCount(8);
  await box.fill('Eat the dots, dodge your tail.');
  await expect(page.locator('.blurb-row[data-id="snake"] .blurb-orig')).toContainText(original);
  await page.locator('#gamesSave').click();
  await expect(page.locator('#gamesSave')).toHaveText('✓ Saved');

  await openPage(page, '/');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  await expect(page.locator('.games > .game.snake .short')).toHaveText('Eat the dots, dodge your tail.');

  await openPage(page, '/admin.html');
  await page.locator('#tabGames').click();
  await page.locator('#blurb-snake').fill('');
  await page.locator('#gamesSave').click();
  await expect(page.locator('#gamesSave')).toHaveText('✓ Saved');
  await expect(page.locator('#blurb-snake')).toHaveValue(original);
});

// Once feedback lives in ARKS ID, the older notes are still listed to read (they used
// to stop the whole list with an error, because their Delete button was gone).
test('the older feedback notes still list once ARKS ID has the inbox', async ({ page }) => {
  expect((await page.request.post('/api/admin/login', { data: { password: 'browser-test-admin' } })).ok()).toBe(true);
  await page.route('**/api/comm/admin/feedback', route => route.fulfill({ json: {
    statuses: ['new', 'seen', 'pending', 'fixed', 'wontfix'],
    inbox: { url: 'https://id.example.test/admin', waiting: 0 },
    items: [{ id: 1, kind: 'bug', status: 'new', from: 'Sam', message: 'The board froze.', createdAt: '2026-11-10 10:00:00', details: {} }]
  } }));
  await openPage(page, '/admin.html');
  await expect(page.locator('#feedbackList')).toContainText('The board froze.');
  await expect(page.locator('#feedbackList')).not.toContainText('Cannot set properties');
  await expect(page.locator('#feedbackList [data-act="delete"]')).toHaveCount(0);
});
