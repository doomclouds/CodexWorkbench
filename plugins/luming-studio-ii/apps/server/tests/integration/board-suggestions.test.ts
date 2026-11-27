import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardEditRejectionReason,
  BoardEditService,
  BoardLayerDirection,
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

function textOperation(text: string, id = objectId) {
  return {
    objectId: id,
    expectedPayloadVersion: 0n,
    edit: { case: 'text', value: { text } },
  } as const;
}

test('previews and commits ordered geometry plus content as one revision and replays both changes', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId, [
    {
      optionId: 'compound',
      label: '同时扩大和修改文字',
      operations: [
        { edit: { case: 'geometry', value: { operation: widthChange(315) } } },
        { edit: { case: 'content', value: textOperation('复合方案') } },
      ],
    },
    ...suggestionOptions().slice(1),
  ]);
  const choice = { ...chooseWidth(boardId, proposal.proposalId), optionId: 'compound' };
  const preview = await callWhiteboard(server.address, owner, previewBoardSuggestion, choice);
  assert.equal(preview.result.case, 'preview');
  assert.equal(preview.result.value.changedObjects[0]?.geometry?.width, 315);
  assert.equal(preview.result.value.changedPayloads[0]?.result.case, 'payload');
  assert.equal((await currentBoard(boardId)).boardRevision, 1n);

  const accepted = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(accepted.receipt?.outcome.case, 'applied');
  assert.equal(accepted.receipt.outcome.value.boardRevision, 2n);
  const payload = accepted.receipt.outcome.value.changedPayloads[0]?.result;
  assert.equal(payload?.case, 'payload');
  assert.equal(payload.value.body.case, 'text');
  assert.equal(payload.value.body.value.text, '复合方案');
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, 315);

  await server.restart();
  const replay = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.deepEqual(replay, accepted);
  assert.equal((await currentBoard(boardId)).boardRevision, 2n);
});

function resizeAlternatives(id = objectId): NonNullable<SuggestionInput['options']> {
  return [
    {
      optionId: 'wide',
      label: '方案一',
      edit: { case: 'geometry', value: { operation: widthChange(210) } },
    },
    {
      optionId: 'larger',
      label: '方案二',
      edit: { case: 'geometry', value: { operation: widthChange(330, id) } },
    },
  ];
}

test('replaces an overlapping active option and safely withdraws it with monotonic object versions', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId, resizeAlternatives());
  const first = chooseWidth(boardId, proposal.proposalId);
  const applied = await callWhiteboard(server.address, owner, acceptBoardSuggestion, first);
  assert.equal(applied.receipt?.outcome.case, 'applied');
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, 210);

  const replacement = {
    ...first,
    optionId: 'larger',
    expectedProposalVersion: 1n,
    commandId: 'replace-with-larger',
  };
  const preview = await callWhiteboard(server.address, owner, previewBoardSuggestion, replacement);
  assert.equal(preview.result.case, 'preview');
  assert.equal(preview.result.value.changedObjects[0]?.geometry?.width, 330);
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, 210);

  const switched = await callWhiteboard(server.address, owner, acceptBoardSuggestion, replacement);
  assert.equal(switched.receipt?.outcome.case, 'applied');
  assert.equal(switched.receipt.outcome.value.boardRevision, 3n);
  const switchedBoard = await currentBoard(boardId);
  assert.equal(switchedBoard.objects[0]?.geometry?.width, 330);
  assert.equal(switchedBoard.objects[0]?.geometryVersion, 2n);

  await server.restart();
  const withdrawal = { ...replacement, expectedProposalVersion: 2n, commandId: 'withdraw-larger' };
  const undone = await callWhiteboard(server.address, owner, acceptBoardSuggestion, withdrawal);
  assert.equal(undone.receipt?.outcome.case, 'applied');
  assert.equal(undone.receipt.outcome.value.boardRevision, 4n);
  const restored = await currentBoard(boardId);
  assert.equal(restored.objects[0]?.geometry?.width, geometry.width);
  assert.equal(restored.objects[0]?.geometryVersion, 3n);

  const again = await callWhiteboard(server.address, owner, acceptBoardSuggestion, {
    ...first,
    expectedProposalVersion: 3n,
    commandId: 'reapply-first',
  });
  assert.equal(again.receipt?.outcome.case, 'applied');
  assert.equal((await currentBoard(boardId)).objects[0]?.geometry?.width, 210);
  const listed = await callWhiteboard(server.address, owner, listBoardSuggestions, { boardId });
  assert.deepEqual(listed.proposals[0]?.activeOptionIds, ['wide']);
});

test('keeps a later object change intact when someone clicks the older active option', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId, resizeAlternatives());
  const choice = chooseWidth(boardId, proposal.proposalId);
  const accepted = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(accepted.receipt?.outcome.case, 'applied');
  const laterEdit = await callWhiteboard(server.address, owner, editObjectContent, {
    boardId,
    commandId: 'later-owner-edit',
    ...textOperation('保留后来的正文'),
  });
  assert.equal(laterEdit.receipt?.outcome.case, 'applied');

  const withdrawn = await callWhiteboard(server.address, owner, acceptBoardSuggestion, {
    ...choice,
    expectedProposalVersion: 1n,
    commandId: 'cannot-overwrite-later-text',
  });
  assert.equal(withdrawn.receipt?.outcome.case, 'conflict');
  const board = await currentBoard(boardId);
  assert.equal(board.boardRevision, 3n);
  assert.equal(board.objects[0]?.geometry?.width, 210);
  assert.equal(board.objects[0]?.payloadVersion, 1n);
});

