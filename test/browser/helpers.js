'use strict';

// Shared bits for the browser tests.

// Every page the arcade serves to people: the home page, each game, and the
// admin sign-in page.
const PAGES = ['/', '/wordless.html', '/rambler.html', '/spinsolve.html', '/chess.html', '/dino.html', '/snake.html',
  '/bricks.html', '/blocks.html', '/towers.html', '/sudoku.html', '/scuffle.html', '/crisscross.html', '/clueless.html', '/tumbler.html', '/discodrop.html', '/royale.html', '/bucketdrop.html', '/bigswing.html', '/moonshot.html', '/trivia.html', '/partdeux.html', '/daredevil.html', '/admin.html'];

// The top bar asks Google Fonts for its lettering. The tests answer that
// themselves with an empty stylesheet, so they don't depend on the internet
// and a slow font server never fails a run.
async function quietFonts(page) {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
}

// Collects what went wrong while a page was open: console errors, uncaught
// errors, requests that never finished, and answers of 400 or worse.
function watchProblems(page) {
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`error: ${e.message}`));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    // A page leaving mid-request (the quick stops at ARKS ID) isn't a failure.
    if (/ERR_ABORTED/.test(why)) return;
    problems.push(`failed: ${r.method()} ${r.url()} ${why}`);
  });
  page.on('response', r => { if (r.status() >= 400) problems.push(`answer ${r.status()}: ${r.request().method()} ${r.url()}`); });
  return problems;
}

// Opens a page and waits until the quick stops at ARKS ID (silent sign-in,
// whose device is this) are over and the page has settled.
async function openPage(page, path) {
  await page.goto(path);
  await page.waitForURL(u => new URL(u).pathname === (path === '/' ? '/' : path.split('?')[0]), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

const chooser = page => page.locator('.apf');

module.exports = { PAGES, quietFonts, watchProblems, openPage, chooser };
