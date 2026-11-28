import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createBoardFixtures } from "./board-fixtures.mjs";
import { createIiFixtureProtocol } from "./boards.mjs";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { fromBinary } = requireServer("@bufbuild/protobuf");
const { BoardHistoryService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/history",
);
const { WhiteboardService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
);
const step = 12;

async function moveInitial(runtime, board, object) {
  const command = {
    artifactId: board.id,
    operationId: randomUUID(),
    expectedVersions: { [object.id]: object.version },
    operations: [{ op: "update", id: object.id, changes: { x: object.x + step } }],
    summary: "移动元素",
  };
  const response = await runtime.request("/api/tools/artifact_apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const reply = await response.json();
  assert.ok(response.ok && reply.ok, "Seeded initial-edition movement must apply.");
}

async function moveCurrent(call, board, object) {
  const { receipt } = await call(WhiteboardService.method.moveObjects, {
    boardId: board.id,
    commandId: randomUUID(),
    delta: { dx: step, dy: 0 },
    targets: [{ objectId: object.id, expectedGeometryVersion: BigInt(object.geometryVersion) }],
  });
  assert.equal(receipt?.outcome.case, "applied", "Seeded Studio II movement must apply.");
}

export async function recordVersionMoves(runtime, edition, board, count) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 36, "Invalid history fixture size.");
  const { readBoard } = createBoardFixtures(edition, runtime);
  const { call } = createIiFixtureProtocol(runtime);
  let snapshot = await readBoard(board);
  const objectId = snapshot.objects[0]?.id;
  assert.ok(objectId, "Expected a board with a movable fixture object.");
  const records = [];
  for (let index = 0; index < count; index++) {
    const object = snapshot.objects.find(({ id }) => id === objectId);
    assert.ok(object && !object.locked, "The fixture object must remain available to move.");
    if (edition === "initial") {
      await moveInitial(runtime, board, object);
    } else {
      await moveCurrent(call, board, object);
    }

    const next = await readBoard(board);
    assert.ok(next.revision > snapshot.revision, "A fixture edit must create a saved version.");
    const moved = next.objects.find(({ id }) => id === objectId);
    assert.equal(moved?.x, object.x + step);
    records.push({ revision: next.revision, x: moved.x });
    snapshot = next;
  }

  return records;
}

export async function failNextOlderVersions(page, studio, board) {
  const origin = new URL(studio.url);
  assert.equal(origin.hostname, "127.0.0.1");
  assert.equal(studio.edition, "ii");
  const method = BoardHistoryService.method.listBoardVersions;
  const url = new URL("/" + method.parent.typeName + "/" + method.name, origin).href;
  let failed = false;
  await page.route(url, async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    if (!failed && body && request.method() === "POST") {
      const args = fromBinary(method.input, body);
      if (args.boardId === board.id && args.beforeRevision !== undefined) {
        failed = true;
        await route.abort();
        return;
      }
    }

    await route.continue();
  });
}
