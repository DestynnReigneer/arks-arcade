'use strict';

// The end window (public/end-window.js), the same in every game. Each game ends a run here and checks:
// the card shows over a dim layer that leaves the top bar alone; the score saved by itself (or the plain line
// when there's nothing to save); ✕ Close, then ☰ has 🏁 Last game's results with a dot, and it brings the card
// back; High scores open inside the card, with Back to my score; Escape closes one layer at a time; Space and
// taps don't reach the game behind; Enter is Play again and leaves no dim or overlay behind. Sizes: a phone, a
// sideways phone (844 by 390) and a laptop.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { quietFonts, watchProblems, openPage } = require('./helpers');
const game = require(path.join(__dirname, '..', '..', 'scuffle', 'game.js'));

const card = page => page.locator('.ew-card');
const layer = page => page.locator('.ew-layer');

// Opens a game as a guest, past How to play. -> the guest's name.
async function openAsGuest(page, path) {
  await quietFonts(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect.poll(() => page.evaluate(() => ArcadeProfile.name())).toMatch(/^Guest \d+$/);
  return page.evaluate(() => ArcadeProfile.name());
}

// Presses a key until the page says the game started.
async function startWith(page, key, playing) {
  await expect(async () => {
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => document.body.dataset.state), { timeout: 1500 }).toBe(playing);
  }).toPass({ timeout: 10000 });
}

// Every button in the card is on the screen, below the top bar, and the dim starts under the top bar.
async function expectFits(page) {
  const view = await page.evaluate(() => {
    const bar = document.querySelector('.ah');
    const vv = window.visualViewport;
    return { w: window.innerWidth, h: vv ? Math.min(window.innerHeight, vv.height) : window.innerHeight, bar: bar ? bar.getBoundingClientRect().bottom : 0 };
  });
  const dim = await layer(page).boundingBox();
  expect(dim.y, 'the dim starts under the top bar').toBeGreaterThanOrEqual(view.bar - 1);
  const boxes = await card(page).locator('button').evaluateAll(bs => bs.filter(b => b.getClientRects().length).map(b => {
    const r = b.getBoundingClientRect();
    return { t: b.textContent.trim(), x: r.left, y: r.top, r: r.right, b: r.bottom };
  }));
  for (const b of boxes) {
    expect(b.y, `${b.t} is below the top bar`).toBeGreaterThanOrEqual(view.bar - 1);
    expect(b.b, `${b.t} is on the screen`).toBeLessThanOrEqual(view.h + 1);
    expect(b.x, `${b.t} isn't cut off on the left`).toBeGreaterThanOrEqual(0);
    expect(b.r, `${b.t} isn't cut off on the right`).toBeLessThanOrEqual(view.w + 1);
  }
  // Nothing in the card scrolls.
  expect(await card(page).evaluate(c => c.scrollHeight <= c.clientHeight + 1), 'the card fits without scrolling').toBe(true);
  if (view.w >= 1000) expect((await card(page).boundingBox()).width, 'about 420px wide on a laptop').toBeLessThanOrEqual(440);
}

