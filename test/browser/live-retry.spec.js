'use strict';

// Live updates that come back by themselves (public/live.js).
//
// A browser's EventSource tries again on its own when the connection drops,
// but it gives up for good when it's answered with an error page, which is
// what a proxy in front of the arcade sends while the arcade restarts. Here a
// room's live updates are answered with a 502 for a while, the way that proxy
// would. The page has to keep trying, and carry on once the arcade is back.

const { test, expect } = require('@playwright/test');
const { quietFonts, openPage } = require('./helpers');

async function asGuest(page, path) {
  await quietFonts(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.apf')).toBeHidden();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  const carryOn = page.locator('#whoGuestBtn');
  if (await carryOn.isVisible().catch(() => false)) await carryOn.click();
}

const GAMES = [
  {
    name: 'Shuffle Scuffle', path: '/scuffle.html', api: 'scuffle', title: 'Your Shuffle Scuffle lobby', roster: '#lobbyPlayers',
    create: async (page, who) => { await page.locator('#modeSeg [data-mode="host"]').click(); await page.locator('#hostName').fill(who); await page.locator('#goBtn').click(); },
    join: async (page, who) => {
      await page.locator('#modeSeg [data-mode="join"]').click();
      await page.locator('#lobbyRows .lb-row', { hasText: `${who}'s lobby` }).click();
      await page.locator('#joinName').fill('Alex');
      await page.locator('#joinBtn').click();
    }
  },
  {
    name: 'Rambler', path: '/rambler.html', api: 'rambler', title: 'Your Rambler lobby', roster: '#lobbyRoster',
    create: async (page, who) => { await page.locator('#modeList .no-tv[data-mode="room"]').click(); await page.locator('#nameInput').fill(who); await page.locator('#startBtn').click(); },
    join: async (page, who) => {
      await page.locator('#modeList [data-mode="find"]').click();
      await page.locator('#hostedRows .hosted-row', { hasText: `${who}'s lobby` }).click();
      await page.locator('#hostedName').fill('Alex');
      await page.locator('#hostedJoinBtn').click();
    }
  }
];

for (const game of GAMES) {
  test(`${game.name}: live updates start again by themselves after a proxy's error page`, async ({ browser }) => {
    test.skip(test.info().project.name !== 'laptop', 'once is enough');
    test.setTimeout(60000);
    const ctxs = await Promise.all([browser.newContext({ viewport: { width: 1280, height: 800 } }), browser.newContext({ viewport: { width: 1280, height: 800 } })]);
    const [host, joiner] = await Promise.all(ctxs.map(c => c.newPage()));
    const who = game.api === 'scuffle' ? 'Remy' : 'Remy2';

    await asGuest(host, game.path);
    // The arcade is "away": everything about this game's rooms is answered the way a proxy answers
    // for an arcade that's restarting. Making the room still goes through, so there is a room to come back to.
    let away = true;
    let tries = 0;
    await host.route(new RegExp(`/api/${game.api}/rooms/[A-Z0-9]{4}(/events)?\\?`), route => {
      if (route.request().url().includes('/events')) tries++;
      return away ? route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }) : route.continue();
    });
    await game.create(host, who);

    // The browser asked once, got the error page and gave up. The page keeps asking, every couple of seconds.
    await expect.poll(() => tries, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    await expect(host.locator('#lobbyTitle')).toHaveText('');

    // The arcade is back: the next try gets through, and the lobby fills in without a reload.
    away = false;
    await expect(host.locator('#lobbyTitle')).toHaveText(game.title, { timeout: 10000 });

    // And the updates are live again: someone joins, and the host's page shows them.
    await asGuest(joiner, game.path);
    await game.join(joiner, who);
    await expect(host.locator(game.roster)).toContainText('Alex', { timeout: 10000 });
    for (const c of ctxs) await c.close();
  });
}
