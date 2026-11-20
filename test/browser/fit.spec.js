'use strict';

// The screen-size check. Every game whose layout is meant to fit the screen is
// opened at five sizes and played up to its first move. At each size, the board
// and everything you play with must be fully on the screen and not covered, the
// board can't be squashed to almost nothing, and the page can't scroll sideways.
//
// The sizes are the ones people really use. Two are about Chrome on a phone: its
// address bar makes the page shorter, and its row of tabs along the bottom covers
// the page without making it shorter. A game that spreads itself over the whole
// height (100dvh) hides its buttons under that row. The page can only see the row
// through the visual viewport (`--app-h` in topbar.js), so the test browser reports
// it that way. `covered` is how much of the bottom the row hides; what you play
// with has to sit above it.
//
// A size a game doesn't fit yet is listed in KNOWN with the reason, and that
// test is expected to fail. When a fix makes it pass, Playwright reports the
// "expected to fail" test as passing unexpectedly: take it off the list then. One
// that fits on some machines and not others starts with "skip: " and isn't run.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const SIZES = [
  ['phone', { width: 390, height: 844 }, true],
  ['phone with the browser bars showing', { width: 412, height: 640 }, true],
  ["phone with Chrome's tab row", { width: 412, height: 860 }, true, 136],
  ['phone turned sideways', { width: 844, height: 390 }, true],
  ['small phone turned sideways', { width: 740, height: 360 }, true],
  ['tablet', { width: 768, height: 1024 }, true],
  ['laptop', { width: 1366, height: 768 }, false]
];

// start: what a person taps to get to the first move ({ fill, text } types into a box). need: what must be on the
// screen then (touch: only on a touch screen). board: the part that can't get tiny
// (null for a game whose board is a wide strip, like Spin & Solve's puzzle).
// cell: a board of squares to tap ({ cols, min }): on a touch screen each square is at least min pixels across.
// setup: what has to be whole on the screen on the setup screen, before anything is tapped (every choice up to and
// including Start), checked at the upright sizes.
const GAMES = [
  { name: 'Sudoku', path: '/sudoku.html', start: ['#coverBtn'], board: '#board, .sd-board', need: ['.sd-board', '#tools', '#pad'] },
  { name: 'Clueless Crosswords', path: '/clueless.html', start: ['#coverBtn'], board: '#grid', need: ['#clueBar', '#grid', '#tools'], touch: ['#keys'] },
  { name: 'Snake', path: '/snake.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Block Drop', path: '/blocks.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Brick Breaker', path: '/bricks.html', start: [], board: '#canvas', need: ['#canvas'] },
  { name: 'Tower Defense', path: '/towers.html', start: ['#waveBtn'], board: '#canvas', cell: { cols: 10, min: 22 }, need: ['#stage', '#waveBtn', '#buildRow'] },
  { name: 'Words with Family', path: '/crisscross.html', start: ['#newLocalBtn', { fill: '#localPlayers input', text: 'Tester' }, '#localGo'], board: '#board', need: ['#board', '#rack', '#playBtn'] },
  { name: 'Spin & Solve', path: '/spinsolve.html', start: ['#goBtn'], board: null, need: ['#puzzleBoard', '#spinBtn', '#vowelBtn', '#solveBtn'],
    setup: ['#levelList', '#packSelect', '#suggestBtn', '#nameList', '#addPlayerBtn', '#roundSeg', '#timerSeg', '#goBtn'] },
  { name: 'Chess', path: '/chess.html', start: ['#goBtn'], board: '#board', need: ['#board', '#statusLine', '#gameBtns'],
    setup: ['#modeSeg', '#levelSeg', '#colorSeg', '#goBtn'] },
  { name: 'Know-It-All', path: '/trivia.html', start: ['#goBtn'], board: null, need: ['#qText', '#answers'],
    setup: ['#levelList', '#genreChips', '#packSelect', '#diffSeg', '#countSeg', '#secsSeg', '#suggestBtn', '#modeSeg', '#goBtn'] },
  { name: 'Rambler', path: '/rambler.html', start: ['#startBtn'], board: '#board', need: ['#board', '#traceBar', '#doneBtn'],
    setup: ['#dailyCard', '#modeList', '#sizeSeg', '#durationSeg', '#difficultySeg', '#profileSeg', '#startBtn'] },
  { name: 'Dare Devil', path: '/daredevil.html', start: ['#goBtn'], board: '#deckBtn', need: ['#scoreStrip', '#deckBtn'],
    setup: ['#levelList', '#lengthSeg', '#modeSeg', '#nameList', '#addPlayerBtn', '#goBtn'] },
  { name: 'Uh-Oh: Part Deux', path: '/partdeux.html', start: ['#goBtn', '#passReady'], board: null, need: ['#drawPile', '#discard', '#hand', '#drawBtn'],
    setup: ['#levelList', '#modeSeg', '#nameList', '#addPlayerBtn', '#goBtn'] },
  // The 3D cabinet games draw in software in the test browser, slowly, so they get triple time.
  { name: 'Big Swing', path: '/bigswing.html', start: ['.cab-go'], board: '#stage', need: ['#stage', '.cab-pad'], slow: true },
];

