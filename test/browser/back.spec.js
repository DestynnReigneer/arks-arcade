'use strict';

// Back, one screen at a time (ArcadeBack in public/topbar.js). Inside a game,
// the phone's or browser's Back and the top bar's back arrow go from a game
// being played to that game's menu (asking first if a game would end), and
// from the menu to the arcade.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

// From the arcade's home page into a game, the way a person gets there, so
// the browser's history has the home page behind the game.
async function intoGame(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/');
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}
const state = page => page.evaluate(() => document.body.dataset.state);
const atHome = page => expect.poll(() => new URL(page.url()).pathname).toBe('/');

test('Back in Snake: the game asks first, then the menu, then the arcade', async ({ page }) => {
  const problems = await intoGame(page, '/snake.html');
  await expect.poll(() => state(page)).toBe('ready');
  await expect(page.locator('.ah-back')).toHaveAttribute('title', 'Back to the arcade');
  // Start a run (a swipe on a phone, an arrow key on a laptop: either works).
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => state(page)).toBe('playing');
  await expect(page.locator('.ah-back')).toHaveAttribute('title', 'Back to this game\'s menu');

  // The browser's own Back asks first, on the page (not a browser dialog), and pauses.
  await page.goBack();
  const ask = page.locator('.ab-confirm');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('Leave this game?');
  await expect(page.locator('#stageMsg')).toContainText('Paused');
  await ask.getByRole('button', { name: 'Keep playing' }).click();
  await expect(ask).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/snake.html');
  expect(await state(page)).toBe('playing');

  // The top bar's arrow does the same; this time, leave.
  await page.locator('.ah-back').click();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Leave' }).click();
  await expect.poll(() => state(page)).toBe('ready');
  expect(new URL(page.url()).pathname).toBe('/snake.html');
  await expect(page.locator('#options')).toBeVisible();

  // From the menu, Back goes to the arcade, in one press.
  await page.goBack();
  await atHome(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Back in Chess: a game with no moves goes straight back to setup', async ({ page }) => {
  const problems = await intoGame(page, '/chess.html');
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('.ab-confirm')).toHaveCount(0);
  // The game's own "Back to setup" button leaves the history as it found it,
  // so one Back from setup still reaches the arcade.
  await page.locator('#goBtn').click();
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('#quitBtn').click();
  await expect(page.locator('#setup')).toBeVisible();
  await page.goBack();
  await atHome(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Back in Criss Cross steps back through its screens', async ({ page }) => {
  const problems = await intoGame(page, '/crisscross.html');
  await page.locator('#newLocalBtn').click();
  await expect(page.locator('#newLocal')).toBeVisible();
  await page.locator('.ah-back').click();
  await expect(page.locator('#home')).toBeVisible();
  await page.locator('.ah-back').click();
  await atHome(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Back in Trivia: a game in progress asks first, then setup', async ({ page }) => {
  const problems = await intoGame(page, '/trivia.html');
  await page.locator('#goBtn').click();
  await expect(page.locator('#play')).toBeVisible();
  await page.goBack();
  const ask = page.locator('.ab-confirm');
  await expect(ask).toContainText('Quit this game?');
  await ask.getByRole('button', { name: 'Leave' }).click();
  await expect(page.locator('#setup')).toBeVisible();
  await page.goBack();
  await atHome(page);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a reload in the middle of a game still leaves the menu in one Back', async ({ page }) => {
  await intoGame(page, '/snake.html');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => state(page)).toBe('playing');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect.poll(() => state(page)).toBe('ready');
  await page.waitForTimeout(300);
  await page.goBack();
  await atHome(page);
});
