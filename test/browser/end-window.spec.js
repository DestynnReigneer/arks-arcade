'use strict';

// The end window (public/end-window.js), the same in every game. Each game ends a run here and checks:
// the card shows over a dim layer that leaves the top bar alone; the score saved by itself (or the plain line
// when there's nothing to save); ✕ Close, then ☰ has 🏁 Last game's results with a dot, and it brings the card
// back; High scores open inside the card, with Back to my score; Escape closes one layer at a time; Space and
// taps don't reach the game behind; Enter is Play again and leaves no dim or overlay behind. Sizes: a phone, a
// sideways phone (844 by 390) and a laptop.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { quietFonts, watchProblems, openPage, nextStep } = require('./helpers');
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
  // Closed, the finished game doesn't start again from its own keys or a tap: Enter or Space brings the card back.
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(layer(page)).toBeHidden();
  await page.locator('#stage').click();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('over');
  await expect(layer(page)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('over');
  await card(page).getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press(' ');
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.state)).toBe('over');
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
  // Seven boards: the tabs wrap onto more rows and stay inside the card, and they and the back link are 40px tall.
  await card(page).getByRole('button', { name: '🏆 High scores' }).click();
  const tabs = card(page).locator('.ew-tabs');
  await expect(tabs.locator('button')).toHaveCount(7);
  expect(await tabs.evaluate(t => t.scrollWidth <= t.clientWidth + 1), 'the tabs fit across the card').toBe(true);
  const box = await card(page).boundingBox();
  for (const b of await tabs.locator('button').all()) {
    const r = await b.boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(r.height, 'a tab is big enough to tap').toBeGreaterThanOrEqual(40);
  }
  expect((await card(page).getByRole('button', { name: '‹ Back to my score' }).boundingBox()).height).toBeGreaterThanOrEqual(40);
  expect((await card(page).getByRole('button', { name: 'Close' }).boundingBox()).height).toBeGreaterThanOrEqual(40);
  await card(page).getByRole('button', { name: '‹ Back to my score' }).click();
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
  // A signed-in player's ARKS ID photo on the same board isn't served to a guest (the board shows their icon
  // instead), so that answer doesn't count here (the same as no-initials.spec.js).
  const photo = problems.some(p => /\/api\/arksid\/photo\//.test(p));
  const real = problems.filter(p => !/\/api\/arksid\/photo\//.test(p) && !(photo && /Failed to load resource.*404/.test(p)));
  expect(real, real.join('\n')).toEqual([]);
});


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
  await expect(card(page).locator('.ew-title')).toHaveText('Locked out before you even started!');
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
  // The solve's confetti and coins (fx.js) are under the card and the top bar, never over them.
  await card(page).getByRole('button', { name: 'Close' }).click();
  await page.locator('.ah-waffle').click();
  await page.locator('.ah-menu button', { hasText: 'Last game\'s results' }).click();
  await page.evaluate(() => window.Fx && Fx.burst({ count: 40, coins: 10 }));
  const z = await page.evaluate(() => {
    const layer = Number(getComputedStyle(document.querySelector('.ew-layer')).zIndex);
    const bar = Number(getComputedStyle(document.querySelector('.ah')).zIndex);
    const fx = [...document.querySelectorAll('#fxCanvas, .fx-banner, .fx-flash, .fx-fly')].map(e => Number(getComputedStyle(e).zIndex));
    return { layer, bar, fx };
  });
  expect(z.fx.length, 'the confetti is drawn').toBeGreaterThan(0);
  for (const f of z.fx) { expect(f).toBeLessThan(z.layer); expect(f).toBeLessThan(z.bar); }
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
  // Nobody played a word, so nothing is celebrated.
  await expect(page.locator('.fx-banner')).toHaveCount(0);
  // Play again: the same two people, straight into a new game (no setup form to fill in again).
  await card(page).getByRole('button', { name: '▶ Play again' }).click();
  // (The new game starts with its pass-the-device cover for the first player.)
  await expect(layer(page)).toBeHidden();
  await expect(page.locator('.ah-waffle')).not.toHaveClass(/ew-dot/);
  await expect(page.locator('#game')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#newLocal')).toBeHidden();
  if (await handoff.isVisible()) await handoff.click();
  await expect(page.locator('#scoreStrip')).toContainText('Ana');
  await expect(page.locator('#scoreStrip')).toContainText('Ben');
  await expect(page.locator('#scoreStrip')).not.toContainText('Computer');
  await page.goBack();
  await expect(page.locator('#home')).toBeVisible();
  expect(browserBox, 'nothing used the browser\'s own confirm box').toBe(false);
  expect(problems, problems.join('\n')).toEqual([]);
});

// ---- the games that had end screens of their own (moved on 2026-11-19, second part) ---------------------