// Game and size pairs that don't fit yet, with why. Fixed in order on the to-do list.
const KNOWN = {
  "Chess @ phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Chess @ small phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Know-It-All @ phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Know-It-All @ small phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Rambler @ phone turned sideways": "the game doesn't have a sideways layout yet, so the board and buttons are below the screen",
  "Rambler @ small phone turned sideways": "the game doesn't have a sideways layout yet, so the board and buttons are below the screen",
  "Dare Devil @ phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Dare Devil @ small phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Big Swing @ phone turned sideways": "skip: the game doesn't have a sideways layout yet, so the stage and its big button are below the screen (skipped rather than expected to fail, because the 3D game is slow to close in the test browser)",
  "Big Swing @ small phone turned sideways": "skip: the game doesn't have a sideways layout yet, so the stage and its big button are below the screen (skipped rather than expected to fail, because the 3D game is slow to close in the test browser)",
  "Uh-Oh: Part Deux @ phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Uh-Oh: Part Deux @ small phone turned sideways": "the game doesn't have a sideways layout yet, so it scrolls and its top runs off the screen",
  "Uh-Oh: Part Deux @ laptop": "skip: fits on some machines and not others; on Windows the page scrolls a little below the hand",
  // Setup screens (the second loop below). These three have more choices than an upright phone can show at once,
  // even tightened, so they need a design call (fewer choices on screen, or choices in steps) before they can fit.
  "Know-It-All's setup @ phone": "too many choices for a phone's height: Let's play is about 400px below the screen",
  "Know-It-All's setup @ phone with the browser bars showing": "too many choices for a phone's height: Let's play is about 500px below the screen",
  "Know-It-All's setup @ phone with Chrome's tab row": "too many choices for a phone's height: Let's play is about 470px below the screen",
  "Spin & Solve's setup @ phone": "too many choices for a phone's height: Let's play is about 130px below the screen",
  "Spin & Solve's setup @ phone with the browser bars showing": "too many choices for a phone's height: Let's play is about 280px below the screen",
  "Spin & Solve's setup @ phone with Chrome's tab row": "too many choices for a phone's height: Let's play is about 240px below the screen",
  "Rambler's setup @ phone": "too many choices for a phone's height: Slide to victory is about 540px below the screen",
  "Rambler's setup @ phone with the browser bars showing": "too many choices for a phone's height: Slide to victory is about 730px below the screen",
  "Rambler's setup @ phone with Chrome's tab row": "too many choices for a phone's height: Slide to victory is about 640px below the screen",
};

test.describe.configure({ mode: 'parallel' });

