'use strict';

// Adult levels stay locked for anyone who isn't a signed-in grown-up. A guest
// can't host a party game at an adult level, can't switch a game to one
// afterwards, and can't get the adult pass that would unlock them. The server
// answers 403 (or 401 for the pass), whatever the page itself shows.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

for (const game of ['partdeux', 'daredevil']) {
  test(`a guest can't host or switch to an adult level in ${game}`, async ({ page }) => {
    await quietFonts(page);
    await openPage(page, `/${game}.html`);
    await page.getByRole('button', { name: /Play as a guest/ }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();

    // Everything below uses this page's own cookies, the same as the game would.
    const api = page.request;
    const { levels } = await (await api.get(`/api/${game}/config`)).json();
    const adult = levels.find(l => l.adult).id;
    const tame = levels.find(l => !l.adult).id;

    const hosting = await api.post(`/api/${game}/rooms`, { data: { name: 'Guest', level: adult, password: 'x1y2' } });
    expect(hosting.status()).toBe(403);
    const withPin = await api.post(`/api/${game}/rooms`, { data: { name: 'Guest', level: adult, password: 'x1y2' }, headers: { 'X-Adult-Pin': '123456' } });
    expect(withPin.status(), 'a PIN does nothing when sign-in is on').toBe(403);
    const onePhone = await api.post(`/api/${game}/local`, { data: { names: ['A', 'B'], level: adult } });
    expect(onePhone.status()).toBe(403);

    const room = await api.post(`/api/${game}/rooms`, { data: { name: 'Guest', level: tame } });
    expect(room.status()).toBe(201);
    const { code, playerId, token } = await room.json();
    const switching = await api.post(`/api/${game}/rooms/${code}/settings`, { data: { playerId, token, level: adult } });
    expect(switching.status()).toBe(403);

    expect((await api.post('/api/arksid/adult-pass')).status()).toBe(401);
  });
}
