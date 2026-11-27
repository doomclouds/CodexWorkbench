import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import studio from "../../../tooling/studio-lint/script-plugin.mjs";
import { scriptRules } from "../../../tooling/studio-lint/script-rules.mjs";
import browser from "./lint/browser-boundary.mjs";

const hostGlobals = [
  "Buffer",
  "EventSource",
  "WebSocket",
  "XMLHttpRequest",
  "document",
  "fetch",
  "global",
  "globalThis",
  "navigator",
  "process",
  "require",
  "self",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "window",
];

export default defineConfig([
  { ignores: ["**/test-results/**", "**/playwright-report/**"] },
  {
    files: ["**/*.mjs"],
    plugins: { studio, "@stylistic": stylistic },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: scriptRules,
  },
  {
    files: ["**/*.spec.mjs"],
    plugins: { browser },
    rules: {
      "browser/user-flow-boundary": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-globals": ["error", { globals: hostGlobals, checkGlobalObject: true }],
    },
  },
]);
