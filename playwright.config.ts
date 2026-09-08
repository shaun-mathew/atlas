import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    // Tests must never claim first-admin privileges in a developer's account database.
    env: { DATABASE_PATH: ':memory:', BETTER_AUTH_SECRET: 'atlas-playwright-isolated-auth-secret', APP_ORIGIN: 'http://127.0.0.1:5173' },
  },
});
