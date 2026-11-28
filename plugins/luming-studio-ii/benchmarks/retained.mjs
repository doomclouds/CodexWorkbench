import assert from "node:assert/strict";
import { createBoardFixtures } from "../e2e/support/board-fixtures.mjs";
import { retainedTextId, seedBenchmarkBoard } from "./fixtures.mjs";
import { createRetainedTransport } from "./fixtures/retained-transport.mjs";

export const retainedMetrics = ["save-retained-move", "save-retained-text", "save-retained-add"];
const retainedVersions = 200;

function commandId(sequence, index) {
  const count = (sequence - 1) * retainedMetrics.length + index + 1;

  return `10000000-0000-4000-8000-${String(count).padStart(12, "0")}`;
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function shapeAt(sequence) {
  return {
    id: `retained-shape-${sequence}`,
    label: `新增形状 ${sequence}`,
    fill: "#f4a56f",
    geometry: {
      x: 40 + (sequence % 8) * 154,
      y: 120 + Math.floor(sequence / 8) * 100,
      width: 140,
      height: 84,
    },
  };
}

function byId(snapshot, id) {
  const object = snapshot.objects.find((item) => item.id === id);
  assert.ok(object, `The stored board is missing ${id}.`);

  return object;
}

function workFor(before, targetId, sequence) {
  return [
    { kind: "move", object: byId(before, targetId), dx: sequence % 2 === 1 ? 12 : -12 },
    { kind: "text", object: byId(before, retainedTextId), text: `基准正文 ${sequence}` },
    { kind: "add", shape: shapeAt(sequence) },
  ];
}

function verifyRound(after, before, work) {
  const [move, text, add] = work;
  const target = byId(after, move.object.id);
  assert.equal(target.x, move.object.x + move.dx);
  assert.equal(target.y, move.object.y);
  assert.equal(byId(after, retainedTextId).text, text.text);
  const shape = byId(after, add.shape.id);
  assert.equal(shape.kind, "shape");
  assert.equal(shape.text, add.shape.label);
  assert.equal(shape.fill, add.shape.fill);
  const { x, y, width, height } = shape;
  assert.deepEqual({ x, y, width, height }, add.shape.geometry);
  assert.equal(after.objects.length, before.objects.length + 1);
  assert.equal(after.revision, before.revision + work.length);

  return {
    revision: after.revision,
    objects: after.objects.length,
    x: target.x,
    y: target.y,
    text: text.text,
    shapeId: shape.id,
  };
}

async function writeRound(transport, input, work, samples, stopping) {
  let { revision } = input;
  for (const [index, operation] of work.entries()) {
    stopping.throwIfAborted();
    const metric = retainedMetrics[index];
    try {
      const result = await transport.write({
        boardId: input.boardId,
        commandId: commandId(input.sequence, index),
        revision,
        work: operation,
      });
      samples.push({ metric, status: "ok", ...result });
      revision = result.revision;
    } catch (error) {
      const status =
        error instanceof Error && error.name === "TimeoutError" ? "timeout" : "failure";
      samples.push({ metric, status, ms: null, error: errorText(error) });
      for (const blocked of retainedMetrics.slice(index + 1)) {
        samples.push({
          metric: blocked,
          status: "failure",
          ms: null,
          error: `Skipped after ${metric} failed.`,
        });
      }

      throw error;
    }
  }
}

function historySummary(versions, head) {
  assert.ok(versions.length >= retainedVersions, "Expected at least 200 saved board versions.");
  assert.equal(versions[0], head);
  for (const [index, revision] of versions.entries()) {
    assert.equal(revision, head - index, "The stored history must have continuous revisions.");
  }

  return { versions: versions.length, oldestRevision: versions.at(-1), newestRevision: head };
}

async function prepareHistory(transport, board, stopping) {
  const start = performance.now();
  let position = await board.readTarget();
  assert.equal(position.revision, 0, "The common archive must start at revision zero.");
  for (let revision = 1; revision < retainedVersions; revision++) {
    stopping.throwIfAborted();
    const dx = revision % 2 === 1 ? 1 : -1;
    await transport.write({
      boardId: board.id,
      commandId: `20000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
      revision: position.revision,
      work: { kind: "move", object: { id: board.targetId, ...position }, dx },
    });
    const stored = await board.readTarget();
    assert.equal(stored.revision, revision);
    assert.equal(stored.x, position.x + dx);
    assert.equal(stored.y, position.y);
    position = stored;
  }

  const history = historySummary(await transport.versions(board.id), position.revision);
  assert.deepEqual(history, {
    versions: retainedVersions,
    oldestRevision: 0,
    newestRevision: retainedVersions - 1,
  });

  return { history, preparationMs: performance.now() - start };
}

export async function runRetainedCase({ edition, runtime, fixture, rounds, warmups, stopping }) {
  const group = { warmups: [], rounds: [] };
  try {
    assert.ok(
      fixture.objects + rounds + warmups <= 2_000,
      "Leave room for one added shape per round.",
    );
    stopping.throwIfAborted();
    const board = await seedBenchmarkBoard(edition, runtime, fixture);
    const boards = createBoardFixtures(edition, runtime);
    const transport = createRetainedTransport(edition, runtime, stopping);
    const { history, preparationMs } = await prepareHistory(transport, board, stopping);
    group.seed = { ...board.verification, history, preparationMs };
    let before = await boards.readBoard(board, new Set([retainedTextId]));
    for (let index = 1 - warmups; index <= rounds; index++) {
      const attempt = { index, samples: [] };
      const phase = index < 1 ? group.warmups : group.rounds;
      phase.push(attempt);
      const sequence = index + warmups;
      const work = workFor(before, fixture.targetId, sequence);
      await writeRound(
        transport,
        { boardId: board.id, revision: before.revision, sequence },
        work,
        attempt.samples,
        stopping,
      );
      const after = await boards.readBoard(board, new Set([retainedTextId, work[2].shape.id]));
      attempt.verification = verifyRound(after, before, work);
      before = after;
    }

    group.verification = historySummary(await transport.versions(board.id), before.revision);
  } catch (error) {
    group.error = errorText(error);
  }

  return group;
}
