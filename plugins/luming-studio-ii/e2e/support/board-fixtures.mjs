import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { materializeBoardAssets } from "./board-fixture-assets.mjs";
import {
  createIiContentReader,
  initialContent,
  portableContent,
} from "./board-fixture-content.mjs";
import { mixedBoard } from "./board-fixture-presets.mjs";
import { createIiFixtureProtocol, initialPost } from "./boards.mjs";

const requireInitial = createRequire(
  new URL("../../../luming-studio/package.json", import.meta.url),
);
const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { zipSync, strToU8 } = requireInitial("fflate");
const zipType = "application/zip";
const ports = [undefined, "top", "bottom", "left", "right"];
const connectorHeads = [undefined, "none", "arrow", "circle"];
const legacyTypes = new Map([
  ["section", "container"],
  ["connector", "arrow"],
  ["ink", "stroke"],
]);
const nativeKinds = new Map([...legacyTypes].map(([kind, type]) => [type, kind]));
const defaultBoard = {
  title: "基础白板",
  objects: [
    {
      id: "section-transparent",
      kind: "section",
      label: "透明分区",
      x: 450,
      y: 100,
      width: 300,
      height: 240,
      transparent: true,
    },
    { id: "shape-a", kind: "shape", label: "A", x: 120, y: 120, width: 160, height: 100 },
    { id: "shape-b", kind: "shape", label: "B", x: 210, y: 155, width: 160, height: 100 },
    { id: "shape-c", kind: "shape", label: "C", x: 500, y: 150, width: 160, height: 100 },
    {
      id: "connector-ab",
      kind: "connector",
      label: "",
      x: 210,
      y: 170,
      width: 70,
      height: 35,
      start: { objectId: "shape-a", port: "right" },
      end: { objectId: "shape-b", port: "left" },
    },
  ],
};
const style = {
  name: "Diagram",
  paper: "#f5f5f5",
  ink: "#2d3142",
  muted: "#4f5d75",
  accent: "#eb6c36",
  link: "#2e5aa8",
  fontFamily: "Arial, sans-serif",
  titleFont: "Georgia, serif",
  monoFont: "Consolas, monospace",
};

function portableEndpoint(endpoint) {
  if (!endpoint) {
    return;
  }
  if (endpoint.objectId) {
    return endpoint.objectId;
  }

  return [endpoint.x, endpoint.y];
}

function portableObject(object, sourceBoardId) {
  const {
    id,
    kind,
    label,
    x,
    y,
    width,
    height,
    rotation,
    locked,
    groupId,
    parentId,
    fill,
    stroke,
    strokeWidth,
    transparent,
    outline,
    start,
    end,
    heads,
    bends,
  } = object;
  const section = kind === "section";
  const connector = kind === "connector";
  const shape = kind === "shape";
  const video = kind === "video";
  const common = {
    id,
    x,
    y,
    w: width,
    h: height,
    rotation,
    locked,
    parentId,
    groupId,
    stroke,
    strokeWidth,
    type: video ? "image" : (legacyTypes.get(kind) ?? kind),
    version: 1,
    text: label,
    fill: transparent ? "transparent" : fill,
    hollow: section ? transparent : undefined,
    kind: shape ? (outline ?? "rounded") : undefined,
    ...portableContent(object, sourceBoardId),
  };

  return connector
    ? {
        ...common,
        label,
        from: portableEndpoint(start),
        fromSide: start?.port,
        to: portableEndpoint(end),
        toSide: end?.port,
        heads: [heads?.start ?? "none", heads?.end ?? "arrow"],
        bends,
      }
    : common;
}

function archiveValue(value) {
  if (Array.isArray(value)) {
    return { array: value.map(archiveValue) };
  }
  if (value && typeof value === "object") {
    return {
      object: Object.entries(value).flatMap(([key, field]) =>
        field === undefined ? [] : [[key, archiveValue(field)]],
      ),
    };
  }

  return value;
}

const boardPresets = new Map([
  ["basic", defaultBoard],
  ["mixed", mixedBoard],
]);