for (const game of GAMES) {
  for (const [label, viewport, touch, covered = 0] of SIZES) {
    test(`${game.name} fits a ${label} (${viewport.width}×${viewport.height})`, async ({ browser }, info) => {
      test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
      if (game.slow) test.slow();
      const known = KNOWN[`${game.name} @ ${label}`];
      if (known && known.startsWith('skip: ')) test.skip(true, known.slice(6));
      else if (known) test.fail(true, known);
      const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 900 });
      const page = await ctx.newPage();
      // Chrome reports the part its tab row covers through the visual viewport, so
      // the test browser is made to report it the same way.
      if (covered) {
        await page.addInitScript(cov => {
          const vv = new EventTarget();
          for (const [k, get] of Object.entries({ height: () => innerHeight - cov, width: () => innerWidth, scale: () => 1, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => scrollY, pageLeft: () => scrollX })) {
            Object.defineProperty(vv, k, { get });
          }
          Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
        }, covered);
      }
      await quietFonts(page);
      const problems = watchProblems(page);
      await openPage(page, game.path);
      const guest = page.getByRole('button', { name: /Play as a guest/ });
      if (await guest.isVisible().catch(() => false)) {
        await guest.click();
        await page.getByRole('button', { name: 'Play', exact: true }).click();
      }
      const close = page.locator('.tut-x');
      if (await close.isVisible().catch(() => false)) await close.click();
      for (const s of game.start) {
        if (typeof s === 'string') await page.locator(s).first().click();
        else await page.locator(s.fill).first().fill(s.text);
      }
      await page.waitForTimeout(1000);

      const need = [...game.need, ...(touch ? game.touch || [] : [])];
      const report = await page.evaluate(({ need, board, covered, cell, touch }) => {
        const vw = innerWidth, vh = innerHeight - covered, out = [];
        for (const sel of need) {
          const el = document.querySelector(sel);
          if (!el) { out.push(`${sel} isn't on the page`); continue; }
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) { out.push(`${sel} is hidden`); continue; }
          if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1) {
            out.push(`${sel} runs off the screen (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)} of ${vh}; left ${Math.round(r.left)}, right ${Math.round(r.right)} of ${vw})`);
            continue;
          }
          // Something else on top of it (a banner, another panel) counts as covered.
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(`${sel} is covered by ${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}${hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(' ')[0] : ''}`);
        }
        const b = board && document.querySelector(board);
        if (b) {
          const r = b.getBoundingClientRect();
          // A board narrower than a third of the screen's short side is too small to play.
          const least = Math.min(vw, vh) * 0.33;
          if (Math.min(r.width, r.height) < least) out.push(`the board is squashed to ${Math.round(r.width)}×${Math.round(r.height)}`);
          // A board of squares to tap: each one at least this many pixels across on a touch screen.
          if (cell && touch && r.width / cell.cols < cell.min - 0.01) out.push(`the board's squares are ${(r.width / cell.cols).toFixed(1)}px, under ${cell.min}px`);
        }
        if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
        // Turned sideways there's no room to spare, so the page mustn't scroll at all.
        if (innerWidth > innerHeight && document.documentElement.scrollHeight > innerHeight + 1) out.push(`the page scrolls (${document.documentElement.scrollHeight} tall)`);
        // The bug-report button mustn't sit on anything you play with.
        const bug = document.querySelector('.fb-bug');
        const br = bug && getComputedStyle(bug).display !== 'none' && bug.getBoundingClientRect();
        if (br && br.width) for (const sel of need) {
          const el = document.querySelector(sel);
          for (const c of el ? [el, ...el.querySelectorAll('button')] : []) {
            const r = c.getBoundingClientRect();
            if (r.width && r.left < br.right && r.right > br.left && r.top < br.bottom && r.bottom > br.top) { out.push(`the bug-report button sits on ${sel}`); break; }
          }
        }
        return out;
      }, { need, board: game.board, covered, cell: game.cell || null, touch });
      await page.screenshot({ path: info.outputPath('screen.png') });
      expect(report, report.join('\n')).toEqual([]);
      expect(problems, problems.join('\n')).toEqual([]);
      await ctx.close();
    });
  }
}

// Opens a page at a size, with Chrome's tab row reported the way the check above does.
async function openAt(browser, path, viewport, covered, touch = true, mobile = touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: mobile });
  const page = await ctx.newPage();
  if (covered) {
    await page.addInitScript(cov => {
      const vv = new EventTarget();
      for (const [k, get] of Object.entries({ height: () => innerHeight - cov, width: () => innerWidth, scale: () => 1, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => scrollY, pageLeft: () => scrollX })) {
        Object.defineProperty(vv, k, { get });
      }
      Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    }, covered);
  }
  await quietFonts(page);
  await openPage(page, path);
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return { ctx, page };
}

