import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixturePng } from "../e2e/support/board-fixture-assets.mjs";
import { createBoardFixtures, encodeFixtureBoardArchive } from "../e2e/support/board-fixtures.mjs";

const profiles = {
  small: { objects: 100, columns: 10 },
  near: { objects: 2_000, columns: 50 },
};
const sourceBoardId = "benchmark-board-fixture";
const assetId = "benchmark-image";
const targetId = "benchmark-drag-target";
const targetLabel = "基准测试拖动目标";
export const retainedTextId = "benchmark-0006";
const target = {
  id: targetId,
  kind: "shape",
  label: targetLabel,
  x: -150,
  y: -64,
  width: 300,
  height: 128,
  fill: "#f4a56f",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cellOrigin(i, dimension, pitch, gutter) {
  const offset = i - dimension / 2;

  return offset * pitch + (offset < 0 ? -gutter : gutter);
}

function fixtureObject(profile, index) {
  const id = `benchmark-${String(index).padStart(4, "0")}`;
  const x = cellOrigin(index % profile.columns, profile.columns, 176, 220);
  const y = cellOrigin(
    Math.floor(index / profile.columns),
    profile.objects / profile.columns,
    144,
    122,
  );
  const geometry = { id, x, y, width: 146, height: 108 };

  switch (index % 20) {
    case 1:
      return {
        ...geometry,
        kind: "html",
        label: `HTML ${index}`,
        html: '<main style="padding:8px"><strong>合成网页</strong><p>白板正文</p></main>',
      };
    case 2:
      return {
        ...geometry,
        kind: "document",
        label: `文档 ${index}`,
        document: {
          schemaVersion: 1,
          blocks: [{ id: "paragraph", type: "paragraph", content: `基准文档正文 ${index}` }],
        },
      };
    case 3:
      return {
        ...geometry,
        kind: "todo",
        label: `待办 ${index}`,
        items: [
          { id: "first", text: "准备白板", checked: true },
          { id: "second", text: "核对数据", checked: false },
        ],
      };
    case 4:
      return {
        ...geometry,
        kind: "image",
        label: `图片 ${index}`,
        src: `/assets/${sourceBoardId}/${assetId}`,
        naturalSize: { width: 2, height: 3 },
      };
    case 5:
      return {
        ...geometry,
        kind: "connector",
        label: "",
        start: { x, y },
        end: { x: x + geometry.width, y: y + geometry.height },
      };
    case 6:
    case 7:
      return { ...geometry, kind: "text", label: `基准文本 ${index}` };
    default:
      return { ...geometry, kind: "shape", label: `形状 ${index}`, fill: "#d8eaf4" };
  }
}

function boardObjects(profile) {
  assert.ok(Object.hasOwn(profiles, profile), `Unknown benchmark fixture profile: ${profile}`);
  const configuration = profiles[profile];

  return [
    target,
    ...Array.from({ length: configuration.objects - 1 }, (_item, i) =>
      fixtureObject(configuration, i + 1),
    ),
  ];
}

function geometryOf({ id, kind, x, y, width, height, rotation = 0 }) {
  return { id, kind, x, y, width, height, rotation };
}

function geometrySha256(objects) {
  return sha256(JSON.stringify(objects.map(geometryOf)));
}

function countKinds(objects) {
  const counts = new Map();
  for (const { kind } of objects) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
}

function worldBounds(objects) {
  return {
    left: Math.min(...objects.map(({ x }) => x)),
    top: Math.min(...objects.map(({ y }) => y)),
    right: Math.max(...objects.map(({ x, width }) => x + width)),
    bottom: Math.max(...objects.map(({ y, height }) => y + height)),
  };
}

export function makeBenchmarkFixture(profile) {
  const objects = boardObjects(profile);
  const bytes = fixturePng();
  const title = `性能基准 · ${objects.length} 对象`;
  const archive = encodeFixtureBoardArchive({
    title,
    artifactId: sourceBoardId,
    objects,
    entries: { [`assets/${assetId}`]: bytes },
    index: {
      [assetId]: {
        id: assetId,
        filename: "benchmark.png",
        mimeType: "image/png",
        size: bytes.length,
      },
    },
  });

  return {
    profile,
    title,
    objects: objects.length,
    targetId,
    targetLabel,
    archiveSha256: sha256(archive),
    archiveBytes: archive.byteLength,
    archive,
    geometrySha256: geometrySha256(objects),
    objectKinds: countKinds(objects),
    worldBounds: worldBounds(objects),
    historyVersions: 1,
    imageSha256: sha256(bytes),
    imageBytes: bytes.length,
  };
}

function contentOf(object) {
  switch (object.kind) {
    case "html":
      return object.html;
    case "document":
      return object.document.blocks.map(({ id, type, content }) => ({ id, type, content }));
    case "todo":
      return object.items.map(({ id, text, checked }) => ({ id, text, checked }));
    case "connector":
      return { start: object.start, end: object.end };
    case "image":
      return object.naturalSize;
    default:
      return object.text ?? object.label;
  }
}

async function verifyImage(runtime, image, fixture) {
  assert.ok(image.src?.startsWith("/"), "Expected a local imported PNG asset.");
  const response = await runtime.request(image.src);
  assert.equal(response.status, 200, "The imported PNG must be readable.");
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.byteLength, fixture.imageBytes);
  assert.equal(sha256(bytes), fixture.imageSha256);

  return { bytes: bytes.byteLength, sha256: fixture.imageSha256 };
}