// The checks every game shares, once its card is up.
//   saved: a RegExp for the save line, or null for none. scores: whether High scores is there.
//   behind: a function -> something about the game that a key or tap behind the card would change.
async function checkCard(page, { saved, plain, scores = true, setup = true, again = true, behind }) {
  await expect(card(page)).toBeVisible({ timeout: 30000 });
  if (saved) await expect(card(page).locator('.ew-saved')).toHaveText(saved, { timeout: 10000 });
  if (plain) await expect(card(page).locator('.ew-saved.ew-plain')).toHaveText(plain);
  await expect(card(page).getByRole('button', { name: '▶ Play again' })).toHaveCount(again ? 1 : 0);
  await expect(card(page).getByRole('button', { name: '🏆 High scores' })).toHaveCount(scores ? 1 : 0);
  await expect(card(page).getByRole('button', { name: '⚙️ Back to setup' })).toHaveCount(setup ? 1 : 0);
  await expect(page.getByText('Look at the game')).toHaveCount(0);
  await expectFits(page);

  // Space and a tap on the game behind it do nothing.
  const before = behind ? await behind() : null;
  await page.waitForTimeout(450);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height - 30);
  await page.waitForTimeout(250);
  await expect(card(page)).toBeVisible();
  if (behind) expect(await behind(), 'the game behind stayed as it was').toEqual(before);

  // High scores open inside the card.
  if (scores) {
    await card(page).getByRole('button', { name: '🏆 High scores' }).click();
    await expect(card(page).locator('.ew-list')).toBeVisible();
    await expect(card(page).locator('.ew-list li').first()).not.toHaveText('Loading…');
    expect(await page.locator('.overlay:not(.hidden)').evaluateAll(os => os.filter(o => o.getClientRects().length).length), 'no other high-score window').toBe(0);
    // Escape goes back to the score, then closes.
    await page.keyboard.press('Escape');
    await expect(card(page).locator('.ew-title').first()).not.toHaveText('🏆 High scores');
    await card(page).getByRole('button', { name: '🏆 High scores' }).click();
    await card(page).getByRole('button', { name: '‹ Back to my score' }).click();
    await expect(card(page).locator('.ew-list')).toHaveCount(0);
  }

  // ✕ Close, then ☰ brings it back; Escape closes it too.
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(layer(page)).toBeHidden();
  await expect(page.locator('.ah-waffle')).toHaveClass(/ew-dot/);
  await page.locator('.ah-waffle').click();
  const item = page.locator('.ah-menu button', { hasText: 'Last game\'s results' });
  await expect(item).toBeVisible();
  await expect(page.locator('.ah-menu button').first()).toHaveText(/Last game's results/);
  await item.click();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(layer(page)).toBeHidden();
  await page.locator('.ah-waffle').click();
  await page.locator('.ah-menu button', { hasText: 'Last game\'s results' }).click();
  await expect(card(page)).toBeVisible();
  // Opening ☰ while the card is up puts the card away first.
  await page.locator('.ah-waffle').click();
  await expect(layer(page)).toBeHidden();
  await expect(page.locator('.ah-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.ah-waffle').click();
  await page.locator('.ah-menu button', { hasText: 'Last game\'s results' }).click();
  await expect(card(page)).toBeVisible();
}

// After Play again (or Back to setup): nothing of the last game is left over.
async function expectClean(page) {
  await expect(layer(page)).toBeHidden();
  await expect(page.locator('.ah-waffle')).not.toHaveClass(/ew-dot/);
  expect(await page.locator('.overlay:not(.hidden), .end-dim, .end-pill').evaluateAll(os => os.filter(o => o.getClientRects().length).length), 'no leftover dim or overlay').toBe(0);
  await page.locator('.ah-waffle').click();
  await expect(page.locator('.ah-menu')).toBeVisible();
  await expect(page.locator('.ah-menu button', { hasText: 'Last game\'s results' })).toHaveCount(0);
  await page.keyboard.press('Escape');
}

// Sideways phone and laptop sizes on the same card.
async function checkSizes(page) {
  const was = page.viewportSize();
  for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(450);
    await expectFits(page);
  }
  await page.setViewportSize(was);
}


// ---- the GameShell games ----------------------------------------------------------------------------

