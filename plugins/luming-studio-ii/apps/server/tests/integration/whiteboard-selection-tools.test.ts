import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardArrangePreset,
  BoardEditRejectionReason,
  BoardEditService,
  type EditBoardGeometryRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import {
  documentId,
  editorId,
  lockedId,
  mainBoardId,
  outsiderId,
  secondBoardId,
  shapeId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type Edit = MessageInitShape<typeof EditBoardGeometryRequestSchema>['operation'];

const server = useWhiteboardTestServer();
const { attachBoardImage, editBoardGeometry } = BoardEditService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const sectionId = 'selection-section';

function targets(expectedGeometryVersion: bigint) {
  return [shapeId, documentId].map((objectId) => ({ objectId, expectedGeometryVersion }));
}

function edit(commandId: string, operation: Edit, boardId = mainBoardId, actor = editorId) {
  return callWhiteboard(server.address, actor, editBoardGeometry, {
    boardId,
    commandId,
    operation,
  });
}

test('groups and ungroups the selected objects through geometry CAS', async () => {
  const group = await edit('group-selection', {
    case: 'group',
    value: { groupId: 'selection-group', targets: targets(0n) },
  });
  expect(group.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: shapeId, groupId: 'selection-group', geometryVersion: 1n },
        { objectId: documentId, groupId: 'selection-group', geometryVersion: 1n },
      ],
    },
  });

  const stale = await edit('ungroup-old', { case: 'ungroup', value: { targets: targets(0n) } });
  expect(stale.receipt?.outcome.case).toBe('conflict');
  const saved = await edit('ungroup-selection', {
    case: 'ungroup',
    value: { targets: targets(1n) },
  });
  expect(saved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: shapeId, geometryVersion: 2n },
        { objectId: documentId, geometryVersion: 2n },
      ],
    },
  });
  const outcome = saved.receipt?.outcome;
  assert.ok(outcome?.case === 'applied');
  expect(outcome.value.changedObjects.every(({ groupId }) => groupId === undefined)).toBe(true);
});

test('inserts a transparent section behind the selection and persists a bounded rename', async () => {
  const created = await edit('draw-section', {
    case: 'createSection',
    value: { sectionId, title: 'Overview', targets: targets(0n) },
  });
  expect(created.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        {
          objectId: sectionId,
          kind: 'section',
          label: 'Overview',
          geometry: { x: -8, y: -32, width: 232, height: 160 },
          geometryDetail: { case: 'section', value: { transparent: true } },
        },
        { objectId: shapeId, parentId: sectionId, geometryVersion: 1n },
        { objectId: documentId, parentId: sectionId, geometryVersion: 1n },
      ],
    },
  });

  const title = '设计总览';
  const target = { objectId: sectionId, expectedGeometryVersion: 0n };
  const tooLarge = await edit('section-name-large', {
    case: 'style',
    value: { targets: [{ target }], patch: { label: '界'.repeat(1400) } },
  });
  expect(tooLarge.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const renamed = await edit('section-name', {
    case: 'style',
    value: { targets: [{ target }], patch: { label: title } },
  });
  expect(renamed.receipt?.outcome.case).toBe('applied');

  await server.restart();
  const reopened = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(reopened.scene?.objects[0]).toMatchObject({ objectId: sectionId, label: title });
  const body = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [sectionId],
  });
  expect(body.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: 1n, body: { case: 'text', value: { text: title } } },
  });
});

test('aligns actual geometry while leaving the selection anchor and locked objects intact', async () => {
  const aligned = await edit('align-selection', {
    case: 'arrange',
    value: { targets: targets(0n), preset: BoardArrangePreset.TOP },
  });
  expect(aligned.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [{ objectId: documentId, geometryVersion: 1n, geometry: { x: 100, y: -8 } }],
    },
  });

  const next = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(next.scene?.objects.find(({ objectId }) => objectId === lockedId)).toMatchObject({
    geometryVersion: 0n,
    geometry: { y: 44 },
    locked: true,
  });
});

test('tidies loose objects with the original square-grid ordering and margin', async () => {
  const tidied = await edit('tidy-selection', {
    case: 'arrange',
    value: { targets: targets(0n), preset: BoardArrangePreset.TIDY },
  });
  expect(tidied.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [{ objectId: documentId, geometryVersion: 1n, geometry: { x: 140, y: -8 } }],
    },
  });
});

test('draws a selection frame around locked content without reparenting that content', async () => {
  const created = await edit('frame-locked', {
    case: 'createSection',
    value: {
      sectionId,
      targets: [shapeId, lockedId].map((objectId) => ({ objectId, expectedGeometryVersion: 0n })),
    },
  });
  expect(created.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [{ objectId: sectionId }, { objectId: shapeId, parentId: sectionId }],
    },
  });
  const board = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  const locked = board.scene?.objects.find(({ objectId }) => objectId === lockedId);
  expect(locked).toMatchObject({
    geometryVersion: 0n,
    locked: true,
  });
  expect(locked?.parentId).toBeUndefined();
});

