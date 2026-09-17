import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: 1,
  globalTeardown: './tests/e2e/global-teardown.ts',
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
