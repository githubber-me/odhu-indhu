import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    env: {
      DATABASE_URL: "",
      NEON_AUTH_BASE_URL: "",
      DATABASE_NEON_AUTH_BASE_URL: "",
      NEON_AUTH_COOKIE_SECRET: "",
      CRON_SECRET: "",
      BLOB_READ_WRITE_TOKEN: "",
      SARVAM_API_KEY: "",
      PARALLEL_API_KEY: "",
      VERCEL_ENV: "development",
    },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
