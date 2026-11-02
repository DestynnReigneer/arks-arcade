'use strict';

// The party and word games on a TV, at 1920 by 1080 with the ARKS TV app's
// user agent, driven only by the keyboard (the remote's arrows and OK arrive
// as arrow keys and Enter): the TV hosts Uh-Oh: Part Deux, Dare Devil,
// Shuffle Scuffle and Rambler as the screen, and a phone (its own browser)
// joins and plays a round. Dare Devil is also played with the remote alone.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const TV_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36 ARKS-TV/1.0.0';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

test.use({ userAgent: TV_UA, viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false });
// One TV is enough: these run in the laptop project only.
test.beforeEach(({}, info) => {
  info.skip(info.project.name !== 'laptop', 'TV tests run once, at TV size');
  info.setTimeout(150000);
});

const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// The first time, the TV shows a code; a grown-up's phone approves it. This
// file sets up the den's TV, so it can run alongside tv.spec.js, which sets up
// the living room's (setting a TV up again signs its old sign-in out).
async function pairTv(page, path) {
  await quietFonts(page);
  await page.goto(path);
  const code = page.locator('.tv-pair .tv-code');
  await expect(code).toBeVisible();
  const userCode = (await code.textContent()).replace(/\s/g, '');
  expect((await fake('/test/tv/approve', { userCode, as: 'den' })).ok).toBe(true);
  await expect(page.locator('#tvBar')).toContainText('Den TV', { timeout: 20000 });
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

// Nothing wider than the TV: no sideways scrolling.
async function fitsTheScreen(page) {
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
}

// A phone, in its own browser, scans the code on the TV and plays as a guest.
async function phoneJoins(browser, path, code) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA });
  const phone = await ctx.newPage();
  await quietFonts(phone);
  const problems = watchProblems(phone);
  await openPage(phone, `${path}?join=${code}`);
  await phone.getByRole('button', { name: /Play as a guest/ }).click();
  await phone.getByRole('button', { name: 'Play', exact: true }).click();
  const close = phone.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return { ctx, phone, problems };
}

test('each party game\'s page fits the TV and offers the TV ways to play', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/partdeux.html');
  for (const [path, tvModes, phoneModes] of [
    ['/partdeux.html', ['tvphones', 'tvpass'], ['local', 'host', 'join']],
    ['/daredevil.html', ['tvphones', 'tvpass', 'tvremote'], ['local', 'host', 'join']],
    ['/scuffle.html', ['tvphones', 'daily', 'free'], ['host', 'join']],
    ['/rambler.html', ['room'], ['solo', 'turns', 'tabletop', 'marathon']]
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveClass(/\btv\b/);
    await expect(page.locator('#tvBar')).toContainText('family mode');
    for (const m of tvModes) await expect(page.locator(`[data-mode="${m}"]:visible`)).toHaveCount(1);
    for (const m of phoneModes) await expect(page.locator(`[data-mode="${m}"]:visible`)).toHaveCount(0);
    // The highlight is on something, and How to play waits for the ? button.
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement !== document.body)).toBe(true);
    await expect(page.locator('.tut-overlay:visible')).toHaveCount(0);
    await fitsTheScreen(page);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Uh-Oh: Part Deux: the TV shows the table and one phone is passed around', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/partdeux.html');
  await press(page, '[data-mode="tvpass"]');
  await expect(page.locator('#tvpassSetup')).toBeVisible();
  await press(page, '#goBtn');
  await expect(page.locator('#lobby')).toBeVisible();
  const code = (await page.locator('#lobbyCode').textContent()).trim();
  await expect(page.locator('#joinQr')).toBeVisible();
  await expect(page.locator('#lobbyHow')).toContainText('pass around');
  await expect(page.locator('#startBtn')).toBeDisabled();
  await fitsTheScreen(page);

  // One phone joins, and adds a second player to pass it to.
  const { ctx, phone, problems: phoneProblems } = await phoneJoins(browser, '/partdeux.html', code);
  await expect(phone.locator('#joinCode')).toHaveValue(code);
  await phone.locator('#joinName').fill('Pat');
  await phone.locator('#goBtn').click();
  await expect(phone.locator('#seatBox')).toBeVisible();
  await phone.locator('#seatName').fill('Sam');
  await phone.locator('#seatAdd').click();
  await expect(phone.locator('#lobbyPlayers')).toContainText('Sam');
  await expect(page.locator('#lobbyPlayers')).toContainText('on Pat\'s phone');

  // The TV starts with the remote and shows the table, not a hand.
  await press(page, '#startBtn');
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#turnLine')).toHaveText(/(PAT|SAM)'S TURN/);
  await expect(page.locator('#opponents li')).toHaveCount(2);
  await expect(page.locator('#hand')).toBeHidden();
  await expect(page.locator('#discard .card')).toBeVisible();
  await fitsTheScreen(page);

  // The phone hides the cards until the right person has it, then they play.
  await expect(phone.locator('#passCover')).toBeVisible();
  const who = (await phone.locator('#passTitle').textContent()).replace('Pass the phone to ', '');
  await phone.locator('#passReady').click();
  await expect(phone.locator('#turnLine')).toContainText('YOUR TURN');
  await expect(phone.locator('#hand .card')).toHaveCount(7);
  const playable = phone.locator('#hand .card.ok');
  if (await playable.count()) {
    const card = playable.first();
    await card.click();
    // A wild asks for a color, a gift for a card and a person.
    if (await phone.locator('#colorPick').isVisible()) await phone.locator('#colorRow button').first().click();
    if (await phone.locator('#giftPick').isVisible()) { await phone.locator('#giftCards .card').first().click(); await phone.locator('#giftTargets button').first().click(); }
  } else {
    await phone.locator('#drawBtn').click();
    if (await phone.locator('#keepBtn').isVisible()) await phone.locator('#keepBtn').click();
  }
  // The TV moves on to the next player's turn.
  await expect(page.locator('#turnLine')).not.toHaveText(new RegExp(`^${who.toUpperCase()}'S TURN$`), { timeout: 10000 });
  await expect(page.locator('#latest')).not.toBeEmpty();
  expect(problems, problems.join('\n')).toEqual([]);
  expect(phoneProblems, phoneProblems.join('\n')).toEqual([]);
  await ctx.close();
});

