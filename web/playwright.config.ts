import { defineConfig, devices } from "@playwright/test";

/**
 * Test end-to-end di chain lokal. Butuh `pnpm dev` (dijalankan otomatis jika belum ada).
 * Semua test berbagi satu chain, jadi dijalankan berurutan.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: "pnpm --dir .. dev",
    url: process.env.WEB_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
