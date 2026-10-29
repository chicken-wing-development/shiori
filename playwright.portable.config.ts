import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'portable.spec.ts', outputDir: './test-results/portable',
  workers: 1, timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'list',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true, offline: true, viewport: { width: 1360, height: 980 } },
});
