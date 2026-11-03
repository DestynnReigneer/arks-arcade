'use strict';

// Shuffle Scuffle in a real browser: start free play, read the letter tiles,
// spell a word that's hiding in them, and see the server count it.

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');
const game = require(path.join(__dirname, '..', '..', 'scuffle', 'game.js'));

test('finding a word in Shuffle Scuffle', async ({ page, isMobile }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/scuffle.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // How to play may open by itself the first time.
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  await page.getByRole('button', { name: /Free play/ }).click();
  await page.locator('#goBtn').click();
  await expect(page.locator('#play')).toBeVisible();
  const tiles = page.locator('#tiles .sc-tile');
  await expect(tiles).toHaveCount(6);
  const letters = (await tiles.allTextContents()).join('');
  const word = game.findWords(letters, 'kids').filter(w => w.length <= 4).pop();
  expect(word, `a short word in ${letters}`).toBeTruthy();

  if (isMobile) {
    // Tap the tiles in order, like a phone.
    const used = new Set();
    for (const ch of word) {
      const all = await tiles.allTextContents();
      const i = all.findIndex((t, k) => t === ch && !used.has(k));
      used.add(i);
      await tiles.nth(i).tap();
    }
    await page.locator('#enterBtn').tap();
  } else {
    await page.keyboard.type(word.toLowerCase());
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('#found li', { hasText: word })).toBeVisible();
  await expect(page.locator('#scoreLabel')).toHaveText(String(game.pointsFor(word, 6)));
  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});

// Today's daily, once played on this device, fades, says why when tapped or
// focused, and free play is picked instead. The other list's daily stays open.
test('a played daily fades and free play is picked', async ({ page, isMobile }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  const day = (await (await page.request.get('/api/scuffle/config')).json()).day;
  await page.addInitScript(d => {
    try {
      localStorage.setItem('scuffle.mode', 'daily');
      localStorage.setItem('scuffle.dailyDone', JSON.stringify({ day: d, kids: true }));
    } catch { /* fine */ }
  }, day);
  await openPage(page, '/scuffle.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  const daily = page.locator('#modeSeg [data-mode="daily"]');
  await expect(daily).toHaveClass(/faded/);
  await expect(daily).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#modeSeg [data-mode="free"]')).toHaveAttribute('aria-pressed', 'true');
  // Touch has no hover, so a tap shows the note too, and it doesn't pick the daily.
  // (force: Playwright won't press an aria-disabled button by itself, but a finger or a mouse still can.)
  if (isMobile) await daily.tap({ force: true }); else await daily.click({ force: true });
  await expect(page.locator('#dailyTip')).toBeVisible();
  await expect(page.locator('#dailyTip')).toContainText('Come back tomorrow for a new one');
  await expect(page.locator('#modeSeg [data-mode="free"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#goBtn')).toHaveText('Let\'s play');
  expect(problems, problems.join('\n')).toEqual([]);
});
