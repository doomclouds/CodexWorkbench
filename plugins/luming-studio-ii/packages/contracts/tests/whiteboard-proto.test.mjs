import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const contractsRoot = fileURLToPath(new URL('../', import.meta.url));
const bufLauncher = fileURLToPath(import.meta.resolve('@bufbuild/buf/bin/buf'));
const protoPackage = 'luming.studio.v1';
const boardId = 'board-1';
const commandId = 'move-1';
const objectId = 'card-1';
const boardRevision = '9007199254740993';
const geometryVersion = '9007199254740995';
const payloadVersion = '9007199254740997';

const cardMetadata = {
  objectId,
  kind: 'document',
  label: '阶段说明',
  geometry: { x: 16, y: -8, width: 240, height: 160 },
  geometryVersion,
  payloadVersion,
};
const inkMetadata = {
  ...cardMetadata,
  objectId: 'ink-1',
  kind: 'ink',
  label: '笔迹',
  ink: { width: 2.5 },
};
const inkPoints = [
  { x: 2, y: 3 },
  { x: 4, y: 7 },
];
const connectorMetadata = {
  ...cardMetadata,
  objectId: 'connector-1',
  kind: 'connector',
  label: '连接线',
};
const connectorEndpoints = {
  start: {
    point: { x: 16, y: -8 },
    attachment: { objectId, port: 'CONNECTOR_PORT_RIGHT' },
  },
  end: { point: { x: 245, y: 12 } },
};

