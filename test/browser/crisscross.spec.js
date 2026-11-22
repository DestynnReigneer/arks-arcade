'use strict';

// Words with Family (once Criss Cross) in a real browser: a guest starts a game against the computer
// on one phone, puts a first word on the board by tapping tiles and squares,
// sees the score before playing, plays it, and the computer answers.
//
// The page checks the word so far 0.2 seconds after each tap, and a word
// that's still half built (one tile, or letters that aren't a word yet) is
// turned down with a 400. Whether one of those checks went out used to depend
// on how fast the taps landed and on which tiles were dealt, which made this
// test fail now and then. So the page's clock is held still while the tiles
// go down, and only the check for the whole word gets to run. The tiles are
// the same every time too: test/browser/serve.js starts the server with
// CRISSCROSS_DEAL_SEED, so there's always a word to make (about one rack in
// 25 has none, and the test used to skip itself then).

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');
const E = require(path.join(__dirname, '..', '..', 'crisscross', 'engine.js'));
const bot = require(path.join(__dirname, '..', '..', 'crisscross', 'bot.js'));

test('placing a first word in Words with Family', async ({ page }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await page.clock.install();
  await openPage(page, '/crisscross.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // The new name and the wooden-tile logo (the page keeps its old address).
  await expect(page).toHaveTitle('Words with Family');
  await expect(page.locator('header.top h1')).toContainText('WORDS WITH FAMILY');
  const logo = page.locator('#home .cc-logo');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);

  await page.locator('#newBotBtn').click();
  await page.locator('#localPlayers input').first().fill('Tester');
  await page.locator('#localGo').click();
  await expect(page.locator('#game')).toBeVisible();
  const tiles = page.locator('#rack .cc-tile');
  await expect(tiles).toHaveCount(7);
  const rack = await tiles.evaluateAll(els => els.map(e => e.dataset.letter));
  const best = bot.bestPlay({ board: new Array(121).fill(''), dictionary: 'kids', racks: [rack] }, 0);
  expect(best, `no word in ${rack.join('')}`).toBeTruthy();

  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  for (const p of best.placements) {
    await page.locator(`#rack .cc-tile[data-letter="${p.letter}"]:not(.used)`).first().click();
    await page.locator(`#board .cc-cell[data-i="${p.index}"]`).click();
  }
  await page.clock.runFor(300);
  await expect(page.locator('#preview')).toContainText(`That's ${best.score} point`);
  await page.clock.resume();
  await page.locator('#playBtn').click();
  await expect(page.locator('#moveList li')).toHaveCount(2);
  const word = best.placements.map(p => p.letter).join('');
  await expect(page.locator('#moveList')).toContainText(word);
  await expect(page.locator('#scoreStrip li').first().locator('.cc-pts')).toHaveText(String(best.score));
  expect(problems, problems.join('\n')).toEqual([]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
});

test('moving and switching tiles you put down in Words with Family', async ({ page }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/crisscross.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.locator('#newBotBtn').click();
  await page.locator('#localPlayers input').first().fill('Tester');
  await page.locator('#localGo').click();
  await expect(page.locator('#rack .cc-tile')).toHaveCount(7);

  const tile = k => page.locator('#rack .cc-tile').nth(k);
  const cell = i => page.locator(`#board .cc-cell[data-i="${i}"]`);
  const hold = async (from, to) => {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
  };

  // Put the first tile on the star, then press and hold it and drag it one square over.
  await tile(0).click();
  await cell(60).click();
  await expect(cell(60)).toHaveClass(/pending/);
  await hold(cell(60), cell(61));
  await expect(cell(61)).toHaveClass(/pending/);
  await expect(cell(60)).not.toHaveClass(/pending/);

  // Dropping another tile on it switches them: the first one goes back to the rack.
  await tile(1).click();
  await cell(61).click();
  await expect(tile(0)).not.toHaveClass(/used/);
  await expect(tile(1)).toHaveClass(/used/);
  await expect(cell(61)).toHaveClass(/pending/);

  // Holding it and dropping it on the rack takes it back.
  await hold(cell(61), page.locator('#rack'));
  await expect(page.locator('#board .cc-cell.pending')).toHaveCount(0);
  await expect(page.locator('#rack .cc-tile.used')).toHaveCount(0);

  // With a mouse there's no hold: tap a tile onto the board, then just drag it.
  await tile(0).click();
  await cell(60).click();
  const a = await cell(60).boundingBox(), b = await cell(62).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(cell(62)).toHaveClass(/pending/);
  await expect(cell(60)).not.toHaveClass(/pending/);
  // One tile isn't a word yet, so the score check before playing turns it down; that's expected here.
  const real = problems.filter(p => !/preview|status of 400/.test(p));
  expect(real, real.join('\n')).toEqual([]);
});

// Dest, 2026-11-15: on a tall phone the board sat in the middle of a box that filled
// the screen, so the tiles and buttons ended up under Chrome's bottom bar and its
// full-screen message. The board now sits right under the scores, and the spare
// room is below the buttons.
test('Words with Family keeps its tiles and buttons high on a tall phone', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await quietFonts(page);
  await openPage(page, '/crisscross.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.locator('#newBotBtn').click();
  await page.locator('#localPlayers input').first().fill('Tester');
  await page.locator('#localGo').click();
  await expect(page.locator('#game')).toBeVisible();
  const status = await page.locator('#status').boundingBox();
  const board = await page.locator('#boardBox').boundingBox();
  const actions = await page.locator('#actions').boundingBox();
  expect(board.y - (status.y + status.height), 'no big gap above the board').toBeLessThan(60);
  expect(915 - (actions.y + actions.height), 'room left under the buttons').toBeGreaterThan(80);
  // The board reaches 4px from each side, and the buttons are in Dest's order.
  expect(board.width, 'the board nearly fills the width').toBeGreaterThan(412 - 12);
  expect(board.x + board.width, 'and stays on the screen').toBeLessThanOrEqual(412);
  expect(await page.locator('#actions .cc-key small').allTextContents()).toEqual(['Pass', 'Swap', 'Recall', 'Shuffle', 'Play']);
});

// The home screen: your games on their own, then the Multiplayer-Multiple devices heading
// over the lobbies, then the two ways to play on one device, each with its own setup.
test('Words with Family: Multiplayer-Shared device and Against the computer set up their own players', async ({ page }) => {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, '/crisscross.html');
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();

  // A guest: the card about everyone's own device, under the heading, with List Hosted Games.
  await expect(page.locator('#home .mode-label')).toHaveText('Multiplayer-Multiple devices');
  await expect(page.locator('#noProfile')).toBeVisible();
  await expect(page.locator('#createPanel')).toBeHidden();
  await expect(page.locator('#hostedPanel')).toBeVisible();
  await expect(page.locator('#newSharedBtn')).toHaveText('🤝 Multiplayer-Shared device');
  await expect(page.locator('#newBotBtn')).toHaveText('🤖 Against the computer');
  await expect(page.locator('#newTvBtn')).toBeHidden();

  // Multiplayer-Shared device: two people, + Add player, and no computer.
  const rows = page.locator('#localPlayers .cc-local-row');
  await page.locator('#newSharedBtn').click();
  await expect(page.locator('#localTitle')).toHaveText('Who\'s playing?');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#localPlayers input')).toHaveCount(2);
  await expect(page.locator('#localPlayers')).not.toContainText('The computer');
  await expect(page.locator('#addPerson')).toBeVisible();
  await expect(page.locator('#addBot')).toBeHidden();
  await page.locator('#addPerson').click();
  await page.locator('#addPerson').click();
  await expect(rows).toHaveCount(4);
  await expect(page.locator('#addPerson')).toBeDisabled();
  await page.locator('#localBack').click();

  // Against the computer: your name and the computer, up to three computer players.
  await page.locator('#newBotBtn').click();
  await expect(page.locator('#localTitle')).toHaveText('Against the computer');
  await expect(page.locator('#localHint')).toHaveText('You play the computer on this device. Add a second computer player if you want a busier board.');
  await expect(page.locator('#localPlayers input')).toHaveCount(1);
  await expect(page.locator('#localPlayers input')).toHaveAttribute('placeholder', 'Your name');
  await expect(page.locator('#localPlayers .cc-bot')).toHaveCount(1);
  await expect(page.locator('#addPerson')).toBeHidden();
  const addBot = page.locator('#addBot');
  await expect(addBot).toHaveText('🤖 Add another computer player');
  // The last computer player stays.
  await expect(rows.nth(1).getByRole('button')).toBeDisabled();
  await addBot.click();
  await addBot.click();
  await expect(page.locator('#localPlayers .cc-bot')).toHaveCount(3);
  await expect(addBot).toBeDisabled();
  await rows.nth(2).getByRole('button').click();
  await rows.nth(1).getByRole('button').click();
  await expect(page.locator('#localPlayers .cc-bot')).toHaveCount(1);
  await expect(rows.nth(1).getByRole('button')).toBeDisabled();
  await page.locator('#localPlayers input').fill('Kim');
  await page.locator('#localGo').click();
  await expect(page.locator('#game')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});
