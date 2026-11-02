'use strict';

// The puzzles and Spin & Solve on a TV, at 1920 by 1080 with the ARKS TV
// app's user agent, played with only the arrow keys and Enter (the remote's
// arrows and OK): typing on the keyboard on the screen in Wordless, moving
// around the Clueless grid, putting a word down in Criss Cross against the
// computer, and spinning and solving in Spin & Solve.

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems } = require('./helpers');
const bot = require(path.join(__dirname, '..', '..', 'crisscross', 'bot.js'));

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const TV_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36 ARKS-TV/1.0.0';

test.use({ userAgent: TV_UA, viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false });
// One TV is enough: these run in the laptop project only.
test.beforeEach(({}, info) => {
  info.skip(info.project.name !== 'laptop', 'TV tests run once, at TV size');
  info.setTimeout(150000);
});

const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// The first time, the TV shows a code; a grown-up's phone approves it. This
// file sets up the kitchen's TV, so it can run alongside the other TV test
// files (setting a TV up again signs its old sign-in out).
async function pairTv(page, p) {
  await quietFonts(page);
  await page.goto(p);
  const code = page.locator('.tv-pair .tv-code');
  await expect(code).toBeVisible();
  const userCode = (await code.textContent()).replace(/\s/g, '');
  expect((await fake('/test/tv/approve', { userCode, as: 'kitchen' })).ok).toBe(true);
  await expect(page.locator('#tvBar')).toContainText('Kitchen TV', { timeout: 20000 });
  await expect(page.locator('.tv-pair')).toHaveCount(0);
}

// Moves the highlight onto the element with the arrow keys alone, the way
// someone with the remote would: toward it, one press at a time.
async function arrowTo(page, selector, max = 60) {
  for (let i = 0; i < max; i++) {
    const at = await page.evaluate(sel => {
      const t = document.querySelector(sel);
      if (!t) return { missing: true };
      const a = document.activeElement;
      if (a === t) return { done: true };
      const box = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      return { t: box(t), a: a && a !== document.body ? box(a) : null };
    }, selector);
    if (at.done) return;
    if (at.missing) throw new Error(`${selector} isn't on the page`);
    let key = 'ArrowDown';
    if (at.a) {
      const [tl, tt, tr, tb] = at.t, [al, aT, ar, ab] = at.a;
      if (tb <= aT + 1) key = 'ArrowUp';
      else if (tt >= ab - 1) key = 'ArrowDown';
      else if (tl >= ar - 1) key = 'ArrowRight';
      else if (tr <= al + 1) key = 'ArrowLeft';
      else key = (tt + tb) / 2 > (aT + ab) / 2 ? 'ArrowDown' : 'ArrowUp';
    }
    await page.keyboard.press(key);
  }
  throw new Error(`couldn't reach ${selector} with the arrows`);
}
const press = async (page, selector) => { await arrowTo(page, selector); await page.keyboard.press('Enter'); };

async function fitsTheScreen(page) {
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
}

