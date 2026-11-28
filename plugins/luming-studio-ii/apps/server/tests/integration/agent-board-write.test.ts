import { create, fromBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { BoardAgentWriteService } from '@codexworkbench/luming-studio-ii-contracts/agent-write/service';
import {
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import {
  BoardCatalogService,
  BoardLifecycleAction,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardRoomService,
  type AgentActivityScopeSchema,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { BoardSuggestionEditInputSchema } from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardHistoryService,
  BoardVersionActorKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  BoardExportFormat,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { agentPrincipalPrefix, useSharingTestServer } from './sharing-test-server.js';

const server = useSharingTestServer();
const owner = 'agent-write-owner';
const agentActor = agentPrincipalPrefix + owner;
const agentId = 'agent-direct-edit';
const taskId = 'direct-edit-task';
const sectionId = 'scoped-section';
const childId = 'unclaimed-child';
const { changeAgentActivity } = BoardRoomService.method;
const { applyAgentBoardEdit, getAgentBoardEditReceipt } = BoardAgentWriteService.method;

async function seedBoard() {
  const { receipt } = await callWhiteboard(
    server.owner,
    owner,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'create-scoped-board',
      title: 'Scoped Agent edits',
    },
  );

  if (receipt?.outcome.case !== 'created') {
    throw new Error('Could not create the scoped Agent board');
  }

  const { boardId } = receipt.outcome.value;
  for (const object of [
    {
      objectId: sectionId,
      kind: 'section',
      label: 'Section',
      geometry: { x: 50, y: 50, width: 300, height: 240, rotation: 0 },
      geometryDetail: { case: 'section', value: { transparent: true } } as const,
    },
    {
      objectId: childId,
      kind: 'text',
      label: 'Unclaimed child',
      parentId: sectionId,
      geometry: { x: 70, y: 80, width: 80, height: 50, rotation: 0 },
    },
  ]) {
    const result = await callWhiteboard(
      server.owner,
      owner,
      BoardEditService.method.editBoardGeometry,
      {
        boardId,
        commandId: 'seed-' + object.objectId,
        operation: { case: 'create', value: { object } },
      },
    );
    expect(result.receipt?.outcome, object.objectId).toMatchObject({ case: 'applied' });
  }

  return receipt.outcome.value;
}

async function begin(boardId: string, scope: MessageInitShape<typeof AgentActivityScopeSchema>) {
  const { result } = await callWhiteboard(server.owner, agentActor, changeAgentActivity, {
    boardId,
    agentId,
    taskId,
    action: {
      case: 'begin',
      value: {
        label: 'Edit section',
        scope,
      },
    },
  });

  if (result.case !== 'workspace') {
    throw new Error('Could not open the scoped Agent workspace');
  }

  return { boardId, agentId, taskId, generation: result.value.generation };
}

function objectScope(...objectIds: string[]): MessageInitShape<typeof AgentActivityScopeSchema> {
  return { target: { case: 'objects', value: { objectIds } } };
}

function createText(objectId: string, x: number) {
  return create(BoardSuggestionEditInputSchema, {
    edit: {
      case: 'geometry',
      value: {
        operation: {
          case: 'create',
          value: {
            object: {
              objectId,
              kind: 'text',
              label: objectId,
              geometry: { x, y: -250, width: 60, height: 30, rotation: 0 },
            },
          },
        },
      },
    },
  });
}

const editSection = create(BoardSuggestionEditInputSchema, {
  edit: {
    case: 'geometry',
    value: {
      operation: {
        case: 'delete',
        value: { targets: [{ objectId: sectionId, expectedGeometryVersion: 0n }] },
      },
    },
  },
});

test('rejects removing a scoped section when its unclaimed child would be changed by the same edit', async () => {
  const { boardId } = await seedBoard();
  const lease = await begin(boardId, objectScope(sectionId));
  const scene = WhiteboardService.method.getBoardScene;
  const original = await callWhiteboard(server.owner, owner, scene, { boardId });
  const { receipt } = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, {
    ...lease,
    commandId: 'delete-section-outside-scope',
    operations: [editSection],
  });
  expect(receipt?.outcome.case).toBe('rejected');
  expect(await callWhiteboard(server.owner, owner, scene, { boardId })).toEqual(original);
});

test('replays an unchanged committed receipt after release and rejects further writes from that generation', async () => {
  const { boardId, entryVersion } = await seedBoard();
  const lease = await begin(boardId, objectScope(sectionId, childId));
  const request = { ...lease, commandId: 'delete-section', operations: [editSection] };
  const original = { original: request };
  const sceneMethod = WhiteboardService.method.getBoardScene;
  const before = await callWhiteboard(server.owner, owner, sceneMethod, { boardId });
  const missing = await callWhiteboard(
    server.owner,
    agentActor,
    getAgentBoardEditReceipt,
    original,
  );
  expect(missing.receipt).toBeUndefined();
  expect(await callWhiteboard(server.owner, owner, sceneMethod, { boardId })).toEqual(before);

  const unbound = await sendWhiteboardRequest(server.owner, agentActor, applyAgentBoardEdit, {
    ...request,
    generation: '',
  });
  expect(unbound.status).toBe(400);

  const saved = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, request);
  expect(saved.receipt?.outcome.case).toBe('applied');
  const { versions } = await callWhiteboard(
    server.owner,
    owner,
    BoardHistoryService.method.listBoardVersions,
    { boardId },
  );
  expect(versions[0]).toMatchObject({
    revision: 3n,
    actorId: agentId,
    actorKind: BoardVersionActorKind.AGENT,
    actorName: 'Agent · ' + agentId.slice(-8),
  });
  expect(versions[1]).toMatchObject({
    actorId: owner,
    actorKind: BoardVersionActorKind.UNSPECIFIED,
  });

  const released = await callWhiteboard(server.owner, owner, changeAgentActivity, {
    boardId,
    agentId,
    taskId,
    action: { case: 'release', value: { generation: lease.generation } },
  });
  expect(released.result.case).toBe('ended');
  const stored = await callWhiteboard(server.owner, agentActor, getAgentBoardEditReceipt, original);
  expect(stored.receipt).toEqual(saved.receipt);
  expect(stored.detailsOmitted).toBe(saved.detailsOmitted);
  const altered = await sendWhiteboardRequest(server.owner, agentActor, getAgentBoardEditReceipt, {
    original: { ...request, generation: 'different-generation' },
  });
  expect(altered.status).toBe(409);
  const otherConnection = await callWhiteboard(server.owner, agentActor, getAgentBoardEditReceipt, {
    original: { ...request, agentId: 'agent-other-connection' },
  });
  expect(otherConnection.receipt).toBeUndefined();
  expect(await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, request)).toEqual(
    saved,
  );

  const denied = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, {
    ...request,
    commandId: 'write-after-release',
  });
  expect(denied.receipt?.outcome.case).toBe('rejected');
  const ownerEndpoint = await sendWhiteboardRequest(
    server.owner,
    owner,
    applyAgentBoardEdit,
    request,
  );
  expect(ownerEndpoint.status).toBe(403);

  const { receipt } = await callWhiteboard(
    server.owner,
    owner,
    BoardCatalogService.method.manageBoard,
    {
      boardId,
      commandId: 'trash-after-agent-release',
      expectedEntryVersion: entryVersion,
      operation: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
    },
  );
  expect(receipt?.outcome.case).toBe('changed');
  const revoked = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, request);
  expect(revoked.receipt?.outcome.case).toBe('rejected');
  expect(
    (await sendWhiteboardRequest(server.owner, agentActor, getAgentBoardEditReceipt, original))
      .status,
  ).toBe(403);
});

