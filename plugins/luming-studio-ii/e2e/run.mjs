import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const candidate = args[0] ?? "";
const candidateIsGroup = /^[a-z][a-z0-9-]{0,49}$/u.test(candidate);
const group =
  candidateIsGroup && existsSync(new URL(candidate + "/", import.meta.url)) ? candidate : "";
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const config = fileURLToPath(new URL("playwright.config.mjs", import.meta.url));
const filters = group ? args.slice(1) : args;
const result = spawnSync(process.execPath, [cli, "test", "--config", config, ...filters], {
  env: { ...process.env, LUMING_STUDIO_E2E_GROUP: group },
  stdio: "inherit",
});

if (result.error) {
  throw new Error("Unable to launch Playwright.", { cause: result.error });
}

process.exitCode = result.status ?? 1;
