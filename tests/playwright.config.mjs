// Browser tests for the game. They run against tests/server.mjs (the real Worker plus the repo's files), in
// Chromium at desktop and phone sizes everywhere, and also in WebKit (iPhone Safari) and Firefox on CI.
import {defineConfig, devices} from "@playwright/test";

const PORT = 4173;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", {open: "never"}], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/New_York",
    locale: "en-US",
  },
  projects: [
    {name: "desktop-chromium", use: {...devices["Desktop Chrome"]}},
    {name: "phone-chromium", use: {...devices["Pixel 7"]}},
    ...(CI ? [
      {name: "phone-webkit", use: {...devices["iPhone 14"]}},
      {name: "desktop-firefox", use: {...devices["Desktop Firefox"]}},
    ] : []),
  ],
  webServer: {
    command: `node --disable-warning=ExperimentalWarning server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !CI,
    stdout: "ignore",
  },
});
