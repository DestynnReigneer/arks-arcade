'use strict';

// Every page loads cleanly: no errors in the browser's console, no requests
// that fail, and nothing wider than the screen (no sideways scrolling).

const { test, expect } = require('@playwright/test');
const { PAGES, quietFonts, watchProblems, openPage } = require('./helpers');

for (const path of PAGES) {
  test(`${path} loads with no errors and no sideways scrolling`, async ({ page }) => {
    await quietFonts(page);
    const problems = watchProblems(page);
    await openPage(page, path);
    // A moment for anything that starts after the page settles (the lobby, the tutorial).
    await page.waitForTimeout(800);
    expect(problems, problems.join('\n')).toEqual([]);
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
    expect(sizes.page, `the page is ${sizes.page}px wide on a ${sizes.screen}px screen`).toBeLessThanOrEqual(sizes.screen);
  });
}
