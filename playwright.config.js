'use strict';

// Browser tests (npm run test:browser). They open the arcade in a real
// Chromium at a phone's size and a laptop's size and check what a person
// would see. The files are in test/browser/. `npm test` doesn't run these;
// CI runs them as their own job.

const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.BROWSER_TEST_PORT || 3101);

module.exports = defineConfig({
  testDir: 'test/browser',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'laptop', use: { viewport: { width: 1280, height: 800 } } }
  ],
  webServer: {
    command: 'node test/browser/serve.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