async function boardArchive(preset) {
  const { title, objects: descriptors } = boardPresets.get(preset) ?? preset;
  const artifactId = "basic-whiteboard-e2e";
  const { objects, entries, index: assets } = await materializeBoardAssets(descriptors, artifactId);
  const date = "2026-01-01T00:00:00.000Z";
  const artifact = {
    id: artifactId,
    title,
    type: "whiteboard",
    revision: 0,
    createdAt: date,
    updatedAt: date,
    pinned: false,
    sharing: false,
  };
  const entry = {
    id: "creation",
    actor: { id: "fixture-owner", name: "Fixture owner", kind: "human", role: "owner" },
    revision: 0,
    createdAt: date,
    changedIds: objects.map(({ id }) => id),
    summary: "Create synthetic board",
  };
  const properties = {
    schemaVersion: 2,
    feedback: [],
    sources: {},
    operations: [],
    assets,
    sharing: { enabled: false, generation: 0, tokens: {} },
  };
  const payloads = [
    entry,
    artifact,
    { style },
    ...objects.map((object) => portableObject(object, artifactId)),
  ];
  const index = [["artifact", 1]];
  for (const [field, value] of Object.entries(properties)) {
    index.push([field, payloads.length]);
    payloads.push(value);
  }

  const header = {
    version: 2,
    history: [[0, 1, 0]],
    current: 0,
    properties: index,
    lengths: [0, payloads.length, 1],
  };
  const content = { fields: 2, units: objects.map((_object, index) => index + 3) };
  const records = [header, ...payloads.map(archiveValue), content].map((record) =>
    JSON.stringify(record),
  );
  const state = "artifact-deltas.ndjson";
  const manifest = { format: "luming-studio-archive", version: 4, artifactId, state };

  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    [state]: strToU8(records.join("\n") + "\n"),
    ...entries,
  });
}

function initialEndpoint(value, port) {
  if (typeof value === "string") {
    return { objectId: value, port };
  }

  if (Array.isArray(value)) {
    const [x, y] = value;

    return { x, y };
  }
}

function initialConnector({ from, fromSide, to, toSide, heads, head, bends }) {
  return {
    start: initialEndpoint(from, fromSide),
    end: initialEndpoint(to, toSide),
    heads: {
      start: heads?.[0] ?? (head === "both" ? "arrow" : "none"),
      end: heads?.[1] ?? (head === "none" ? "none" : "arrow"),
    },
    bends: bends ?? [],
  };
}

function initialObject(object) {
  const {
    id,
    type,
    x,
    y,
    w,
    h,
    rotation,
    locked,
    groupId,
    parentId,
    text,
    label,
    fill,
    hollow,
    stroke,
    strokeWidth,
    version,
    kind: outline,
  } = object;
  const video = type === "image" && typeof object.video === "string";
  const kind = video ? "video" : (nativeKinds.get(type) ?? type);
  return {
    id,
    kind,
    x,
    y,
    width: w,
    height: h,
    rotation: rotation ?? 0,
    locked: locked ?? false,
    groupId,
    parentId,
    label: label ?? text ?? "",
    text: label ?? text ?? "",
    fill,
    stroke,
    strokeWidth,
    version,
    geometryVersion: version,
    payloadVersion: version,
    outline: kind === "shape" ? outline : undefined,
    transparent: kind === "section" ? Boolean(hollow || fill === "transparent") : undefined,
    ...(kind === "connector" && initialConnector(object)),
    ...initialContent(object, kind),
  };
}

function iiEndpoint(endpoint) {
  const { attachment, point } = endpoint ?? {};
  if (attachment) {
    return { objectId: attachment.objectId, port: ports[attachment.port] };
  }
  if (point) {
    return { x: point.x, y: point.y };
  }
}

function iiConnector({ start, end, startHead, endHead, bends, relativeBends }) {
  return {
    start: iiEndpoint(start),
    end: iiEndpoint(end),
    heads: {
      start: connectorHeads[startHead] ?? "none",
      end: connectorHeads[endHead] ?? "arrow",
    },
    bends: relativeBends
      ? [relativeBends.firstAxis === 2 ? "v" : "h", ...relativeBends.offsets]
      : bends.flatMap(({ x, y }) => [x, y]),
  };
}

function iiObject(object, payload, content) {
  const { objectId: id, kind, label, geometry, locked, parentId, groupId, geometryDetail } = object;
  const { x, y, width, height, rotation } = geometry;
  const { fill, stroke, strokeWidth } = object.appearance ?? {};
  const outline = geometryDetail.case === "shape" ? geometryDetail.value.outline : undefined;
  const transparent =
    geometryDetail.case === "section" ? geometryDetail.value.transparent : undefined;

  return {
    id,
    kind,
    label,
    x,
    y,
    width,
    height,
    rotation,
    locked,
    parentId,
    groupId,
    fill,
    stroke,
    strokeWidth,
    version: Number(object.payloadVersion ?? object.geometryVersion),
    geometryVersion: Number(object.geometryVersion),
    payloadVersion: object.payloadVersion === undefined ? undefined : Number(object.payloadVersion),
    outline,
    transparent,
    text: payload?.body.case === "text" ? payload.body.value.text : label,
    ...(geometryDetail.case === "connector" && iiConnector(geometryDetail.value)),
    ...content(payload, geometry),
  };
}

