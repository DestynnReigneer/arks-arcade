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
const { quietFonts, watchProblems, openPage, nextStep } = require('./helpers');

const SIZES = [
  ['phone', { width: 390, height: 844 }, true],
  ['phone with the browser bars showing', { width: 412, height: 640 }, true],
  ["phone with Chrome's tab row", { width: 412, height: 860 }, true, 136],
  ['phone turned sideways', { width: 844, height: 390 }, true],
  ['small phone turned sideways', { width: 740, height: 360 }, true],
  ['tablet', { width: 768, height: 1024 }, true],
  ['laptop', { width: 1366, height: 768 }, false]
];

// start: what a person taps to get to the first move ({ fill, text } types into a box; a selector starting with
// "?" is tapped only when it's showing, like Next on a phone's setup in steps). need: what must be on the
// screen then (touch: only on a touch screen). board: the part that can't get tiny
// (null for a game whose board is a wide strip, like Spin & Solve's puzzle).
// cell: a board of squares to tap ({ cols, min }): on a touch screen each square is at least min pixels across.
// setup: what has to be whole on the screen on the setup screen, before anything is tapped (every choice up to and
// including Start), checked at the upright sizes. steps: a setup that's two steps on a phone (setup-steps.js): what
// has to be whole on the screen on step 1 (one), what's tapped to go on (next), and what on step 2 (two). On an
// upright phone those are checked instead of `setup`, which a tablet and a laptop still get.
const GAMES = [
  { name: 'Sudoku', path: '/sudoku.html', start: ['#coverBtn'], board: '#board, .sd-board', need: ['.sd-board', '#tools', '#pad'] },
  { name: 'Clueless Crosswords', path: '/clueless.html', start: ['#coverBtn'], board: '#grid', need: ['#clueBar', '#grid', '#tools'], touch: ['#keys'] },
  { name: 'Snake', path: '/snake.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Block Drop', path: '/blocks.html', start: [], board: '#canvas', need: ['#canvas'], touch: ['#pad'] },
  { name: 'Brick Breaker', path: '/bricks.html', start: [], board: '#canvas', need: ['#canvas'] },
  { name: 'Tower Defense', path: '/towers.html', start: ['#waveBtn'], board: '#canvas', cell: { cols: 10, min: 22 }, need: ['#stage', '#waveBtn', '#buildRow'] },
  { name: 'Words with Family', path: '/crisscross.html', start: ['#newBotBtn', { fill: '#localPlayers input', text: 'Tester' }, '#localGo'], board: '#board', need: ['#board', '#rack', '#playBtn'] },
  { name: 'Spin & Solve', path: '/spinsolve.html', start: ['?.steps-next', '#goBtn'], board: null, need: ['#puzzleBoard', '#spinBtn', '#vowelBtn', '#solveBtn'],
    setup: ['#levelList', '#packSelect', '#suggestBtn', '#modeSeg', '#roundSeg', '#timerSeg', '#goBtn'],
    steps: { one: ['#modeSeg', '#levelList', '#packSelect', '#suggestBtn', '.steps-next'], next: '.steps-next',
      two: ['#roundSeg', '#timerSeg', '.steps-back', '#goBtn'] } },
  { name: 'Chess', path: '/chess.html', start: ['#goBtn'], board: '#board', need: ['#board', '#statusLine', '#gameBtns'],
    setup: ['#modeSeg', '#levelSeg', '#colorSeg', '#goBtn'] },
  { name: 'Know-It-All', path: '/trivia.html', start: ['?.steps-next', '#goBtn'], board: null, need: ['#qText', '#answers'],
    setup: ['#levelList', '#genreChips', '#packSelect', '#diffSeg', '#countSeg', '#secsSeg', '#suggestBtn', '#modeSeg', '#goBtn'],
    steps: { one: ['#modeSeg', '#levelList', '.steps-next'], next: '.steps-next',
      two: ['#genreChips', '#packSelect', '#diffSeg', '#countSeg', '#secsSeg', '#suggestBtn', '.steps-back', '#goBtn'] } },
  // Rambler's first step is its ways to play, and tapping one goes on (there's no Next).
  { name: 'Rambler', path: '/rambler.html', start: ['#modeList .mode.no-tv[data-mode="solo"]', '#startBtn'], board: '#board', need: ['#board', '#traceBar', '#doneBtn'],
    setup: ['#dailyCard', '#modeList', '#sizeSeg', '#durationSeg', '#difficultySeg', '#profileSeg', '#startBtn'],
    steps: { one: ['#dailyCard', '#modeList'], next: '#modeList .mode.no-tv[data-mode="solo"]',
      two: ['#sizeSeg', '#durationSeg', '#difficultySeg', '#profileSeg', '.steps-back', '#startBtn'] } },
  { name: 'Dare Devil', path: '/daredevil.html', start: ['#goBtn'], board: '#deckBtn', need: ['#scoreStrip', '#deckBtn'],
    setup: ['#levelList', '#lengthSeg', '#modeSeg', '#nameList .name-row:last-child', '#addPlayerBtn', '#goBtn'] },
  { name: 'Uh-Oh: Part Deux', path: '/partdeux.html', start: ['#goBtn', '#passReady'], board: null, need: ['#drawPile', '#discard', '#hand', '#drawBtn'],
    setup: ['#levelList', '#modeSeg', '#nameList .name-row:last-child', '#addPlayerBtn', '#goBtn'] },
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
        if (typeof s === 'string' && s.startsWith('?')) {
          const maybe = page.locator(s.slice(1)).first();
          if (await maybe.isVisible().catch(() => false)) await maybe.click();
        } else if (typeof s === 'string') await page.locator(s).first().click();
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
      // An upright phone: the setup in two steps, each whole on the screen.
      const steps = game.steps && viewport.width < 760 ? game.steps : null;
      if (steps) {
        const one = await setupReport(page, steps.one, covered);
        await page.screenshot({ path: info.outputPath('setup-step1.png') });
        await page.locator(steps.next).first().click();
        await page.waitForTimeout(400);
        const two = await setupReport(page, steps.two, covered);
        await page.screenshot({ path: info.outputPath('setup-step2.png') });
        expect([...one.map(x => `step 1: ${x}`), ...two.map(x => `step 2: ${x}`)], [...one, ...two].join('\n')).toEqual([]);
        await ctx.close();
        return;
      }
      const report = await setupReport(page, game.setup, covered);
      await page.screenshot({ path: info.outputPath('setup.png') });
      expect(report, report.join('\n')).toEqual([]);
      await ctx.close();
    });
  }
}

