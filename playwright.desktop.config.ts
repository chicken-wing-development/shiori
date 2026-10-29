import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'desktop.spec.ts',
  outputDir: './test-results/desktop',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --mode desktop --host 127.0.0.1 --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
});
