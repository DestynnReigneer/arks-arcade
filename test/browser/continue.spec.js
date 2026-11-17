'use strict';

// The Continue row on the home page: it stays out of the way until someone
// has a game in progress, then lists them with a Play button each. What goes
// in the list is the server's job (test/continue.test.js), so here the list
// is handed to the page and only the page is checked.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage, chooser } = require('./helpers');

const GAMES = [
  { game: 'crisscross', title: 'Words with Family with Ben', detail: 'Your move', href: 'crisscross.html?game=abc', yourTurn: true, updatedAt: 2 },
  { game: 'sudoku', title: 'Sudoku, today\'s Easy Challenge', detail: '4:12 played so far', href: 'sudoku.html?level=easy', yourTurn: false, updatedAt: 1 }
];

test.beforeEach(async ({ page }) => { await quietFonts(page); });

test('the Continue row is hidden when there is nothing to continue', async ({ page }) => {
  await openPage(page, '/');
  await expect(page.locator('#continue')).toBeHidden();
});

test('the Continue row lists your games and opens the one you tap', async ({ page }) => {
  let asked = null;
  await page.route('**/api/continue', route => {
    asked = route.request().headers()['x-profile-token'] || null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games: GAMES }) });
  });
  await openPage(page, '/');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Wait until the guest is saved, so the next step doesn't get written over.
  await expect(chooser(page)).toBeHidden();
  // The page asks with the token of whoever is playing, and only then.
  await page.evaluate(() => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('arcade.profile') || '{}') || {}; } catch { /* start clean */ }
    localStorage.setItem('arcade.profile', JSON.stringify({ ...p, id: p.id || 'p1', name: p.name || 'Ana', token: 'test.token' }));
  });
  await openPage(page, '/');
  const row = page.locator('#continue');
  await expect(row).toBeVisible();
  expect(asked).toBe('test.token');
  const items = row.locator('li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Words with Family with Ben');
  await expect(items.nth(0)).toContainText('Your move');
  await expect(items.nth(1)).toContainText('4:12 played so far');
  // Nothing runs off the side of a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await items.nth(1).getByRole('link', { name: 'Play' }).click();
  await page.waitForURL(/sudoku\.html\?level=easy/);
});

// Press and hold a row (a right-click on a computer) for Resume and leaving. The
// server's side of leaving is in test/continue.test.js; here the page asks first,
// sends the right game, and paints the list it gets back.
test('holding a Continue row asks before leaving the game, then takes it off', async ({ page }) => {
  let games = GAMES.map((g, k) => ({ ...g, ref: k ? 'easy' : 'abc', leave: k ? 'give-up' : 'ends', ...(k ? {} : { others: ['Ben'] }) }));
  let sent = null;
  await page.route('**/api/continue', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games }) }));
  await page.route('**/api/continue/leave', route => {
    sent = route.request().postDataJSON();
    games = games.filter(g => g.ref !== sent.ref);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, games }) });
  });
  await openPage(page, '/');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(chooser(page)).toBeHidden();
  await page.evaluate(() => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('arcade.profile') || '{}') || {}; } catch { /* start clean */ }
    localStorage.setItem('arcade.profile', JSON.stringify({ ...p, id: p.id || 'p1', name: p.name || 'Ana', token: 'test.token' }));
  });
  await openPage(page, '/');
  const items = page.locator('#continue li');
  await expect(items).toHaveCount(2);

  // A game of two: the question names the other player.
  await items.nth(0).click({ button: 'right' });
  const card = page.locator('.lp-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('menuitem', { name: /Resume/ })).toBeVisible();
  await card.getByRole('menuitem', { name: /Leave this game/ }).click();
  await expect(card).toContainText('Leave your game with Ben? The game ends, and Ben wins.');
  // Cancel changes nothing.
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toBeHidden();
  expect(sent).toBeNull();

  // Giving up today's Sudoku.
  await items.nth(1).click({ button: 'right' });
  await card.getByRole('menuitem', { name: /Give up today's puzzle/ }).click();
  await expect(card).toContainText("Give up today's Easy Challenge? It comes off your list, and today's time won't go on the board.");
  await card.getByRole('button', { name: 'Give up', exact: true }).click();
  await expect(items).toHaveCount(1);
  expect(sent).toEqual({ game: 'sudoku', ref: 'easy' });
  await expect(items.nth(0)).toContainText('Words with Family with Ben');
});

// The menu and its question stay where they can be seen: above Chrome's tab row on a
// phone (it covers the bottom of the page without making the window shorter), and
// inside a phone turned sideways once the longer question replaces the list.
for (const size of [
  { name: 'phone with the tab row', width: 412, height: 860, covered: 136 },
  { name: 'phone sideways', width: 844, height: 390 },
  { name: 'small phone sideways', width: 740, height: 360 }
]) {
  test(`the hold menu stays on screen: ${size.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    if (size.covered) {
      await page.addInitScript(cov => {
        const vv = new EventTarget();
        for (const [k, get] of Object.entries({ height: () => innerHeight - cov, width: () => innerWidth, scale: () => 1, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => scrollY, pageLeft: () => scrollX })) {
          Object.defineProperty(vv, k, { get });
        }
        Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
      }, size.covered);
    }
    await quietFonts(page);
    const games = GAMES.map((g, k) => ({ ...g, ref: k ? 'easy' : 'abc', leave: k ? 'give-up' : 'ends', ...(k ? {} : { others: ['Ben'] }) }));
    await page.route('**/api/continue', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games }) }));
    await openPage(page, '/');
    await page.getByRole('button', { name: /Play as a guest/ }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(chooser(page)).toBeHidden();
    await page.evaluate(() => {
      let p = {};
      try { p = JSON.parse(localStorage.getItem('arcade.profile') || '{}') || {}; } catch { /* start clean */ }
      localStorage.setItem('arcade.profile', JSON.stringify({ ...p, id: p.id || 'p1', name: p.name || 'Ana', token: 'test.token' }));
    });
    await openPage(page, '/');
    const row = page.locator('#continue li').nth(1);
    await row.scrollIntoViewIfNeeded();
    await row.locator('.l-main').click({ button: 'right' });
    const card = page.locator('.lp-card');
    await expect(card).toBeVisible();
    const inside = async () => {
      await page.waitForTimeout(250);
      return page.evaluate(cov => {
        const r = document.querySelector('.lp-card').getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight - cov;
      }, size.covered || 0);
    };
    expect(await inside()).toBe(true);
    await card.getByRole('menuitem', { name: /Give up today's puzzle/ }).click();
    await expect(card.getByRole('button', { name: 'Give up', exact: true })).toBeVisible();
    expect(await inside()).toBe(true);
    await context.close();
  });
}