test('Snake: the end window, saved by itself', async ({ page }) => {
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/snake.html');
  await page.evaluate(() => { window.ShellTest = { score: 30 }; });
  await startWith(page, 'ArrowUp', 'playing');
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+ on Classic`), behind: () => page.evaluate(() => document.body.dataset.state) });
  await checkSizes(page);
  await page.keyboard.press('Enter');
  await expectClean(page);
  await expect.poll(() => page.evaluate(() => document.body.dataset.state)).toBe('playing');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Block Drop: the end window after the well fills, with Back to setup', async ({ page }) => {
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/blocks.html');
  await startWith(page, ' ', 'playing');
  // Space drops each piece the rest of the way, until the well is full.
  for (let i = 0; i < 120 && !(await card(page).isVisible()); i++) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(40);
  }
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`), behind: () => page.evaluate(() => document.body.dataset.state) });
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect(page.locator('#options')).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('ready');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Brick Breaker: the end window, with Back to setup', async ({ page }) => {
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/bricks.html');
  await startWith(page, ' ', 'playing');
  // Paused, then the run ends the way the game ends it.
  await page.keyboard.press('p');
  await page.evaluate(() => window.ShellTest.over({ score: 140, board: 'classic', detail: 'Reached level 1' }));
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+ on the board`) });
  // (The game opened this card a moment ago; Enter only counts once it has been up a moment.)
  await page.keyboard.press('Escape');
  await page.locator('.ah-waffle').click();
  await page.locator('.ah-menu button', { hasText: 'Last game\'s results' }).click();
  await page.keyboard.press('Enter');
  await expectClean(page);
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('ready');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Tower Defense: Next level is the one extra button, and Back to setup brings the pickers back', async ({ page }) => {
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/towers.html');
  await page.locator('#waveBtn').click();
  await page.evaluate(() => window.TowersTest.win());
  await expect(card(page).getByRole('button', { name: 'Next level: Medium' })).toBeVisible({ timeout: 10000 });
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`) });
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect(page.locator('#options')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

// ---- the cabinet games ----------------------------------------------------------------------------------

test('Big Swing: the end window, and a new game started during the wait never gets the old card', async ({ page }) => {
  test.setTimeout(90000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/bigswing.html');
  await page.locator('.cab-go').click();
  await page.evaluate(() => CabTest.manual(true));
  const outs = () => page.evaluate(() => { const g = CabTest.game; CabTest.step(4); g.runs = Math.max(g.runs, 3); for (let i = 0; i < 3; i++) g.out('OUT!'); CabTest.tick(0.2); });
  await outs();
  // Space starts the next game before the card has come up (it waits a moment so the last play can be seen).
  await page.keyboard.press(' ');
  await page.waitForTimeout(2200);
  await expect(layer(page)).toBeHidden();
  expect(await page.evaluate(() => ArcadeEnd.has || ArcadeEnd.pending)).toBe(false);
  // This game ends properly.
  await outs();
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`), setup: false });
  await checkSizes(page);
  await page.keyboard.press('Enter');
  await expectClean(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('ARKS Launcher: the end window with Back to setup', async ({ page }) => {
  test.setTimeout(90000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/launcher.html');
  await page.locator('.cab-go').click();
  await page.evaluate(() => { CabTest.manual(true); const g = CabTest.game; CabTest.step(3.5); g.score = 120; g.over = true; CabTest.tick(0); });
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`) });
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect(page.locator('.cab-setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

// ---- Dino Dash, Tumbler Rumble ---------------------------------------------------------------------------

test('Dino Dash: High scores inside the window, and a tap or up arrow doesn\'t start a run behind it', async ({ page }) => {
  test.setTimeout(60000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/dino.html');
  await startWith(page, 'Space', 'running');
  await expect(card(page)).toBeVisible({ timeout: 40000 });
  await page.waitForTimeout(800);
  // Past the moment a tap used to start the next run.
  await page.keyboard.press('ArrowUp');
  await page.locator('.ew-layer').click({ position: { x: 5, y: 5 } });
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('over');
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`), behind: () => page.evaluate(() => document.body.dataset.state) });
  await card(page).getByRole('button', { name: '🏆 High scores' }).click();
  await expect(card(page).locator('.ew-list li.me')).toContainText(guest);
  await card(page).getByRole('button', { name: '▶ Play again' }).click();
  await expectClean(page);
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('running');
  expect(problems, problems.join('\n')).toEqual([]);
});

const TOO_SLOW = ['Too slow, you spun right past your number!', 'You missed your number!', 'Hesitate and the lock wins.', 'The dial got away from you.',
  'Your number came and went.', 'Blink and you miss it. You blinked.', 'Still thinking? The lock didn\'t wait.', 'Forgot the combo halfway through?'];

test('Tumbler Rumble: a lock\'s words, the plain line for no pops, and today\'s board inside the window', async ({ page }) => {
  test.setTimeout(60000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/tumbler.html');
  // A run where the light slides past the first lock: nothing to save.
  await expect(async () => {
    await page.locator('#stage').click();
    await expect.poll(() => page.evaluate(() => !!window.TumblerTest), { timeout: 1500 }).toBe(true);
  }).toPass({ timeout: 10000 });
  await expect(card(page)).toBeVisible({ timeout: 20000 });
  expect(TOO_SLOW).toContain((await card(page).locator('.ew-title').textContent()).trim());
  await expect(card(page).locator('.ew-saved')).toHaveText('Pop one lock to get on the board.');
  await expect(page.locator('body')).not.toContainText(/\bpins?\b/i);
  // Play again (Enter, once the card has been up a moment), then pop one lock and let the next one slip:
  // saved by itself for today.
  await page.waitForTimeout(450);
  await page.keyboard.press('Enter');
  await expectClean(page);
  await expect(page.locator('#popBtn')).toHaveText('POP!', { timeout: 6000 });
  await page.evaluate(() => new Promise(resolve => {
    const go = () => {
      const ms = window.TumblerTest.msToNextPin();
      if (ms > 3) { setTimeout(go, Math.min(ms - 2, 40)); return; }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      resolve();
    };
    go();
  }));
  await expect(page.locator('#hudPops')).toHaveText('1');
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+ for today`), behind: () => page.evaluate(() => window.TumblerTest.state().mode) });
  // Today and Overall, inside the window.
  await card(page).getByRole('button', { name: '🏆 High scores' }).click();
  await expect(card(page).locator('.ew-tabs button', { hasText: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).locator('.ew-list li.me')).toContainText(guest);
  await card(page).locator('.ew-tabs button', { hasText: 'Overall' }).click();
  await expect(card(page).locator('.ew-list li').first()).not.toHaveText('Loading…');
  await card(page).getByRole('button', { name: '‹ Back to my score' }).click();
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect.poll(() => page.evaluate(() => document.body.dataset.state)).toBe('ready');
  expect(problems, problems.join('\n')).toEqual([]);
});

// ---- the daily puzzles -----------------------------------------------------------------------------------

// A plain Sudoku solver, for the test only.
function solve(grid) {
  const g = grid.slice();
  const ok = (i, v) => {
    const r = Math.floor(i / 9), c = i % 9, br = r - r % 3, bc = c - c % 3;
    for (let k = 0; k < 9; k++) {
      if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false;
      if (g[(br + Math.floor(k / 3)) * 9 + bc + k % 3] === v) return false;
    }
    return true;
  };
  const go = () => {
    const i = g.indexOf(0);
    if (i < 0) return true;
    for (let v = 1; v <= 9; v++) if (ok(i, v)) { g[i] = v; if (go()) return true; g[i] = 0; }
    return false;
  };
  return go() ? g : null;
}

test('Sudoku: solved, saved for today, and Try another level in the first place', async ({ page }) => {
  test.setTimeout(90000);
  const problems = watchProblems(page);
  await page.addInitScript(() => { try { localStorage.setItem('sudoku.level', 'family'); } catch { /* fine */ } });
  const guest = await openAsGuest(page, '/sudoku.html');
  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  const cells = page.locator('.sd-cell');
  await expect(cells).toHaveCount(81);
  const grid = (await cells.allTextContents()).map((t, i) => Number(t.trim().slice(0, 1)) || 0);
  const givenIdx = await cells.evaluateAll(cs => cs.map(c => c.classList.contains('given')));
  const start = grid.map((v, i) => (givenIdx[i] ? v : 0));
  const answer = solve(start);
  expect(answer).toBeTruthy();
  for (let i = 0; i < 81; i++) {
    if (givenIdx[i]) continue;
    await cells.nth(i).click();
    await page.keyboard.press(String(answer[i]));
  }
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+ in Family for today`), again: false, setup: false });
  await expect(card(page).locator('.ew-title')).toHaveText('Family puzzle solved! 🎉');
  await expect(card(page).getByRole('button', { name: 'Try another level' })).toHaveClass(/ew-play/);
  // Enter takes the first button: the next level.
  await page.keyboard.press('Enter');
  await expectClean(page);
  await expect(page.locator('#levelSeg button[aria-pressed="true"]')).toHaveText('Easy');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Clueless Crosswords: solved and saved for today', async ({ page }) => {
  test.setTimeout(90000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/clueless.html');
  await page.locator('#coverBtn').click();
  await expect(page.locator('#cover')).toBeHidden();
  const runId = await page.evaluate(() => Object.keys(localStorage).filter(k => /^clueless\.current\.\d/.test(k)).map(k => localStorage.getItem(k))[0]);
  const { letters } = await (await page.request.get(`/api/clueless/test/answer/${runId}`)).json();
  const cells = page.locator('#grid .cl-cell');
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] === '#') continue;
    const cell = cells.nth(i);
    if (!/\bsel\b/.test(await cell.getAttribute('class'))) await cell.click();
    const key = page.locator(`#keys [data-key="${letters[i]}"]`);
    if (await key.isVisible()) await key.click(); else await page.keyboard.press(letters[i].toLowerCase());
  }
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+ in .* for today`), again: false, setup: false });
  await expect(card(page).getByRole('button', { name: 'Try the other one' })).toBeVisible();
  await card(page).getByRole('button', { name: 'Close' }).click();
  expect(problems, problems.join('\n')).toEqual([]);
});

// ---- the word games with rooms -------------------------------------------------------------------------

test('Shuffle Scuffle: the daily set saves by itself, and the window goes when a new game starts', async ({ page }) => {
  test.setTimeout(120000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/scuffle.html');
  await page.getByRole('button', { name: /Daily/ }).first().click();
  await page.locator('#goBtn').click();
  // Every round: find one word, then I'm done (asked on the arcade's own card) and on to the next.
  for (let round = 0; round < 8 && !(await card(page).isVisible()); round++) {
    await expect(page.locator('#play')).toBeVisible({ timeout: 10000 });
    const letters = (await page.locator('#tiles .sc-tile').allTextContents()).join('');
    const word = game.findWords(letters, 'kids').filter(w => w.length <= 4).pop();
    await page.keyboard.type(word.toLowerCase());
    await page.keyboard.press('Enter');
    await expect(page.locator('#found li', { hasText: word })).toBeVisible();
    await page.locator('#doneBtn').click();
    await page.locator('.ab-confirm [data-leave]').click();
    await expect(page.locator('#reveal')).toBeVisible({ timeout: 10000 });
    if (await page.locator('#nextBtn').isVisible()) await page.locator('#nextBtn').click();
  }
  // The daily is once a day, so there's no Play again.
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+ for today`), again: false });
  // The buttons that move the game on are in the window, not left outside it.
  await expect(page.locator('#reveal #nextBtn')).toBeHidden();
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect(page.locator('#setup')).toBeVisible();
  // Free play, one round: the window goes away with the next game, and nothing is left on the screen.
  await page.getByRole('button', { name: /Free play/ }).click();
  await page.locator('#goBtn').click();
  for (let round = 0; round < 8 && !(await card(page).isVisible()); round++) {
    await expect(page.locator('#play')).toBeVisible({ timeout: 10000 });
    await page.locator('#doneBtn').click();
    await page.locator('.ab-confirm [data-leave]').click();
    await expect(page.locator('#reveal')).toBeVisible({ timeout: 10000 });
    if (await page.locator('#nextBtn').isVisible()) await page.locator('#nextBtn').click();
  }
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: 'Close' }).click();
  await page.goBack();
  await expectClean(page);
  await expect(page.locator('#setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Words with Family: a game that stalls ends in the window, and leaving asks on the arcade\'s own card', async ({ page }) => {
  test.setTimeout(120000);
  const problems = watchProblems(page);
  let browserBox = false;
  page.on('dialog', d => { browserBox = true; d.dismiss(); });
  await openAsGuest(page, '/crisscross.html');
  // Against the computer: leaving goes back to your games, with no "Computer wins" and no confetti.
  await page.locator('#newLocalBtn').click();
  await page.locator('#localPlayers input').first().fill('Tester');
  await page.locator('#localGo').click();
  await expect(page.locator('#game')).toBeVisible();
  await page.evaluate(() => document.getElementById('resignBtn').click());
  await expect(page.locator('.ab-confirm')).toBeVisible();
  await page.locator('.ab-confirm [data-leave]').click();
  await expect(page.locator('#home')).toBeVisible();
  await expect(layer(page)).toBeHidden();
  await expect(page.getByText('Computer wins')).toHaveCount(0);
  // Two people on one device who both pass three times: the game stalls and ends.
  await page.locator('#newLocalBtn').click();
  await page.locator('#addPerson').click();
  await page.locator('#localPlayers .cc-local-row', { hasText: 'The computer' }).getByRole('button').click();
  await page.locator('#localPlayers input').nth(0).fill('Ana');
  await page.locator('#localPlayers input').nth(1).fill('Ben');
  await page.locator('#localGo').click();
  const handoff = page.locator('#handoffGo');
  const yes = page.locator('.ab-confirm [data-leave]');
  for (let i = 0; i < 20 && !(await card(page).isVisible()); i++) {
    // Pass the device: the next person shows their tiles first.
    await page.waitForTimeout(300);
    if (await handoff.isVisible()) { await handoff.click(); continue; }
    if (await card(page).isVisible()) break;
    await page.evaluate(() => document.getElementById('passBtn').click());
    if (await yes.waitFor({ timeout: 2000 }).then(() => true, () => false)) await yes.click();
  }
  await checkCard(page, { saved: null });
  await expect(card(page).locator('.ew-detail')).toContainText('Ana');
  await page.goBack();
  await expectClean(page);
  await expect(page.locator('#home')).toBeVisible();
  expect(browserBox, 'nothing used the browser\'s own confirm box').toBe(false);
  expect(problems, problems.join('\n')).toEqual([]);
});
