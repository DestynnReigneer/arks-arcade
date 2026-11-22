'use strict';

// The setup in two steps on a phone (public/setup-steps.js) for Know-It-All, Spin &
// Solve and Rambler: Next and Back keep every choice, the top bar's Back goes from
// step 2 to step 1 before it leaves, a card in Rambler's list goes straight to step 2,
// and a tablet or a TV keeps the whole setup on one screen. Also Know-It-All's
// shared-device hand-off line on the play screen.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function open(browser, path, options = PHONE) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  const guest = page.getByRole('button', { name: /Play as a guest/ });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return { ctx, page, problems };
}

const pressed = (page, sel) => page.locator(`${sel} [aria-pressed="true"]`);
const backLabel = page => page.locator('.ah-back span');

test('Know-It-All: Next and Back keep the choices, and the top bar\'s Back goes to step 1 first', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page, problems } = await open(browser, '/trivia.html');
  const setup = page.locator('#setup');
  await expect(setup).toHaveClass(/on-step-1/);
  await expect(page.locator('#setup .panel h2').filter({ hasText: 'Game mode' })).toBeVisible();
  await expect(page.locator('#genreChips')).toBeHidden();
  await expect(page.locator('#goBtn')).toBeHidden();
  await expect(page.locator('.steps-back')).toBeHidden();

  await page.locator('#modeSeg [data-mode="local"]').click();
  await page.locator('.steps-next').click();
  await expect(setup).toHaveClass(/on-step-2/);
  await expect(page.locator('#modeSeg')).toBeHidden();
  await expect(page.locator('#goBtn')).toBeVisible();
  await expect(page.locator('.steps-next')).toBeHidden();
  await page.locator('#diffSeg [data-v="hard"]').click();
  await page.locator('#countSeg [data-v="5"]').click();

  await page.locator('.steps-back').click();
  await expect(setup).toHaveClass(/on-step-1/);
  await expect(pressed(page, '#modeSeg')).toHaveAttribute('data-mode', 'local');
  await expect(page.locator('#nameList .name-row')).toHaveCount(2);
  await page.locator('.steps-next').click();
  await expect(pressed(page, '#diffSeg')).toHaveAttribute('data-v', 'hard');
  await expect(pressed(page, '#countSeg')).toHaveAttribute('data-v', '5');

  // The top bar's Back: step 2 to step 1, then the arcade.
  await expect(backLabel(page)).toHaveText('Back');
  await page.locator('.ah-back').click();
  await expect(setup).toHaveClass(/on-step-1/);
  expect(new URL(page.url()).pathname).toBe('/trivia.html');
  await expect(backLabel(page)).toHaveText('Arcade');
  // The phone's own Back does the same.
  await page.locator('.steps-next').click();
  await expect(backLabel(page)).toHaveText('Back');
  await page.goBack();
  await expect(setup).toHaveClass(/on-step-1/);
  expect(new URL(page.url()).pathname).toBe('/trivia.html');

  // List Hosted Games has nothing to start, so there's no Next either.
  await page.locator('#modeSeg [data-mode="join"]').click();
  await expect(page.locator('#joinSetup')).toBeVisible();
  await expect(page.locator('.steps-next')).toBeHidden();
  await page.locator('#modeSeg [data-mode="solo"]').click();
  await expect(page.locator('.steps-next')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

test('Spin & Solve: Next and Back keep the players, the level and the rounds', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page, problems } = await open(browser, '/spinsolve.html');
  await expect(page.locator('#nameList')).toBeVisible();
  await expect(page.locator('#roundSeg')).toBeHidden();
  const names = page.locator('#nameList .name-row');
  const before = await names.count();
  if (before < 4) await page.locator('#addPlayerBtn').click();
  const count = await names.count();
  await names.first().locator('input').fill('Kim');
  await page.locator('.steps-next').click();
  await expect(page.locator('#nameList')).toBeHidden();
  await page.locator('#roundSeg [data-rounds="5"]').click();
  await page.locator('#timerSeg [data-secs="0"]').click();
  await page.locator('.steps-back').click();
  await expect(names).toHaveCount(count);
  await expect(names.first().locator('input')).toHaveValue('Kim');
  await page.locator('.steps-next').click();
  await expect(pressed(page, '#roundSeg')).toHaveAttribute('data-rounds', '5');
  await expect(pressed(page, '#timerSeg')).toHaveAttribute('data-secs', '0');
  await page.goBack();
  await expect(page.locator('#nameList')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

test('Rambler: tapping a way to play goes straight to step 2, and Back keeps it picked', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page, problems } = await open(browser, '/rambler.html');
  const screen = page.locator('#setupScreen');
  await expect(screen).toHaveClass(/on-step-1/);
  // No Next: the cards go on by themselves.
  await expect(page.locator('.steps-next')).toBeHidden();
  await expect(page.locator('#startBtn')).toBeHidden();
  await expect(page.locator('#modeList .mode-label')).toHaveText('Multiplayer-Shared device');

  await page.locator('#modeList .mode[data-mode="turns"]').click();
  await expect(screen).toHaveClass(/on-step-2/);
  await expect(page.locator('#playersField')).toBeVisible();
  await expect(page.locator('#startBtn')).toBeVisible();
  await page.locator('#durationSeg button').first().click();
  const timer = await pressed(page, '#durationSeg').textContent();

  await page.locator('.steps-back').click();
  await expect(screen).toHaveClass(/on-step-1/);
  await expect(page.locator('#modeList .mode[data-mode="turns"]')).toHaveAttribute('aria-pressed', 'true');

  // The top bar's Back from step 2 goes to step 1, then the arcade.
  await page.locator('#modeList .mode[data-mode="solo"]').click();
  await expect(screen).toHaveClass(/on-step-2/);
  await expect(pressed(page, '#durationSeg')).toHaveText(timer);
  await page.locator('.ah-back').click();
  await expect(screen).toHaveClass(/on-step-1/);
  expect(new URL(page.url()).pathname).toBe('/rambler.html');

  // Today's Board still opens its own screen.
  await page.locator('#dailyCard').click();
  await expect(page.locator('#dailyScreen')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

test('a tablet and a TV keep the whole setup on one screen', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The sizes are set here.');
  const tablet = { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true };
  for (const path of ['/trivia.html', '/spinsolve.html', '/rambler.html']) {
    const { ctx, page } = await open(browser, path, tablet);
    await expect(page.locator('.steps-on')).toHaveCount(0);
    await expect(page.locator('.steps-nav')).toBeHidden();
    await expect(page.locator(path === '/rambler.html' ? '#startBtn' : '#goBtn')).toBeVisible();
    await ctx.close();
  }
  // A TV at a phone's width still gets no steps.
  const { ctx, page } = await open(browser, '/trivia.html?tv=1', PHONE);
  await expect(page.locator('html')).toHaveClass(/\btv\b/);
  await expect(page.locator('.steps-on')).toHaveCount(0);
  await expect(page.locator('.steps-nav')).toBeHidden();
  await expect(page.locator('#modeSeg')).toBeVisible();
  await expect(page.locator('#genreChips')).toBeVisible();
  await ctx.close();
});

// The play screen's hand-off line had the lobby's id, so it never showed.
test('Know-It-All: one device taking turns says who to hand it to', async ({ browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'once is enough');
  const { ctx, page, problems } = await open(browser, '/trivia.html', { viewport: { width: 1280, height: 800 } });
  await page.evaluate(async () => {
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    };
    const room = await post('/api/trivia/rooms', { name: 'Sam', settings: { level: 'kids', style: 'turns', count: 5, seconds: 20 } });
    const me = { playerId: room.playerId, token: room.token };
    await post(`/api/trivia/rooms/${room.code}/seats`, { ...me, name: 'Kim' });
    await post(`/api/trivia/rooms/${room.code}/start`, me);
    sessionStorage.setItem('trivia.room', JSON.stringify({ code: room.code, ...me }));
  });
  await page.reload();
  await expect(page.locator('#readyBox')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#playReadyHint')).toHaveText('Hand the device to Sam. The clock starts when they press I\'m ready.');
  await expect(page.locator('#lobby #readyHint')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

test('Spin & Solve: leaving a game comes back to step 1, not step 2', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The size is set here.');
  const { ctx, page, problems } = await open(browser, '/spinsolve.html');
  const setup = page.locator('#setup');
  await page.locator('.steps-next').click();
  await expect(setup).toHaveClass(/on-step-2/);
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  // The top bar's Back leaves the game (nothing asks, Back means back).
  await page.locator('.ah-back').click();
  await expect(setup).toBeVisible();
  await expect(setup).toHaveClass(/on-step-1/);
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});
