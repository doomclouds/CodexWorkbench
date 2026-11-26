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

test('declares the typed unary methods for archive receipts, board catalog, and whiteboard editing', () => {
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
    ['BoardArchiveService', ['GetArchiveImportReceipt']],
    ['BoardCatalogService', ['ListBoards', 'CreateBoard', 'GetCatalogCommandReceipt']],
    ['WhiteboardService', ['GetBoardScene', 'GetObjectPayloads', 'MoveObjects', 'GetCommandReceipt']],
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
        serverStreaming: false,
      })),
    );
  }
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