// What's wrong with a setup screen as it is now: each of `need` whole on the screen, not covered and clear of the
// bug-report button, and nothing scrolling sideways.
function setupReport(page, need, covered) {
  return page.evaluate(({ need, covered }) => {
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
  }, { need, covered });
}

const UPRIGHT_PHONES = SIZES.filter(s => s[2] && s[1].height > s[1].width && s[1].width < 600);

// Whole on the screen above anything covering its bottom, and the thing in its middle is itself.
const onScreen = (page, sel, covered) => page.evaluate(({ sel, covered }) => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.top >= -1 && r.bottom <= innerHeight - covered + 1 && !!hit && (el === hit || el.contains(hit))
    ? '' : `${sel}: ${Math.round(r.top)}-${Math.round(r.bottom)} of ${innerHeight - covered}`;
}, { sel, covered });

// With four players, the names take another row; Start must still be on the screen.
for (const [game, path] of [['Dare Devil', '/daredevil.html'], ['Uh-Oh: Part Deux', '/partdeux.html']]) {
  for (const [label, viewport, , covered = 0] of UPRIGHT_PHONES) {
    test(`${game}'s Start is on the screen with four players on a ${label}`, async ({ browser }, info) => {
      test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
      const { ctx, page } = await openAt(browser, path, viewport, covered);
      await page.locator('#addPlayerBtn').click();
      await page.locator('#addPlayerBtn').click();
      await expect(page.locator('#nameList .name-row')).toHaveCount(4);
      await page.waitForTimeout(200);
      expect(await onScreen(page, '#goBtn', covered)).toBe('');
      expect(await onScreen(page, '#addPlayerBtn', covered)).toBe('');
      await ctx.close();
    });
  }
}

// Rambler's 5x5 board on a short screen: every die inside the board, and its last row above the word being traced.
for (const [label, viewport, , covered = 0] of UPRIGHT_PHONES.filter(s => s[1].width === 412)) {
  test(`Rambler's 5x5 board fits a ${label}`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/rambler.html', viewport, covered);
    await page.locator('#modeList .mode.no-tv[data-mode="solo"]').click();
    await page.locator('#sizeSeg button').nth(1).click();
    await page.locator('#startBtn').click();
    await expect(page.locator('#board .die')).toHaveCount(25);
    await page.waitForTimeout(500);
    const out = await page.evaluate(() => {
      const b = document.querySelector('#board').getBoundingClientRect();
      const trace = document.querySelector('#traceBar').getBoundingClientRect();
      const bad = [];
      for (const d of document.querySelectorAll('#board .die')) {
        const r = d.getBoundingClientRect();
        if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1) bad.push(`a die runs out of the board (${Math.round(r.bottom)} > ${Math.round(b.bottom)})`);
        if (r.bottom > trace.top + 1) bad.push(`a die sits on the traced word (${Math.round(r.bottom)} > ${Math.round(trace.top)})`);
      }
      return [...new Set(bad)];
    });
    expect(out).toEqual([]);
    expect(await onScreen(page, '#doneBtn', covered)).toBe('');
    await ctx.close();
  });
}

