import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createIiFixtureProtocol } from "./boards.mjs";

const runtimes = new WeakMap();
const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { create, fromBinary, toBinary } = requireServer("@bufbuild/protobuf");
const { BoardSuggestionService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/suggestions/service",
);
const { AgentActivityPhase, AgentActivityEndReason, BoardRoomService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/rooms/service",
);
const { WhiteboardService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
);

export function registerTopbarOverlayRuntime(studio, runtime) {
  runtimes.set(studio, runtime);
  return studio;
}

export async function seedTopbarSuggestion(studio, board, objectId) {
  const runtime = runtimes.get(studio);
  assert.ok(runtime && studio.edition === "ii", "The isolated suggestion fixture is required");
  const { call } = createIiFixtureProtocol(runtime);
  const { createBoardReviewSource, submitBoardSuggestion } = BoardSuggestionService.method;
  const boardId = board.id;
  const { scene } = await call(WhiteboardService.method.getBoardScene, { boardId });
  assert.ok(scene && scene.boardRevision !== undefined, "The test board must exist");
  const { source } = await call(createBoardReviewSource, {
    boardId,
    commandId: randomUUID(),
    expectedBoardRevision: scene.boardRevision,
    origin: { case: "selection", value: { objectIds: [objectId] } },
  });
  const target = source?.targets.find((entry) => entry.objectId === objectId);
  assert.ok(source && target?.payloadVersion !== undefined, "The selected label must be frozen");

  const observation = "同一张卡片可以尝试两个发布名称。";
  const alternatives = [
    { optionId: "short", label: "简化名称", headline: "发布路径" },
    { optionId: "long", label: "补足动作", headline: "说明发布行动" },
  ];
  const proposal = create(submitBoardSuggestion.input, {
    boardId,
    commandId: randomUUID(),
    sourceId: source.sourceId,
    observation,
    options: alternatives.map(({ optionId, label, headline }) => ({
      optionId,
      label,
      edit: {
        case: "content",
        value: {
          objectId,
          expectedPayloadVersion: target.payloadVersion,
          edit: { case: "text", value: { text: headline } },
        },
      },
    })),
  });
  const response = await runtime.submitAgentSuggestion(
    toBinary(submitBoardSuggestion.input, proposal),
  );
  assert.equal(response.status, 200, "Agent submission must succeed for the synthetic board");
  const { suggestion } = fromBinary(
    submitBoardSuggestion.output,
    new Uint8Array(await response.arrayBuffer()),
  );
  assert.ok(suggestion?.proposalId);
  assert.equal(suggestion.options.length, alternatives.length);

  return { observation, alternatives };
}

export async function seedTopbarAgentWorkspace(studio, board, objectId, label = "检查发布区对象") {
  const runtime = runtimes.get(studio);
  assert.ok(runtime && studio.edition === "ii", "The isolated Agent workspace fixture is required");
  const { changeAgentActivity } = BoardRoomService.method;
  const taskId = randomUUID();
  async function change(action) {
    const task = create(changeAgentActivity.input, {
      boardId: board.id,
      agentId: "agent-topbar-fixture",
      taskId,
      action,
    });
    const response = await runtime.openAgentWorkspace(toBinary(changeAgentActivity.input, task));
    assert.equal(response.status, 200);

    return fromBinary(changeAgentActivity.output, new Uint8Array(await response.arrayBuffer()))
      .result;
  }

  const result = await change({
    case: "begin",
    value: { label, scope: { target: { case: "objects", value: { objectIds: [objectId] } } } },
  });
  assert.equal(result.case, "workspace", "An Agent must be able to begin the test workspace");
  const { generation } = result.value;
  return {
    label,
    async progress() {
      const response = await change({
        case: "update",
        value: { generation, phase: AgentActivityPhase.WRITING, activeObjectIds: [objectId] },
      });
      assert.equal(response.case, "workspace", "An Agent must be able to report progress");
    },
    async complete() {
      const response = await change({ case: "end", value: { generation } });
      assert.equal(response.case, "ended");
      assert.equal(response.value.reason, AgentActivityEndReason.COMPLETED);
    },
    async disconnect() {
      const response = await change({ case: "disconnect", value: {} });
      assert.equal(response.case, "disconnected");
    },
  };
}