// The setup screens: every choice and the Start button are whole on the screen without scrolling, not covered,
// and clear of the bug-report button. Upright sizes only (a phone turned sideways comes later).
for (const game of GAMES.filter(g => g.setup)) {
  for (const [label, viewport, touch, covered = 0] of SIZES.filter(s => s[1].height > s[1].width || !s[2])) {
    test(`${game.name}'s setup fits a ${label} (${viewport.width}×${viewport.height})`, async ({ browser }, info) => {
      test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
      const known = KNOWN[`${game.name}'s setup @ ${label}`];
      if (known && known.startsWith('skip: ')) test.skip(true, known.slice(6));
      else if (known) test.fail(true, known);
      const { ctx, page } = await openAt(browser, game.path, viewport, covered, touch, touch && viewport.width < 900);
      await page.waitForTimeout(600);
      const report = await page.evaluate(({ need, covered }) => {
        const vw = innerWidth, vh = innerHeight - covered, out = [];
        const bug = document.querySelector('.fb-bug');
        const br = bug && getComputedStyle(bug).display !== 'none' && bug.getBoundingClientRect();
        for (const sel of need) {
          const el = document.querySelector(sel);
          if (!el) { out.push(`${sel} isn't on the page`); continue; }
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) { out.push(`${sel} is hidden`); continue; }
          if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1) {
            out.push(`${sel} runs off the screen (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)} of ${vh})`);
            continue;
          }
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(`${sel} is covered by ${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}`);
          if (br && br.width && r.left < br.right && r.right > br.left && r.top < br.bottom && r.bottom > br.top) out.push(`the bug-report button sits on ${sel}`);
        }
        if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
        return out;
      }, { need: game.setup, covered });
      await page.screenshot({ path: info.outputPath('setup.png') });
      expect(report, report.join('\n')).toEqual([]);
      await ctx.close();
    });
  }
}

// A start card that shrinks with its board must still fit inside it, or its text
// spills over the buttons around it and catches their taps.
for (const [label, viewport, , covered = 0] of SIZES.filter(s => s[2] && s[1].height > s[1].width)) {
  test(`Clueless Crosswords' start card fits inside the grid on a ${label}`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/clueless.html', viewport, covered);
    await page.waitForTimeout(600);
    const grid = await page.locator('#grid').boundingBox();
    const card = await page.locator('.cl-cover-box').boundingBox();
    expect(card.y).toBeGreaterThanOrEqual(grid.y - 1);
    expect(card.y + card.height).toBeLessThanOrEqual(grid.y + grid.height + 1);
    await ctx.close();
  });
}

// A pop-up message sits above Chrome's tab row, where it can be seen.
test('a pop-up message clears Chrome\'s tab row', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page } = await openAt(browser, '/sudoku.html', { width: 412, height: 860 }, 136);
  await page.locator('#coverBtn').click();
  await page.locator('#undoBtn').click();   // nothing to undo yet, so it says so
  const toast = page.locator('.toast').first();
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(860 - 136);
  await ctx.close();
});

// The ☰ sheet sits above Chrome's tab row, so its first item (the last game's results) can be tapped.
test('the menu clears Chrome\'s tab row, last game\'s results included', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page } = await openAt(browser, '/snake.html', { width: 412, height: 860 }, 136);
  await expect(async () => {
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => page.evaluate(() => document.body.dataset.state), { timeout: 1500 }).toBe('playing');
  }).toPass({ timeout: 10000 });
  await expect(page.locator('.ew-card')).toBeVisible({ timeout: 20000 });
  await page.locator('.ew-card').getByRole('button', { name: 'Close' }).click();
  await page.locator('.ah-waffle').click();
  const item = page.locator('.ah-menu button', { hasText: 'Last game\'s results' });
  await expect(item).toBeVisible();
  await page.waitForTimeout(400);
  const box = await item.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(860 - 136);
  const sheet = await page.locator('.ah-menu').boundingBox();
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(860 - 136);
  await ctx.close();
});

// Turned sideways, the menu holds what moved off the screen, so all of it has to be
// reachable, and what moved has to work there.
for (const [label, viewport] of SIZES.filter(s => s[2] && s[1].width > s[1].height)) {
  test(`Clueless Crosswords sideways on a ${label}: the menu, the clues and pausing work`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/clueless.html', viewport, 0);
    await expect(page.locator('#levelSeg')).toBeVisible();
    await page.locator('#coverBtn').click();
    await expect(page.locator('#levelSeg')).toBeHidden();
    // The keyboard is all on the screen.
    const keys = await page.locator('#keys').boundingBox();
    expect(keys.y + keys.height).toBeLessThanOrEqual(viewport.height + 1);
    // Every item in the menu is on the screen.
    await page.locator('.ah-waffle, [aria-label="Menu"]').first().click();
    const items = page.locator('.ah-menu .grid button');
    await expect(items.first()).toBeVisible();
    const last = await items.last().boundingBox();
    const menu = await page.locator('.ah-menu').boundingBox();
    expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height + 1);
    // All the clues opens a sheet that's on the screen.
    await page.locator('.ah-menu .grid button', { hasText: /clues/i }).first().click();
    const lists = page.locator('#lists');
    await expect(lists).toBeVisible();
    const box = await lists.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.locator('#cluesClose').click();
    await expect(lists).toBeHidden();
    expect(last).toBeTruthy();
    await ctx.close();
  });
}

