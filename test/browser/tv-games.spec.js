'use strict';

// The games played on the TV itself (public/tv-play.js), at 1920 by 1080 with
// the ARKS TV app's user agent: the cabinet games (Tumbler Rumble, Disco Drop,
// Roll Royale, Moonshot) and the classics (Snake, Dino Dash, Block Drop, Brick
// Breaker, Tower Defense, Sudoku, Chess). Each one is opened, started and
// played a little with only the remote's arrows and OK (arrow keys and
// Enter), and a pretend game controller (navigator.getGamepads, the way the
// TV app's controller reaches the page) presses the buttons that aren't the
// remote's. Where a run ends quickly, the initials go on the board picked with
// the arrows, like an arcade cabinet.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const TV_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36 ARKS-TV/1.0.0';

test.use({ userAgent: TV_UA, viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false });
test.beforeEach(({}, info) => {
  info.skip(info.project.name !== 'laptop', 'TV tests run once, at TV size');
  info.setTimeout(120000);
});

const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// One TV per worker, set up the way a grown-up does it: the TV shows a code
// and the pretend grown-up's phone approves it. Every test then opens its
// game on that TV (its sign-in is kept and reused), so the tests don't each
// ask for a new code (the arcade allows 30 new codes in 10 minutes).
let signedInTv = null;
async function pairTv(page) {
  const code = page.locator('.tv-pair .tv-code');
  await expect(code).toBeVisible();
  const userCode = (await code.textContent()).replace(/\s/g, '');
  expect((await fake('/test/tv/approve', { userCode, as: 'playroom' })).ok).toBe(true);
  await expect(page.locator('#tvBar')).toContainText('Playroom TV', { timeout: 20000 });
  await expect(page.locator('.tv-pair')).toHaveCount(0);
}
test.beforeAll(async ({ browser }, info) => {
  if (info.project.name !== 'laptop') return;
  const context = await browser.newContext({ userAgent: TV_UA, viewport: { width: 1920, height: 1080 }, baseURL: `http://localhost:${PORT}` });
  const page = await context.newPage();
  await quietFonts(page);
  await page.goto('/');
  await pairTv(page);
  signedInTv = await context.storageState();
  await context.close();
});
test.use({ storageState: async ({}, use) => use(signedInTv || undefined) });