function runBuf(args, input) {
  const result = spawnSync(process.execPath, [bufLauncher, ...args], {
    cwd: contractsRoot,
    input,
    timeout: 15_000,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  return result.stdout;
}

function encode(type, value) {
  return runBuf(
    ['convert', '.', `--type=${protoPackage}.${type}`, '--from=-#format=json', '--to=-#format=binpb'],
    Buffer.from(JSON.stringify(value), 'utf8'),
  );
}

function decode(type, wire) {
  const output = runBuf(
    ['convert', '.', `--type=${protoPackage}.${type}`, '--from=-#format=binpb', '--to=-#format=json'],
    wire,
  );

  return JSON.parse(output.toString('utf8'));
}

function assertRoundTrip(type, value) {
  const wire = encode(type, value);
  assert.ok(wire.length > 0);
  assert.deepEqual(decode(type, wire), value);
}

test('keeps the online Agent roster independent of completed workspaces and private disconnect', () => {
  const agentId = 'agent-one';
  assertRoundTrip('BoardRoomSnapshot', {
    actorId: 'owner',
    onlineAgents: { agentIds: [agentId], readingAgentIds: [agentId] },
  });
  assertRoundTrip('RoomAgentWorkspaceList', { onlineAgents: {} });
  assertRoundTrip('ChangeAgentActivityRequest', { agentId, disconnect: {} });
  assertRoundTrip('ChangeAgentActivityResponse', { disconnected: {} });
  assertRoundTrip('ChangeAgentActivityRequest', {
    agentId,
    boardId,
    readPresence: { activityId: 'read-one', reading: true },
  });
});

test('declares the request, response and streaming direction of every Studio RPC', () => {
  const descriptor = JSON.parse(
    runBuf([
      'build',
      '.',
      '--as-file-descriptor-set',
      '--exclude-imports',
      '--exclude-source-info',
      '--output=-#format=json',
    ]).toString('utf8'),
  );
  const services = descriptor.file
    .filter((file) => file.package === protoPackage)
    .flatMap((file) => file.service ?? []);
  const methodsByService = new Map([
    ['BoardAgentWriteService', ['ApplyAgentBoardEdit', 'GetAgentBoardEditReceipt']],
    [
      'BoardArchiveService',
      ['GetArchiveImportReceipt', 'ListBoardAssets', 'ImportBoardAsset', 'DeleteBoardAsset'],
    ],
    [
      'BoardCatalogService',
      [
        'ListBoards',
        'WaitForBoardCatalogChange',
        'ListTrashedBoards',
        'GetBoardThumbnail',
        'CreateBoard',
        'DuplicateBoard',
        'ManageBoard',
        'PurgeBoards',
        'GetCatalogCommandReceipt',
        'GetWorkbenchPreferences',
        'UpdateWorkbenchPreferences',
      ],
    ],
    [
      'BoardEditService',
      [
        'EditBoardGeometry',
        'EditObjectContent',
        'AttachBoardImage',
        'AttachBoardVideo',
        'UploadBoardDocumentImage',
        'ReverseBoardEdit',
        'GetBoardEditReceipt',
      ],
    ],
    [
      'BoardHistoryService',
      [
        'ListBoardVersions',
        'GetBoardVersionScene',
        'GetBoardVersionPayloads',
        'RestoreBoardVersion',
        'ExportBoardVersion',
      ],
    ],
    [
      'BoardRoomService',
      [
        'GetBoardRoom',
        'WaitBoardRoomEvents',
        'StreamBoardRoomEvents',
        'UpdateBoardPresence',
        'LeaveBoardPresence',
        'ChangeBoardTimer',
        'GetBoardTimerReceipt',
        'ChangeAgentActivity',
      ],
    ],
    [
      'BoardSharingService',
      [
        'GetBoardSharing',
        'UpdateBoardSharing',
        'GetBoardSharingReceipt',
        'InspectBoardInvitation',
        'JoinBoardInvitation',
      ],
    ],
    [
      'BoardSuggestionService',
      [
        'CreateBoardReviewSource',
        'SubmitBoardSuggestion',
        'ListBoardSuggestions',
        'PreviewBoardSuggestion',
        'AcceptBoardSuggestion',
        'ChooseAgentBoardSuggestion',
        'RejectBoardSuggestion',
      ],
    ],
    ['FeedbackService', ['ListThreads', 'GetThread', 'ApplyFeedback', 'GetFeedbackReceipt']],
    ['McpPanelViewService', ['UpdatePanelView', 'ReadPanelView']],
    [
      'WhiteboardService',
      ['GetBoardScene', 'GetObjectPayloads', 'MoveObjects', 'GetCommandReceipt', 'ExportBoard'],
    ],
  ]);
  assert.deepEqual(services.map(({ name }) => name).sort(), [...methodsByService.keys()]);

  for (const service of services) {
    const signatures = service.method.map(
      ({ name, inputType, outputType, clientStreaming = false, serverStreaming = false }) => ({
        name,
        inputType,
        outputType,
        clientStreaming,
        serverStreaming,
      }),
    );
    const methods = methodsByService.get(service.name);
    assert.deepEqual(
      signatures,
      methods.map((name) => ({
        name,
        inputType: `.${protoPackage}.${name}Request`,
        outputType: `.${protoPackage}.${name}Response`,
        clientStreaming: false,
        serverStreaming: service.name === 'BoardRoomService' && name === 'StreamBoardRoomEvents',
      })),
    );
  }
});

test('keeps the workspace generation and ordered Agent edits together in one command', () => {
  assertRoundTrip('ApplyAgentBoardEditRequest', {
    boardId,
    agentId: 'agent-editor',
    taskId: 'work-section',
    generation: 'generation-1',
    commandId,
    operations: [
      { geometry: { changeLock: { targets: [{ objectId, expectedGeometryVersion: '0' }], locked: true } } },
      { content: { objectId, expectedPayloadVersion: '0', text: { text: 'Scoped write' } } },
    ],
  });
});

test('preserves the expected sharing version and keeps invitations separate from guest sessions', () => {
  assertRoundTrip('UpdateBoardSharingRequest', {
    boardId,
    commandId,
    expectedVersion: '0',
    setScope: { scope: 'SHARING_SCOPE_LAN' },
  });
  assertRoundTrip('JoinBoardInvitationResponse', {
    session: {
      boardId,
      actorId: 'guest-123',
      name: '访客',
      role: 'SHARING_ROLE_COMMENTER',
      version: boardRevision,
      canComment: true,
    },
  });
});

test('preserves suggestion source references and existing typed edit operations', () => {
  assertRoundTrip('CreateBoardReviewSourceRequest', {
    boardId,
    commandId,
    selection: { objectIds: ['shape-1'] },
    expectedBoardRevision: '0',
  });
  assertRoundTrip('SubmitBoardSuggestionRequest', {
    boardId,
    commandId,
    sourceId: 'selection-1',
    observation: '更新任务标记。',
    options: [
      {
        optionId: 'alternative-1',
        label: '修改名称',
        content: {
          objectId: 'shape-1',
          expectedPayloadVersion: '0',
          text: { text: '新名称' },
        },
      },
    ],
  });
  assertRoundTrip('AcceptBoardSuggestionRequest', {
    boardId,
    commandId,
    proposalId: 'proposal-1',
    optionId: 'alternative-1',
    expectedProposalVersion: '0',
  });
});

test('preserves the ordered operations of one suggestion and simultaneous active option IDs', () => {
  assertRoundTrip('SubmitBoardSuggestionRequest', {
    boardId,
    commandId,
    sourceId: 'selection-1',
    observation: '保留顺序和对象版本。',
    options: [
      {
        optionId: 'multi',
        label: '缩放并改正文',
        operations: [
          {
            geometry: {
              transform: {
                kind: 'BOARD_TRANSFORM_KIND_RESIZE',
                objects: [
                  {
                    target: { objectId: 'text-1', expectedGeometryVersion: '0' },
                    geometry: { width: 500, height: 300 },
                  },
                ],
              },
            },
          },
          {
            content: {
              objectId: 'text-1',
              expectedPayloadVersion: '0',
              text: { text: '修改后的正文' },
            },
          },
        ],
      },
    ],
  });
  assertRoundTrip('ListBoardSuggestionsResponse', {
    proposals: [
      {
        proposalId: 'proposal-1',
        sourceId: 'selection-1',
        observation: '同时显示有效方案。',
        proposalVersion: '2',
        expiresAtMillis: '123',
        activeOptionIds: ['multi', 'detail'],
      },
    ],
  });
});

test('preserves native content commands and independent table width checks', () => {
  const common = { boardId, commandId, objectId: 'native-object', expectedPayloadVersion: '0' };
  assertRoundTrip('EditObjectContentRequest', {
    ...common,
    table: {
      table: {
        text: '验收表格',
        grid: {
          rows: [{ cells: [{ text: '名称' }, { number: 2 }] }],
          rowIds: ['row-1'],
          columnIds: ['col-1', 'col-2'],
          columnWidths: [240, 270],
          head: true,
        },
      },
      widthChange: { expectedWidth: 480, width: 510 },
    },
  });
  assertRoundTrip('EditObjectContentRequest', {
    ...common,
    embedSource: {
      title: '验收图解',
      html: '<p>最新源码</p>',
      expectedSourceRevision: '9007199254740993',
    },
  });
  assertRoundTrip('EditObjectContentRequest', {
    ...common,
    embedState: { state: { phase: 'ready', positions: [2, 4] } },
  });
  assertRoundTrip('EditObjectContentRequest', {
    ...common,
    sticker: { stickerId: 'heart' },
  });
  assertRoundTrip('EditObjectContentRequest', {
    ...common,
    crop: {
      crop: { zoom: 1.5, x: 0.25, y: 0.75 },
      naturalSize: { width: 2, height: 3 },
    },
  });
});

test('uses the existing embedded payload on a geometry creation command', () => {
  const title = 'HTML 图解';
  const html = '<!doctype html><html lang="zh-CN"><p>流程预览</p></html>';
  assertRoundTrip('EditBoardGeometryRequest', {
    boardId,
    commandId,
    create: {
      object: {
        objectId: 'new-html-diagram',
        kind: 'html',
        label: title,
        geometry: { x: 80, y: 80, width: 1440, height: 1120 },
      },
      initialPayload: { embed: { title, html, sourceRevision: '0' } },
    },
  });
});

test('preserves the source version and the two ports for an atomic adjacent shape creation', () => {
  assertRoundTrip('EditBoardGeometryRequest', {
    boardId,
    commandId,
    create: {
      object: {
        objectId: 'adjacent-shape',
        kind: 'shape',
        geometry: { x: 200, y: 30, width: 144, height: 100 },
      },
      attachment: {
        source: { objectId, expectedGeometryVersion: '0' },
        sourcePort: 'CONNECTOR_PORT_RIGHT',
        targetPort: 'CONNECTOR_PORT_LEFT',
        connectorId: 'adjacent-arrow',
      },
    },
  });
});

test('keeps the applied editing receipt when optional historical details expire', () => {
  assertRoundTrip('GetBoardEditReceiptResponse', {
    receipt: {
      boardId,
      commandId,
      applied: { boardRevision: '181', detailsExpired: true },
    },
  });
});

test('preserves the source board and command identity when duplicating', () => {
  assertRoundTrip('DuplicateBoardRequest', { commandId, sourceBoardId: boardId });
});

test('preserves list filters, offsets and explicitly requested preview revision zero', () => {
  assertRoundTrip('ListBoardsRequest', {
    query: 'Architecture',
    pageSize: 10,
    pinnedOnly: true,
    offset: 0,
  });
  assertRoundTrip('ListTrashedBoardsRequest', {
    query: 'Architecture',
    order: 'BOARD_SORT_ORDER_TITLE',
    pageSize: 10,
    pinnedOnly: true,
    offset: 1,
  });
  assertRoundTrip('GetBoardThumbnailRequest', { boardId, revision: '0', trashed: true });
});

test('preserves a document image command without canvas geometry', () => {
  assertRoundTrip('UploadBoardDocumentImageRequest', { boardId, commandId, objectId, content: 'AQID' });
});

test('binds the rich PNG render plan and ZIP request to one saved revision', () => {
  assertRoundTrip('ExportBoardRequest', {
    boardId,
    expectedRevision: boardRevision,
    whole: {},
    format: 'BOARD_EXPORT_FORMAT_ZIP',
  });
  const plan = {
    filename: '布局.png',
    revision: boardRevision,
    width: 320.5,
    height: 480,
    svgTemplate: '<svg/>',
    regions: [{ index: 2, html: '<p>原稿</p>', width: 240, height: 160 }],
  };
  assertRoundTrip('ExportBoardResponse', { browserPng: plan });
  assertRoundTrip('ExportBoardVersionResponse', { browserPng: plan });
});

test('preserves confirmed import outcomes and distinguishes missing archive receipts', () => {
  const imported = { commandId, imported: { boardId, title: '导入的白板' } };
  assertRoundTrip('ImportBoardArchiveResponse', { receipt: imported });
  assertRoundTrip('GetArchiveImportReceiptResponse', { receipt: imported });
  assertRoundTrip('GetArchiveImportReceiptResponse', { notRecorded: { commandId } });
  assertRoundTrip('ImportBoardArchiveResponse', {
    receipt: {
      commandId,
      rejected: {
        reason: 'ARCHIVE_IMPORT_REJECTION_REASON_INVALID_ARCHIVE',
        message: '备份格式无效。',
      },
    },
  });
});

test('preserves omitted, zero, and large expected geometry versions', () => {
  const request = {
    boardId,
    commandId,
    delta: { dx: 4.5, dy: -2 },
    targets: [
      { objectId, expectedGeometryVersion: '0' },
      { objectId: 'card-2' },
      { objectId: 'card-3', expectedGeometryVersion: geometryVersion },
    ],
  };
  assertRoundTrip('MoveObjectsRequest', request);

  const omitted = Buffer.from([0x0a, 0x01, 0x61]);
  const zero = Buffer.from([0x0a, 0x01, 0x61, 0x10, 0x00]);
  assert.deepEqual(decode('MoveTarget', omitted), { objectId: 'a' });
  assert.deepEqual(decode('MoveTarget', zero), { objectId: 'a', expectedGeometryVersion: '0' });
  assert.notDeepEqual(
    encode('MoveTarget', { objectId: 'a' }),
    encode('MoveTarget', { objectId: 'a', expectedGeometryVersion: '0' }),
  );
});

test('opens an ordered metadata scene without embedding object payloads', () => {
  const scene = {
    boardId,
    title: '第一阶段',
    boardRevision,
    objects: [
      {
        ...cardMetadata,
        objectId: 'shape-2',
        kind: 'shape',
        label: '图形',
        geometryVersion: '0',
        shape: { outline: 'rounded' },
      },
      cardMetadata,
      inkMetadata,
    ],
    access: { canEdit: true },
  };
  assertRoundTrip('GetBoardSceneResponse', { scene });

  const metadataWithPayload = {
    ...cardMetadata,
    payload: { payloadVersion, document: { title: '独立读取的正文' } },
  };
  assert.deepEqual(decode('ObjectMetadata', encode('ObjectMetadata', metadataWithPayload)), cardMetadata);

  const metadataWithInkSamples = {
    ...inkMetadata,
    ink: { ...inkMetadata.ink, points: inkPoints },
  };
  assert.deepEqual(
    decode('ObjectMetadata', encode('ObjectMetadata', metadataWithInkSamples)),
    inkMetadata,
  );
});

test('returns decoded payloads and unavailability in the same batch', () => {
  const reply = {
    boardId,
    results: [
      {
        objectId,
        payload: {
          payloadVersion,
          document: {
            title: '计划草案',
            schemaVersion: 1,
            blocks: [
              {
                blockId: 'heading-1',
                type: 'heading',
                props: { level: 2 },
                content: '第一阶段',
                children: [{ blockId: 'note-1', type: 'paragraph', content: '先验证契约' }],
              },
            ],
          },
        },
      },
      {
        objectId: inkMetadata.objectId,
        payload: { payloadVersion, ink: { points: inkPoints } },
      },
      {
        objectId: 'missing-card',
        unavailable: { reason: 'OBJECT_PAYLOAD_UNAVAILABLE_REASON_NOT_FOUND' },
      },
    ],
  };

  assertRoundTrip('GetObjectPayloadsResponse', reply);
});

test('preserves explicit table cell values and extension bytes', () => {
  assertRoundTrip('ObjectPayload', {
    payloadVersion: '0',
    table: {
      grid: {
        rows: [
          {
            cells: [{ number: 0 }, { boolValue: false }, { nullValue: null }, { text: '' }],
          },
        ],
      },
    },
  });
  assertRoundTrip('ObjectPayload', {
    payloadVersion,
    extension: { schemaId: 'example.serialized.v1', data: 'AP8BAg==' },
  });
});

test('preserves applied, conflict, and rejected move outcomes', () => {
  const absoluteConnector = {
    ...connectorMetadata,
    connector: {
      ...connectorEndpoints,
      bends: [{ x: 115, y: 12 }],
      labelOffset: { x: 1, y: -1 },
      endHead: 'CONNECTOR_HEAD_ARROW',
    },
  };
  const relativeConnector = {
    ...connectorMetadata,
    objectId: 'connector-2',
    connector: {
      ...connectorEndpoints,
      relativeBends: { firstAxis: 'BEND_AXIS_HORIZONTAL', offsets: [4.5, -2] },
    },
  };
  const outcomes = [
    { applied: { boardRevision, objects: [cardMetadata, absoluteConnector, relativeConnector] } },
    {
      conflict: {
        reason: 'MOVE_CONFLICT_REASON_GEOMETRY_VERSION_CHANGED',
        boardRevision,
        currentObjects: [cardMetadata],
      },
    },
    { rejected: { reason: 'MOVE_REJECTION_REASON_GEOMETRY_LOCKED' } },
  ];

  for (const outcome of outcomes) {
    assertRoundTrip('MoveObjectsResponse', { receipt: { boardId, commandId, ...outcome } });
  }
});

test('distinguishes a receipt lookup with no record from a recorded outcome', () => {
  assertRoundTrip('GetCommandReceiptRequest', { boardId, commandId });
  assertRoundTrip('GetCommandReceiptResponse', {
    receipt: { boardId, commandId, applied: { boardRevision, objects: [cardMetadata] } },
  });
  assertRoundTrip('GetCommandReceiptResponse', { notRecorded: { boardId, commandId } });
  assert.deepEqual(decode('GetCommandReceiptResponse', Buffer.alloc(0)), {});
});
