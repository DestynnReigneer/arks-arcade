'use strict';

// Rambler on an arcade with sign-in. Who's playing is whoever the device is
// signed in as: there's no list of profiles to pick from, nothing to add, edit
// or delete, and a visitor plays as a guest and is shown nobody's profile.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, chooser } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// The first visit opens How to play over the page.
const closeHelp = async page => { const x = page.locator('.tut-x'); if (await x.isVisible().catch(() => false)) await x.click(); };

test('Rambler follows who is signed in, and shows a visitor nobody\'s profile', async ({ browser }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  test.setTimeout(60000);

  // Alex signs in and opens Rambler: the chip is Alex, with no picking.
  const alex = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await quietFonts(alex);
  const problems = watchProblems(alex);
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await alex.goto('/auth/signin?return=/rambler.html');
  await alex.waitForURL(u => new URL(u).pathname === '/rambler.html');
  await alex.waitForLoadState('networkidle');
  await closeHelp(alex);
  await expect(alex.locator('#pcName')).toHaveText('Alex');
  await expect(alex.locator('#profileBtn')).toHaveClass(/signed/);

  // The chip opens Alex's own Rambler card. Edit and Switch profile aren't offered:
  // the name is the account's, and switching is signing out.
  await alex.locator('#profileBtn').click();
  await expect(alex.locator('#profileDetailOverlay')).toBeVisible();
  await expect(alex.locator('#pdTitle')).toHaveText('Alex');
  await expect(alex.locator('#pdEditBtn')).toBeHidden();
  await expect(alex.locator('#pdSwitchBtn')).toBeHidden();
  await alex.locator('#closeProfileDetailBtn').click();
  expect(problems, problems.join('\n')).toEqual([]);

  // What the page was handed: Alex's profile and nobody else's.
  const mine = await alex.evaluate(async () => (await fetch('/api/rambler/players', { headers: { 'X-Profile-Token': ArcadeProfile.token() } })).json());
  expect(mine.signIn).toBe(true);
  expect(mine.players.map(p => p.name)).toEqual(['Alex']);

  // A visitor in another browser: a guest, shown nobody, and Rambler's own list never opens.
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await quietFonts(visitor);
  await visitor.goto('/rambler.html');
  await visitor.waitForLoadState('networkidle');
  const seen = await visitor.evaluate(async () => (await fetch('/api/rambler/players')).json());
  expect(seen.players).toEqual([]);
  // The arcade's own Who's playing? card is what asks a visitor, not a list of Rambler's.
  await expect(chooser(visitor)).toBeVisible();
  await expect(visitor.locator('#pcName')).toHaveText('Guest');
  await expect(visitor.locator('#whoGrid .who-tile')).toHaveCount(0);

  // And a visitor can't change Alex's profile behind the page's back.
  const alexId = mine.players[0].id;
  const renamed = await visitor.evaluate(async id => (await fetch(`/api/rambler/players/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Not Alex' })
  })).status, alexId);
  const deleted = await visitor.evaluate(async id => (await fetch(`/api/rambler/players/${id}`, { method: 'DELETE' })).status, alexId);
  expect([renamed, deleted]).toEqual([403, 403]);
  await alex.reload();
  await alex.waitForLoadState('networkidle');
  await expect(alex.locator('#pcName')).toHaveText('Alex');
});