function initialBoardFixtures(runtime) {
  let session;
  function readSession() {
    session ??= runtime.request("/api/session", { method: "GET" }).then(async (response) => {
      assert.equal(response.status, 200, "Expected the isolated Studio session.");
      return response.json();
    });

    return session;
  }

  return {
    async importBoard(archive) {
      const { artifact } = await initialPost(runtime, "/api/import", zipType, archive);
      return { id: artifact.id, title: artifact.title };
    },
    async readBoard({ id }) {
      const [{ artifact, elements }, { actor }] = await Promise.all([
        initialPost(
          runtime,
          "/api/tools/artifact_read",
          "application/json",
          JSON.stringify({ artifactId: id, mode: "board" }),
        ),
        readSession(),
      ]);
      assert.equal(artifact.id, id);
      assert.ok(Array.isArray(elements), "Expected the saved whiteboard projection.");
      const trashed = Boolean(artifact.trashedAt);
      const canEdit = !trashed && (actor.role === "owner" || actor.role === "editor");

      return {
        title: artifact.title,
        revision: artifact.revision,
        access: { canEdit, trashed },
        objects: elements.map(initialObject),
      };
    },
  };
}

function iiBoardFixtures(runtime) {
  const { BoardArchiveService, ImportBoardArchiveResponseSchema } = requireServer(
    "@codexworkbench/luming-studio-ii-contracts/archives/service",
  );
  const { ObjectPayloadUnavailableReason, WhiteboardService } = requireServer(
    "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
  );
  const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
  const { post, call, outcome } = createIiFixtureProtocol(runtime);
  const content = createIiContentReader();
  async function readPayloads(boardId, objects) {
    const requested = objects.filter(({ payloadVersion }) => payloadVersion !== undefined);
    const payloads = new Map();
    if (!requested.length) {
      return payloads;
    }

    const objectIds = requested.map(({ objectId }) => objectId);
    const { results } = await call(getObjectPayloads, { boardId, objectIds });
    const received = new Map(results.map(({ objectId, result }) => [objectId, result]));
    for (const { objectId, payloadVersion } of requested) {
      const result = received.get(objectId);
      if (result?.case === "payload" && result.value.payloadVersion === payloadVersion) {
        payloads.set(objectId, result.value);
        continue;
      }
      const unsupported =
        result?.case === "unavailable" &&
        result.value.reason === ObjectPayloadUnavailableReason.UNSUPPORTED_KIND;

      if (!unsupported) {
        return undefined;
      }
    }

    return payloads;
  }

  async function readSnapshot(boardId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { scene } = await call(getBoardScene, { boardId });
      assert.equal(scene?.boardId, boardId, "Expected the saved whiteboard scene.");
      assert.notEqual(scene.boardRevision, undefined, "Expected the saved whiteboard revision.");
      const payloads = await readPayloads(boardId, scene.objects);
      if (payloads) {
        return { scene, payloads };
      }
    }

    throw new Error("The synthetic board changed while reading its saved content.");
  }

  return {
    async importBoard(archive) {
      const result = await post(
        `/${BoardArchiveService.typeName}/ImportBoardArchive`,
        ImportBoardArchiveResponseSchema,
        zipType,
        archive,
        { "x-studio-command-id": randomUUID() },
      );
      const { boardId, title } = outcome(result, "imported");
      return { id: boardId, title };
    },
    async readBoard({ id: boardId }) {
      const { scene, payloads } = await readSnapshot(boardId);
      const revision = Number(scene.boardRevision);
      assert.ok(
        Number.isSafeInteger(revision),
        "Expected a safe revision for the synthetic board.",
      );

      return {
        title: scene.title,
        revision,
        access: { canEdit: scene.access?.canEdit, trashed: scene.access?.trashed },
        objects: scene.objects.map((object) =>
          iiObject(object, payloads.get(object.objectId), content),
        ),
      };
    },
  };
}

export function createBoardFixtures(edition, runtime) {
  const { importBoard, readBoard } =
    edition === "initial" ? initialBoardFixtures(runtime) : iiBoardFixtures(runtime);

  return {
    async seedBasicBoard(preset = "basic") {
      const board = await importBoard(await boardArchive(preset));
      const url = new URL(runtime.url);
      url.searchParams.set(edition === "initial" ? "artifactId" : "board", board.id);

      return { ...board, url: url.href };
    },
    readBoard(board) {
      return readBoard(typeof board === "string" ? { id: board } : board);
    },
  };
}
