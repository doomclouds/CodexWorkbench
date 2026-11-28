import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function runtimeFiles(directory, path = "") {
  const entries = await readdir(join(directory, path), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = path + entry.name;
    if (entry.isDirectory()) {
      files.push(...(await runtimeFiles(directory, name + "/")));
    } else if (entry.isFile()) {
      files.push(name);
    }
  }

  return files.sort();
}

export async function fingerprintRuntime(edition, directory) {
  const manifest = JSON.parse(await readFile(join(directory, "plugin.json"), "utf8"));
  const runtime = join(directory, "runtime");
  const files = await runtimeFiles(runtime);
  const entrypoint = edition === "initial" ? "server.mjs" : "backend.mjs";
  if (!files.includes(entrypoint)) {
    throw new Error(`Studio runtime entry is missing: ${entrypoint}`);
  }

  const fingerprint = [];
  for (const file of files) {
    const content = await readFile(join(runtime, file));
    fingerprint.push({
      file,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  return {
    id: edition,
    name: edition === "initial" ? "V1" : "V2",
    version: manifest.version,
    packageSha256: createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex"),
    files: fingerprint,
  };
}