// Opens a game on the TV. How to play opens by itself the first time; it's
// closed with the arrows and OK.
async function openTv(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await page.goto(path);
  // switches.spec.js switches Dino Dash off for everyone for a few seconds,
  // to show its "Pardon our dust" sign. If this lands in those seconds, the
  // game is back on a moment later.
  await page.waitForLoadState('networkidle');
  for (let i = 0; i < 30 && await page.locator('.dust-page').isVisible(); i++) {
    await page.waitForTimeout(1000);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await expect(page.locator('#tvBar')).toContainText('Playroom TV', { timeout: 10000 });
  await expect(page.locator('html')).toHaveClass(/tv-play/);
  await page.waitForLoadState('networkidle');
  if (await page.locator('.tut-overlay:not([hidden])').isVisible().catch(() => false)) await press(page, '.tut-x');
  await expect(page.locator('.tut-overlay:not([hidden])')).toHaveCount(0);
  return problems;
}

// The game fills the right side of the screen, inside the safe area, and
// nothing is wider than the TV.
async function expectTvLayout(page, { minHeight = 700 } = {}) {
  const box = await page.locator('.tv-stage').boundingBox();
  expect(box.x).toBeGreaterThan(700);
  expect(box.x + box.width).toBeLessThanOrEqual(1920 - 48);
  expect(box.y).toBeGreaterThanOrEqual(150);
  expect(box.y + box.height).toBeLessThanOrEqual(1080 - 30);
  expect(box.height).toBeGreaterThan(minHeight);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
}

// Moves the highlight onto the element with the arrow keys alone, one press
// at a time toward it, the way someone with the remote would.
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

// The letters on a game-over panel, picked like an arcade cabinet: up and
// down change a letter, right moves to the next one, and OK saves.
async function pickInitials(page, row, word) {
  const boxes = page.locator(`${row} input.ini`);
  await expect(boxes.first()).toBeFocused({ timeout: 5000 });
  for (let i = 0; i < word.length; i++) {
    if (i) await page.keyboard.press('ArrowRight');
    await expect(boxes.nth(i)).toBeFocused();
    for (let n = 0; n < 40 && (await boxes.nth(i).inputValue()) !== word[i]; n++) await page.keyboard.press('ArrowUp');
    await expect(boxes.nth(i)).toHaveValue(word[i]);
  }
  await page.keyboard.press('Enter');
}

// A pretend game controller, the way the page sees one through the Gamepad
// API, and the keys that reach the page (to see what a button turned into).
async function plugInPad(page) {
  await page.evaluate(() => {
    const pad = {
      index: 0, id: 'Pretend controller', connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
    };
    window.testPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
    window.testKeys = [];
    document.addEventListener('keydown', e => window.testKeys.push(e.key), true);
    document.addEventListener('keyup', e => window.testKeys.push(`up:${e.key}`), true);
  });
}
const padButton = (page, i, down) => page.evaluate(([i, down]) => {
  const b = window.testPad.buttons[i];
  b.pressed = down; b.touched = down; b.value = down ? 1 : 0;
}, [i, down]);
// The page reads the controller once a frame, so every change is held
// until it has drawn two frames: a press can't fall between them, however
// busy the machine is.
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function padPress(page, i, holdMs = 0) {
  await padButton(page, i, true);
  await frames(page);
  if (holdMs) await page.waitForTimeout(holdMs);
  await padButton(page, i, false);
  await frames(page);
}
async function stick(page, x, y) {
  await page.evaluate(([x, y]) => { window.testPad.axes[0] = x; window.testPad.axes[1] = y; }, [x, y]);
  await frames(page);
  await page.evaluate(() => { window.testPad.axes[0] = 0; window.testPad.axes[1] = 0; });
  await frames(page);
}
const keysSeen = page => page.evaluate(() => window.testKeys.slice());
const activity = page => page.waitForRequest(r => r.url().endsWith('/api/tv/activity') && r.method() === 'POST', { timeout: 10000 });

test('Tumbler Rumble with the remote and a controller', async ({ page }) => {
  let reported = false;
  page.on('request', r => { if (r.url().endsWith('/api/tv/activity')) reported = true; });
  const problems = await openTv(page, '/tumbler.html');
  await expectTvLayout(page);
  await expect(page.locator('.tv-go')).toBeFocused();
  // Nothing counts as playing yet, so ARKS ID hasn't heard of a game.
  expect(reported).toBe(false);
  const played = activity(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => !!window.TumblerTest)).toBe(true);
  await played;

  // OK pops the pin, pressed when the light is on it (timed inside the page,
  // through the page's own handlers, so the browser's round trips don't
  // matter).
  await page.evaluate(() => new Promise(resolve => {
    const go = () => {
      const ms = window.TumblerTest.msToNextPin();
      if (ms > 3) { setTimeout(go, Math.min(ms - 2, 40)); return; }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      resolve();
    };
    go();
  }));
  await expect(page.locator('#hudPins')).toHaveText('2');

  // A controller's X pops too. Pressed right away the light isn't on the new
  // pin, so it's a miss and the run ends.
  await plugInPad(page);
  await padPress(page, 2);
  expect(await keysSeen(page)).toContain(' ');
  await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
  await pickInitials(page, '#iniRow', 'ACE');
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList li.me')).toContainText('ACE');

  // Close the scores, and Play again is where the highlight lands.
  await press(page, '#scoresClose');
  await expect(page.locator('#againBtn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.TumblerTest.state().mode)).toBe('playing');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Disco Drop with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/discodrop.html');
  await expectTvLayout(page);
  // The cabinet's own Start button has the highlight.
  await expect(page.locator('#coverBtn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cover')).toBeHidden();
  await plugInPad(page);
  // OK, then X, R1 and the right trigger, then OK for the rest.
  const ways = ['ok', 2, 5, 7];
  for (let ball = 1; ball <= 10; ball++) {
    await expect(page.locator('#ball')).toHaveText(`${ball} of 10`);
    await expect(page.locator('#dropBtn')).toBeEnabled();
    const way = ways[ball - 1] || 'ok';
    if (way === 'ok') await page.keyboard.press('Enter');
    else await padPress(page, way);
    if (ball < 10) await expect(page.locator('#ball')).toHaveText(`${ball + 1} of 10`, { timeout: 10000 });
  }
  await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overChips span')).toHaveCount(10);
  await pickInitials(page, '#iniRow', 'DJ');
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList')).toContainText('DJ');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Roll Royale with a held OK and a held controller button', async ({ page }) => {
  const problems = await openTv(page, '/royale.html');
  await expectTvLayout(page);
  await expect(page.locator('.tv-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => !!window.RoyaleTest)).toBe(true);
  const ready = () => expect.poll(() => page.evaluate(() => {
    const T = window.RoyaleTest, st = T.state();
    return T.msToReady() <= 0 && st.landed >= st.ball;
  }), { timeout: 15000 }).toBe(true);

  // The first ball into the middle: OK pressed and held for the planned time,
  // inside the page so the timing is exact.
  await ready();
  await page.evaluate(() => new Promise(resolve => {
    const T = window.RoyaleTest;
    const key = type => document.body.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', bubbles: true }));
    const until = (at, then) => { const go = () => { const ms = at - T.gameTime(); if (ms > 2) { setTimeout(go, Math.min(ms - 1, 40)); return; } then(); }; go(); };
    const plan = T.plan('bull');
    until(plan.pressAt, () => { key('keydown'); until(T.gameTime() + plan.holdMs, () => { key('keyup'); resolve(); }); });
  }));
  await expect(page.locator('#hudBall')).toHaveText('2', { timeout: 10000 });

  // The second with a controller's X, held and let go.
  await plugInPad(page);
  await ready();
  await padPress(page, 2, 250);
  await expect(page.locator('#hudBall')).toHaveText('3', { timeout: 10000 });

  // The rest with the remote: hold OK a moment and let go.
  for (let ball = 3; ball <= 9; ball++) {
    await ready();
    await page.keyboard.down('Enter');
    await page.waitForTimeout(250);
    await page.keyboard.up('Enter');
    if (ball < 9) await expect(page.locator('#hudBall')).toHaveText(String(ball + 1), { timeout: 10000 });
  }
  await expect(page.locator('#over')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#tally li')).toHaveCount(9);
  await pickInitials(page, '#iniRow', 'ROL');
  await expect(page.locator('#scores')).toBeVisible();
  await expect(page.locator('#scoreList li.me')).toContainText('ROL');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Moonshot with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/moonshot.html');
  await expectTvLayout(page);
  await expect(page.locator('#coverBtn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cover')).toBeHidden();
  const swings = [];
  page.on('request', r => { if (/\/api\/moonshot\/run\/[^/]+\/swing$/.test(r.url())) swings.push(r.url()); });

  // OK swings at the first pitch, right when it reaches the ring.
  const runId = await page.evaluate(() => window.MoonshotClock.runId());
  const first = await (await page.request.get(`/api/moonshot/test/homer/${runId}?after=0`)).json();
  await page.evaluate(at => new Promise(resolve => {
    const go = () => {
      const left = at - window.MoonshotClock.elapsed();
      if (left > 30) { setTimeout(go, Math.min(left - 25, 200)); return; }
      while (window.MoonshotClock.elapsed() < at) { /* the last few ms */ }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      resolve();
    };
    go();
  }), first.perfect);
  await expect(page.locator('.fx-banner .fx-title')).toHaveText('HOME RUN!');
  await expect(page.locator('#score')).toHaveText('100');

  // A controller's X swings at the next one.
  await plugInPad(page);
  const second = await (await page.request.get(`/api/moonshot/test/homer/${runId}?after=${first.perfect + 500}`)).json();
  await page.waitForFunction(at => window.MoonshotClock.elapsed() >= at - 40, second.perfect, { timeout: 30000 });
  await padPress(page, 2, 60);
  await expect.poll(() => swings.length, { timeout: 5000 }).toBe(2);

  // Start pauses; the highlight lands on Keep playing, and OK carries on.
  await padPress(page, 9);
  await expect(page.locator('#pauseCover')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pauseCover')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.MoonshotClock.mode())).toMatch(/resuming|playing/);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Snake with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/snake.html');
  await expectTvLayout(page);
  // The mode and speed are picked with the arrows, then Play.
  await press(page, '#speedSeg button:nth-child(1)');
  await expect(page.locator('#speedSeg button:nth-child(1)')).toHaveAttribute('aria-pressed', 'true');
  await press(page, '.tv-go');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('.tv-go')).toBeHidden();

  // The controller: Start pauses, and OK on the remote carries on.
  await plugInPad(page);
  await padPress(page, 9);
  await expect(page.locator('#stageMsg')).toContainText('Paused');
  await page.keyboard.press('Enter');
  await expect(page.locator('#stageMsg')).toBeHidden();
  // The left stick steers: up, into the top wall.
  await stick(page, 0, -1);
  expect(await keysSeen(page)).toEqual(expect.arrayContaining(['p', 'ArrowUp', 'up:ArrowUp']));
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 20000 });
  // No apples means no score to save, so Play again has the highlight.
  await expect(page.locator('.over-panel .again-btn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  // The arrows steer while it's being played.
  await page.keyboard.press('ArrowDown');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Dino Dash with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/dino.html');
  await expectTvLayout(page, { minHeight: 200 });
  await expect(page.locator('.tv-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'running');
  await plugInPad(page);
  // X jumps (held for a big jump), and OK jumps too.
  await padPress(page, 2, 200);
  await page.keyboard.press('Enter');
  expect(await keysSeen(page)).toEqual(expect.arrayContaining([' ', 'up: ']));
  // Sooner or later a cactus wins.
  await expect(page.locator('#overPanel')).toBeVisible({ timeout: 30000 });
  await pickInitials(page, '#overPanel', 'REX');
  await expect(page.locator('#scoresView')).toBeVisible();
  await expect(page.locator('#scoreList')).toContainText('REX');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Block Drop with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/blocks.html');
  await expectTvLayout(page);
  await expect(page.locator('.tv-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await plugInPad(page);
  await padPress(page, 2);           // X turns
  await padPress(page, 3);           // Y holds the piece
  await stick(page, 1, 0);           // the stick moves it right
  expect(await keysSeen(page)).toEqual(expect.arrayContaining(['x', 'c', 'ArrowRight']));
  // OK drops each piece the rest of the way, until the well is full.
  for (let i = 0; i < 80 && !(await page.locator('.over-panel').isVisible()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
  }
  await expect(page.locator('.over-panel')).toBeVisible({ timeout: 10000 });
  await pickInitials(page, '.over-panel', 'BLK');
  await expect(page.locator('.overlay[aria-label="High scores"]')).toBeVisible();
  await expect(page.locator('.overlay[aria-label="High scores"] .scores')).toContainText('BLK');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Brick Breaker with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/bricks.html');
  await expectTvLayout(page);
  await expect(page.locator('.tv-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#stageMsg')).toContainText('Press OK to launch');
  // OK launches the ball, and the arrows move the paddle.
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(200);
  await page.keyboard.up('ArrowLeft');
  // The controller's Start pauses, and OK carries on.
  await plugInPad(page);
  await padPress(page, 9);
  await expect(page.locator('#stageMsg')).toContainText('Paused');
  await page.keyboard.press('Enter');
  await expect(page.locator('#stageMsg')).toBeHidden();
  await stick(page, 1, 0);
  expect(await keysSeen(page)).toEqual(expect.arrayContaining(['p', 'ArrowRight', 'up:ArrowRight']));
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Tower Defense with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/towers.html');
  await expectTvLayout(page);
  // The map has the highlight; the arrows move around it and OK picks a
  // square. Look for grass to build on.
  await expect(page.locator('#stage')).toBeFocused();
  const moves = ['ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowUp'];
  for (const key of moves) {
    await page.keyboard.press('Enter');
    if (await page.locator('#info .build-grid').isVisible()) break;
    await page.keyboard.press(key);
  }
  await expect(page.locator('#info .build-grid')).toBeVisible();
  // The highlight went to the towers; OK builds the first one.
  await expect(page.locator('#info .build-grid button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#gold')).not.toHaveText('180');
  // Back on the map afterwards.
  await expect(page.locator('#stage')).toBeFocused();
  // A controller's X calls the first wave now.
  await plugInPad(page);
  const played = activity(page);
  await padPress(page, 2);
  await expect(page.locator('#wave')).toHaveText(/^1\//);
  await played;
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Sudoku with the remote and a controller', async ({ page }) => {
  const problems = await openTv(page, '/sudoku.html');
  await expectTvLayout(page);
  await expect(page.locator('#coverBtn')).toBeFocused({ timeout: 10000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#cover')).toBeHidden();
  // The arrows move around the board; find a square to fill.
  for (let i = 0; i < 81; i++) {
    await page.keyboard.press('ArrowRight');
    const sel = page.locator('.sd-cell.sel');
    if (await sel.count() && !(await sel.getAttribute('class')).includes('given') && !(await sel.textContent()).trim()) break;
  }
  const cell = page.locator('.sd-cell.sel');
  await expect(cell).toHaveText('');
  // OK opens the numbers; OK on 5 puts it in.
  await page.keyboard.press('Enter');
  await expect(page.locator('.sd-picker')).toBeVisible();
  await expect(page.locator('.sd-picker-nums button').nth(4)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sd-picker')).toBeHidden();
  await expect(cell).toHaveText('5');
  // A controller: X erases, Y turns notes on, Start pauses.
  await plugInPad(page);
  await padPress(page, 2);
  await expect(cell).toHaveText('');
  await padPress(page, 3);
  await expect(page.locator('#notesBtn')).toHaveAttribute('aria-pressed', 'true');
  await padPress(page, 9);
  await expect(page.locator('#cover')).toBeVisible();
  await expect(page.locator('#coverBtn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cover')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Chess against the computer with the remote', async ({ page }) => {
  const problems = await openTv(page, '/chess.html');
  // The two-phone games stay on phones.
  await expect(page.locator('[data-mode="host"]')).toBeHidden();
  await expect(page.locator('[data-mode="join"]')).toBeHidden();
  await press(page, '#goBtn');
  await expect(page.locator('#game')).toBeVisible();
  await expectTvLayout(page);
  // The highlight starts on the king's pawn: OK picks it, up twice, OK moves it.
  await expect(page.locator('[data-sq="52"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-sq="36"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sq="36"] .pc.w')).toBeVisible();
  // The computer answers, and the highlight stays on the board.
  await expect(page.locator('#lastMove')).toContainText('Computer', { timeout: 20000 });
  await expect(page.locator('#board .sq:focus')).toHaveCount(1);
  expect(problems, problems.join('\n')).toEqual([]);
});

// The remote's Back: the TV app turns it into the browser's Back, so it
// follows the same one-screen-back rule as a phone (ArcadeBack in topbar.js).
// A game being played asks first on the TV's own card, which the remote can
// answer; from the game's menu, Back leaves for the arcade.
test('Back on the remote goes one screen back in Snake', async ({ page }) => {
  await quietFonts(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const problems = await openTv(page, '/snake.html');
  await press(page, '.tv-go');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await page.goBack();
  const card = page.locator('.tv-confirm');
  await expect(card).toContainText('Leave this game?');
  // "Keep playing" has the highlight, so OK stays.
  await expect(card.getByRole('button', { name: 'Keep playing' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/snake.html');
  await page.goBack();
  await expect(card.getByRole('button', { name: 'Keep playing' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(card.getByRole('button', { name: 'Leave' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.tv-go')).toBeVisible();
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a Back or Escape key on the TV goes back to Chess\'s setup', async ({ page }) => {
  const problems = await openTv(page, '/chess.html');
  await press(page, '#goBtn');
  await expect(page.locator('#game')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#setup')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/chess.html');
  expect(problems, problems.join('\n')).toEqual([]);
});
