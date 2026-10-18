import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:3100/api/health",
    env: { PORT: "3100" },
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
