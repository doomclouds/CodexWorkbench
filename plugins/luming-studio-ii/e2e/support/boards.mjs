import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const archiveFixture = new URL(
  "../../apps/server/tests/fixtures/archives/legacy-v4.studio.zip",
  import.meta.url,
);
const fixtureContent = { contentText: "发布准备", contentImage: "发布指标样例" };
const zipType = "application/zip";

export async function initialPost(runtime, path, type, body) {
  const response = await runtime.request(path, {
    method: "POST",
    headers: { "content-type": type },
    body,
  });
  const result = await response.json();
  assert.ok(response.ok && result.ok, `${path}: ${response.status} ${result.error?.message ?? ""}`);
  assert.ok(result.data?.artifact?.id, `${path}: missing artifact`);
  return result.data;
}

async function seedInitialBoard(runtime, { title, pinned, trashed }, archive) {
  async function manage(arguments_) {
    const { artifact } = await initialPost(
      runtime,
      "/api/tools/artifact_manage",
      "application/json",
      JSON.stringify(arguments_),
    );

    return artifact;
  }

  let artifact = archive
    ? (await initialPost(runtime, "/api/import", zipType, archive)).artifact
    : await manage({ action: "create", type: "whiteboard", title });

  function change(action, value) {
    return manage({
      action,
      artifactId: artifact.id,
      expectedRevision: artifact.revision,
      ...value,
    });
  }

  if (archive) {
    artifact = await change("rename", { title });
  }
  if (pinned) {
    artifact = await change("pin", { pinned: true });
  }
  if (trashed) {
    artifact = await change("trash");
  }
  return { id: artifact.id, title: artifact.title };
}

export function createIiFixtureProtocol(runtime) {
  const { create, fromBinary, toBinary } = requireServer("@bufbuild/protobuf");

  async function post(path, output, type, body, headers) {
    const response = await runtime.request(path, {
      method: "POST",
      headers: { "content-type": type, ...headers },
      body,
    });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), "application/protobuf", path);
    return fromBinary(output, new Uint8Array(await response.arrayBuffer()));
  }

  function call(method, input) {
    return post(
      `/${method.parent.typeName}/${method.name}`,
      method.output,
      "application/protobuf",
      toBinary(method.input, create(method.input, input)),
    );
  }

  function outcome(response, expected) {
    const receipt = response.receipt?.outcome;
    assert.equal(
      receipt?.case,
      expected,
      `Catalog receipt rejection ${receipt?.value?.reason ?? ""}`,
    );

    return receipt.value;
  }

  return { post, call, outcome };
}

function iiSeeder(runtime) {
  const { BoardCatalogService, BoardLifecycleAction, BoardSortOrder } = requireServer(
    "@codexworkbench/luming-studio-ii-contracts/catalog/service",
  );
  const { BoardArchiveService, ImportBoardArchiveResponseSchema } = requireServer(
    "@codexworkbench/luming-studio-ii-contracts/archives/service",
  );
  const { createBoard, listBoards, manageBoard } = BoardCatalogService.method;
  const { post, call, outcome } = createIiFixtureProtocol(runtime);

  async function importBoard(archive) {
    const imported = await post(
      `/${BoardArchiveService.typeName}/ImportBoardArchive`,
      ImportBoardArchiveResponseSchema,
      zipType,
      archive,
      { "x-studio-command-id": randomUUID() },
    );
    const { boardId, title } = outcome(imported, "imported");
    let cursor;
    do {
      const result = await call(listBoards, {
        query: title,
        order: BoardSortOrder.TITLE,
        pageSize: 100,
        cursor,
      });
      const board = result.boards.find((entry) => entry.boardId === boardId);
      if (board) {
        return board;
      }

      cursor = result.nextCursor;
    } while (cursor);
    throw new Error(`Imported board ${boardId} was missing from the catalogue`);
  }

  return async function seedBoard({ title, pinned, trashed }, archive) {
    let board = archive
      ? await importBoard(archive)
      : outcome(await call(createBoard, { commandId: randomUUID(), title }), "created");

    async function change(case_, value) {
      assert.notEqual(board.entryVersion, undefined);
      const receipt = await call(manageBoard, {
        commandId: randomUUID(),
        boardId: board.boardId,
        expectedEntryVersion: board.entryVersion,
        operation: { case: case_, value },
      });

      return outcome(receipt, "changed");
    }

    if (archive) {
      board = await change("title", title);
    }
    if (pinned) {
      board = await change("pinned", true);
    }
    if (trashed) {
      board = await change("lifecycle", BoardLifecycleAction.TRASH);
    }
    return { id: board.boardId, title: board.title };
  };
}

export async function seedBoards(edition, runtime, descriptors) {
  assert.ok(edition === "initial" || edition === "ii", `Unknown Studio edition: ${edition}`);
  const archive = descriptors.some(({ withContent }) => withContent)
    ? await readFile(archiveFixture)
    : undefined;
  const seed =
    edition === "initial" ? seedInitialBoard.bind(undefined, runtime) : iiSeeder(runtime);
  const seeded = [];

  for (const descriptor of descriptors) {
    const content = descriptor.withContent ? archive : undefined;
    const board = await seed(descriptor, content);
    assert.equal(board.title, descriptor.title, "Seeded board title");
    const url = new URL(runtime.url);
    url.searchParams.set(edition === "initial" ? "artifactId" : "board", board.id);
    seeded.push({ ...board, url: url.href, ...(content && fixtureContent) });
  }

  return seeded;
}
