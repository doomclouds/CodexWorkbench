import { statSync } from "node:fs";
import { resolve } from "node:path";

export const initialRootVariable = "LUMING_STUDIO_E2E_INITIAL_ROOT";

export function initialServerEntry(root = process.env[initialRootVariable]) {
  if (!root?.trim()) {
    throw new Error(
      "Set " + initialRootVariable + " to the initial Studio plugin package directory.",
    );
  }

  const entry = resolve(root, "runtime", "server.mjs");
  if (!statSync(entry, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      initialRootVariable + " must point to a plugin package with runtime/server.mjs.",
    );
  }

  return entry;
}
