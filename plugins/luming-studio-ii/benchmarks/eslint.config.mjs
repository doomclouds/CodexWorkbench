import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import studio from "../../../tooling/studio-lint/script-plugin.mjs";
import { errorHandlingSyntax, scriptRules } from "../../../tooling/studio-lint/script-rules.mjs";

const publicRuntime = {
  regex: "(?:^|/)(?:src/|runtime/|luming-studio/)",
  message: "Use the isolated runtime launcher or public fixture protocols.",
};
const browserSyntax = [
  ...errorHandlingSyntax,
  {
    selector: "ImportExpression",
    message: "Declare browser driver imports statically.",
  },
  {
    selector:
      "Identifier[name=/^(fetch|XMLHttpRequest|WebSocket|EventSource|indexedDB|localStorage|sessionStorage|require|setTimeout|setInterval)$/]",
    message: "Measure real browser input and observed browser state.",
  },
  {
    selector:
      "MemberExpression[property.name=/^(route|routeFromHAR|request|setContent|addScriptTag|addStyleTag|dispatchEvent|waitForTimeout|setOffline|addCookies|setExtraHTTPHeaders|newCDPSession|clock)$/]",
    message: "Keep application traffic, browser scheduling and input unmodified.",
  },
];

export default defineConfig([
  {
    files: ["benchmarks/**/*.mjs"],
    plugins: { studio, "@stylistic": stylistic },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: {
      ...scriptRules,
      "no-restricted-imports": ["error", { patterns: [publicRuntime] }],
    },
  },
  {
    files: ["benchmarks/browser/**/*.mjs"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            publicRuntime,
            {
              regex: "^(?!\\./[a-z][a-z0-9-]*\\.mjs$|node:assert/strict$|@playwright/test$)",
              message:
                "Keep runtime setup, fixture writes, network and filesystem outside browser measurement.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...browserSyntax,
        {
          selector:
            "MemberExpression[property.name=/^(evaluate|evaluateHandle|waitForFunction|addInitScript)$/]",
          message: "Keep page-context inspection in browser/observe.mjs.",
        },
      ],
    },
  },
  {
    files: ["benchmarks/browser/observe.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...browserSyntax,
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML|textContent|className|classList|style|cookie|src|href|value)$/]",
          message: "Observe browser state without modifying the document.",
        },
        {
          selector:
            "MemberExpression[property.name=/^(appendChild|replaceChildren|removeChild|insertAdjacentHTML|setAttribute|removeAttribute|setProperty|click)$/]",
          message: "Use the browser driver for input and keep observation read-only.",
        },
      ],
    },
  },
]);
