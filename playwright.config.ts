/**
 * Playwright E2E Test Configuration
 * Phase C2: E2E Authentication Matrix Framework
 * 
 * Uses system-installed Microsoft Edge browser (no additional browser download needed)
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Disable parallel execution to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid login rate limiting
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'msedge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },
  ],
  webServer: process.env.CI ? {
    command: 'pnpm dev:win',
    url: 'http://localhost:5000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  } : undefined,
  resolveSnapshotPath: (testPath, snapshotPath) => {
    return path.join('tests', 'e2e', '__snapshots__', testPath.replace(/\\/g, '__') + '.snap');
  },
});
