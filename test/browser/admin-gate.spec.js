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
  for (const tab of ['tabArcade', 'tabBoards', 'tabStats', 'tabRambler', 'tabWordless', 'tabSpin', 'tabTrivia', 'tabClueless']) {
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