test('Dare Devil: phones draw while the TV shows the card, then the remote plays alone', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/daredevil.html');
  await expect(page.locator('[data-mode="tvphones"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page, '#lengthSeg [data-v="quick"]');
  await press(page, '#goBtn');
  await expect(page.locator('#lobby')).toBeVisible();
  const code = (await page.locator('#lobbyCode').textContent()).trim();
  const { ctx, phone, problems: phoneProblems } = await phoneJoins(browser, '/daredevil.html', code);
  await phone.locator('#joinName').fill('Ana');
  await phone.locator('#goBtn').click();
  await phone.locator('#seatName').fill('Ben');
  await phone.locator('#seatAdd').click();
  await expect(page.locator('#lobbyPlayers li')).toHaveCount(2);
  await press(page, '#startBtn');
  await expect(page.locator('#turnLine')).toContainText('\'s turn');
  await expect(page.locator('#deckBtn')).toBeDisabled();
  // The phone draws; the card shows up big on the TV.
  // The deck bobs up and down to say "draw me", so it never holds still for a click.
  await phone.locator('#deckBtn').click({ force: true });
  await expect(page.locator('#dareCard')).toBeVisible();
  const text = await page.locator('#dcText').textContent();
  await expect(phone.locator('#dcText')).toHaveText(text);
  await expect(page.locator('#dcBtns')).toBeHidden();
  await phone.locator('#doneBtn').click();
  await expect(page.locator('#scoreStrip')).toContainText(/[1-3]/);
  await expect(page.locator('#deckLeft')).toContainText('14 of 15');
  // The TV ends it (a yes-or-no card the remote answers, not a browser box).
  await press(page, '#quitBtn');
  await expect(page.locator('.tv-confirm')).toBeVisible();
  await press(page, '.tv-confirm .tv-btn:nth-child(2)');
  await expect(page.locator('#setup')).toBeVisible();
  await expect(phone.locator('#setup')).toBeVisible({ timeout: 10000 });
  await ctx.close();

  // Now with only the remote: two players take turns on the TV.
  await press(page, '[data-mode="tvremote"]');
  await expect(page.locator('#nameList .name-row')).toHaveCount(2);
  await press(page, '#goBtn');
  await expect(page.locator('#game')).toBeVisible();
  for (let turn = 0; turn < 3; turn++) {
    await expect(page.locator('#deckBtn')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dareCard')).toBeVisible();
    await press(page, '#doneBtn');
    await expect(page.locator('#deckLeft')).toContainText(`${14 - turn} of 15`);
  }
  await expect(page.locator('#scoreStrip li')).toHaveCount(2);
  expect(problems, problems.join('\n')).toEqual([]);
  // The phone finding out the TV ended the game (a 404 for the room) is expected.
  expect(phoneProblems.filter(p => !/rooms\/[A-Z0-9]{4}(\/events)?\?|status of 404/.test(p)), phoneProblems.join('\n')).toEqual([]);
});

test('Shuffle Scuffle: the TV shows the letters while a phone races', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/scuffle.html');
  await expect(page.locator('[data-mode="tvphones"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page, '#goBtn');
  await expect(page.locator('#lobby')).toBeVisible();
  const code = (await page.locator('#lobbyCode').textContent()).trim();
  await expect(page.locator('#lobbyHow')).toContainText('own phone');
  const { ctx, phone, problems: phoneProblems } = await phoneJoins(browser, '/scuffle.html', code);
  await phone.locator('#joinName').fill('Pat');
  await phone.locator('#goBtn').click();
  await expect(page.locator('#lobbyPlayers')).toContainText('Pat');
  await press(page, '#startBtn');
  await expect(page.locator('#play')).toBeVisible();
  const letters = await page.locator('#tiles .sc-tile').allTextContents();
  expect(letters.length).toBeGreaterThanOrEqual(6);
  await expect(page.locator('#tiles .sc-tile').first()).toBeDisabled();
  await expect(page.locator('.sc-keys')).toBeHidden();
  await expect(phone.locator('#tiles .sc-tile')).toHaveCount(letters.length);
  // The phone spells a word with its tiles (right or wrong, the server says).
  for (let i = 0; i < 3; i++) await phone.locator('#tiles .sc-tile:not(.used)').first().click();
  await phone.locator('#enterBtn').click();
  await expect(page.locator('#strip')).toContainText('Pat');
  await fitsTheScreen(page);
  // The TV ends the round with the remote, and everyone sees how it went.
  await press(page, '#doneBtn');
  await expect(page.locator('#reveal')).toBeVisible();
  await expect(page.locator('#revealFull')).not.toBeEmpty();
  await expect(page.locator('#standings')).toContainText('Pat');
  await expect(phone.locator('#reveal')).toBeVisible();
  await expect(page.locator('#nextBtn')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
  expect(phoneProblems.filter(p => !/answer 409/.test(p)), phoneProblems.join('\n')).toEqual([]);
  await ctx.close();
});

test('Rambler: the board goes up on the TV and a phone plays the round', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/rambler.html');
  await expect(page.locator('#tvRoomMode')).toHaveAttribute('aria-pressed', 'true');
  await press(page, '#startBtn');
  await expect(page.locator('#lobbyScreen')).toBeVisible();
  const code = (await page.locator('#roomCode').textContent()).trim();
  await expect(page.locator('#lobbyHow')).toContainText('own phone');
  await expect(page.locator('#lobbyStartBtn')).toBeDisabled();
  const { ctx, phone, problems: phoneProblems } = await phoneJoins(browser, '/rambler.html', code);
  const guest = phone.locator('#whoGuestBtn');
  if (await guest.isVisible().catch(() => false)) await guest.click();
  await expect(phone.locator('#joinCodeInput')).toHaveValue(code);
  await phone.locator('#nameInput').fill('Pat');
  await phone.locator('#joinBtn').click();
  await expect(page.locator('#lobbyRoster')).toContainText('Pat');
  await press(page, '#lobbyStartBtn');
  await expect(page.locator('#playScreen')).toBeVisible();
  await expect(page.locator('#board .die')).toHaveCount(16);
  await expect(page.locator('#traceBar')).toBeHidden();
  await expect(page.locator('#playRoster')).toContainText('Pat');
  await expect(phone.locator('#board .die')).toHaveCount(16);
  expect(await phone.locator('#board').textContent()).toBe(await page.locator('#board').textContent());
  await fitsTheScreen(page);
  // The phone finishes; the results come up on the TV.
  await phone.locator('#doneBtn').click();
  await expect(page.locator('#resultsScreen')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#standings')).toContainText('Pat');
  await expect(page.locator('#saveScoreBtn')).toBeHidden();
  await expect(page.locator('#againBtn')).toHaveText('New round');
  expect(problems, problems.join('\n')).toEqual([]);
  expect(phoneProblems, phoneProblems.join('\n')).toEqual([]);
  await ctx.close();
});
