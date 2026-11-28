import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initialRootVariable, initialServerEntry } from "./support/initial-baseline.mjs";

const args = process.argv.slice(2);
const includeInitial = args.includes("--with-initial");
const options = args.filter((argument) => argument !== "--with-initial");
const candidate = options[0] ?? "";
const candidateIsGroup = /^[a-z][a-z0-9-]{0,49}$/u.test(candidate);
const group =
  candidateIsGroup && existsSync(new URL(candidate + "/", import.meta.url)) ? candidate : "";
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const config = fileURLToPath(new URL("playwright.config.mjs", import.meta.url));
const filters = group ? options.slice(1) : options;
const initialRequested =
  includeInitial ||
  filters.some(
    (argument, index) =>
      argument === "--project=initial" ||
      (argument === "--project" && filters[index + 1] === "initial"),
  );
const env = { ...process.env, LUMING_STUDIO_E2E_GROUP: group };
if (initialRequested) {
  initialServerEntry(env[initialRootVariable]);
  env[initialRootVariable] = resolve(env[initialRootVariable]);
} else {
  delete env[initialRootVariable];
}

const result = spawnSync(process.execPath, [cli, "test", "--config", config, ...filters], {
  env,
  stdio: "inherit",
});

if (result.error) {
  throw new Error("Unable to launch Playwright.", { cause: result.error });
}

process.exitCode = result.status ?? 1;
