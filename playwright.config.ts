import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 45000, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chrome', headless: true, actionTimeout: 10000, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 30000 },
});
