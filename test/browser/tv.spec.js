'use strict';

// The arcade on a TV, at 1920 by 1080 with the ARKS TV app's user agent,
// driven only by the keyboard (the remote's arrows and OK arrive as arrow
// keys and Enter). Setting the TV up with a pairing code, the home screen,
// Know-It-All played to the end with the remote, a phone joining a game the
// TV hosts, and an adult level picked with nothing to unlock.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const TV_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36 ARKS-TV/1.0.0';

test.use({ userAgent: TV_UA, viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false });
// One TV is enough: these run in the laptop project only.
test.beforeEach(({}, info) => {
  info.skip(info.project.name !== 'laptop', 'TV tests run once, at TV size');
  // Setting the TV up waits for the pretend adult's phone, and the remote moves one press at a time.
  info.setTimeout(120000);
});

const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// The first time, the TV shows a code; an adult's phone approves it.
async function pairTv(page, path) {
  await quietFonts(page);
  await page.goto(path);
  const code = page.locator('.tv-pair .tv-code');
  await expect(code).toBeVisible();
  await expect(page.locator('.tv-pair')).toContainText('Set up this TV');
  await expect(page.locator('.tv-pair img.tv-qr')).toBeVisible();
  const userCode = (await code.textContent()).replace(/\s/g, '');
  expect(userCode).toMatch(/^[A-Z]{6}$/);
  expect((await fake('/test/tv/approve', { userCode })).ok).toBe(true);
  await expect(page.locator('#tvBar')).toContainText('Living room TV', { timeout: 20000 });
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

test('the TV sets itself up and the home screen works with only the remote', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/');
  await expect(page.locator('html')).toHaveClass(/\btv\b/);
  // The highlight starts on Know-It-All, shown big, and is easy to see.
  await expect(page.locator('a.game.trivia')).toBeFocused({ timeout: 5000 });
  const ring = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth));
  expect(ring).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.game.trivia .tv-badge')).toBeVisible();
  // No hover-only corners, and no admin link on the TV.
  await expect(page.locator('.fb-bug')).toBeHidden();
  await expect(page.locator('.ah-lock')).toBeHidden();
  // Every game and the help button can be reached with the arrows.
  const games = await page.locator('a.game').evaluateAll(list => list.map(a => a.className.split(' ')[1]));
  expect(games.length).toBeGreaterThan(10);
  for (const g of games) await arrowTo(page, `a.game.${g}`);
  await arrowTo(page, '#helpOpen');
  await expect(page.locator('#tvAdults')).toHaveCount(0);
  // The picture stays inside the screen: nothing wider than the TV.
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.screen);
  // OK on Know-It-All opens it.
  await arrowTo(page, 'a.game.trivia');
  await page.keyboard.press('Enter');
  await page.waitForURL(/trivia\.html/);
  await expect(page.locator('#tvBar')).toContainText('📺');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Know-It-All played to the end with the TV remote', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/trivia.html');
  await expect(page.locator('[data-mode="tvremote"]')).toBeVisible();
  await expect(page.locator('[data-mode="solo"]')).toBeHidden();
  await press(page, '[data-mode="tvremote"]');
  await expect(page.locator('[data-mode="tvremote"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page, '#countSeg [data-v="5"]');
  // Just one player with the remote.
  await press(page, '#nameList .name-row:nth-child(2) button');
  await expect(page.locator('#nameList .name-row')).toHaveCount(1);
  await press(page, '#goBtn');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#lobbyPlayers')).toContainText('Player 1');
  await expect(page.locator('#lobbyPlayers')).toContainText('on the TV');
  await press(page, '#startBtn');
  // Each turn: ready, answer, next. Only Enter and the arrows.
  let answered = 0;
  for (let step = 0; step < 40 && !(await page.locator('.ew-card').isVisible()); step++) {
    if (await page.locator('#readyBtn').isVisible()) {
      await expect(page.locator('#readyTitle')).toHaveText('Player 1\'s turn');
      await press(page, '#readyBtn');
      await expect(page.locator('#answers button:not([disabled])').first()).toBeVisible();
    } else if (await page.locator('#answers button:not([disabled])').count()) {
      await press(page, `#answers button:nth-child(${(answered % 4) + 1})`);
      answered++;
      await expect(page.locator('#qStatus')).toHaveText(/Right|Not quite|Out of time/);
    } else if (await page.locator('#nextBtn').isVisible()) {
      await press(page, '#nextBtn');
      await expect(page.locator('#readyBtn:visible, .ew-card:visible')).toHaveCount(1);
    } else await page.waitForTimeout(200);
  }
  // The end window (end-window.js), over the TV's screen.
  const card = page.locator('.ew-card');
  await expect(card).toBeVisible();
  expect(answered).toBe(5);
  await expect(card.locator('.ew-title')).toContainText('Player 1');
  // The scores came from the server, not the page.
  const score = Number((await card.locator('.ew-score').textContent()).replace(/,/g, ''));
  expect(score % 1).toBe(0);
  await expect(card.getByRole('button', { name: '▶ Play again' })).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a phone joins a game the TV hosts', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/trivia.html');
  // Everyone on their own phone is where it starts.
  await expect(page.locator('[data-mode="tvphones"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page, '[data-mode="tvphones"]');
  await press(page, '#countSeg [data-v="5"]');
  await press(page, '#goBtn');
  await expect(page.locator('#lobby')).toBeVisible();
  // The TV shows a QR code to scan and no code to type; the test reads the lobby the QR code points to.
  await expect(page.locator('#joinQr')).toHaveAttribute('data-code', /^[A-Z2-9]{4}$/);
  const code = await page.locator('#joinQr').getAttribute('data-code');
  await expect(page.locator('#lobbyCode')).toHaveCount(0);
  await expect(page.locator('#joinQr')).toBeVisible();
  await expect(page.locator('#lobbyHow')).toContainText('own phone');
  await expect(page.locator('#startBtn')).toBeDisabled();

  // A phone, in its own browser, scans the code.
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  });
  const phoneUa = await (await phoneCtx.newPage()).evaluate(() => navigator.userAgent);
  expect(phoneUa).not.toContain('ARKS-TV');
  const phone = await phoneCtx.newPage();
  await quietFonts(phone);
  const phoneProblems = watchProblems(phone);
  await openPage(phone, `/trivia.html?join=${code}`);
  await phone.getByRole('button', { name: /Play as a guest/ }).click();
  await phone.getByRole('button', { name: 'Play', exact: true }).click();
  // Play saves the guest, then closes the picker; wait for it, as a person would,
  // so the next thing typed doesn't land while the picker still has the keyboard.
  await expect(phone.locator('.apf')).toBeHidden();
  const close = phone.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  // The QR opens that lobby's details: type a name and join (no code to type).
  await expect(phone.locator('#detailsView')).toBeVisible();
  await expect(phone.locator('#dHow')).toContainText('on the TV');
  await phone.locator('#joinName').fill('Pat');
  await phone.locator('#joinBtn').click();
  await expect(phone.locator('#lobby')).toBeVisible();
  await expect(phone.locator('#waitHost')).toContainText('start the game');

  // The TV sees them and starts with the remote.
  await expect(page.locator('#lobbyPlayers')).toContainText('Pat');
  await press(page, '#startBtn');
  await expect(page.locator('#qText')).not.toBeEmpty();
  await expect(page.locator('#qStatus')).toContainText('Answer on devices!');
  // The TV shows the question but doesn't answer it.
  await expect(page.locator('#answers button:not([disabled])')).toHaveCount(0);
  await expect(phone.locator('#qText')).toHaveText(await page.locator('#qText').textContent());
  await phone.locator('#answers button').first().click();
  await expect(phone.locator('#qStatus')).toHaveText(/Right|Not quite/);
  await expect(page.locator('#qStatus')).toHaveText(/Pat (got it|ran out)|Not quite, Pat/);
  await expect(page.locator('#scoreStrip')).toContainText('Pat');
  expect(problems, problems.join('\n')).toEqual([]);
  expect(phoneProblems, phoneProblems.join('\n')).toEqual([]);
  await phoneCtx.close();
});

test('the TV plays an adult level with nothing to unlock', async ({ page }) => {
  const problems = watchProblems(page);
  await pairTv(page, '/trivia.html');
  // Picking an adult level on the TV just picks it: no code for a phone, no PIN.
  await press(page, '#levelList .level:nth-child(3)');
  await expect(page.locator('#levelList .level:nth-child(3)')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tv-unlock')).toHaveCount(0);
  await expect(page.locator('#pinView')).toBeHidden();
  await expect(page.locator('html')).toHaveClass(/adult-mode/);
  expect(problems, problems.join('\n')).toEqual([]);
});
