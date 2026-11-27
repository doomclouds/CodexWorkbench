import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureSpecifier = "../support/studio.mjs";
const fixturePath = fileURLToPath(new URL(fixtureSpecifier, import.meta.url));
const fixtureImports = new Set(["expect", "focused", "observe", "screenshot", "test"]);
const scopedFixtureImports = new Map(
  [
    ["failNextRecycleBinRead", "recycle-bin/retry"],
    ["failNextWorkbenchRead", "workbench/browse"],
    ["interceptNextBoardCreation", "workbench/create"],
    ["controlNextThumbnail", "workbench/display"],
    ["readCardCover", "workbench/display"],
    ["readControlPresentation", "workbench/display"],
    ["chooseArchive", "workbench/import"],
    ["failNextArchiveImport", "workbench/import"],
    ["holdNextArchiveImport", "workbench/import"],
    ["imageLoaded", "workbench/import"],
    ["workbenchLinkProbe", "workbench/link"],
  ].map(([helper, spec]) => [
    helper,
    fileURLToPath(new URL("../" + spec + ".spec.mjs", import.meta.url)),
  ]),
);
const testModes = new Set(["only", "skip", "fixme", "fail", "failOnly"]);
const pageFactories = new Set(["newPage", "openGuest"]);
const browserFactories = new Set([
  "context",
  "filter",
  "first",
  "getByLabel",
  "getByRole",
  "getByTestId",
  "getByText",
  "last",
  "nth",
]);
const unsupportedSelectors = new Set([
  "$",
  "$$",
  "$eval",
  "$$eval",
  "elementHandle",
  "elementHandles",
  "frameLocator",
  "getByAltText",
  "getByPlaceholder",
  "getByTitle",
  "locator",
  "querySelector",
  "querySelectorAll",
  "waitForSelector",
]);
const browserInternals = new Set([
  "addCookies",
  "addInitScript",
  "annotations",
  "clearCookies",
  "dispatchEvent",
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
  "exposeBinding",
  "exposeFunction",
  "newCDPSession",
  "newContext",
  "request",
  "route",
  "routeFromHAR",
  "routeWebSocket",
  "setContent",
  "setExtraHTTPHeaders",
  "setFiles",
  "setInputFiles",
  "storageState",
  "unroute",
  "unrouteAll",
  "waitForFunction",
  "waitForRequest",
  "waitForResponse",
]);
const screenshotAccess = new Set(["attach", "screenshot", "toHaveScreenshot"]);
const rawPageActions = new Set([
  "check",
  "click",
  "dblclick",
  "dragAndDrop",
  "fill",
  "focus",
  "getAttribute",
  "hover",
  "innerHTML",
  "innerText",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "press",
  "selectOption",
  "setChecked",
  "tap",
  "textContent",
  "type",
  "uncheck",
]);
const eventMethods = new Set(["waitForEvent", "on", "once", "addListener"]);
const privateBrowserEvents = new Set([
  "filechooser",
  "request",
  "requestfailed",
  "requestfinished",
  "response",
  "websocket",
]);

function propertyName({ computed, property, key }) {
  const name = property ?? key;
  if (!computed && name?.type === "Identifier") {
    return name.name;
  }

  return name?.type === "Literal" ? name.value : undefined;
}

function definitionOf(source, identifier) {
  for (let scope = source.getScope(identifier); scope; scope = scope.upper) {
    const definitions = scope.set.get(identifier.name)?.defs;
    if (definitions) {
      return definitions.length === 1 ? definitions[0] : undefined;
    }
  }
}

function propertyBinding(pattern, kind, name) {
  return (
    pattern?.type === "ObjectPattern" &&
    pattern.properties.some(
      (item) => item.type === "Property" && propertyName(item) === kind && item.value.name === name,
    )
  );
}

function unwrapped(node) {
  if (node?.type === "AwaitExpression") {
    return node.argument;
  }
  if (node?.type === "ChainExpression") {
    return node.expression;
  }

  return node;
}

function isPage(source, receiver, visited = new Set()) {
  const node = unwrapped(receiver);
  if (node?.type === "CallExpression") {
    const callee = node.callee;
    return callee.type === "MemberExpression" && pageFactories.has(propertyName(callee));
  }
  if (node?.type !== "Identifier") {
    return false;
  }
  if (node.name === "page") {
    return true;
  }

  const definition = definitionOf(source, node);
  if (!definition || visited.has(definition)) {
    return false;
  }

  visited.add(definition);
  if (definition.type === "Parameter") {
    return definition.node.params.some((parameter) =>
      propertyBinding(parameter, "page", node.name),
    );
  }

  return definition.type === "Variable" && isPage(source, definition.node.init, visited);
}

function isBrowserReceiver(source, receiver, visited = new Set()) {
  const node = unwrapped(receiver);
  if (isPage(source, node)) {
    return true;
  }
  if (node?.type === "CallExpression" && node.callee.type === "MemberExpression") {
    return browserFactories.has(propertyName(node.callee));
  }
  if (node?.type === "MemberExpression" && propertyName(node) === "describe") {
    return isBrowserReceiver(source, node.object, visited);
  }
  if (node?.type !== "Identifier") {
    return false;
  }

  const definition = definitionOf(source, node);
  if (!definition || visited.has(definition)) {
    return false;
  }

  visited.add(definition);
  if (definition.type === "ImportBinding") {
    return definition.node.imported?.name === "test";
  }

  return definition.type === "Variable" && isBrowserReceiver(source, definition.node.init, visited);
}

