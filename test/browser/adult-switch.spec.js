'use strict';

// A host turns a family lobby adult while someone is in it. The host is an
// adult signed in with ARKS ID; the other player is a guest, so the arcade
// doesn't know them to be an adult. The guest is moved out and told why, the
// host's chat says who left, and the lobby now takes its password to join.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

test('a host turns a family lobby adult: the guest is moved out and told why', async ({ browser }) => {
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

  // A guest finds it in List Hosted Games and joins.
  await openPage(guest, '/partdeux.html');
  await guest.getByRole('button', { name: /Play as a guest/ }).click();
  await guest.getByRole('button', { name: 'Play', exact: true }).click();
  await closeHelp(guest);
  await guest.locator('#modeSeg [data-mode="join"]').click();
  await guest.locator('#joinSetup .lb-row', { hasText: "Alex's lobby" }).click();
  await guest.locator('.pl-details [data-name]').fill('Gus');
  await guest.locator('.pl-details [data-join]').click();
  await expect(guest.locator('#lobby')).toBeVisible();
  await expect(host.locator('#lobbyPlayers')).toContainText('Gus');

  // The host picks Spicy and makes up the lobby password.
  await host.locator('#lobbyLevels .level', { hasText: 'Spicy' }).click();
  const ask = host.locator('[role=dialog] [data-input]');
  await expect(ask).toBeVisible({ timeout: 15000 });
  await ask.fill('tacos42');
  await host.locator('[role=dialog] [data-ok]').click();
  await expect(host.locator('#lobbyLevels .level[aria-pressed=true]')).toContainText('Spicy');

  // The guest is back on the setup screen, with the reason.
  await expect(guest.locator('#toast')).toHaveText('The host switched to an adult level, so you were moved out of the lobby. Adults can join again with the lobby password.');
  await expect(guest.locator('#setup')).toBeVisible();
  await expect(guest.locator('#lobby')).toBeHidden();

  // The host's lobby shows who left, and only the host is in it.
  await expect(host.locator('#lobby .lb-chat')).toContainText('Gus was moved out, because the host switched to an adult level');
  await expect(host.locator('#lobbyPlayers')).not.toContainText('Gus');
  for (const c of ctxs) await c.close();
});
