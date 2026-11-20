'use strict';

// Nobody types initials to get on a board. Someone signed in with ARKS ID finishes a game and the score goes on
// the board under their name, with no letter boxes anywhere. A guest's score goes on under the guest's name. A
// guest with no name at all is told to sign in, and gets no boxes either.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// Runs Dino Dash until the dino trips, and waits for the end window.
async function runDino(page) {
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => document.body.dataset.state), { timeout: 1500 }).toBe('running');
  }).toPass({ timeout: 10000 });
  await expect(page.locator('.ew-card')).toBeVisible({ timeout: 30000 });
}

// No initials box shows anywhere on the page.
const shownBoxes = page => page.evaluate(() => [...document.querySelectorAll('input.ini, .initial-box')].filter(b => b.offsetParent !== null).length);

test('signed in: the score goes on the board under the profile\'s name, with nothing to type', async ({ browser }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await quietFonts(page);
  const problems = watchProblems(page);

  expect((await fake('/test/next-once', { as: 'kim' })).ok).toBe(true);
  await page.goto('/auth/signin?return=/dino.html');
  await page.waitForURL(u => new URL(u).pathname === '/dino.html');
  await page.waitForLoadState('networkidle');
  await runDino(page);

  expect(await shownBoxes(page)).toBe(0);
  // Saved by itself, with nothing to press.
  await expect(page.locator('.ew-card .ew-saved')).toContainText('Saved as Kim · #');
  await page.locator('.ew-card').getByRole('button', { name: '🏆 High scores' }).click();
  await expect(page.locator('.ew-list li.me')).toContainText('Kim');
  const board = await (await page.request.get('/api/scores/dino?board=run&limit=100')).json();
  expect(board.some(r => r.profileName === 'Kim')).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

test('a guest: the score goes on the board under the guest\'s name, with nothing to type', async ({ page }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/dino.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => ArcadeProfile.name())).toMatch(/^Guest \d+$/);
  const guest = await page.evaluate(() => ArcadeProfile.name());
  await runDino(page);

  expect(await shownBoxes(page)).toBe(0);
  await expect(page.locator('.ew-card .ew-saved')).toContainText(`Saved as ${guest} · #`);
  await page.locator('.ew-card').getByRole('button', { name: '🏆 High scores' }).click();
  await expect(page.locator('.ew-list li.me')).toContainText(guest);
  // A signed-in player's ARKS ID photo on the same board isn't served to a guest (the board shows their icon
  // instead), so that answer doesn't count here.
  const photo = problems.some(p => /\/api\/arksid\/photo\//.test(p));
  const real = problems.filter(p => !/\/api\/arksid\/photo\//.test(p) && !(photo && /Failed to load resource.*404/.test(p)));
  expect(real, real.join('\n')).toEqual([]);
});

test('Rambler: a score good enough for the board goes up under the guest\'s name by itself', async ({ page }) => {
  test.setTimeout(60000);
  await quietFonts(page);
  await openPage(page, '/rambler.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => ArcadeProfile.name())).toMatch(/^Guest \d+$/);
  const guest = await page.evaluate(() => ArcadeProfile.name());
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // The round is scored by the real server; only its answer is nudged so this round "made the board", and the
  // board's answer is handed back here, to see exactly what the page sends.
  await page.route('**/api/rambler/score', async route => {
    const res = await route.fetch();
    const data = await res.json();
    data.results[0].score = 42;
    data.arcade = { ...(data.arcade || {}), boardKey: '4', makesBoard: true, rank: 3, slots: 10, filled: 10, cutoff: 10, shortBy: 0, entries: [] };
    await route.fulfill({ response: res, json: data });
  });
  let sent = null;
  await page.route('**/api/rambler/leaderboard', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { made: true, id: 1, score: 42, boardKey: '4', rank: 3, evicted: [{ name: 'Robin', initials: 'ROB', score: 10 }] } });
  });

  await page.locator('#modeList .mode[data-mode="solo"]').click();
  await page.locator('#startBtn').click();
  await page.locator('#doneBtn').click();
  await expect(page.locator('#initialsOverlay')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#initialsMsg')).toHaveText('Number 3. You knocked Robin off.');
  expect(await shownBoxes(page)).toBe(0);
  expect(sent.name).toBe(guest);
  expect('initials' in sent).toBe(false);
});

test('a guest with no name is told to sign in, and isn\'t asked for initials', async ({ page }) => {
  await quietFonts(page);
  await openPage(page, '/dino.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // A guest who somehow has no name.
  await expect.poll(() => page.evaluate(() => ArcadeProfile.name())).toMatch(/^Guest \d+$/);
  await page.evaluate(() => { ArcadeProfile.set({ ...ArcadeProfile.get(), name: '' }); });
  await runDino(page);

  expect(await shownBoxes(page)).toBe(0);
  await expect(page.locator('.ew-card .ew-saved')).toHaveText('Sign in with ARKS ID to put your score on the board.');
});
