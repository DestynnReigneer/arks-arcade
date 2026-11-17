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
const GAMES = [
  { name: 'Sudoku', path: '/sudoku.html', start: ['#coverBtn'], board: '#board, .sd-board', need: ['.sd-board', '#tools', '#pad'] },
  { name: 'Clueless Crosswords', path: '/clueless.html', start: ['#coverBtn'], board: '#grid', need: ['#clueBar', '#grid', '#tools'], touch: ['#keys'] },
  { name: 'Snake', path: '/snake.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Block Drop', path: '/blocks.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Brick Breaker', path: '/bricks.html', start: [], board: '#canvas', need: ['#canvas'] },
  { name: 'Tower Defense', path: '/towers.html', start: ['#waveBtn'], board: '#stage', need: ['#stage', '#waveBtn', '#info'] },
  { name: 'Words with Family', path: '/crisscross.html', start: ['#newLocalBtn', { fill: '#localPlayers input', text: 'Tester' }, '#localGo'], board: '#board', need: ['#board', '#rack', '#playBtn'] },
  { name: 'Spin & Solve', path: '/spinsolve.html', start: ['#goBtn'], board: null, need: ['#puzzleBoard', '#spinBtn', '#vowelBtn', '#solveBtn'] }
];

// Game and size pairs that don't fit yet, with why. Fixed in order on the to-do list.
const KNOWN = {
};

test.describe.configure({ mode: 'parallel' });

for (const game of GAMES) {
  for (const [label, viewport, touch, covered = 0] of SIZES) {
    test(`${game.name} fits a ${label} (${viewport.width}×${viewport.height})`, async ({ browser }, info) => {
      test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
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
      const report = await page.evaluate(({ need, board, covered }) => {
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
      }, { need, board: game.board, covered });
      await page.screenshot({ path: info.outputPath('screen.png') });
      expect(report, report.join('\n')).toEqual([]);
      expect(problems, problems.join('\n')).toEqual([]);
      await ctx.close();
    });
  }
}

// Opens a page at a size, with Chrome's tab row reported the way the check above does.
async function openAt(browser, path, viewport, covered) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
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

// Tower Defense turned sideways: picking a square before the first wave shows the
// towers, and every one of them has to be on the screen to be tapped.
for (const [label, viewport] of SIZES.filter(s => s[2] && s[1].width > s[1].height)) {
  test(`Tower Defense sideways on a ${label}: the towers are on the screen after picking a square`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/towers.html', viewport, 0);
    const map = await page.locator('#canvas').boundingBox();
    // A square of grass on the first map: column 5, row 5 (counting from 1).
    await page.touchscreen.tap(map.x + map.width * 4.5 / 10, map.y + map.height * 4.5 / 13);
    const buttons = page.locator('#info .build-grid button');
    await expect(buttons.first()).toBeVisible();
    for (const b of await buttons.all()) {
      const r = await b.boundingBox();
      expect(r.y + r.height, await b.innerText()).toBeLessThanOrEqual(viewport.height + 1);
    }
    await ctx.close();
  });
}
