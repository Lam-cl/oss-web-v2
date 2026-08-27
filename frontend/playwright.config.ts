import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: process.env.STAGING_BASE_URL || 'https://tonewow.xifuhalim.com',
    browserName: 'chromium',
    headless: true,
    launchOptions: { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
