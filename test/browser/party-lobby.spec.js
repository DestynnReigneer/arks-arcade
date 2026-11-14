'use strict';

// Uh-Oh: Part Deux and Dare Devil with each player on their own phone: a guest
// creates a lobby, a second phone finds it in List Hosted Games and joins from its
// details card, they chat, the joiner taps Ready and the host starts.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function asGuest(page, path) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.apf')).toBeHidden();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}

for (const [path, title, first] of [['/partdeux.html', 'Uh-Oh: Part Deux', 'Robin'], ['/daredevil.html', 'Dare Devil', 'Remy']]) {
  test(`${title}: a lobby with no code, the details card, the chat, Ready and starting`, async ({ browser }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext()]);
    const [host, joiner] = await Promise.all(ctxs.map(c => c.newPage()));
    // Phone and laptop run at the same time on one server, so each host has its own name.
    const who = test.info().project.name === 'phone' ? first : `${first}2`;

    const hostProblems = await asGuest(host, path);
    await host.locator('#modeSeg [data-mode="host"]').click();
    await host.locator('#hostName').fill(who);
    await host.locator('#goBtn').click();
    await expect(host.locator('#lobby')).toBeVisible();
    await expect(host.locator('#lobbyCode')).toBeHidden();
    await expect(host.locator('#lobbyInfo')).toContainText(`Your ${title} lobby`);
    await expect(host.locator('#startBtn')).toHaveText('Waiting on players to join...');

    const joinProblems = await asGuest(joiner, path);
    await joiner.locator('#modeSeg [data-mode="join"]').click();
    await joiner.locator('#joinSetup .lb-row', { hasText: `${who}'s lobby` }).click();
    await expect(joiner.locator('.pl-details h2')).toHaveText(`${who}'s ${title} lobby`);
    await joiner.locator('.pl-details [data-name]').fill('Alex');
    await joiner.locator('.pl-details [data-join]').click();
    await expect(joiner.locator('#lobby')).toBeVisible();
    await expect(host.locator('#lobbyPlayers')).toContainText('not ready');
    await expect(host.locator('#startBtn')).toBeDisabled();

    await joiner.locator('#lobby .lb-say input').fill('deal me in');
    await joiner.locator('#lobby .lb-say input').press('Enter');
    await expect(host.locator('#lobby .lb-chat')).toContainText('deal me in');

    await joiner.getByRole('button', { name: 'Ready!' }).click();
    await expect(host.locator('#startBtn')).toHaveText('Players Ready, Start Game!');
    await expect(host.locator('#startBtn')).toBeEnabled();
    await host.locator('#startBtn').click();
    await expect(host.locator('#game')).toBeVisible();
    await expect(joiner.locator('#game')).toBeVisible();

    expect(hostProblems, hostProblems.join('\n')).toEqual([]);
    expect(joinProblems, joinProblems.join('\n')).toEqual([]);
    for (const c of ctxs) await c.close();
  });
}