test('allows creation inside declared empty space and rolls back a mixed batch that exceeds the area', async () => {
  const { boardId } = await seedBoard();
  const lease = await begin(boardId, {
    target: { case: 'area', value: { x: -300, y: -280, width: 140, height: 120 } },
  });
  const scene = WhiteboardService.method.getBoardScene;
  const original = await callWhiteboard(server.owner, owner, scene, { boardId });
  const inside = createText('inside', -280);
  const outside = createText('outside', -210);
  const aborted = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, {
    ...lease,
    commandId: 'mixed-area-batch',
    operations: [inside, outside],
  });
  expect(aborted.receipt?.outcome.case).toBe('rejected');
  expect(await callWhiteboard(server.owner, owner, scene, { boardId })).toEqual(original);

  const applied = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, {
    ...lease,
    commandId: 'inside-area',
    operations: [inside],
  });
  expect(applied.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { changedObjects: [{ objectId: 'inside' }] },
  });
});

test('retains the recorded Agent author after exporting and reopening the board archive', async () => {
  const { boardId } = await seedBoard();
  const lease = await begin(boardId, objectScope(sectionId, childId));
  const saved = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, {
    ...lease,
    commandId: 'recorded-agent-edit',
    operations: [editSection],
  });
  expect(saved.receipt?.outcome.case).toBe('applied');
  const { result } = await callWhiteboard(
    server.owner,
    owner,
    WhiteboardService.method.exportBoard,
    {
      boardId,
      expectedRevision: 3n,
      scope: { case: 'whole', value: {} },
      format: BoardExportFormat.ZIP,
    },
  );

  if (result.case !== 'file') {
    throw new Error('Agent history could not be exported');
  }

  const response = await fetch(
    new URL('/' + BoardArchiveService.typeName + '/ImportBoardArchive', server.owner),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'x-studio-command-id': 'import-agent-history',
        [actorHeader]: owner,
      },
      body: new Uint8Array(result.value.content),
      signal: AbortSignal.timeout(5_000),
    },
  );
  expect(response.status).toBe(200);
  const imported = fromBinary(
    ImportBoardArchiveResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );

  if (imported.receipt?.outcome.case !== 'imported') {
    throw new Error('Agent history could not be imported');
  }

  const { versions } = await callWhiteboard(
    server.owner,
    owner,
    BoardHistoryService.method.listBoardVersions,
    { boardId: imported.receipt.outcome.value.boardId },
  );
  expect(versions[0]).toMatchObject({
    revision: 3n,
    actorId: agentId,
    actorKind: BoardVersionActorKind.AGENT,
    actorName: 'Agent · ' + agentId.slice(-8),
  });
});

