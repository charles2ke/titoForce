import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3457);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Specs share one seeded database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    // Charts skip their entry animations, so screenshots show final values.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // PW_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's bundled Chromium.
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: 'node e2e/server.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    env: { E2E_PORT: String(port) },
    reuseExistingServer: false,
    // SIGTERM (instead of the default SIGKILL) lets e2e/server.ts delete its temporary database.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