function isCurrentContext(source, receiver) {
  if (receiver?.type !== "CallExpression" || receiver.callee.type !== "MemberExpression") {
    return false;
  }

  const { callee } = receiver;
  return propertyName(callee) === "context" && isPage(source, callee.object);
}

function isFixtureReference(source, receiver, kind) {
  if (receiver?.type !== "Identifier") {
    return false;
  }

  const definition = definitionOf(source, receiver);
  if (definition?.type === "Parameter") {
    const { name } = receiver;
    return (
      name === kind ||
      definition.node.params.some((parameter) => propertyBinding(parameter, kind, name))
    );
  }
  if (kind === "board" && definition?.type === "Variable") {
    const initializer = unwrapped(definition.node.init);
    const callee = initializer?.type === "CallExpression" && initializer.callee;

    return (
      callee?.type === "MemberExpression" &&
      propertyName(callee) === "seedBoards" &&
      isFixtureReference(source, callee.object, "studio")
    );
  }

  return false;
}

function fixtureUrl(source, input) {
  if (input?.type === "MemberExpression" && propertyName(input) === "url") {
    return (
      isFixtureReference(source, input.object, "studio") ||
      isFixtureReference(source, input.object, "board")
    );
  }

  if (input?.type === "Identifier") {
    const definition = definitionOf(source, input);
    if (definition?.type === "Variable") {
      const { id, init } = definition.node;

      return propertyBinding(id, "url", input.name) && isFixtureReference(source, init, "studio");
    }
  }

  return false;
}

function restrictedProperty(name) {
  if (testModes.has(name)) {
    return "testMode";
  }
  if (unsupportedSelectors.has(name)) {
    return "selector";
  }
  if (screenshotAccess.has(name)) {
    return "screenshot";
  }
  if (name === "waitForTimeout") {
    return "wait";
  }
  if (browserInternals.has(name)) {
    return "browserInternal";
  }
}

function validFixtureImport(node, file) {
  return (
    node.source.value === fixtureSpecifier &&
    resolve(dirname(file), fixtureSpecifier) === fixturePath &&
    node.specifiers.length > 0 &&
    node.specifiers.every((entry) => {
      if (entry.type !== "ImportSpecifier") {
        return false;
      }

      const { name } = entry.imported;
      return fixtureImports.has(name) || scopedFixtureImports.get(name) === file;
    })
  );
}

const userFlowBoundary = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      fixture: "Import the test runner, assertions and evidence helper from ../support/studio.mjs.",
      browserInternal:
        "Exercise the application through visible browser actions. Keep browser internals, network calls and local file selection in the fixture.",
      selector: "Locate controls with getByRole, getByText, getByLabel or getByTestId.",
      navigation: "Navigate using studio.url, a seeded board URL or browser history.",
      screenshot: "Attach screenshots with the screenshot helper from the Studio fixture.",
      testMode: "Run every declared scenario without only, skip, fixme or expected failure.",
      wait: "Wait for the visible result with an assertion.",
      computed: "Name the browser operation explicitly.",
    },
  },
  create(context) {
    const source = context.sourceCode;

    function inspectOperation(node, receiver) {
      const name = propertyName(node);
      const restricted = restrictedProperty(name);
      if (restricted) {
        context.report({ node, messageId: restricted });
        return;
      }

      const call = node.parent;
      const directCall = call.type === "CallExpression" && call.callee === node;
      if (name === "goto") {
        if (!directCall || !fixtureUrl(source, call.arguments[0])) {
          context.report({ node, messageId: "navigation" });
        }
        return;
      }
      if (name === "newPage" && !isCurrentContext(source, receiver)) {
        context.report({ node, messageId: "browserInternal" });
        return;
      }

      const aliasedListener = eventMethods.has(name) && !directCall;
      if (aliasedListener && isBrowserReceiver(source, receiver)) {
        context.report({ node, messageId: "browserInternal" });
        return;
      }

      if (rawPageActions.has(name) && isPage(source, receiver)) {
        context.report({ node, messageId: "selector" });
      }

      const computedOperation = node.computed && name === undefined;
      if (computedOperation && isBrowserReceiver(source, receiver)) {
        context.report({ node, messageId: "computed" });
      }
    }

    function inspectBrowserListener(node) {
      const { callee, arguments: args } = node;
      if (callee.type === "MemberExpression" && eventMethods.has(propertyName(callee))) {
        const event = args[0];
        const privateEvent = event?.type === "Literal" && privateBrowserEvents.has(event.value);
        const computedEvent = event?.type !== "Literal" && isBrowserReceiver(source, callee.object);
        if (privateEvent || computedEvent) {
          context.report({ node, messageId: "browserInternal" });
        }
      }
    }

    function rejectImport(node) {
      context.report({ node, messageId: "fixture" });
    }

    return {
      ImportDeclaration(node) {
        if (!validFixtureImport(node, context.physicalFilename)) {
          rejectImport(node);
        }
      },
      ImportExpression: rejectImport,
      ExportAllDeclaration: rejectImport,
      ExportDefaultDeclaration: rejectImport,
      ExportNamedDeclaration: rejectImport,
      MemberExpression(node) {
        inspectOperation(node, node.object);
      },
      "ObjectPattern > Property"(node) {
        inspectOperation(node, node.parent.parent.init);
      },
      CallExpression: inspectBrowserListener,
    };
  },
};

export default { rules: { "user-flow-boundary": userFlowBoundary } };