// Typing a word in Rambler opens the phone's keyboard, which makes the visual viewport about 300px shorter. The board
// must not shrink to nothing or spill over the typing row.
test('Rambler keeps its board when the keyboard opens for typing a word', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const ctx = await browser.newContext({ viewport: { width: 412, height: 640 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const vv = new EventTarget();
    window.__keyboard = 0;
    window.__openKeyboard = px => { window.__keyboard = px; vv.dispatchEvent(new Event('resize')); };
    for (const [k, get] of Object.entries({ height: () => innerHeight - window.__keyboard, width: () => innerWidth, scale: () => 1, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => scrollY, pageLeft: () => scrollX })) {
      Object.defineProperty(vv, k, { get });
    }
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  });
  await quietFonts(page);
  await openPage(page, '/rambler.html');
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.locator('#modeList .mode.no-tv[data-mode="solo"]').click();
  await page.locator('#startBtn').click();
  await expect(page.locator('#board .die')).toHaveCount(16);
  await page.locator('#typeInput').focus();
  await page.evaluate(() => window.__openKeyboard(300));
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const b = document.querySelector('#board').getBoundingClientRect();
    const row = document.querySelector('#typeRow').getBoundingClientRect();
    const bad = [];
    if (Math.min(b.width, b.height) < 150) bad.push(`the board shrank to ${Math.round(b.width)}x${Math.round(b.height)}`);
    for (const d of document.querySelectorAll('#board .die')) {
      const r = d.getBoundingClientRect();
      if (r.bottom > row.top + 1 && r.top < row.bottom - 1) { bad.push('a die sits on the typing row'); break; }
    }
    return bad;
  });
  expect(out).toEqual([]);
  await ctx.close();
});

// Know-It-All while playing: the bug-report button isn't over the answers or Quit.
for (const [label, viewport, , covered = 0] of UPRIGHT_PHONES) {
  test(`Know-It-All's answers and Quit are clear of the bug-report button on a ${label}`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'phone', 'The sizes are set here, so one project runs them all.');
    const { ctx, page } = await openAt(browser, '/trivia.html', viewport, covered);
    await nextStep(page);
    await page.locator('#goBtn').click();
    await expect(page.locator('#answers button').first()).toBeVisible({ timeout: 10000 });
    const out = await page.evaluate(() => {
      const bug = document.querySelector('.fb-bug');
      const br = bug && getComputedStyle(bug).display !== 'none' && bug.getBoundingClientRect();
      if (!br || !br.width) return [];
      const bad = [];
      for (const el of [...document.querySelectorAll('#answers button'), document.querySelector('#quitBtn')]) {
        const r = el.getBoundingClientRect();
        if (r.width && r.left < br.right && r.right > br.left && r.top < br.bottom && r.bottom > br.top) bad.push(`the bug-report button sits on ${el.id || el.textContent.trim()}`);
      }
      return bad;
    });
    expect(out).toEqual([]);
    await ctx.close();
  });
}

// Know-It-All's setup in two columns on a tablet: each row of choices stays one row.
test('Know-It-All\'s setup keeps each row of choices on one row on a tablet', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page } = await openAt(browser, '/trivia.html', { width: 768, height: 1024 }, 0);
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const bad = [];
    for (const seg of document.querySelectorAll('#setup .seg')) {
      const tops = new Set([...seg.children].filter(b => b.getBoundingClientRect().width).map(b => Math.round(b.getBoundingClientRect().top)));
      if (tops.size > 1) bad.push(`#${seg.id} wraps onto ${tops.size} rows`);
    }
    // Start comes after every choice: below the last one in the right-hand column.
    const go = document.querySelector('#goBtn').getBoundingClientRect();
    const panels = [...document.querySelectorAll('#setup > .panel')].map(p => p.getBoundingClientRect());
    const right = panels.filter(p => p.left > innerWidth / 2 - 20);
    if (!right.length || go.bottom < Math.max(...right.map(p => p.bottom)) - 30) bad.push('Let\'s play isn\'t at the end of the right-hand column');
    return bad;
  });
  expect(out).toEqual([]);
  await ctx.close();
});

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
