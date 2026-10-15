import { defineConfig } from "@playwright/test";

const folder = "../logs/voice-browser-" + (process.env.JARVIS_BROWSER_RUN ??= new Date().toISOString().replace(/[:.]/g, "-"));

export default defineConfig({
  testDir: "./e2e",
  testMatch: "voice.spec.js",
  timeout: 240000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: folder + "/results.json" }]],
  outputDir: folder + "/artifacts",
  use: {
    baseURL: "http://127.0.0.1:18791",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
});
