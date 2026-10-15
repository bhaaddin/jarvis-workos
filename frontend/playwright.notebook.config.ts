import { defineConfig } from "@playwright/test";

const folder = "../logs/notebook-browser-" + new Date().toISOString().replace(/[:.]/g, "-");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "notebook.spec.js",
  timeout: 180000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: folder + "/results.json" }]],
  outputDir: folder + "/artifacts",
  // No trace/HAR/network log: those could contain the live HTTP Authorization header.
  use: { headless: true, trace: "off", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
});
