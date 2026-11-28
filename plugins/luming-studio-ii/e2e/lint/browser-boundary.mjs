import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureSpecifier = "../support/studio.mjs";
const fixturePath = fileURLToPath(new URL(fixtureSpecifier, import.meta.url));
const fixtureImports = new Set(["expect", "focused", "observe", "screenshot", "test"]);
const whiteboardFixtureSpecs = new Set(
  [
    "whiteboard-basics/viewport",
    "whiteboard-basics/placement",
    "whiteboard-basics/selection",
    "whiteboard-basics/geometry",
    "whiteboard-basics/organization",
    "whiteboard-basics/connectors",
    "whiteboard-basics/objects",
    "whiteboard-basics/objects-media",
    "whiteboard-basics/persistence",
    "whiteboard-editing/html",
    "whiteboard-editing/document",
    "whiteboard-editing/todo",
    "whiteboard-editing/rich-gestures",
    "whiteboard-editing/organization",
    "whiteboard-editing/connector-directions",
    "whiteboard-editing/object-menus",
    "whiteboard-editing/reading-controls",
    "whiteboard-editing/zoom-visibility",
    "whiteboard-editing/canvas-extras",
    "whiteboard-editing/inline-editing",
    "whiteboard-topbar/chrome",
    "whiteboard-topbar/history",
    "whiteboard-topbar/export",
    "whiteboard-topbar/sharing-feedback",
    "whiteboard-topbar/overlays",
    "whiteboard-topbar/export-fidelity",
    "whiteboard-topbar/scripted-export",
    "whiteboard-collaboration/presence",
    "whiteboard-collaboration/geometry",
    "whiteboard-collaboration/content",
  ].map(pathOfSpec),
);
const scopedFixtureMethods = new Map([
  ["seedVersionMoves", pathOfSpec("whiteboard-topbar/history")],
]);
const whiteboardFixtureMethods = new Set([
  "readBoard",
  "seedBasicBoard",
  ...scopedFixtureMethods.keys(),
]);
const boardSeedMethods = new Set(["seedBoards", "seedBasicBoard"]);
const scopedFixtureImports = new Map(
  [
    ["recycle-bin/retry", ["failNextRecycleBinRead"]],
    ["workbench/browse", ["failNextWorkbenchRead"]],
    ["workbench/create", ["interceptNextBoardCreation"]],
    ["workbench/display", ["controlNextThumbnail", "readCardCover", "readControlPresentation"]],
    [
      "workbench/import",
      ["chooseArchive", "failNextArchiveImport", "holdNextArchiveImport", "imageLoaded"],
    ],
    ["workbench/link", ["workbenchLinkProbe"]],
    ["whiteboard-basics/organization", ["workbenchLinkProbe"]],
    ["whiteboard-basics/objects", ["controlNextCanvasSave"]],
    [
      "whiteboard-basics/objects-media",
      ["chooseBoardMedia", "imageLoaded", "mediaDisplaySize", "mediaPlaying"],
    ],
    ["whiteboard-basics/persistence", ["controlNextCanvasSave", "enableCanvasClipboard"]],
    [
      "whiteboard-editing/html",
      ["embedFrame", "chooseHtmlFile", "controlNextHtmlSave", "workbenchLinkProbe"],
    ],
    [
      "whiteboard-editing/document",
      ["chooseDocumentImage", "readDocumentDownload", "failNextDocumentSave", "workbenchLinkProbe"],
    ],
    ["whiteboard-editing/todo", ["controlNextTodoSave", "workbenchLinkProbe"]],
    ["whiteboard-editing/rich-gestures", ["embedFrame", "workbenchLinkProbe"]],
    ["whiteboard-editing/organization", ["enableCanvasClipboard"]],
    ["whiteboard-editing/inline-editing", ["holdNextInlineTextRefresh", "holdNextInlineTextWrite"]],
    ["whiteboard-editing/reading-controls", ["readViewingInk", "workbenchLinkProbe"]],
    ["whiteboard-editing/zoom-visibility", ["readZoomDetails", "holdNextCanvasMove"]],
    [
      "whiteboard-editing/canvas-extras",
      ["workbenchLinkProbe", "readPeerCursors", "readPlacementPreview", "controlNextTextSave"],
    ],
    ["whiteboard-topbar/chrome", ["controlNextCanvasSave"]],
    ["whiteboard-topbar/history", ["failNextOlderVersions", "readBoardDownload"]],
    [
      "whiteboard-topbar/export",
      ["downloadBoardExport", "readBoardDownload", "failNextBoardExport"],
    ],
    [
      "whiteboard-topbar/sharing-feedback",
      ["workbenchLinkProbe", "mediaDisplaySize", "mediaPlaying"],
    ],
    ["whiteboard-topbar/overlays", ["seedTopbarSuggestion", "seedTopbarAgentWorkspace"]],
    ["whiteboard-topbar/export-fidelity", ["downloadBoardExport", "inspectBoardExport"]],
    ["whiteboard-topbar/scripted-export", ["downloadBoardExport", "inspectBoardExport"]],
    [
      "whiteboard-collaboration/presence",
      ["workbenchLinkProbe", "readPeerCursors", "readPlacementPreview", "setRoomConnectionOffline"],
    ],
    ["whiteboard-collaboration/geometry", ["workbenchLinkProbe"]],
    [
      "whiteboard-collaboration/content",
      [
        "workbenchLinkProbe",
        "embedFrame",
        "chooseHtmlFile",
        "chooseBoardMedia",
        "mediaDisplaySize",
        "mediaPlaying",
        "holdNextInlineTextWrite",
      ],
    ],
  ].map(([spec, helpers]) => [pathOfSpec(spec), new Set(helpers)]),
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
const downloadAccess = new Set(["createReadStream", "path", "saveAs"]);
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

function pathOfSpec(spec) {
  return fileURLToPath(new URL("../" + spec + ".spec.mjs", import.meta.url));
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

function variableInitializer(definition) {
  const { id, init } = definition.node;
  const call = unwrapped(init);
  if (id.type !== "ArrayPattern" || call?.type !== "CallExpression") {
    return init;
  }

  const { callee } = call;
  if (callee.type !== "MemberExpression") {
    return init;
  }

  const promiseAll = callee.object.name === "Promise" && propertyName(callee) === "all";
  const items = call.arguments[0];
  if (!promiseAll || items?.type !== "ArrayExpression") {
    return init;
  }

  const index = id.elements.indexOf(definition.name);
  return items.elements[index];
}

function isPage(source, receiver, visited = new Set()) {
  const node = unwrapped(receiver);
  if (node?.type === "CallExpression") {
    const callee = node.callee;
    if (callee.type !== "MemberExpression") {
      return false;
    }

    const method = propertyName(callee);
    const popup = method === "waitForEvent" && node.arguments[0]?.value === "popup";
    return pageFactories.has(method) || popup;
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

  return definition.type === "Variable" && isPage(source, variableInitializer(definition), visited);
}

function isBrowserCall(source, { callee }) {
  if (callee.type === "MemberExpression") {
    return browserFactories.has(propertyName(callee));
  }

  if (callee.type === "Identifier") {
    const definition = definitionOf(source, callee);
    return definition?.type === "ImportBinding" && definition.node.imported?.name === "embedFrame";
  }

  return false;
}

function isBrowserReceiver(source, receiver, visited = new Set()) {
  const node = unwrapped(receiver);
  if (isPage(source, node)) {
    return true;
  }
  if (node?.type === "CallExpression") {
    return isBrowserCall(source, node);
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

function isDownload(source, receiver, visited = new Set()) {
  const node = unwrapped(receiver);
  if (node?.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const listening = propertyName(node.callee) === "waitForEvent";
    return listening && node.arguments[0]?.value === "download";
  }
  if (node?.type !== "Identifier") {
    return false;
  }
  if (node.name === "download") {
    return true;
  }

  const definition = definitionOf(source, node);
  if (!definition || visited.has(definition)) {
    return false;
  }

  visited.add(definition);
  return (
    definition.type === "Variable" && isDownload(source, variableInitializer(definition), visited)
  );
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
      boardSeedMethods.has(propertyName(callee)) &&
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

function restrictedProperty(name, source, receiver) {
  if (testModes.has(name)) {
    return "testMode";
  }
  if (unsupportedSelectors.has(name)) {
    return "selector";
  }
  if (screenshotAccess.has(name)) {
    return "screenshot";
  }
  if (downloadAccess.has(name) && isDownload(source, receiver)) {
    return "download";
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
      return (
        fixtureImports.has(name) ||
        scopedFixtureImports.get(file)?.has(name) ||
        (name === "readCanvas" && whiteboardFixtureSpecs.has(file))
      );
    })
  );
}

const userFlowBoundary = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      fixture: "Import the test runner, assertions and evidence helper from ../support/studio.mjs.",
      fixtureMethod:
        "Call the declared whiteboard capability directly on the Studio fixture from its assigned scenario.",
      browserInternal:
        "Exercise the application through visible browser actions. Keep browser internals, network calls and local file selection in the fixture.",
      selector: "Locate controls with getByRole, getByText, getByLabel or getByTestId.",
      navigation: "Navigate using studio.url, a seeded board URL or browser history.",
      screenshot: "Attach screenshots with the screenshot helper from the Studio fixture.",
      download: "Inspect download bytes through the assigned Studio fixture helper.",
      testMode: "Run every declared scenario without only, skip, fixme or expected failure.",
      wait: "Wait for the visible result with an assertion.",
      computed: "Name the browser operation explicitly.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    const whiteboardScenario = whiteboardFixtureSpecs.has(context.physicalFilename);

    function inspectFixtureMethod(node, receiver, directCall, name) {
      const assignedScenario = scopedFixtureMethods.get(name);
      const assignedHere = !assignedScenario || assignedScenario === context.physicalFilename;
      const directStudioCall = directCall && isFixtureReference(source, receiver, "studio");
      if (!whiteboardScenario || !assignedHere || !directStudioCall) {
        context.report({ node, messageId: "fixtureMethod" });
      }
    }

    function inspectOperation(node, receiver) {
      const name = propertyName(node);
      const restricted = restrictedProperty(name, source, receiver);
      if (restricted) {
        context.report({ node, messageId: restricted });
        return;
      }

      const call = node.parent;
      const directCall = call.type === "CallExpression" && call.callee === node;
      if (whiteboardFixtureMethods.has(name)) {
        inspectFixtureMethod(node, receiver, directCall, name);
        return;
      }
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

      if (!node.computed || name !== undefined) {
        return;
      }

      const browserReceiver = isBrowserReceiver(source, receiver) || isDownload(source, receiver);
      if (browserReceiver || isFixtureReference(source, receiver, "studio")) {
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
