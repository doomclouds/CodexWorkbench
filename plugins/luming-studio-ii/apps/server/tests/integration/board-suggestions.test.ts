import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardEditRejectionReason,
  BoardEditService,
  BoardTransformKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { BoardSuggestionService } from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { ConnectorPort } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { afterEach, beforeEach, test } from 'vitest';
import { createWhiteboardServer } from '../../src/bootstrap/index.js';
import { interruptSuggestionAcceptance } from '../support/board-suggestion-database.js';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { createTemporaryDatabase } from '../support/whiteboard-database.js';

const owner = 'suggestion-owner';
const agentCredential = 'suggestion-test-agent';
const other = 'different-actor';
const objectId = 'suggestion-target';
const observation = '调整空白板对象的样式。';
const { createBoard } = BoardCatalogService.method;
const { editBoardGeometry, editObjectContent, getBoardEditReceipt } = BoardEditService.method;
const { getBoardScene } = WhiteboardService.method;
const {
  createBoardReviewSource,
  submitBoardSuggestion,
  listBoardSuggestions,
  previewBoardSuggestion,
  acceptBoardSuggestion,
  rejectBoardSuggestion,
} = BoardSuggestionService.method;
const geometry = { x: 12, y: 32, width: 100, height: 80, rotation: 0 };

function setupSuggestionServer() {
  let database: ReturnType<typeof createTemporaryDatabase>;
  let server: ReturnType<typeof createWhiteboardServer>;
  let address: URL;
  let errors: unknown[];

  async function start() {
    server = createWhiteboardServer({
      databasePath: database.path,
      resolveActor(request) {
        const credential = request.headers[actorHeader];
        if (credential === agentCredential) {
          return { id: owner, kind: 'agent' };
        }

        return typeof credential === 'string' ? { id: credential } : undefined;
      },
      onError(error) {
        errors.push(error);
      },
    });
    address = await server.listen();
  }

  beforeEach(async () => {
    database = createTemporaryDatabase();
    errors = [];
    await start();
  });
  afterEach(async () => {
    try {
      await server.close();
    } finally {
      database.dispose();
    }
  });

  return {
    get address() {
      return address;
    },
    get databasePath() {
      return database.path;
    },
    get errors() {
      return errors;
    },
    async restart() {
      await server.close();
      await start();
    },
  };
}

const server = setupSuggestionServer();

async function boardWithText(commandId = 'create-proposal-board') {
  const { receipt } = await callWhiteboard(server.address, owner, createBoard, {
    title: '私有建议验收',
    commandId,
  });
  assert.equal(receipt?.outcome.case, 'created');
  const { boardId } = receipt.outcome.value;
  const saved = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'initial-shape',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId,
          kind: 'text',
          geometry,
          label: '范围对象',
        },
      },
    },
  });
  assert.equal(saved.receipt?.outcome.case, 'applied');

  return boardId;
}

type GeometryInput = MessageInitShape<typeof editBoardGeometry.input>;
type SuggestionInput = MessageInitShape<typeof submitBoardSuggestion.input>;

function widthChange(width: number, id = objectId): NonNullable<GeometryInput['operation']> {
  return {
    case: 'transform',
    value: {
      kind: BoardTransformKind.RESIZE,
      objects: [
        {
          target: { objectId: id, expectedGeometryVersion: 0n },
          geometry: { ...geometry, width },
        },
      ],
    },
  };
}

function suggestionOptions(target = objectId): NonNullable<SuggestionInput['options']> {
  return [
    {
      optionId: 'wide',
      label: '扩大宽度',
      edit: { case: 'geometry', value: { operation: widthChange(210, target) } },
    },
    {
      optionId: 'text',
      label: '替换文字',
      edit: {
        case: 'content',
        value: {
          objectId: target,
          expectedPayloadVersion: 0n,
          edit: { case: 'text', value: { text: '被提议的文字' } },
        },
      },
    },
  ];
}

async function captureSource(
  boardId: string,
  ids: readonly string[] = [objectId],
  expectedBoardRevision = 1n,
) {
  const { source } = await callWhiteboard(server.address, owner, createBoardReviewSource, {
    boardId,
    commandId: 'capture-source',
    expectedBoardRevision,
    origin: { case: 'selection', value: { objectIds: [...ids] } },
  });
  assert.ok(source);
  assert.equal(source.capturedBoardRevision, expectedBoardRevision);
  assert.deepEqual(source.objectIds, [...ids]);

  return source;
}

function submitRequest(boardId: string, sourceId: string) {
  return {
    boardId,
    sourceId,
    commandId: 'submit-suggestion',
    observation,
    options: [...suggestionOptions()],
  };
}