test('applies bold and italic to a previously empty body and checks existing versions', async () => {
  const target = { objectId: shapeId, expectedGeometryVersion: 0n };
  const opened = await edit('format-empty-shape', {
    case: 'style',
    value: { targets: [{ target }], patch: { bold: true, italic: true } },
  });
  expect(opened.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { changedObjects: [{ objectId: shapeId, geometryVersion: 0n, payloadVersion: 0n }] },
  });
  const changed = await edit('clear-bold', {
    case: 'style',
    value: { targets: [{ target, expectedPayloadVersion: 0n }], patch: { bold: false } },
  });
  expect(changed.receipt?.outcome.case).toBe('applied');
  const outdated = await edit('stale-italic', {
    case: 'style',
    value: { targets: [{ target, expectedPayloadVersion: 0n }], patch: { italic: false } },
  });
  expect(outdated.receipt?.outcome.case).toBe('conflict');

  const saved = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [shapeId],
  });
  expect(saved.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: 1n, body: { case: 'text', value: { bold: false, italic: true } } },
  });
});

test('allows paint on locked shapes while a shape-to-text conversion still honors the lock', async () => {
  const target = { objectId: lockedId, expectedGeometryVersion: 0n };
  const painted = await edit('paint-locked-shape', {
    case: 'style',
    value: { targets: [{ target }], patch: { fill: '#aabbcc', dashed: true } },
  });
  expect(painted.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: lockedId, locked: true, appearance: { fill: '#aabbcc', dashed: true } },
      ],
    },
  });
  const converted = await edit('form-locked-shape', {
    case: 'style',
    value: {
      targets: [{ target: { ...target, expectedGeometryVersion: 1n } }],
      patch: { shapeForm: 'text' },
    },
  });
  expect(converted.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
  });
});

test('pastes the captured revision after cut and preserves its original receipt on retry', async () => {
  const removed = await edit('cut-selection', {
    case: 'delete',
    value: { targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }] },
  });
  expect(removed.receipt?.outcome.case).toBe('applied');

  const operation: Edit = {
    case: 'paste',
    value: {
      sourceBoardId: mainBoardId,
      sourceRevision: 0n,
      targets: [{ sourceObjectId: shapeId, objectId: 'cut-paste-shape' }],
      delta: { dx: 32, dy: 32 },
    },
  };
  const pasted = await edit('paste-cut', operation);
  expect(pasted.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: 'cut-paste-shape', geometryVersion: 0n, geometry: { x: 48, y: 24 } },
      ],
    },
  });

  await server.restart();
  const replay = await edit('paste-cut', operation);
  expect(replay.receipt).toEqual(pasted.receipt);
});

const originImage = 'clipboard-origin-image';
const destinationImage = 'clipboard-destination-image';

async function seedImage() {
  const attached = await callWhiteboard(server.address, editorId, attachBoardImage, {
    boardId: mainBoardId,
    commandId: 'clipboard-image-attach',
    objectId: originImage,
    displayName: 'Sample.png',
    content: pngImage,
    geometry: { x: 10, y: 20, width: 100, height: 100 },
  });
  expect(attached.receipt?.outcome.case).toBe('applied');
}

function pasteImage(): Edit {
  return {
    case: 'paste',
    value: {
      sourceBoardId: mainBoardId,
      sourceRevision: 1n,
      targets: [{ sourceObjectId: originImage, objectId: destinationImage }],
      delta: { dx: 32, dy: 32 },
    },
  };
}

test('copies media to the destination resource namespace and denies unreadable source boards', async () => {
  await seedImage();
  const pasted = await edit('paste-clipboard-image', pasteImage(), secondBoardId);
  expect(pasted.receipt?.outcome.case).toBe('applied');

  const payloads = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: secondBoardId,
    objectIds: [destinationImage],
  });
  const result = payloads.results[0]?.result;
  assert.ok(result?.case === 'payload' && result.value.body.case === 'image');
  const path = result.value.body.value.src;
  assert.ok(path);
  expect(path.startsWith('/studio-archive-assets/' + secondBoardId + '/paste-')).toBe(true);
  const served = await fetch(new URL(path, server.address), {
    headers: { [actorHeader]: editorId },
    signal: AbortSignal.timeout(5_000),
  });
  expect(served.status).toBe(200);
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(pngImage);

  const destination = await callWhiteboard(
    server.address,
    outsiderId,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'create-private-destination',
      title: 'Private board',
    },
  );
  const outcome = destination.receipt?.outcome;
  assert.ok(outcome?.case === 'created');
  const denied = await edit(
    'paste-without-source-access',
    pasteImage(),
    outcome.value.boardId,
    outsiderId,
  );
  expect(denied.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });
});
