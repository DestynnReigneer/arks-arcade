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
  ['tablet', { width: 768, height: 1024 }, true],
  ['laptop', { width: 1366, height: 768 }, false]
];

// start: what a person taps to get to the first move. need: what must be on the
// screen then (touch: only on a touch screen). board: the part that can't get tiny.
const GAMES = [
  { name: 'Sudoku', path: '/sudoku.html', start: ['#coverBtn'], board: '#board, .sd-board', need: ['.sd-board', '#tools', '#pad'] },
  { name: 'Clueless Crosswords', path: '/clueless.html', start: ['#coverBtn'], board: '#grid', need: ['#clueBar', '#grid', '#tools'], touch: ['#keys'] },
  { name: 'Snake', path: '/snake.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Block Drop', path: '/blocks.html', start: [], board: '#canvas', need: ['#canvas'] },
  { name: 'Brick Breaker', path: '/bricks.html', start: [], board: '#canvas', need: ['#canvas'] },
  { name: 'Tower Defense', path: '/towers.html', start: ['#waveBtn'], board: '#stage', need: ['#stage', '#waveBtn'] }
];

// Game and size pairs that don't fit yet, with why. Fixed in order on the to-do list.
const KNOWN = {
  "Sudoku @ phone turned sideways": "Turned sideways, the board and the buttons are stacked, and the screen is too short for that.",
  "Clueless Crosswords @ phone turned sideways": "Turned sideways, the board and the buttons are stacked, and the screen is too short for that.",
  "Snake @ phone turned sideways": "Turned sideways, the board and the buttons are stacked, and the screen is too short for that.",
  "Block Drop @ phone turned sideways": "Turned sideways, the board and the buttons are stacked, and the screen is too short for that.",
  "Brick Breaker @ phone turned sideways": "skip: The game runs a couple of pixels off the bottom on some machines and fits on others, so it's left out until the sideways layout fixes it for good.",
  "Tower Defense @ phone turned sideways": "Turned sideways, the board and the buttons are stacked, and the screen is too short for that."
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
      for (const s of game.start) await page.locator(s).first().click();
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
        const b = document.querySelector(board);
        if (b) {
          const r = b.getBoundingClientRect();
          // A board narrower than a third of the screen's short side is too small to play.
          const least = Math.min(vw, vh) * 0.33;
          if (Math.min(r.width, r.height) < least) out.push(`the board is squashed to ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
        return out;
      }, { need, board: game.board, covered });
      await page.screenshot({ path: info.outputPath('screen.png') });
      expect(report, report.join('\n')).toEqual([]);
      expect(problems, problems.join('\n')).toEqual([]);
      await ctx.close();
    });
  }
}
