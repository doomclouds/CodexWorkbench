import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { fromBinary } = requireServer("@bufbuild/protobuf");
const { BoardEditService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/edits",
);
const { WhiteboardService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
);

function rpcUrl(origin, method) {
  return new URL("/" + method.parent.typeName + "/" + method.name, origin).href;
}

function readRequest(route, method) {
  const request = route.request();
  const bytes = request.postDataBuffer();
  if (request.method() === "POST" && bytes) {
    return fromBinary(method.input, bytes);
  }
}

export async function holdNextInlineTextWrite(page, studio, { boardId, objectId }) {
  const current = new URL(page.url());
  const initial = studio.edition === "initial";
  const queryKey = initial ? "artifactId" : "board";
  assert.equal(current.searchParams.get(queryKey), boardId);
  const origin = new URL(current.origin);
  assert.equal(origin.protocol, "http:");
  assert.equal(origin.hostname, "127.0.0.1");
  const write = BoardEditService.method.editObjectContent;
  const received = Promise.withResolvers();
  const release = Promise.withResolvers();
  const endpoint = initial
    ? new URL("/api/tools/artifact_apply", origin).href
    : rpcUrl(origin, write);
  let holding = false;
  await page.route(endpoint, async (route) => {
    if (holding || route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const request = initial ? readInitialTextWrite(route) : readRequest(route, write);
    if (request?.boardId !== boardId || request.objectId !== objectId) {
      await route.continue();
      return;
    }

    holding = true;
    received.resolve();
    await release.promise;
    await route.continue();
  });

  return { received: received.promise, release: release.resolve };
}

function readInitialTextWrite(route) {
  const body = route.request().postDataJSON();
  const operation = body?.operations?.[0];
  const writesText = operation?.op === "update" && typeof operation.changes?.text === "string";
  if (body?.summary === "编辑文字" && body.operations?.length === 1 && writesText) {
    return { boardId: body.artifactId, objectId: operation.id };
  }
}

export async function holdNextInlineTextRefresh(page, studio, { boardId, objectId }) {
  const origin = new URL(studio.url);
  assert.equal(origin.hostname, "127.0.0.1");
  assert.equal(studio.edition, "ii");
  const write = BoardEditService.method.editObjectContent;
  const read = WhiteboardService.method.getObjectPayloads;
  const saved = Promise.withResolvers();
  const refreshing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const replied = Promise.withResolvers();
  let holding = false;

  await page.route(rpcUrl(origin, read), async (route) => {
    const request = readRequest(route, read);
    if (holding && request?.boardId === boardId && request.objectIds.includes(objectId)) {
      refreshing.resolve();
      await release.promise;
    }

    await route.continue();
  });
  await page.route(rpcUrl(origin, write), async (route) => {
    const request = readRequest(route, write);
    if (holding || request?.boardId !== boardId || request?.objectId !== objectId) {
      await route.continue();
      return;
    }

    holding = true;
    try {
      const response = await route.fetch({ timeout: 8000, maxRedirects: 0 });
      const result = fromBinary(write.output, new Uint8Array(await response.body()));
      assert.equal(response.status(), 200);
      assert.equal(result.receipt?.outcome.case, "applied");
      saved.resolve();
      await release.promise;
      await route.fulfill({ response });
      replied.resolve();
    } catch (error) {
      saved.reject(error);
      await route.abort();
    }
  });

  async function waitForReply() {
    await replied.promise;
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  }

  return {
    saved: saved.promise,
    refreshing: refreshing.promise,
    release: release.resolve,
    waitForReply,
  };
}