test('replays the attached target metadata from its frozen revision after both edit channels change', async () => {
  const boardId = await boardWithText();
  const frozen = await captureSource(boardId);
  const target = frozen.targets[0];
  assert.ok(target);
  assert.equal(target.objectId, objectId);
  assert.equal(target.kind, 'text');
  assert.equal(target.geometryVersion, 0n);
  assert.equal(target.payloadVersion, 0n);
  assert.equal(target.geometry?.width, geometry.width);
  assert.equal(frozen.targetsBoardRevision, 1n);

  const geometryEdit = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'resize-after-source',
    operation: widthChange(210),
  });
  assert.equal(geometryEdit.receipt?.outcome.case, 'applied');
  const payloadEdit = await callWhiteboard(server.address, owner, editObjectContent, {
    boardId,
    commandId: 'edit-text-after-source',
    objectId,
    expectedPayloadVersion: 0n,
    edit: { case: 'text', value: { text: '之后的留言' } },
  });
  assert.equal(payloadEdit.receipt?.outcome.case, 'applied');
  assert.equal((await currentBoard(boardId)).boardRevision, 3n);

  await server.restart();
  const replayed = await captureSource(boardId);
  assert.deepEqual(replayed, frozen);
});

async function privateProposal(boardId: string, options = suggestionOptions()) {
  const source = await captureSource(boardId);
  const { suggestion } = await callWhiteboard(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    { ...submitRequest(boardId, source.sourceId), options },
  );
  assert.ok(suggestion);
  assert.equal(suggestion.proposalVersion, 0n);

  return suggestion;
}

function chooseWidth(boardId: string, proposalId: string) {
  return {
    boardId,
    proposalId,
    optionId: 'wide',
    expectedProposalVersion: 0n,
    commandId: 'accept-width',
  };
}

async function currentBoard(boardId: string) {
  const { scene } = await callWhiteboard(server.address, owner, getBoardScene, { boardId });
  assert.ok(scene);

  return scene;
}

test('keeps the proposal private and the preview read-only, then commits and replays the original receipt', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId);
  const choice = chooseWidth(boardId, proposal.proposalId);
  assert.equal((await currentBoard(boardId)).boardRevision, 1n);

  const preview = await callWhiteboard(server.address, owner, previewBoardSuggestion, choice);
  assert.equal(preview.result.case, 'preview');
  assert.equal(preview.result.value.boardRevision, 1n);
  assert.equal(preview.result.value.changedObjects[0]?.geometry?.width, 210);
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, geometry.width);

  const accepted = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(accepted.receipt?.outcome.case, 'applied');
  assert.equal(accepted.receipt.outcome.value.boardRevision, 2n);
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, 210);

  await server.restart();
  const replayed = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.deepEqual(replayed, accepted);
  const recorded = await callWhiteboard(server.address, owner, getBoardEditReceipt, {
    boardId,
    commandId: choice.commandId,
  });
  assert.deepEqual(recorded.receipt, accepted.receipt);

  const replayedSubmission = await callWhiteboard(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    submitRequest(boardId, proposal.sourceId),
  );
  assert.deepEqual(replayedSubmission.suggestion, proposal);
  const listed = await callWhiteboard(server.address, owner, listBoardSuggestions, { boardId });
  assert.equal(listed.proposals[0]?.acceptedBoardRevision, 2n);
  assert.equal(listed.proposals[0]?.acceptedOptionId, choice.optionId);
  assert.equal((await currentBoard(boardId)).boardRevision, 2n);
});

test('requires trusted actor separation and a same-board source without leaking private suggestions', async () => {
  const boardId = await boardWithText();
  const source = await captureSource(boardId);
  const request = submitRequest(boardId, source.sourceId);
  const humanSubmit = await sendWhiteboardRequest(
    server.address,
    owner,
    submitBoardSuggestion,
    request,
  );
  assert.equal(humanSubmit.status, 403);
  const foreignBoardId = await boardWithText('foreign-board');
  const crossBoard = await sendWhiteboardRequest(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    { ...request, boardId: foreignBoardId },
  );
  assert.equal(crossBoard.status, 403);

  const { suggestion } = await callWhiteboard(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    request,
  );
  assert.ok(suggestion);
  const actorChoice = chooseWidth(boardId, suggestion.proposalId);
  const agentAccept = await sendWhiteboardRequest(
    server.address,
    agentCredential,
    acceptBoardSuggestion,
    actorChoice,
  );
  assert.equal(agentAccept.status, 403);
  const publicRead = await sendWhiteboardRequest(server.address, other, listBoardSuggestions, {
    boardId,
  });
  assert.equal(publicRead.status, 403);
  assert.equal((await currentBoard(boardId)).boardRevision, 1n);
});