// Tower Defense turned sideways: the towers are always in the build bar, and after
// picking a square every one of them has to be on the screen to be tapped.
for (const [label, viewport] of SIZES.filter(s => s[2] && s[1].width > s[1].height)) {
  test(`Tower Defense sideways on a ${label}: the towers are on the screen after picking a square`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/towers.html', viewport, 0);
    const map = await page.locator('#canvas').boundingBox();
    // A square of grass on the first map: column 5, row 5 (counting from 1).
    await page.touchscreen.tap(map.x + map.width * 4.5 / 10, map.y + map.height * 4.5 / 13);
    await expect(page.locator('#buildHow')).toContainText('Now pick a tower');
    const buttons = page.locator('#buildRow button');
    await expect(buttons).toHaveCount(4);
    await expect(buttons.first()).toBeVisible();
    for (const b of await buttons.all()) {
      const r = await b.boundingBox();
      expect(r.y + r.height, await b.innerText()).toBeLessThanOrEqual(viewport.height + 1);
    }
    await ctx.close();
  });
}

// Tower Defense at every size: the build bar is whole on the screen before the first
// wave, a picked tower's Upgrade and Sell are whole on the screen during one, and the
// bug-report button never sits on either.
for (const [label, viewport, , covered = 0] of SIZES) {
  test(`Tower Defense on a ${label}: the towers, and a picked tower's Upgrade and Sell, are on the screen`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/towers.html', viewport, covered);
    // Who's playing? can open a moment after the page settles.
    await page.waitForTimeout(800);
    const guest = page.getByRole('button', { name: /Play as a guest/ });
    if (await guest.isVisible().catch(() => false)) {
      await guest.click();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
    }
    await expect(page.locator('.apf').first()).toBeHidden();
    // Whole on the screen, not covered by anything, and clear of the bug-report button.
    const check = sel => page.evaluate(({ sel, covered }) => {
      const vw = innerWidth, vh = innerHeight - covered, out = [];
      const bug = document.querySelector('.fb-corner');
      const b = bug && bug.getBoundingClientRect();
      const bugOn = b && b.width && b.height && getComputedStyle(bug).display !== 'none' && getComputedStyle(bug).visibility !== 'hidden';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        const name = `${sel} "${el.textContent.trim().replace(/\s+/g, ' ')}"`;
        if (!r.width || !r.height) { out.push(`${name} is hidden`); continue; }
        if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1) out.push(`${name} runs off the screen (${Math.round(r.top)}-${Math.round(r.bottom)} of ${vh})`);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(`${name} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`);
        if (bugOn && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) out.push(`the bug-report button sits on ${name}`);
      }
      if (!document.querySelectorAll(sel).length) out.push(`${sel} isn't on the page`);
      if (document.documentElement.scrollWidth > vw + 1) out.push('the page scrolls sideways');
      return out;
    }, { sel, covered });
    expect(await check('#buildRow, #buildRow button')).toEqual([]);
    await page.locator('#waveBtn').click();
    await page.waitForTimeout(600);
    expect(await check('#buildRow button')).toEqual([]);
    const sq = await page.evaluate(() => window.TowersTest.free());
    const map = await page.locator('#canvas').boundingBox();
    await page.touchscreen.tap(map.x + (sq.x + 0.5) * map.width / sq.cols, map.y + (sq.y + 0.5) * map.height / sq.rows);
    await page.locator('#buildRow button', { hasText: 'Archer' }).tap();
    await expect(page.locator('.tower-actions')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await check('.tower-actions button')).toEqual([]);
    expect(await check('#buildRow button')).toEqual([]);
    if (viewport.width > viewport.height && viewport.height < 600) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  });
}
