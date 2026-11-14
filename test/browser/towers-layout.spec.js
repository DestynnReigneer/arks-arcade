'use strict';

// Tower Defense with no scrolling: on a computer the tower panel sits beside the
// map, and on a phone it stays under it, with the whole game on the screen.

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems, openPage } = require('./helpers');

for (const [label, viewport, beside] of [['a laptop', { width: 1440, height: 900 }, true], ['a phone', { width: 390, height: 844 }, false]]) {
  test(`Tower Defense fits ${label} with the towers ${beside ? 'beside' : 'under'} the map`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await quietFonts(page);
    const problems = watchProblems(page);
    await openPage(page, '/towers.html');
    const guest = page.getByRole('button', { name: /Play as a guest/ });
    if (await guest.isVisible().catch(() => false)) {
      await guest.click();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
    }
    const close = page.locator('.tut-x');
    if (await close.isVisible().catch(() => false)) await close.click();
    await page.locator('#waveBtn').click();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    const stage = await page.locator('#stage').boundingBox();
    const info = await page.locator('#info').boundingBox();
    if (beside) {
      expect(info.x).toBeGreaterThan(stage.x + stage.width);
      expect(stage.y + stage.height).toBeLessThanOrEqual(viewport.height);
      expect(stage.height).toBeGreaterThan(viewport.height * 0.6);
      const overflow = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      expect(overflow).toBeLessThanOrEqual(1);
    } else {
      expect(info.y).toBeGreaterThan(stage.y + stage.height - 1);
      expect(info.x).toBeLessThan(stage.x + 20);
    }
    expect(problems, problems.join('\n')).toEqual([]);
    await ctx.close();
  });
}
