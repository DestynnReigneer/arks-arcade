'use strict';

// The notifications switch in the profile card: someone signed in with ARKS ID
// sees it, with a pink dot until they've used it once; turning it on the first
// time shows "One more step in Chrome", and the switch then says you're all set.
// Off, the switch shows its title and nothing under it.
// The device's push service is pretended (a test browser has none to talk to).

const { test, expect } = require('@playwright/test');
const { quietFonts, watchProblems } = require('./helpers');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);
const FAKE = `http://localhost:${PORT + 1}`;   // the pretend ARKS ID (serve.js)
const fake = (p, body) => fetch(FAKE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

test('the notifications switch: the pink dot, turning it on, and the Chrome check', async ({ browser }) => {
  test.skip(test.info().project.name !== 'phone', 'once is enough');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await quietFonts(page);
  const problems = watchProblems(page);
  // Pretend the phone's push service: subscribing works and hands back a subscription.
  await page.addInitScript(() => {
    const sub = { endpoint: 'https://push.example/test', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, unsubscribe: async () => true };
    let subscribed = false;
    window.__pushOn = () => subscribed;
    Object.defineProperty(window, 'Notification', { value: { permission: 'default', requestPermission: async () => 'granted' }, configurable: true });
    window.PushManager = window.PushManager || function PushManager() {};
    navigator.serviceWorker.register = async () => ({
      pushManager: {
        getSubscription: async () => (subscribed ? sub : null),
        subscribe: async opts => { sub.options = { applicationServerKey: opts.applicationServerKey }; subscribed = true; window.Notification.permission = 'granted'; return sub; }
      },
      getNotifications: async () => []
    });
  });
  await page.route('**/api/push/subscribe', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));

  // Sign in as Alex with ARKS ID (no photo, so other pages' profile lists don't fetch one).
  expect((await fake('/test/next-once', { as: 'alex' })).ok).toBe(true);
  await page.goto('/auth/signin?return=/');
  await page.waitForURL(u => new URL(u).pathname === '/');
  await page.evaluate(() => { ArcadeProfile.open(); });
  const row = page.locator('.apf-notify');
  await expect(row).toBeVisible();
  await expect(row.locator('b')).toHaveText('🔔 Notifications');
  await expect(row.locator('small')).toBeHidden();
  await expect(row.locator('.apf-dot')).toBeVisible();
  await expect(row).toHaveAttribute('aria-checked', 'false');

  await row.click();
  await expect(page.locator('.apf-card h2')).toHaveText('One more step in Chrome');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.apf-notify')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.apf-notify')).toContainText('You\'re all set, I\'ll let you know when it\'s your move or someone starts a game with you.');
  await expect(page.locator('.apf-notify .apf-dot')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pushOn())).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});