test('Chess: resigning ends in the window, and the result line under the board brings it back', async ({ page }) => {
  const problems = watchProblems(page);
  await openAsGuest(page, '/chess.html');
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('#resignBtn').click();
  await page.locator('.ab-confirm [data-leave]').click();
  await expect(card(page)).toBeVisible({ timeout: 10000 });
  await expect(card(page).locator('.ew-title')).toHaveText('You resigned. The computer wins, and would have won easily, but continuing would have been entertaining...');
  // A loss has nothing to save, and says nothing about it.
  await expect(card(page).locator('.ew-saved')).toHaveCount(0);
  await checkCard(page, { saved: null });
  await card(page).getByRole('button', { name: 'Close' }).click();
  await page.locator('#statusLine').click();
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: '▶ Play again' }).click();
  await expectClean(page);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#statusLine')).not.toContainText('Tap for results');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Know-It-All solo: a right answer saves by itself, and a game of none says so with no trophy', async ({ page }) => {
  test.setTimeout(90000);
  const problems = watchProblems(page);
  const correct = [];
  await page.route('**/api/trivia/questions?*', async route => {
    const res = await route.fetch();
    const data = await res.json();
    correct.length = 0;
    for (const q of data.questions) correct.push(q.correctIndex);
    await route.fulfill({ response: res, json: data });
  });
  const guest = await openAsGuest(page, '/trivia.html');
  const play = async right => {
    await nextStep(page);
    await page.locator('#countSeg button').first().click();
    await page.locator('#goBtn').click();
    const answers = page.locator('#answers button:not([disabled])');
    const next = page.locator('#nextBtn');
    for (let i = 0; i < 40 && !(await card(page).isVisible()); i++) {
      // Each question: wait for its answers, pick one, then Next (or the end of the game).
      await expect.poll(async () => (await answers.first().isVisible().catch(() => false)) || (await card(page).isVisible()), { timeout: 15000 }).toBe(true);
      if (await card(page).isVisible()) break;
      const n = await answers.count();
      await answers.nth(right ? correct[i] : (correct[i] + 1) % n).click();
      await expect.poll(async () => (await next.isVisible()) || (await card(page).isVisible()), { timeout: 15000 }).toBe(true);
      if (await next.isVisible()) await next.click();
    }
  };
  await play(false);
  await expect(card(page)).toBeVisible({ timeout: 20000 });
  await expect(card(page).locator('.ew-saved')).toHaveText('Show some brain power and get on the board.');
  await expect(page.locator('.big-emoji:visible')).toHaveCount(0);
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await play(true);
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`) });
  await card(page).getByRole('button', { name: '🏆 High scores' }).click();
  await expect(card(page).locator('.ew-list li.me')).toContainText(guest);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Spin & Solve: a solo game saves by itself, with High scores inside the window', async ({ page }) => {
  test.setTimeout(120000);
  const problems = watchProblems(page);
  const guest = await openAsGuest(page, '/spinsolve.html');
  while (await page.locator('#nameList .name-row').count() > 1) await page.locator('#nameList .name-row:last-child button').click();
  await nextStep(page);
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  const run = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('spin.run.'));
    return key ? JSON.parse(localStorage.getItem(key)).id : null;
  });
  // Three rounds (the setup's default), each solved outright.
  for (let round = 0; round < 3; round++) {
    const { answer } = await (await page.request.get(`/api/spinsolve/test/answer/${await run()}`)).json();
    await page.locator('#solveBtn').click();
    await page.locator('#solveInput').fill(answer);
    await page.locator('#solveOk').click();
    await expect(page.locator('#roundView')).toBeVisible({ timeout: 20000 });
    await page.locator('#nextRoundBtn').click();
    if (round < 2) await expect(page.locator('#roundLabel')).toContainText(`Round ${round + 2} of 3`);
  }
  await checkCard(page, { saved: new RegExp(`Saved as ${guest} · #\\d+`) });
  await card(page).getByRole('button', { name: '🏆 High scores' }).click();
  await expect(card(page).locator('.ew-list li.me')).toContainText(guest);
  await card(page).getByRole('button', { name: '‹ Back to my score' }).click();
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect(page.locator('#setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Wordless: a loss has nothing to save and no SCORE heading, and Play again starts a new word', async ({ page }) => {
  test.setTimeout(60000);
  const problems = watchProblems(page);
  await openAsGuest(page, '/wordless.html');
  const pick = page.locator('#difficultyChoices button').first();
  if (await pick.isVisible().catch(() => false)) await pick.click();
  // Six guesses that can't be the answer.
  await expect(page.locator('[id^="tile-0-"]').first()).toBeVisible();
  const tiles = await page.locator('[id^="tile-0-"]').count();
  // Each guess turns over one tile at a time (250 ms each, so over two seconds for a long word), and the
  // keys wait until it's done. So: type until the row shows the letters, send it, then wait for its last tile
  // to turn over, instead of a fixed wait that a long word outlasts.
  for (let g = 0; g < 6 && !(await card(page).isVisible()); g++) {
    const last = page.locator(`#tile-${g}-${tiles - 1}`);
    await expect(async () => {
      await page.keyboard.type('z'.repeat(tiles));
      await expect(last).toHaveClass(/\bfilled\b/, { timeout: 500 });
    }).toPass({ timeout: 10000 });
    await page.keyboard.press('Enter');
    await expect(last).toHaveClass(/\b(absent|present|correct)\b/, { timeout: 10000 });
  }
  await expect(card(page)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('SCORE', { exact: true })).toHaveCount(0);
  await checkCard(page, { plain: 'Solve the word, like the wheel of... anyways, get on the board.' });
  await page.keyboard.press('Enter');
  await expectClean(page);
  await expect(page.locator('#board .tile.filled')).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Rambler solo: the round\'s results stay on the page under the window', async ({ page }) => {
  test.setTimeout(60000);
  const problems = watchProblems(page);
  await openAsGuest(page, '/rambler.html');
  await page.locator('#modeList .mode[data-mode="solo"]').click();
  await page.locator('#startBtn').click();
  await page.locator('#doneBtn').click();
  await expect(card(page)).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#resultsScreen')).toBeVisible();
  await checkCard(page, { plain: 'Find a word to get on the board.' });
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#standings')).toBeVisible();
  await page.goBack();
  await expectClean(page);
  await expect(page.locator('#setupScreen')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

// The card games on one device, played to the end by tapping whatever the turn needs. They have no board,
// so no score to save and no High scores.
// inPage: click each button in the page itself, for games whose cards overlap (a click at a spot can land on
// the card next to the one meant).
async function playCards(page, steps, max = 400, inPage = false) {
  for (let i = 0; i < max && !(await card(page).isVisible()); i++) {
    let did = false;
    for (const sel of steps) {
      const b = page.locator(sel).first();
      if (await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) {
        // (force: the deck and the cards wobble, so they're never still enough for a normal click)
        if (inPage) await b.evaluate(el => el.click()).catch(() => {});
        else await b.click({ timeout: 2000, force: true }).catch(() => {});
        did = true;
        break;
      }
    }
    if (!did) await page.waitForTimeout(150);
  }
}

test('Dare Devil: a quick game on one device ends in the window, with no High scores', async ({ page }) => {
  test.setTimeout(180000);
  const problems = watchProblems(page);
  await openAsGuest(page, '/daredevil.html');
  await page.locator('#lengthSeg [data-v="quick"]').click();
  const names = page.locator('#nameList input');
  if (await names.count() < 2) await page.locator('#addPlayerBtn').click();
  await names.nth(0).fill('Ana');
  await names.nth(1).fill('Ben');
  await page.locator('#goBtn').click();
  await playCards(page, ['#calloutOk', '.ab-confirm [data-leave]', '#dctGo', '#doneBtn', '#deckBtn']);
  await checkCard(page, { scores: false });
  await expect(card(page).locator('.ew-title')).toContainText('is the Dare Devil!');
  await card(page).getByRole('button', { name: '▶ Play again' }).click();
  await expectClean(page);
  await expect(page.locator('#game')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Uh-Oh: Part Deux: a game on one device ends in the window, with no High scores', async ({ page }) => {
  test.setTimeout(540000);
  const problems = watchProblems(page);
  await openAsGuest(page, '/partdeux.html');
  const names = page.locator('#nameList input');
  if (await names.count() < 2) await page.locator('#addPlayerBtn').click();
  await names.nth(0).fill('Ana');
  await names.nth(1).fill('Ben');
  await page.locator('#goBtn').click();
  const steps = ['#calloutOk', '#passReady', '#colorRow button', '#uhohBtn', '#hand .ok', '#keepBtn', '#drawBtn'];
  // A two-player game can run long (draw piles, Nopes, gifts), so it gets a time budget rather than a count.
  const until = Date.now() + 460000;
  while (Date.now() < until && !(await card(page).isVisible())) {
    // A gift card: pick a card to give, then who gets it.
    if (await page.locator('#giftPick:not(.hidden)').isVisible().catch(() => false)) {
      // (clicked in the page: the little cards overlap, so a click at a spot can land on the wrong one, or none)
      await page.evaluate(() => { document.querySelector('#giftCards > *').click(); document.querySelector('#giftTargets button').click(); });
      continue;
    }
    await playCards(page, steps, 8, true);
  }
  await checkCard(page, { scores: false });
  await expect(card(page).locator('.ew-title')).toContainText('wins!');
  await card(page).getByRole('button', { name: '⚙️ Back to setup' }).click();
  await expectClean(page);
  await expect(page.locator('#setup')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});
