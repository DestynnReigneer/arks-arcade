'use strict';

// A guest names themselves on the "Who's playing?" card that opens with the page, after
// the page has already set up its name boxes. The name still lands in the first box:
// Spin & Solve's Solo box, Words with Family's first player on this device, and the first
// name in Dare Devil and Uh-Oh: Part Deux.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

async function asGuest(page, path, name) {
  await quietFonts(page);
  const problems = watchProblems(page);
  await openPage(page, path);
  await page.getByRole('button', { name: /Play as a guest/ }).click();
  await page.locator('.apf input[placeholder="Your name (optional)"]').fill(name);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const close = page.locator('.tut-x');
  if (await close.isVisible().catch(() => false)) await close.click();
  return problems;
}

test('Spin & Solve: the guest\'s name is in the Solo box', async ({ page }) => {
  const problems = await asGuest(page, '/spinsolve.html', 'Robin');
  await expect(page.locator('#soloName input')).toHaveValue('Robin');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Words with Family: the guest\'s name is the first player on this device', async ({ page }) => {
  const problems = await asGuest(page, '/crisscross.html', 'Robin');
  await page.locator('#newBotBtn').click();
  await expect(page.locator('#localPlayers input').first()).toHaveValue('Robin');
  await page.locator('#localBack').click();
  await page.locator('#newSharedBtn').click();
  await expect(page.locator('#localPlayers input').first()).toHaveValue('Robin');
  expect(problems, problems.join('\n')).toEqual([]);
});

for (const [game, path] of [['Dare Devil', '/daredevil.html'], ['Uh-Oh: Part Deux', '/partdeux.html']]) {
  test(`${game}: the guest's name is the first name`, async ({ page }) => {
    const problems = await asGuest(page, path, 'Robin');
    await expect(page.locator('#nameList .name-row input').first()).toHaveValue('Robin');
    // A name typed over it stays when the guest changes their name again.
    await page.locator('#nameList .name-row input').first().fill('Kim');
    await page.evaluate(() => ArcadeProfile.set({ ...ArcadeProfile.get(), name: 'Robin 2' }));
    await expect(page.locator('#nameList .name-row input').first()).toHaveValue('Kim');
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