test('rejects stale proposals and changes dismissal status without publishing a board revision', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId);
  const changed = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'owner-edits-before-decision',
    operation: widthChange(144),
  });
  assert.equal(changed.receipt?.outcome.case, 'applied');
  const dismissed = {
    boardId,
    proposalId: proposal.proposalId,
    commandId: 'dismiss',
    expectedProposalVersion: 0n,
  };
  const stale = await callWhiteboard(
    server.address,
    owner,
    acceptBoardSuggestion,
    chooseWidth(boardId, proposal.proposalId),
  );
  assert.equal(stale.receipt?.outcome.case, 'conflict');
  const rejected = await callWhiteboard(server.address, owner, rejectBoardSuggestion, dismissed);
  assert.equal(rejected.suggestion?.rejected, true);
  assert.equal(rejected.suggestion.proposalVersion, 1n);
  const replayed = await callWhiteboard(server.address, owner, rejectBoardSuggestion, dismissed);
  assert.deepEqual(replayed, rejected);
  assert.equal((await currentBoard(boardId)).boardRevision, 2n);
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, 144);
});

test('rolls back the board revision and receipt if saving the accepted option fails', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId);
  interruptSuggestionAcceptance(server.databasePath);
  const choice = chooseWidth(boardId, proposal.proposalId);
  const failed = await sendWhiteboardRequest(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(failed.status, 500);
  assert.equal(server.errors.length, 1);
  const board = await currentBoard(boardId);
  assert.equal(board.boardRevision, 1n);
  assert.equal(board.objects[0]?.geometry?.width, geometry.width);

  const recorded = await callWhiteboard(server.address, owner, getBoardEditReceipt, {
    boardId,
    commandId: choice.commandId,
  });
  assert.equal(recorded.receipt, undefined);
  const proposals = await callWhiteboard(server.address, owner, listBoardSuggestions, { boardId });
  assert.equal(proposals.proposals[0]?.acceptedOptionId, undefined);
});

test('accepts a typed content option through the existing payload edit and history pipeline', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId);
  const accepted = await callWhiteboard(server.address, owner, acceptBoardSuggestion, {
    ...chooseWidth(boardId, proposal.proposalId),
    optionId: 'text',
  });
  assert.equal(accepted.receipt?.outcome.case, 'applied');
  const { changedPayloads, changedObjects, boardRevision } = accepted.receipt.outcome.value;
  const content = changedPayloads[0]?.result;
  assert.equal(content?.case, 'payload');
  assert.equal(content.value.payloadVersion, 1n);
  assert.equal(content.value.body.case, 'text');
  assert.equal(content.value.body.value.text, '被提议的文字');
  assert.equal(changedObjects[0]?.geometryVersion, 0n);
  assert.equal(boardRevision, 2n);
});

function removalOptions(): NonNullable<SuggestionInput['options']> {
  return [
    {
      optionId: 'remove',
      label: '移除对象',
      edit: {
        case: 'geometry',
        value: {
          operation: {
            case: 'delete',
            value: { targets: [{ objectId, expectedGeometryVersion: 0n }] },
          },
        },
      },
    },
    ...suggestionOptions().slice(1),
  ];
}

const connectorId = 'related-connector';

async function attachConnector(boardId: string) {
  const attached = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'new-related-connector',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: connectorId,
          kind: 'connector',
          label: '随后添加的连线',
          geometry,
          geometryDetail: {
            case: 'connector',
            value: {
              start: {
                point: { x: 100, y: 80 },
                attachment: { objectId, port: ConnectorPort.RIGHT },
              },
              end: { point: { x: 230, y: 150 } },
            },
          },
        },
      },
    },
  });
  assert.equal(attached.receipt?.outcome.case, 'applied');
}

test('rejects a proposed removal whose existing attached line was omitted from the frozen selection', async () => {
  const boardId = await boardWithText();
  await attachConnector(boardId);
  const source = await captureSource(boardId, [objectId], 2n);
  const response = await sendWhiteboardRequest(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    { ...submitRequest(boardId, source.sourceId), options: removalOptions() },
  );
  assert.equal(response.status, 403);

  const listed = await callWhiteboard(server.address, owner, listBoardSuggestions, { boardId });
  assert.deepEqual(listed.proposals, []);
  assert.equal((await currentBoard(boardId)).boardRevision, 2n);
});

test('rejects acceptance if a new attached line would now be removed outside the frozen selection', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId, removalOptions());
  const choice = { ...chooseWidth(boardId, proposal.proposalId), optionId: 'remove' };
  const initialPreview = await callWhiteboard(
    server.address,
    owner,
    previewBoardSuggestion,
    choice,
  );
  assert.equal(initialPreview.result.case, 'preview');
  assert.deepEqual(initialPreview.result.value.removedObjectIds, [objectId]);

  await attachConnector(boardId);
  const stale = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(stale.receipt?.outcome.case, 'rejected');
  assert.equal(stale.receipt.outcome.value.reason, BoardEditRejectionReason.FORBIDDEN);
  const board = await currentBoard(boardId);
  assert.equal(board.boardRevision, 2n);
  assert.deepEqual(
    board.objects.map((object) => object.objectId),
    [objectId, connectorId],
  );
});
