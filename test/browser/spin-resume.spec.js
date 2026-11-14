'use strict';

// Spin & Solve keeps your game. The page remembers which game it's in, so a
// reload (what a browser does to a page that sat behind a locked screen) lands
// back in the same game with the same puzzle, strikes and round. Time the page
// spent asleep or hidden never counts against the turn clock, and leaving the
// game on purpose forgets it.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

// Past "Who's playing?" and the first-time How to play, when they show.
async function settle(page) {
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
}

// The puzzle wall as text: a letter that's showing, _ for one still covered.
const wall = page => page.locator('#puzzleBoard .tile').evaluateAll(tiles =>
  tiles.map(t => (t.classList.contains('blank') ? ' ' : t.classList.contains('covered') ? '_' : t.textContent)).join(''));

test('Spin & Solve picks the same game back up after a reload, and a sleeping page keeps its clock', async ({ page }) => {
  test.setTimeout(90000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/spinsolve.html');
  await settle(page);

  // One player, three rounds, the 30-second clock.
  while (await page.locator('#nameList .name-row').count() > 1) await page.locator('#nameList .name-row:last-child button').click();
  await page.locator('#timerSeg [data-secs="30"]').click();
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();

  // A wrong answer is a strike, so there's something to find again.
  await page.locator('#solveBtn').click();
  await page.locator('#solveInput').fill('ZZZZ');
  await page.locator('#solveOk').click();
  await expect(page.locator('#strikes')).toHaveText('❌⬜⬜');
  const before = {
    wall: await wall(page),
    category: await page.locator('#categoryLabel').textContent(),
    round: await page.locator('#roundLabel').textContent()
  };
  expect(before.wall).toContain('_');

  // The reload: the same game, not the setup screen.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await settle(page);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#setup')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Welcome back, your game is right where you left it.');
  await expect(page.locator('#strikes')).toHaveText('❌⬜⬜');
  await expect(page.locator('#categoryLabel')).toHaveText(before.category);
  await expect(page.locator('#roundLabel')).toHaveText(before.round);
  expect(await wall(page)).toBe(before.wall);

  // The clock keeps the setting it had, and runs once Solve is tapped.
  const text = page.locator('#ttText');
  await page.locator('#solveBtn').click();
  await expect(text).toContainText(/\d+s to solve/);

  // The page sleeps for ten minutes (a locked screen stops its timers). It wakes
  // up with the clock about where it was, not out of time.
  await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 10 * 60 * 1000; });
  await page.waitForTimeout(1500);
  await expect(page.locator('#solveView')).toBeVisible();
  await expect(text).toContainText(/(2[4-9]|30)s to solve/);

  // While the page is hidden the clock stands still.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#turnTimer')).toHaveClass(/paused/);
  const held = await text.textContent();
  await page.waitForTimeout(2500);
  expect(await text.textContent()).toBe(held);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#turnTimer')).not.toHaveClass(/paused/);
  await page.locator('#solveCancel').click();

  // Leaving on purpose forgets the game: the next reload starts at the setup screen.
  await page.evaluate(() => document.getElementById('quitBtn').click());
  await page.locator('.ab-confirm [data-leave]').click();
  await expect(page.locator('#setup')).toBeVisible();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await settle(page);
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();

  expect(problems, problems.join('\n')).toEqual([]);
});

// The id of the game this page is remembering (one key per profile, or "guest").
const remembered = page => page.evaluate(() => {
  const key = Object.keys(localStorage).find(k => k.startsWith('spin.run.'));
  return key ? JSON.parse(localStorage.getItem(key)).id : null;
});

async function reload(page) {
  await page.reload();
  await page.waitForLoadState('networkidle');
  await settle(page);
}

test('a finished round and a score that isn\'t saved yet are still there after a reload', async ({ page }) => {
  test.setTimeout(120000);
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/spinsolve.html');
  await settle(page);
  while (await page.locator('#nameList .name-row').count() > 1) await page.locator('#nameList .name-row:last-child button').click();
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();

  // The test server tells a test the answer, so each round can be solved outright.
  const solveRound = async () => {
    const { answer } = await (await page.request.get(`/api/spinsolve/test/answer/${await remembered(page)}`)).json();
    await page.locator('#solveBtn').click();
    await page.locator('#solveInput').fill(answer);
    await page.locator('#solveOk').click();
    await expect(page.locator('#roundView')).toBeVisible({ timeout: 20000 });
    return answer;
  };

  // A reload on the round's result shows that result again, and the game goes on from it.
  const first = await solveRound();
  await expect(page.locator('#roundAnswer')).toHaveText(first);
  await reload(page);
  await expect(page.locator('#roundView')).toBeVisible();
  await expect(page.locator('#roundAnswer')).toHaveText(first);
  await expect(page.locator('#roundTitle')).toContainText('solved it!');
  await page.locator('#nextRoundBtn').click();
  await expect(page.locator('#roundLabel')).toContainText('Round 2 of 3');
  await solveRound();
  await page.locator('#nextRoundBtn').click();
  await expect(page.locator('#roundLabel')).toContainText('Round 3 of 3');
  await solveRound();
  await expect(page.locator('#nextRoundBtn')).toHaveText('See the results');
  await page.locator('#nextRoundBtn').click();
  await expect(page.locator('#overView')).toBeVisible();
  await expect(page.locator('#overScore')).toBeVisible();
  const banked = await page.locator('#overTitle').textContent();

  // A reload before the score is saved: the results are back, and the score can still be saved.
  await reload(page);
  await expect(page.locator('#overView')).toBeVisible();
  await expect(page.locator('#overTitle')).toHaveText(banked);
  await expect(page.locator('#overScore')).toBeVisible();
  const boxes = page.locator('#overScore .ini');
  for (const [i, ch] of ['S', 'P', 'N'].entries()) await boxes.nth(i).fill(ch);
  await page.locator('#saveScoreBtn').click();
  await expect(page.locator('#scoresView')).toBeVisible();
  await expect(page.locator('#scoreList')).toContainText('SPN');

  // Saved: there's nothing left to come back to.
  expect(await remembered(page)).toBeNull();
  await reload(page);
  await expect(page.locator('#setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a game the arcade no longer has sends the page back to the setup screen', async ({ page }) => {
  await quietFonts(page);
  await openPage(page, '/spinsolve.html');
  await settle(page);
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  expect(await remembered(page)).toMatch(/^[0-9a-f]{32}$/);

  // Remembering a game the server doesn't have is what a restart, or a day away, looks like.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('spin.run.'));
    localStorage.setItem(key, JSON.stringify({ id: 'f'.repeat(32), turnSecs: 45, pack: 'all' }));
  });
  await reload(page);
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('That game has ended');
  expect(await remembered(page)).toBeNull();
});
