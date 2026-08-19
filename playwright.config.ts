import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 1,
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
  },
});