test('coordinates a release racing with a real submission and never admits another commit afterward', async () => {
  const { boardId } = await seedBoard();
  const lease = await begin(boardId, objectScope(sectionId, childId));
  const request = { ...lease, commandId: 'race-edit-and-release', operations: [editSection] };
  const [edit, release] = await Promise.all([
    callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, request),
    callWhiteboard(server.owner, owner, changeAgentActivity, {
      boardId,
      agentId,
      taskId,
      action: { case: 'release', value: { generation: lease.generation } },
    }),
  ]);
  expect(release.result.case).toBe('ended');
  expect(['applied', 'rejected']).toContain(edit.receipt?.outcome.case);

  const { scene } = await callWhiteboard(
    server.owner,
    owner,
    WhiteboardService.method.getBoardScene,
    {
      boardId,
    },
  );
  const exists = scene?.objects.some(({ objectId }) => objectId === sectionId);
  expect(exists).toBe(edit.receipt?.outcome.case === 'rejected');
  expect(await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, request)).toEqual(
    edit,
  );

  const late = await callWhiteboard(server.owner, agentActor, applyAgentBoardEdit, {
    ...request,
    commandId: 'new-write-after-release-acknowledgement',
  });
  expect(late.receipt?.outcome.case).toBe('rejected');
});
