import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { fromBinary } = requireServer("@bufbuild/protobuf");
const { BoardEditService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/edits",
);
const { WhiteboardService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
);
const legacySummaries = {
  move: "移动元素",
  duplicate: "复制元素",
  create: "添加元素",
  embedSource: "保存 HTML 源码",
};
const legacy = {
  path: "/api/tools/artifact_apply",
  readRequest(request, action) {
    const body = request.postDataJSON();
    if (body?.summary !== legacySummaries[action]) {
      return;
    }

    return { boardId: body.artifactId, commandId: body.operationId };
  },
  async assertApplied(response, commandId, boardId) {
    const reply = await response.json();
    const data = reply.data;
    const compactReceipt = data?.operationId === commandId;
    const fullReceipt = data?.board?.artifact?.id === boardId && !!data.historyEntry?.id;
    if (reply.ok !== true || (!compactReceipt && !fullReceipt)) {
      throw new Error("The isolated initial-edition save was not confirmed.");
    }
  },
};

function modernContract(action) {
  const methods = {
    move: WhiteboardService.method.moveObjects,
    embedSource: BoardEditService.method.editObjectContent,
  };
  const method = methods[action] ?? BoardEditService.method.editBoardGeometry;

  return {
    path: "/" + method.parent.typeName + "/" + method.name,
    readRequest(request) {
      const body = fromBinary(method.input, request.postDataBuffer());
      const operation = action === "embedSource" ? body.edit : body.operation;
      if (action !== "move" && operation?.case !== action) {
        return;
      }

      return { boardId: body.boardId, commandId: body.commandId };
    },
    async assertApplied(response, commandId) {
      const reply = fromBinary(method.output, new Uint8Array(await response.body()));
      if (reply.receipt?.commandId !== commandId || reply.receipt.outcome.case !== "applied") {
        throw new Error("The isolated Studio II save was not confirmed.");
      }
    },
  };
}

export async function enableCanvasClipboard(page, studio) {
  const url = new URL(studio.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("Whiteboard clipboard permission requires the isolated loopback origin.");
  }

  const { origin } = url;
  const read = "readIsolatedCanvasClipboard";
  const write = "writeIsolatedCanvasClipboard";
  let contents = "";
  let reads = 0;
  function requireOrigin(frame) {
    if (new URL(frame.url()).origin !== origin) {
      throw new Error("The whiteboard clipboard is isolated to the test origin.");
    }
  }

  await page.exposeBinding(read, ({ frame }) => {
    requireOrigin(frame);
    reads += 1;

    return contents;
  });
  await page.exposeBinding(write, ({ frame }, value) => {
    requireOrigin(frame);
    if (typeof value !== "string") {
      throw new TypeError("The canvas clipboard requires text.");
    }

    contents = value;
  });
  await page.addInitScript(
    ({ origin, read, write }) => {
      if (location.origin === origin) {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: Object.freeze({
            readText: () => window[read](),
            writeText: (value) => window[write](value),
          }),
        });
      }
    },
    { origin, read, write },
  );

  return { reads: () => reads };
}

export async function controlNextCanvasSave(page, studio, { boardId, action, mode }) {
  if (!Object.hasOwn(legacySummaries, action) || !["before", "after", "hold"].includes(mode)) {
    throw new TypeError("Select a registered whiteboard mutation and test mode.");
  }
  if (typeof boardId !== "string" || !boardId) {
    throw new TypeError("A seeded board ID is required.");
  }

  const contract = studio.edition === "initial" ? legacy : modernContract(action);
  const url = new URL(contract.path, studio.url).href;
  const observed = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const commandIds = [];

  await page.route(url, async (route) => {
    const request = route.request();
    const mutation =
      request.method() === "POST" ? contract.readRequest(request, action) : undefined;

    if (mutation?.boardId !== boardId || typeof mutation.commandId !== "string") {
      await route.continue();
      return;
    }

    commandIds.push(mutation.commandId);
    if (commandIds.length > 1) {
      await route.continue();
      return;
    }

    try {
      if (mode === "before") {
        await route.abort();
        observed.resolve();
        return;
      }

      const response = await route.fetch({ maxRedirects: 0, timeout: 8_000 });
      if (!response.ok()) {
        throw new Error("The real whiteboard save returned HTTP " + response.status() + ".");
      }

      await contract.assertApplied(response, mutation.commandId, mutation.boardId);
      observed.resolve();
      if (mode === "after") {
        await route.abort();
        return;
      }

      await release.promise;
      await route.fulfill({ response });
    } catch (error) {
      observed.reject(error);
      if (!page.isClosed()) {
        await route.abort();
      }

      throw error;
    } finally {
      finished.resolve();
    }
  });

  return {
    observed: observed.promise,
    finished: finished.promise,
    release: release.resolve,
    requests: () => [...commandIds],
  };
}

function requestedTextSave(request, edition, method) {
  if (edition === "initial") {
    const body = request.postDataJSON();
    const operation = body?.operations?.[0];
    const updatesText = operation?.op === "update" && typeof operation.changes?.text === "string";
    if (body?.summary === "编辑文字" && body.operations?.length === 1 && updatesText) {
      return { boardId: body.artifactId, objectId: operation.id };
    }

    return;
  }

  const body = fromBinary(method.input, request.postDataBuffer());
  if (body.edit.case === "text") {
    return { boardId: body.boardId, objectId: body.objectId };
  }
}

export async function controlNextTextSave(page, studio, { boardId, objectId }) {
  const hasBoard = typeof boardId === "string" && boardId !== "";
  const hasObject = typeof objectId === "string" && objectId !== "";
  if (!hasBoard || !hasObject) {
    throw new TypeError("A seeded board and text object are required.");
  }

  const origin = new URL(studio.url);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new Error("Text save injection requires the isolated loopback origin.");
  }

  const method = BoardEditService.method.editObjectContent;
  const path =
    studio.edition === "initial" ? legacy.path : `/${method.parent.typeName}/${method.name}`;
  const observed = Promise.withResolvers();
  let blocked = false;

  await page.route(new URL(path, origin).href, async (route) => {
    const request = route.request();
    const save =
      !blocked && request.method() === "POST"
        ? requestedTextSave(request, studio.edition, method)
        : undefined;

    if (save?.boardId !== boardId || save.objectId !== objectId) {
      await route.continue();
      return;
    }

    blocked = true;
    await route.abort();

    observed.resolve();
  });

  return { observed: observed.promise };
}

export function holdNextCanvasMove(page, studio, boardId) {
  return controlNextCanvasSave(page, studio, { boardId, action: "move", mode: "hold" });
}
