import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createIiFixtureProtocol } from "../../e2e/support/boards.mjs";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { create, fromBinary, toBinary } = requireServer("@bufbuild/protobuf");
const { BoardEditService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/edits",
);
const { BoardHistoryService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/history",
);
const { WhiteboardService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
);
const initialPath = "/api/tools/artifact_apply";

function initialOperation(work) {
  if (work.kind === "add") {
    const { id, label, geometry, fill } = work.shape;
    const { x, y, width: w, height: h } = geometry;

    return {
      op: "add",
      element: { id, type: "shape", kind: "rounded", text: label, x, y, w, h, fill },
    };
  }

  const changes =
    work.kind === "move"
      ? { x: work.object.x + work.dx, y: work.object.y + (work.dy ?? 0) }
      : { text: work.text };

  return { op: "update", id: work.object.id, changes };
}

function initialWrite({ boardId, commandId, revision, work }) {
  const addressed =
    work.kind === "add"
      ? { expectedRevision: revision }
      : { expectedVersions: { [work.object.id]: work.object.version } };

  return JSON.stringify({
    artifactId: boardId,
    operationId: commandId,
    merge: "safe",
    receiptFormat: "units-v1",
    ...addressed,
    operations: [initialOperation(work)],
    summary: `性能基准 ${work.kind}`,
  });
}

function textEdit(command, work) {
  return {
    ...command,
    objectId: work.object.id,
    expectedPayloadVersion: BigInt(work.object.payloadVersion),
    edit: { case: "text", value: { text: work.text } },
  };
}

function shapeEdit(command, { shape }) {
  const { id: objectId, label, geometry, fill } = shape;

  return {
    ...command,
    operation: {
      case: "create",
      value: {
        object: {
          objectId,
          kind: "shape",
          label,
          geometry,
          appearance: { fill },
          geometryDetail: { case: "shape", value: { outline: "rounded" } },
        },
        initialPayload: { objectId, body: { case: "text", value: { text: label } } },
      },
    },
  };
}

function moveEdit(command, { object, dx, dy = 0 }) {
  return {
    ...command,
    delta: { dx, dy },
    targets: [{ objectId: object.id, expectedGeometryVersion: BigInt(object.geometryVersion) }],
  };
}

const iiWrites = {
  move: [WhiteboardService.method.moveObjects, moveEdit],
  text: [BoardEditService.method.editObjectContent, textEdit],
  add: [BoardEditService.method.editBoardGeometry, shapeEdit],
};

async function post(runtime, path, contentType, body, signal) {
  return runtime.request(path, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    signal,
  });
}

async function timedInitialWrite(runtime, input, signal) {
  const body = initialWrite(input);
  const started = performance.now();
  const response = await post(runtime, initialPath, "application/json", body, signal);
  const raw = await response.text();
  const reply = JSON.parse(raw);
  const ms = performance.now() - started;
  assert.ok(
    response.ok && reply.ok,
    `HTTP ${response.status}: ${reply.error?.message ?? "write failed"}`,
  );
  const artifact = reply.data?.artifact ?? reply.data?.board?.artifact;
  const revision = artifact?.revision;
  assert.equal(artifact?.id, input.boardId);
  assert.equal(revision, input.revision + 1, "Expected the next committed board revision.");

  return {
    ms,
    revision,
    requestBytes: Buffer.byteLength(body),
    responseBytes: Buffer.byteLength(raw),
  };
}

async function timedIiWrite(runtime, input, signal) {
  const { boardId, commandId, work } = input;
  const [method, prepare] = iiWrites[work.kind];
  const path = `/${method.parent.typeName}/${method.name}`;
  const body = toBinary(method.input, create(method.input, prepare({ boardId, commandId }, work)));
  const started = performance.now();
  const response = await post(runtime, path, "application/protobuf", body, signal);
  const raw = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status, 200, path);
  const { receipt } = fromBinary(method.output, raw);
  const ms = performance.now() - started;
  assert.equal(receipt?.boardId, boardId);
  assert.equal(receipt.commandId, commandId);
  const { outcome } = receipt;
  assert.equal(
    outcome.case,
    "applied",
    `${path} returned ${outcome.case}: ${outcome.value?.reason ?? ""}`,
  );
  const revision = Number(outcome.value.boardRevision);
  assert.equal(revision, input.revision + 1, "Expected the next committed board revision.");

  return { ms, revision, requestBytes: body.byteLength, responseBytes: raw.byteLength };
}

async function initialVersions(runtime, boardId, signal) {
  const body = JSON.stringify({ artifactId: boardId, mode: "history" });
  const response = await post(
    runtime,
    "/api/tools/artifact_read",
    "application/json",
    body,
    signal,
  );
  const reply = await response.json();
  assert.ok(response.ok && reply.ok, "Expected the initial Studio board versions.");

  return reply.data.history.map(({ revision }) => revision).reverse();
}

async function iiVersions(runtime, boardId, signal) {
  const { call } = createIiFixtureProtocol(runtime);
  const versions = [];
  let beforeRevision;
  do {
    signal.throwIfAborted();
    const response = await call(BoardHistoryService.method.listBoardVersions, {
      boardId,
      beforeRevision,
      limit: 50,
    });
    versions.push(...response.versions.map(({ revision }) => Number(revision)));
    beforeRevision = response.nextBeforeRevision;
  } while (beforeRevision !== undefined);

  return versions;
}

export function createRetainedTransport(edition, runtime, signal) {
  const initial = edition === "initial";

  return {
    write: (input) => (initial ? timedInitialWrite : timedIiWrite)(runtime, input, signal),
    versions: (boardId) => (initial ? initialVersions : iiVersions)(runtime, boardId, signal),
  };
}
