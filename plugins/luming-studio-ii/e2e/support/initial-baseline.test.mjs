import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { initialRootVariable } from "./initial-baseline.mjs";

const run = fileURLToPath(new URL("../run.mjs", import.meta.url));

function list(root, ...options) {
  const result = spawnSync(
    process.execPath,
    [run, "workbench", "browse.spec.mjs", "--list", ...options],
    {
      encoding: "utf8",
      env: { ...process.env, [initialRootVariable]: root },
    },
  );
  assert.ifError(result.error);
  return result;
}

test("the default E2E imports and lists Studio II even with an unusable initial root", () => {
  const result = list(join(tmpdir(), "unavailable-initial-studio-test-root"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ii\]/u);
  assert.doesNotMatch(result.stdout, /\[initial\]/u);
});

test("the optional initial projects require an explicit package root", () => {
  for (const options of [["--project", "initial"], ["--with-initial"]]) {
    const result = list("", ...options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LUMING_STUDIO_E2E_INITIAL_ROOT/u);
  }
});

test("an external initial package can be listed alone or beside Studio II", async (context) => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "luming-initial-compare-test-"));
  context.after(async () => {
    const confirmed = await realpath(root);
    assert.equal(confirmed, root);
    assert.equal(dirname(confirmed), parent);
    await rm(confirmed, { recursive: true, force: true });
  });
  await mkdir(join(root, "runtime"));
  await writeFile(join(root, "runtime", "server.mjs"), "");

  const initial = list(root, "--project=initial");
  assert.equal(initial.status, 0, initial.stderr);
  assert.match(initial.stdout, /\[initial\]/u);
  assert.doesNotMatch(initial.stdout, /\[ii\]/u);

  const comparison = list(root, "--with-initial");
  assert.equal(comparison.status, 0, comparison.stderr);
  assert.match(comparison.stdout, /\[initial\]/u);
  assert.match(comparison.stdout, /\[ii\]/u);
});
