'use strict';

// A host turns a family lobby adult while someone is in it. The host is an
// adult signed in with ARKS ID; the other player is a kid signed in on their
// own device. The kid is moved out and told why, and the host's chat says
// who left. Nobody types a password.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

test('a host turns a family lobby adult: a kid is moved out and told why', async ({ browser }) => {
  test.skip(test.info().project.name !== 'laptop', 'once is enough');
  test.setTimeout(60000);
  const ctxs = await Promise.all([browser.newContext({ viewport: { width: 1280, height: 800 } }), browser.newContext({ viewport: { width: 1280, height: 800 } })]);
  const [host, guest] = await Promise.all(ctxs.map(c => c.newPage()));
  await quietFonts(host);
  await quietFonts(guest);
  const closeHelp = async page => { const x = page.locator('.tut-x'); if (await x.isVisible().catch(() => false)) await x.click(); };

  // Alex, an adult, signs in and creates a family lobby in Uh-Oh: Part Deux.
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await host.goto('/auth/signin?return=/partdeux.html');
  await host.waitForURL(u => new URL(u).pathname === '/partdeux.html');
  await host.waitForLoadState('networkidle');
  await closeHelp(host);
  await host.locator('#modeSeg [data-mode="host"]').click();
  await host.locator('#goBtn').click();
  await expect(host.locator('#lobby')).toBeVisible();

  // Milo, a kid signed in on their own device, finds it in List Hosted Games and joins.
  expect((await fake('/test/next-once', { as: 'milo' })).ok).toBe(true);
  await guest.goto('/auth/signin?return=/partdeux.html');
  await guest.waitForURL(u => new URL(u).pathname === '/partdeux.html');
  await guest.waitForLoadState('networkidle');
  await closeHelp(guest);
  await guest.locator('#modeSeg [data-mode="join"]').click();
  await guest.locator('#joinSetup .lb-row', { hasText: "Alex's lobby" }).click();
  const nameBox = guest.locator('.pl-details [data-name]');
  if (await nameBox.isVisible().catch(() => false)) await nameBox.fill('Milo');
  await guest.locator('.pl-details [data-join]').click();
  await expect(guest.locator('#lobby')).toBeVisible();
  await expect(host.locator('#lobbyPlayers')).toContainText('Milo');

  // The host picks Spicy. Nothing asks for a password.
  await host.locator('#lobbyLevels .level', { hasText: 'Spicy' }).click();
  await expect(host.locator('#lobbyLevels .level[aria-pressed=true]')).toContainText('Spicy');

  // The guest is back on the setup screen, with the reason.
  await expect(guest.locator('#toast')).toHaveText('The host switched the game mode to adult, you have been removed.');
  await expect(guest.locator('#setup')).toBeVisible();
  await expect(guest.locator('#lobby')).toBeHidden();

  // The host's lobby shows who left, and only the host is in it.
  await expect(host.locator('#lobby .lb-chat')).toContainText('Milo was removed, the host switched game mode to adult.');
  await expect(host.locator('#lobbyPlayers')).not.toContainText('Milo');
  await expect(host.locator('[role=dialog] [data-input]')).toHaveCount(0);
  for (const c of ctxs) await c.close();
});
