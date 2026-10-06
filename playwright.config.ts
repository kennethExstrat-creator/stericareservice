import { defineConfig, devices } from "@playwright/test";

// The specs sign in against the Supabase project in .env.local.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: specs that need Supabase fail with a clear message instead.
}

// iPad Safari's user agent with touch on, so (pointer: coarse) styles apply.
const ipad = {
  userAgent: devices["iPad Pro 11"].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

/**
 * End-to-end checks and screenshots at the three sizes in BUILD_SPEC
 * section 8. Start a dev server first and point PLAYWRIGHT_BASE_URL at it.
 * One worker: every spec shares the same live database.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "ipad-portrait", use: { ...ipad, viewport: { width: 820, height: 1180 } } },
    { name: "ipad-landscape", use: { ...ipad, viewport: { width: 1180, height: 820 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
