'use strict';

// Every lobby on a device has a Show QR code button: tap it, show your screen,
// and a friend scans the code to join. The code opens that game's lobby.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

const closeHelp = async page => { const x = page.locator('.tut-x'); if (await x.isVisible().catch(() => false)) await x.click(); };

async function asGuest(page, path) {
  await quietFonts(page);
  await openPage(page, path);
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  await closeHelp(page);
}

async function checkButton(page, game) {
  const btn = page.locator('.qr-show');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('📷 Show QR code');
  await btn.click();
  const big = page.locator('.qr-big');
  await expect(big).toBeVisible();
  await expect(big).toContainText('Scan to join');
  await expect.poll(async () => decodeURIComponent(await big.locator('img').getAttribute('src') || '')).toContain(`/${game}.html?join=`);
  // Nothing to read or copy: no address on the screen.
  await expect(big).not.toContainText('http');
  await big.getByRole('button', { name: 'Close' }).click();
  await expect(big).toHaveCount(0);
}

test('the card games, Know-It-All and Shuffle Scuffle show a QR code in their lobby', async ({ page }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  test.setTimeout(90000);
  for (const game of ['partdeux', 'daredevil', 'trivia', 'scuffle']) {
    await asGuest(page, `/${game}.html`);
    await page.locator('#modeSeg [data-mode="host"]').click();
    await page.locator('#goBtn').click();
    await expect(page.locator('#lobby')).toBeVisible();
    await checkButton(page, game);
  }
});

test('Rambler and Chess show a QR code in their lobby', async ({ page }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  await asGuest(page, '/rambler.html');
  await page.locator('#modeList .no-tv[data-mode="room"]').click();
  await page.locator('#startBtn').click();
  await expect(page.locator('#lobbyScreen')).toBeVisible();
  await checkButton(page, 'rambler');

  await asGuest(page, '/chess.html');
  await page.locator('[data-mode="host"]').first().click();
  await page.locator('#createBtn').click();
  await expect(page.locator('#lobby')).toBeVisible();
  await checkButton(page, 'chess');
});
