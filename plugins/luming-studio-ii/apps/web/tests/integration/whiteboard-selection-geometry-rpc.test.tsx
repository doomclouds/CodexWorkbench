import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardArrangePreset,
  BoardEditRejectionReason,
  BoardEditService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { TextAlignment } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { ConnectorHead } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { expect, test } from 'vitest';

import {
  createWhiteboardEditService,
  type EditBoardGeometryOperation,
  type WhiteboardArrangePreset,
} from '../../src/data/whiteboard/index.js';

const { editBoardGeometry } = BoardEditService.method;
const identity = { boardId: 'target-board', commandId: 'selection-command' };
const revision = 9_007_199_254_740_995n;
const targets = [
  { id: 'first', expectedGeometryVersion: 0n },
  { id: 'second', expectedGeometryVersion: revision },
];
const wireTargets = [
  { objectId: 'first', expectedGeometryVersion: 0n },
  { objectId: 'second', expectedGeometryVersion: revision },
];
const route = '/luming.studio.v1.BoardEditService/EditBoardGeometry';
const geometry = { x: 24, y: 32, width: 80, height: 35, rotation: 0 };

type GeometryResponse = MessageInitShape<typeof editBoardGeometry.output>;

function reply(receipt: GeometryResponse['receipt']) {
  return toBinary(editBoardGeometry.output, create(editBoardGeometry.output, { receipt }));
}

function applied(changedObjects: readonly { readonly objectId: string; readonly kind: string }[]) {
  return reply({
    ...identity,
    outcome: {
      case: 'applied',
      value: {
        boardRevision: revision,
        changedObjects: changedObjects.map((object) => ({
          ...object,
          geometry,
          label: object.objectId,
          geometryVersion: 0n,
        })),
      },
    },
  });
}

function rejected(reason: BoardEditRejectionReason) {
  return reply({
    ...identity,
    outcome: { case: 'rejected', value: { reason } },
  });
}

const grouping = [
  [{ kind: 'group', targets, groupId: 'connected-cards' }, { groupId: 'connected-cards' }],
  [{ kind: 'ungroup', targets }, {}],
] as const;

test.each(grouping)(
  'sends explicit target CAS for grouping operation %o',
  async (operation, extra) => {
    const service = createWhiteboardEditService(async (path, bytes) => {
      expect(path).toBe(route);
      expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
        ...identity,
        operation: { case: operation.kind, value: { targets: wireTargets, ...extra } },
      });

      return rejected(BoardEditRejectionReason.GEOMETRY_LOCKED);
    });

    await expect(service.editGeometry({ ...identity, operation })).resolves.toEqual({
      ...identity,
      kind: 'rejected',
      reason: 'geometryLocked',
    });
  },
);

test('sends an optional section title and requires confirmation of the requested new section', async () => {
  const operation: EditBoardGeometryOperation = {
    kind: 'createSection',
    targets,
    sectionId: 'selection-section',
    title: '发布范围',
  };
  const service = createWhiteboardEditService(async (path, bytes) => {
    expect(path).toBe(route);
    expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
      ...identity,
      operation: {
        case: 'createSection',
        value: { sectionId: operation.sectionId, title: operation.title, targets: wireTargets },
      },
    });

    return applied([{ objectId: operation.sectionId, kind: 'section' }]);
  });

  await expect(service.editGeometry({ ...identity, operation })).resolves.toMatchObject({
    ...identity,
    kind: 'applied',
    revision,
    objects: [{ id: 'selection-section', kind: 'section' }],
  });
});

const arrangePresets = [
  ['tidy', BoardArrangePreset.TIDY],
  ['left', BoardArrangePreset.LEFT],
  ['hcenter', BoardArrangePreset.HCENTER],
  ['right', BoardArrangePreset.RIGHT],
  ['top', BoardArrangePreset.TOP],
  ['vcenter', BoardArrangePreset.VCENTER],
  ['bottom', BoardArrangePreset.BOTTOM],
] as const satisfies readonly (readonly [WhiteboardArrangePreset, BoardArrangePreset])[];

