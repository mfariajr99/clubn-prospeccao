import { defineConfig, devices } from "@playwright/test";

const PORT = 3334;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Serves the production build (run `vite build` first — `npm run test:e2e` does it) with a fresh demo database.
    command: `node -e "for (const f of ['data/e2e.db','data/e2e.db-wal','data/e2e.db-shm']) { try { require('fs').rmSync(f) } catch {} }" && npx tsx server/db/seed-cli.ts && npx tsx server/index.ts`,
    env: { DATABASE_FILE: "data/e2e.db", PORT: String(PORT), PREVIEW_SCREENSHOTS: "off" },
    url: `http://localhost:${PORT}/api/me`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