test('keeps non-overlapping options active together and clears the card without changing their board effects', async () => {
  const boardId = await boardWithText();
  const alternateId = 'suggestion-alternate-object';
  const addition = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'create-alternate-suggestion-object',
    operation: {
      case: 'create',
      value: {
        object: { objectId: alternateId, kind: 'text', geometry, label: '第二对象' },
      },
    },
  });
  assert.equal(addition.receipt?.outcome.case, 'applied');

  const source = await captureSource(boardId, [objectId, alternateId], 2n);
  const { suggestion } = await callWhiteboard(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    {
      ...submitRequest(boardId, source.sourceId),
      options: resizeAlternatives(alternateId),
    },
  );
  assert.ok(suggestion);
  const first = chooseWidth(boardId, suggestion.proposalId);
  const firstResult = await callWhiteboard(server.address, owner, acceptBoardSuggestion, first);
  assert.equal(firstResult.receipt?.outcome.case, 'applied');
  const secondResult = await callWhiteboard(server.address, owner, acceptBoardSuggestion, {
    ...first,
    optionId: 'larger',
    expectedProposalVersion: 1n,
    commandId: 'apply-next-disjoint-option',
  });
  assert.equal(secondResult.receipt?.outcome.case, 'applied');
  const before = await currentBoard(boardId);
  assert.equal(before.boardRevision, 4n);
  assert.deepEqual(
    before.objects.map((object) => object.geometry?.width),
    [210, 330],
  );
  const listed = await callWhiteboard(server.address, owner, listBoardSuggestions, { boardId });
  assert.deepEqual(listed.proposals[0]?.activeOptionIds, ['wide', 'larger']);

  const clear = {
    boardId,
    proposalId: suggestion.proposalId,
    expectedProposalVersion: 2n,
    commandId: 'clear-active-card',
  };
  const cleared = await callWhiteboard(server.address, owner, rejectBoardSuggestion, clear);
  assert.equal(cleared.suggestion?.rejected, true);
  const replayed = await callWhiteboard(server.address, owner, rejectBoardSuggestion, clear);
  assert.deepEqual(replayed, cleared);
  const visible = await callWhiteboard(server.address, owner, listBoardSuggestions, { boardId });
  assert.deepEqual(visible.proposals, []);
  assert.deepEqual(await currentBoard(boardId), before);
});

test('leaves the first staged edit unapplied when a later operation in the accepted option conflicts', async () => {
  const boardId = await boardWithText();
  const proposal = await privateProposal(boardId, [
    {
      optionId: 'compound',
      label: '扩大并改写正文',
      operations: [
        { edit: { case: 'geometry', value: { operation: widthChange(315) } } },
        { edit: { case: 'content', value: textOperation('旧建议正文') } },
      ],
    },
    ...suggestionOptions().slice(1),
  ]);
  const later = await callWhiteboard(server.address, owner, editObjectContent, {
    boardId,
    commandId: 'refresh-stale-compound-body',
    ...textOperation('用户刚保存的正文'),
  });
  assert.equal(later.receipt?.outcome.case, 'applied');
  const before = await currentBoard(boardId);
  const choice = { ...chooseWidth(boardId, proposal.proposalId), optionId: 'compound' };
  const rejected = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(rejected.receipt?.outcome.case, 'conflict');
  assert.deepEqual(await currentBoard(boardId), before);
  const stored = await callWhiteboard(server.address, owner, getBoardEditReceipt, {
    boardId,
    commandId: choice.commandId,
  });
  assert.equal(stored.receipt, undefined);
});

test('restores real layer order when an active layering option is clicked again', async () => {
  const boardId = await boardWithText();
  const second = 'layer-neighbor';
  const created = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'create-layer-neighbor',
    operation: {
      case: 'create',
      value: { object: { objectId: second, kind: 'text', geometry, label: '相邻对象' } },
    },
  });
  assert.equal(created.receipt?.outcome.case, 'applied');

  const source = await captureSource(boardId, [objectId], 2n);
  const { suggestion } = await callWhiteboard(
    server.address,
    agentCredential,
    submitBoardSuggestion,
    {
      ...submitRequest(boardId, source.sourceId),
      options: [
        {
          optionId: 'onto-front',
          label: '移到顶部',
          edit: {
            case: 'geometry',
            value: {
              operation: {
                case: 'reorder',
                value: {
                  expectedBoardRevision: 2n,
                  direction: BoardLayerDirection.FRONT,
                  targets: [{ objectId, expectedGeometryVersion: 0n }],
                },
              },
            },
          },
        },
        ...suggestionOptions().slice(1),
      ],
    },
  );
  assert.ok(suggestion);
  const choice = { ...chooseWidth(boardId, suggestion.proposalId), optionId: 'onto-front' };
  const selected = await callWhiteboard(server.address, owner, acceptBoardSuggestion, choice);
  assert.equal(selected.receipt?.outcome.case, 'applied');
  assert.deepEqual(
    (await currentBoard(boardId)).objects.map((object) => object.objectId),
    [second, objectId],
  );

  const restored = await callWhiteboard(server.address, owner, acceptBoardSuggestion, {
    ...choice,
    expectedProposalVersion: 1n,
    commandId: 'withdraw-layer-order',
  });
  assert.equal(restored.receipt?.outcome.case, 'applied');
  const board = await currentBoard(boardId);
  assert.equal(board.boardRevision, 4n);
  assert.deepEqual(
    board.objects.map((object) => object.objectId),
    [objectId, second],
  );
});