test.each(arrangePresets)(
  'encodes arrange preset %s with every target version',
  async (preset, wire) => {
    const service = createWhiteboardEditService(async (path, bytes) => {
      expect(path).toBe(route);
      expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
        ...identity,
        operation: { case: 'arrange', value: { targets: wireTargets, preset: wire } },
      });

      return applied([
        { objectId: 'first', kind: 'shape' },
        { objectId: 'second', kind: 'shape' },
      ]);
    });

    await expect(
      service.editGeometry({ ...identity, operation: { kind: 'arrange', targets, preset } }),
    ).resolves.toMatchObject({ kind: 'applied', revision });
  },
);

test('keeps style fields optional and encodes explicit false and independent payload versions', async () => {
  const [first, second] = targets;
  if (!first || !second) {
    throw new Error('Expected two style targets.');
  }

  const style = {
    fill: '#fff2bf',
    stroke: '#263648',
    strokeWidth: 1.5,
    dashed: false,
    textColor: '#415061',
    fontFamily: 'Arial',
    fontSize: 24,
    textAlign: 'center',
    shapeForm: 'rounded',
    startHead: 'none',
    endHead: 'arrow',
  } as const;
  const service = createWhiteboardEditService(async (path, bytes) => {
    expect(path).toBe(route);
    const request = fromBinary(editBoardGeometry.input, bytes);
    if (request.operation.case !== 'style') {
      throw new Error('Expected a style operation.');
    }

    expect(request.operation.value.targets[1]?.expectedPayloadVersion).toBeUndefined();
    expect(request.operation.value.patch?.hollow).toBeUndefined();
    expect(request).toMatchObject({
      ...identity,
      operation: {
        case: 'style',
        value: {
          targets: [
            { target: wireTargets[0], expectedPayloadVersion: 0n },
            { target: wireTargets[1] },
          ],
          patch: {
            ...style,
            textAlign: TextAlignment.CENTER,
            startHead: ConnectorHead.NONE,
            endHead: ConnectorHead.ARROW,
          },
        },
      },
    });

    return rejected(BoardEditRejectionReason.INVALID_EDIT);
  });

  const operation = {
    kind: 'style',
    targets: [{ target: first, expectedPayloadVersion: 0n }, { target: second }],
    patch: style,
  } as const satisfies EditBoardGeometryOperation;
  await expect(service.editGeometry({ ...identity, operation })).resolves.toEqual({
    ...identity,
    kind: 'rejected',
    reason: 'invalidEdit',
  });
});

test('requests paste by source IDs and saved version without transferring object bodies', async () => {
  const operation: EditBoardGeometryOperation = {
    kind: 'paste',
    sourceBoardId: 'source-board',
    sourceRevision: 0n,
    targets: [
      { sourceObjectId: 'source-picture', newObjectId: 'pasted-picture' },
      { sourceObjectId: 'source-note', newObjectId: 'pasted-note' },
    ],
    delta: { x: -18, y: 32 },
  };
  const service = createWhiteboardEditService(async (path, bytes) => {
    expect(path).toBe(route);
    expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
      ...identity,
      operation: {
        case: 'paste',
        value: {
          sourceBoardId: 'source-board',
          sourceRevision: 0n,
          targets: [
            { sourceObjectId: 'source-picture', objectId: 'pasted-picture' },
            { sourceObjectId: 'source-note', objectId: 'pasted-note' },
          ],
          delta: { dx: -18, dy: 32 },
        },
      },
    });

    return applied([
      { objectId: 'pasted-picture', kind: 'image' },
      { objectId: 'pasted-note', kind: 'note' },
    ]);
  });

  await expect(service.editGeometry({ ...identity, operation })).resolves.toMatchObject({
    ...identity,
    kind: 'applied',
    revision,
    objects: [{ id: 'pasted-picture' }, { id: 'pasted-note' }],
  });
});

const creating = [
  { kind: 'createSection', targets, sectionId: 'selection-section' },
  {
    kind: 'paste',
    sourceBoardId: 'source-board',
    sourceRevision: revision,
    targets: [{ sourceObjectId: 'old-note', newObjectId: 'new-note' }],
    delta: { x: 10, y: 10 },
  },
] as const satisfies readonly EditBoardGeometryOperation[];

test.each(creating)(
  'rejects an applied receipt that omits its new object %o',
  async (operation) => {
    const service = createWhiteboardEditService(async () =>
      applied([{ objectId: 'unrelated-card', kind: 'shape' }]),
    );

    await expect(service.editGeometry({ ...identity, operation })).rejects.toThrow(
      'did not confirm creation',
    );
  },
);
