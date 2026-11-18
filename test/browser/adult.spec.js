'use strict';

// Anyone can play an adult game but a kid's or a teen's device (the maintainer,
// 2026-11-15). A guest gets the adult pass with nothing to unlock, and hosts and
// switches a party game to an adult level with it, and nobody types a password.
// A kid signed in on their own device gets no pass, so the server refuses them.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

for (const game of ['partdeux', 'daredevil']) {
  test(`a guest hosts and switches to an adult level in ${game}, and a kid can't`, async ({ browser }) => {
    test.skip(test.info().project.name !== 'laptop', 'once is enough');
    const guestCtx = await browser.newContext();
    const page = await guestCtx.newPage();
    await quietFonts(page);
    await openPage(page, `/${game}.html`);
    await page.getByRole('button', { name: /Play as a guest/ }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();

    // Everything below uses this page's own cookies, the same as the game would.
    const api = page.request;
    const { levels } = await (await api.get(`/api/${game}/config`)).json();
    const adult = levels.find(l => l.adult).id;
    const tame = levels.find(l => !l.adult).id;
    const passed = await api.post('/api/arksid/adult-pass');
    expect(passed.status()).toBe(200);
    const pin = { 'X-Adult-Pin': (await passed.json()).pass };

    expect((await api.post(`/api/${game}/rooms`, { data: { name: 'Guest', level: adult } })).status(), 'without the pass the server says no').toBe(403);
    const hosting = await api.post(`/api/${game}/rooms`, { data: { name: 'Guest', level: adult }, headers: pin });
    expect(hosting.status()).toBe(201);
    const room = await api.post(`/api/${game}/rooms`, { data: { name: 'Guest', level: tame } });
    const { code, playerId, token } = await room.json();
    const switching = await api.post(`/api/${game}/rooms/${code}/settings`, { data: { playerId, token, level: adult }, headers: pin });
    expect(switching.status()).toBe(200);

    // Milo, a kid, signed in on their own device.
    const kidCtx = await browser.newContext();
    const kid = await kidCtx.newPage();
    expect((await fake('/test/next-once', { as: 'milo' })).ok).toBe(true);
    await kid.goto(`/auth/signin?return=/${game}.html`);
    await kid.waitForURL(u => new URL(u).pathname === `/${game}.html`);
    expect((await kid.request.post('/api/arksid/adult-pass')).status()).toBe(403);
    const kidJoin = await kid.request.post(`/api/${game}/rooms/${code}/join`, { data: { name: 'Milo' } });
    expect(kidJoin.status()).toBe(403);
    await guestCtx.close();
    await kidCtx.close();
  });
}

// Picking an adult level just turns it on: no PIN, no password, no screen in between.
for (const [game, seg] of [['rambler', '#profileSeg'], ['scuffle', '#dictSeg']]) {
  test(`a guest picks Unfiltered in ${game} with nothing to type`, async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'once is enough');
    await quietFonts(page);
    await openPage(page, `/${game}.html`);
    await page.getByRole('button', { name: /Play as a guest/ }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const pick = page.locator(seg).getByRole('button', { name: /Unfiltered/ });
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Enter the PIN|lobby password/i)).toHaveCount(0);
    await expect(page.locator('input[type="password"]:visible')).toHaveCount(0);
  });
}
