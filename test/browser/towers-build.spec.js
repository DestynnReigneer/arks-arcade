'use strict';

// Tower Defense's build bar: every tower is always on show, lit up when you can
// pay for it, and you can build square first or tower first. After the last
// wave the win card carries on to the next level with the score, and the map
// and level pickers stay out of the way while you play. TowersTest (towers.js,
// only in a browser driven by Playwright) sets the gold and wins the last wave.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function open(page) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/towers.html');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.waitForFunction(() => window.TowersTest);
  return problems;
}
const state = page => page.evaluate(() => window.TowersTest.state());
const bar = page => page.locator('#buildRow button');
const tower = (page, name) => page.locator('#buildRow button', { hasText: name });

// Clicks the middle of a square on the map.
async function clickSquare(page, sq, options) {
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x + (sq.x + 0.5) * box.width / sq.cols, box.y + (sq.y + 0.5) * box.height / sq.rows, options);
}
const freeSquare = page => page.evaluate(() => window.TowersTest.free());

test('the build bar shows every tower with its name and price, before and during play', async ({ page }) => {
  const problems = await open(page);
  const names = ['Archer', 'Cannon', 'Frost', 'Tesla'];
  const costs = ['50', '80', '65', '120'];
  await expect(bar(page)).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(bar(page).nth(i)).toContainText(names[i]);
    await expect(bar(page).nth(i)).toContainText(costs[i]);
  }
  // An upright phone gets the short line, so it fits on one line.
  const phone = page.viewportSize().width < 600;
  await expect(page.locator('#buildHow')).toHaveText(phone ? 'Pick a square then a tower, or a tower then a square.'
    : 'Pick an empty square and then a tower, or pick a tower and then a square.');
  const how = await page.locator('#buildHow').evaluate(e => ({ lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)), cut: e.scrollWidth > e.clientWidth }));
  if (phone) expect(how).toEqual({ lines: 1, cut: false });
  await page.locator('#waveBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  const view = page.viewportSize();
  for (let i = 0; i < 4; i++) {
    await expect(bar(page).nth(i)).toBeVisible();
    const b = await bar(page).nth(i).boundingBox();
    expect(b.y + b.height).toBeLessThanOrEqual(view.height);
    expect(b.x + b.width).toBeLessThanOrEqual(view.width);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('towers light up when the gold is there and dim when it is not', async ({ page }) => {
  const problems = await open(page);
  await page.evaluate(() => window.TowersTest.setGold(60));
  await expect(tower(page, 'Archer')).toHaveClass(/\bcan\b/);
  for (const name of ['Cannon', 'Frost', 'Tesla']) {
    await expect(tower(page, name)).toHaveClass(/\bcant\b/);
    await expect(tower(page, name)).toHaveAttribute('aria-disabled', 'true');
  }
  // More gold: Frost (65) and Cannon (80) light up and flash, Tesla (120) stays dim.
  await page.evaluate(() => window.TowersTest.setGold(100));
  await expect(tower(page, 'Frost')).toHaveClass(/\bcan\b/);
  await expect(tower(page, 'Cannon')).toHaveClass(/\bcan\b.*\blit\b|\blit\b.*\bcan\b/);
  await expect(tower(page, 'Tesla')).toHaveClass(/\bcant\b/);
  // A tower you can't pay for says how much more you need and doesn't get picked.
  await tower(page, 'Tesla').click({ force: true });   // aria-disabled, but still answers a tap
  await expect(page.locator('.toast, #toast').filter({ hasText: 'You need 20 more gold for the Tesla.' }).first()).toBeVisible();
  await expect(tower(page, 'Tesla')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.TowersTest.setGold(500));
  for (const name of ['Archer', 'Cannon', 'Frost', 'Tesla']) await expect(tower(page, name)).toHaveClass(/\bcan\b/);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('building square first: pick an empty square, then a tower', async ({ page }) => {
  const problems = await open(page);
  const sq = await freeSquare(page);
  await clickSquare(page, sq);
  await expect(page.locator('#buildHow')).toContainText('Now pick a tower');
  await tower(page, 'Cannon').click();
  await expect.poll(async () => (await state(page)).towers).toBe(1);
  expect((await state(page)).gold).toBe(180 - 80);
  // The picked tower's card shows, and the map pickers stepped aside.
  await expect(page.locator('#info .tower-actions')).toBeVisible();
  await expect(page.locator('#options')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('building tower first: pick a tower, then a square, and Esc or a right-click cancels', async ({ page }) => {
  const problems = await open(page);
  const sq = await freeSquare(page);
  await tower(page, 'Frost').click();
  await expect(tower(page, 'Frost')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#buildHow')).toContainText(/lit square.*Frost/);
  await page.keyboard.press('Escape');
  await expect(tower(page, 'Frost')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).armed).toBe(null);

  await tower(page, 'Frost').click();
  await clickSquare(page, sq, { button: 'right' });
  await expect(tower(page, 'Frost')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).towers).toBe(0);

  // The number key picks the tower when no square is picked.
  await page.keyboard.press('3');
  await expect(tower(page, 'Frost')).toHaveAttribute('aria-pressed', 'true');
  await clickSquare(page, sq);
  await expect.poll(async () => (await state(page)).towers).toBe(1);
  expect((await state(page)).gold).toBe(180 - 65);
  await expect(tower(page, 'Frost')).toHaveAttribute('aria-pressed', 'false');
  // With a tower built (before any wave), the tip is about upgrading and selling, not wave 1.
  await page.keyboard.press('Escape');
  if (page.viewportSize().width >= 900) {
    await expect(page.locator('#info')).toContainText('to upgrade or sell it');
    await expect(page.locator('#info')).not.toContainText('Once you build');
  } else await expect(page.locator('#info')).toBeHidden();   // an upright phone keeps the room for the map
  expect(problems, problems.join('\n')).toEqual([]);
});

test('after the last wave the game carries on to the next level with the score', async ({ page }) => {
  const problems = await open(page);
  await page.locator('#mapSeg button', { hasText: 'Meadow' }).click();
  await page.locator('#waveBtn').click();
  await expect(page.locator('#options')).toBeHidden();
  await page.evaluate(() => window.TowersTest.win());
  const panel = page.locator('.ew-card');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel.locator('.ew-title')).toContainText('Victory');
  const next = panel.getByRole('button', { name: 'Next level: Medium' });
  await expect(next).toBeVisible();
  const won = await state(page);
  expect(won.score).toBeGreaterThan(0);
  await next.click();
  await expect(panel).toBeHidden();
  const s = await state(page);
  expect(s.map).toBe('canyon');
  expect(s.score).toBe(won.score);
  expect(s.gold).toBe(150);
  expect(s.towers).toBe(0);
  expect(s.wave).toBe(0);
  await expect(page.locator('#score')).toHaveText(won.score.toLocaleString('en-US'));
  // A carried-on game is under way, so the pickers stay away.
  await expect(page.locator('#options')).toBeHidden();
  // Taking the next level saved the game so far on All levels by itself, so Back can't lose it.
  const id = await page.evaluate(() => window.TowersTest.runSaved());
  expect(id).toBeGreaterThan(0);
  const onAll = async () => (await (await page.request.get('/api/scores/towers?board=all&limit=100')).json()).filter(r => r.id === id);
  expect((await onAll()).map(r => [r.score, r.detail])).toEqual([[won.score, 'Meadow']]);

  // Medium leads on to Hard; Hard is the last level.
  await page.locator('#waveBtn').click();
  await page.evaluate(() => window.TowersTest.win());
  await expect(panel.getByRole('button', { name: 'Next level: Hard' })).toBeVisible({ timeout: 10000 });
  // The lives left are this map's, and the card says which map.
  await expect(panel.locator('.ew-detail')).toContainText('on Meadow and Canyon, with 20 lives left on Canyon.');
  await expect(panel.locator('.ew-saved')).toContainText('on the All levels board');
  await panel.getByRole('button', { name: 'Next level: Hard' }).click();
  expect((await state(page)).map).toBe('castle');
  await page.locator('#waveBtn').click();
  await page.evaluate(() => window.TowersTest.win());
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel.locator('.ew-detail')).toHaveText('All 25 waves on Meadow, Canyon and Castle. You beat every level in one game!');
  await expect(panel.getByRole('button', { name: /Next level/ })).toHaveCount(0);
  await expect(panel.locator('.ew-saved')).toContainText(/Saved as .* · #\d+ on the All levels board/);
  const final = await state(page);
  // Still one row for the whole game, raised to the final score; no map's board has it.
  expect((await onAll()).map(r => [r.score, r.detail])).toEqual([[final.score, 'Meadow, Canyon and Castle']]);
  const castle = await (await page.request.get('/api/scores/towers?board=castle&limit=100')).json();
  expect(castle.some(r => r.score === final.score)).toBe(false);
  // The high scores, inside the end window, open on the All levels board.
  await panel.getByRole('button', { name: '🏆 High scores' }).click();
  await expect(panel.locator('.ew-tabs button', { hasText: 'All levels' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: '‹ Back to my score' }).click();
  // Play again starts over from the map the game began on.
  await panel.getByRole('button', { name: '▶ Play again' }).click();
  const again = await state(page);
  expect([again.map, again.score, again.run]).toEqual(['meadow', 0, null]);
  await expect(page.locator('#options')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the map and level pickers hide while you play and come back at the end', async ({ page }) => {
  const problems = await open(page);
  await expect(page.locator('#options')).toBeVisible();
  await page.locator('#waveBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('#options')).toBeHidden();
  await expect(page.locator('#canvas')).toBeVisible();
  await page.evaluate(() => window.TowersTest.win());
  await expect(page.locator('.ew-card')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#options')).not.toHaveClass(/hidden/);
  // Play again starts the same map from its setup.
  await page.locator('.ew-card').getByRole('button', { name: '▶ Play again' }).click();
  await expect(page.locator('#options')).toBeVisible();
  expect((await state(page)).score).toBe(0);
  expect(problems, problems.join('\n')).toEqual([]);
});
