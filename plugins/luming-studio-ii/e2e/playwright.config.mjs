import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const artifacts = fileURLToPath(
  new URL(`../../../artifacts/luming-studio-ii/v${manifest.version}/e2e/`, import.meta.url),
);
const group = process.env.LUMING_STUDIO_E2E_GROUP ?? "";
const scoped = /^[a-z][a-z0-9-]{0,49}$/u.test(group);
const groupRoot = scoped ? join(artifacts, group) : artifacts;
const run = join(groupRoot, "run");

export default defineConfig({
  testDir: scoped ? "./" + group : ".",
  testMatch: "**/*.spec.mjs",
  outputDir: join(run, "evidence"),
  fullyParallel: true,
  forbidOnly: true,
  workers: 3,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: join(run, "results.json") }],
    ["html", { outputFolder: join(run, "playwright"), open: "never" }],
  ],
  use: {
    browserName: "chromium",
    viewport: { width: 1366, height: 820 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "dark",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "initial" }, { name: "ii" }],
});