test('each puzzle page fits the TV, and How to play waits for the ? button', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/wordless.html');
  for (const p of ['/wordless.html', '/clueless.html', '/crisscross.html', '/spinsolve.html']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveClass(/\btv\b/);
    await expect(page.locator('#tvBar')).toContainText('family mode');
    await expect(page.locator('.tut-overlay:visible')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement !== document.body)).toBe(true);
    await fitsTheScreen(page);
  }
  // Criss Cross keeps the games on everyone's own phone off the TV.
  await expect(page.locator('#newOnlineBtn')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Wordless: a guess typed with the remote on the keyboard on the screen', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/wordless.html');
  await expect(page.locator('#difficultyOverlay')).toBeVisible();
  await press(page, '.difficulty-choice:nth-child(1)');
  await expect(page.locator('#difficultyOverlay')).toBeHidden();
  const length = await page.locator('#row-0 .tile').count();
  expect(length).toBeGreaterThanOrEqual(3);
  const word = 'stare'.repeat(3).slice(0, length);
  for (const ch of word) await press(page, `#key-${ch}`);
  await expect(page.locator('#row-0 .tile.filled')).toHaveCount(length);
  // ⌫ takes one back, and the letter goes in again.
  await press(page, '#key-back');
  await expect(page.locator('#row-0 .tile.filled')).toHaveCount(length - 1);
  await press(page, `#key-${word[length - 1]}`);
  await press(page, '#key-enter');
  await expect(page.locator('#row-0 .tile.correct, #row-0 .tile.present, #row-0 .tile.absent')).toHaveCount(length, { timeout: 8000 });
  await expect(page.locator('#key-s')).toHaveClass(/correct|present|absent/);
  await fitsTheScreen(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Clueless: the highlight is the cursor, and the keyboard types', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/clueless.html');
  await expect(page.locator('#coverBtn')).toBeFocused({ timeout: 8000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#cover')).toBeHidden();
  // The highlight starts on the first square to fill.
  await expect(page.locator('.cl-cell.sel')).toBeFocused();
  const cellIndex = () => page.evaluate(() => [...document.querySelectorAll('#grid .cl-cell')].indexOf(document.activeElement));
  const selIndex = () => page.locator('.cl-cell.sel').evaluate(e => [...e.parentNode.children].indexOf(e));
  const first = await selIndex();
  // The arrows move the highlight; OK picks the square it's on.
  await page.keyboard.press('ArrowRight');
  const next = await cellIndex();
  expect(next).not.toBe(first);
  expect(await selIndex()).toBe(first);
  await page.keyboard.press('Enter');
  expect(await selIndex()).toBe(next);
  // OK again switches between across and down (where both run through it).
  const dir = await page.locator('#dirBtn small').textContent();
  await page.keyboard.press('Enter');
  const switched = (await page.locator('#dirBtn small').textContent()) !== dir;
  expect(await selIndex()).toBe(next);
  if (!switched) expect(await page.locator('#dirBtn small').textContent()).toBe(dir);
  // Down to the keyboard (passing over other squares doesn't pick them), and a letter lands in the picked square.
  await press(page, '.cl-key[data-key="Q"]');
  await expect(page.locator('#grid .cl-cell').nth(next).locator('.ltr')).toHaveText('Q');
  // Back up: the highlight lands on the square that's picked now.
  for (let i = 0; i < 8 && !(await page.evaluate(() => !!document.activeElement.closest('#grid'))); i++) await page.keyboard.press('ArrowUp');
  await expect(page.locator('.cl-cell.sel')).toBeFocused();
  await fitsTheScreen(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Criss Cross: a first word against the computer, with the remote', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/crisscross.html');
  await press(page, '#newLocalBtn');
  await expect(page.locator('#localPlayers')).toContainText('The computer');
  await press(page, '#localGo');
  await expect(page.locator('#game')).toBeVisible();
  const tiles = page.locator('#rack .cc-tile');
  await expect(tiles).toHaveCount(7);
  const rack = await tiles.evaluateAll(els => els.map(e => e.dataset.letter));
  const best = bot.bestPlay({ board: new Array(121).fill(''), dictionary: 'kids', racks: [rack] }, 0);
  expect(best, `no word in ${rack.join('')}`).toBeTruthy();
  for (const p of best.placements) {
    const id = await page.locator(`#rack .cc-tile[data-letter="${p.letter}"]:not(.used)`).first().getAttribute('data-id');
    await press(page, `#rack .cc-tile[data-id="${id}"]`);
    // Picking a tile up sends the highlight to the board.
    await expect.poll(() => page.evaluate(() => !!document.activeElement.closest('#board'))).toBe(true);
    await press(page, `#board .cc-cell[data-i="${p.index}"]`);
    await expect(page.locator(`#board .cc-cell[data-i="${p.index}"]`)).toHaveClass(/pending/);
  }
  await expect(page.locator('#preview')).toContainText(`That's ${best.score} point`, { timeout: 8000 });
  await press(page, '#playBtn');
  const word = best.placements.map(p => p.letter).join('');
  await expect(page.locator('#moveList')).toContainText(word);
  // The server scored it, and the computer took its turn.
  await expect(page.locator('#moveList li')).toHaveCount(2, { timeout: 15000 });
  await fitsTheScreen(page);
  // A half-built word asked about while placing gets "not a word yet" (400): that's expected.
  expect(problems.filter(p => !/\/preview/.test(p) && !/status of 400/.test(p)), problems.join('\n')).toEqual([]);
});

test('Spin & Solve: spin, call a letter and type an answer with the remote', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/spinsolve.html');
  // Just one player, with the remote.
  await press(page, '#nameList .name-row:nth-child(2) button');
  await expect(page.locator('#nameList .name-row')).toHaveCount(1);
  await press(page, '#timerSeg [data-secs="0"]');
  await press(page, '#goBtn');
  await expect(page.locator('#game')).toBeVisible();
  // Spin until a letter's worth something (a Bankrupt or Lose a Turn just spins again).
  for (let i = 0; i < 6 && !(await page.locator('#letterView').isVisible()); i++) {
    await expect(page.locator('#spinBtn')).toBeEnabled({ timeout: 15000 });
    await press(page, '#spinBtn');
    await expect(page.locator('#letterView, #spinBtn:enabled').first()).toBeVisible({ timeout: 15000 });
  }
  await expect(page.locator('#letterView')).toBeVisible();
  // The arrows move across the letters; OK calls the one the highlight is on.
  const letter = await page.locator('#letterGrid button:not(:disabled)').nth(3).textContent();
  await press(page, `#letterGrid button[data-tv-test="${letter}"]`.replace(`[data-tv-test="${letter}"]`, `:nth-child(${letter.charCodeAt(0) - 64})`));
  await expect(page.locator('#letterView')).toBeHidden();
  await expect(page.locator('#usedLetters')).not.toBeEmpty({ timeout: 10000 });
  // Solve: the keyboard on the screen types the answer.
  await expect(page.locator('#solveBtn')).toBeEnabled({ timeout: 15000 });
  await press(page, '#solveBtn');
  await expect(page.locator('#solveView')).toBeVisible();
  await expect(page.locator('#solveKeys button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await press(page, '#solveKeys [aria-label="B"]');
  await press(page, '#solveKeys [aria-label="Space"]');
  await press(page, '#solveKeys [aria-label="Erase"]');
  await expect(page.locator('#solveInput')).toHaveValue('AB');
  await press(page, '#solveCancel');
  await expect(page.locator('#solveView')).toBeHidden();
  await fitsTheScreen(page);
  expect(problems, problems.join('\n')).toEqual([]);
});
