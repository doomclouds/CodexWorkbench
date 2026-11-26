import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardHistoryService,
  BoardVersionKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import { BoardExportFormat } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { createBoardHistoryService, type WhiteboardPost } from '../../src/data/whiteboard/index.js';

const boardId = 'history-board';
const title = '交付清单';
const objectId = 'archive-image';
const commandId = 'restore-archive';
const source = '/studio-archive-assets/history-board/asset-id';
const revision = 9_007_199_254_740_995n;
const {
  listBoardVersions,
  getBoardVersionScene,
  getBoardVersionPayloads,
  restoreBoardVersion,
  exportBoardVersion,
} = BoardHistoryService.method;
const getBoardEditReceipt = BoardEditService.method.getBoardEditReceipt;

function historyPath(method: string) {
  return '/' + BoardHistoryService.typeName + '/' + method;
}

test('lists historical versions with an exclusive cursor and preserves revision zero', async () => {
  const post: WhiteboardPost = async (path, bytes) => {
    expect(path).toBe(historyPath('ListBoardVersions'));
    expect(fromBinary(listBoardVersions.input, bytes)).toMatchObject({
      boardId,
      beforeRevision: 1n,
    });

    return toBinary(
      listBoardVersions.output,
      create(listBoardVersions.output, {
        currentRevision: revision,
        versions: [{ revision: 0n, title, kind: BoardVersionKind.BASELINE, changedObjectCount: 0 }],
      }),
    );
  };

  await expect(createBoardHistoryService(post).listVersions(boardId, 1n)).resolves.toMatchObject({
    currentRevision: revision,
    versions: [{ revision: 0n, kind: 'baseline', title }],
  });
});

test('loads a read-only scene and resolves only the requested archived payloads for that revision', async () => {
  const post: WhiteboardPost = async (path, bytes) => {
    if (path === historyPath('GetBoardVersionScene')) {
      expect(fromBinary(getBoardVersionScene.input, bytes)).toMatchObject({ boardId, revision });

      return toBinary(
        getBoardVersionScene.output,
        create(getBoardVersionScene.output, {
          scene: {
            boardId,
            title,
            boardRevision: revision,
            access: { canEdit: true },
            objects: [],
          },
        }),
      );
    }

    expect(path).toBe(historyPath('GetBoardVersionPayloads'));
    expect(fromBinary(getBoardVersionPayloads.input, bytes)).toMatchObject({
      boardId,
      revision,
      objectIds: [objectId],
    });

    return toBinary(
      getBoardVersionPayloads.output,
      create(getBoardVersionPayloads.output, {
        boardId,
        revision,
        results: [
          {
            objectId,
            result: {
              case: 'payload',
              value: {
                payloadVersion: 3n,
                body: {
                  case: 'document',
                  value: {
                    title: '历史文档',
                    schemaVersion: 1,
                    blocks: [{ blockId: 'image-block', type: 'image', props: { url: source } }],
                  },
                },
              },
            },
          },
        ],
      }),
    );
  };

  const service = createBoardHistoryService(post, (value) => 'https://studio.test' + value);
  await expect(service.getVersionScene(boardId, revision)).resolves.toEqual({
    boardId,
    title,
    revision,
    canEdit: false,
    objects: [],
  });
  await expect(
    service.getVersionPayloads(boardId, revision, [objectId, objectId]),
  ).resolves.toMatchObject([
    {
      kind: 'loaded',
      payload: {
        id: objectId,
        version: 3n,
        body: {
          kind: 'document',
          value: { document: { blocks: [{ props: { url: 'https://studio.test' + source } }] } },
        },
      },
    },
  ]);
});

test('rejects a scene or a download with a different saved revision', async () => {
  const post: WhiteboardPost = async (path, bytes) => {
    if (path === historyPath('GetBoardVersionScene')) {
      return toBinary(
        getBoardVersionScene.output,
        create(getBoardVersionScene.output, {
          scene: { boardId, title, boardRevision: revision + 1n, access: { canEdit: false } },
        }),
      );
    }

    const query = fromBinary(exportBoardVersion.input, bytes);
    expect(query).toMatchObject({
      boardId,
      revision,
      format: BoardExportFormat.JSON,
      scope: { case: 'selection', value: { objectIds: [objectId] } },
    });

    return toBinary(
      exportBoardVersion.output,
      create(exportBoardVersion.output, {
        result: {
          case: 'file',
          value: {
            filename: '白板.json',
            mimeType: 'application/json',
            revision: revision + 1n,
            content: new TextEncoder().encode('{}'),
          },
        },
      }),
    );
  };

  const service = createBoardHistoryService(post);
  await expect(service.getVersionScene(boardId, revision)).rejects.toThrow('版次');
  await expect(
    service.exportVersion({
      boardId,
      revision,
      format: 'json',
      scope: { kind: 'selection', objectIds: [objectId] },
    }),
  ).rejects.toThrow('版次');
});

test('submits a fixed source and current revision and uses the edit service for receipt recovery', async () => {
  const receipt = {
    boardId,
    commandId,
    outcome: { case: 'applied' as const, value: { boardRevision: revision + 2n } },
  };
  const post: WhiteboardPost = async (path, bytes) => {
    if (path === historyPath('RestoreBoardVersion')) {
      expect(fromBinary(restoreBoardVersion.input, bytes)).toMatchObject({
        boardId,
        commandId,
        revision: 0n,
        expectedCurrentRevision: revision + 1n,
        scope: { case: 'whole' },
      });

      return toBinary(restoreBoardVersion.output, create(restoreBoardVersion.output, { receipt }));
    }

    expect(path).toBe('/' + BoardEditService.typeName + '/GetBoardEditReceipt');
    expect(fromBinary(getBoardEditReceipt.input, bytes)).toMatchObject({ boardId, commandId });

    return toBinary(getBoardEditReceipt.output, create(getBoardEditReceipt.output, { receipt }));
  };
  const service = createBoardHistoryService(post);
  const applied = await service.restoreVersion({
    boardId,
    commandId,
    revision: 0n,
    expectedCurrentRevision: revision + 1n,
    scope: { kind: 'whole' },
  });
  expect(applied).toMatchObject({ kind: 'applied', boardId, commandId, revision: revision + 2n });
  await expect(service.getRestoreReceipt(boardId, commandId)).resolves.toEqual(applied);
});