function verifyGeometry(seed, saved) {
  assert.equal(saved.objects.length, seed.length);
  const byId = new Map(saved.objects.map((object) => [object.id, object]));
  assert.equal(byId.size, seed.length, "Imported board has duplicate object IDs.");
  const persisted = seed.map((object) => {
    const imported = byId.get(object.id);
    assert.ok(imported, `Missing imported object ${object.id}.`);
    assert.deepEqual(geometryOf(imported), geometryOf(object), `Geometry of ${object.id}.`);

    return imported;
  });

  return { byId, hash: geometrySha256(persisted) };
}

async function verifyContent(runtime, seed, byId, fixture) {
  const content = {};
  let image;
  for (const expected of seed) {
    const saved = byId.get(expected.id);
    const value = contentOf(saved);
    assert.notEqual(value, undefined, `Missing imported ${expected.kind} content.`);
    assert.deepEqual(value, contentOf(expected), `Content of ${expected.id}.`);
    const encoded = JSON.stringify(value);
    content[expected.kind] = {
      id: expected.id,
      bytes: Buffer.byteLength(encoded),
      sha256: sha256(encoded),
    };

    if (expected.kind === "image") {
      image = await verifyImage(runtime, saved, fixture);
    }
  }

  return { content, image };
}

export async function seedBenchmarkBoard(edition, runtime, fixture) {
  assert.equal(sha256(fixture.archive), fixture.archiveSha256, "The benchmark archive changed.");
  const boards = createBoardFixtures(edition, runtime);
  const board = await boards.seedArchive(fixture.archive);
  const seed = boardObjects(fixture.profile);
  const seen = new Set();
  const samples = seed.filter(({ kind }) => {
    if (seen.has(kind)) {
      return false;
    }

    seen.add(kind);

    return true;
  });
  const saved = await boards.readBoard(board, new Set(samples.map(({ id }) => id)));
  assert.equal(saved.title, fixture.title);
  assert.ok(saved.access.canEdit && !saved.access.trashed, "The imported board must be editable.");
  const { byId, hash } = verifyGeometry(seed, saved);
  assert.equal(hash, fixture.geometrySha256);
  const { content, image } = await verifyContent(runtime, samples, byId, fixture);

  return {
    ...board,
    targetId: fixture.targetId,
    targetLabel: fixture.targetLabel,
    verification: {
      initialRevision: saved.revision,
      objects: saved.objects.length,
      objectKinds: countKinds(saved.objects),
      geometrySha256: hash,
      content,
      image,
    },
    readTarget: () => boards.readPosition(board, fixture.targetId),
  };
}
