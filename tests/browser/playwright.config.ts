import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "text-selection.spec.ts",
  outputDir: "../../test-results/text-selection",
  timeout: 30_000,
  workers: 1,
  reporter: "list",
  use: { viewport: { width: 1200, height: 1000 }, screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
