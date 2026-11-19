import { defineConfig } from "@playwright/test";

// This suite CREATES isolated QA records. Refuse accidental writes to an arbitrary server.
if (process.env.OMR_E2E_ALLOW_SETUP !== "1") {
  throw new Error(
    "Run against a fresh disposable OMR server and explicitly set OMR_E2E_ALLOW_SETUP=1. See documentation/TESTING.md.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: ".cache/qa/e2e-artifacts",
  // Emit structured failure annotations in Actions as well as retaining traces;
  // restricted environments may not be able to download signed log archives.
  reporter: process.env.GITHUB_ACTIONS ? [["list"], ["github"]] : [["list"]],
  // Default runs manage their own disposable server. An explicitly supplied URL
  // must also be a FRESH QA server; the first-run assertion refuses populated DBs.
  ...(process.env.OMR_E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `${JSON.stringify(process.env.OMR_TEST_PYTHON || ".venv/bin/python")} scripts/e2e-server.py --port 8010`,
          url: "http://127.0.0.1:8010/api/health",
          reuseExistingServer: false,
          stdout: "pipe" as const,
          gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
          timeout: 60_000,
        },
      }),
  use: {
    baseURL: process.env.OMR_E2E_BASE_URL || "http://127.0.0.1:8010",
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
});
