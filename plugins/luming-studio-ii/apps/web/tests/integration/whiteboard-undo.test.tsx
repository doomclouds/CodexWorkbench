import { expect, test } from 'vitest';
import type {
  BoardEditReceipt,
  ReverseBoardEditCommand,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

const boardId = 'canvas-undo-board';
const object: WhiteboardObject = {
  id: 'undo-shape',
  kind: 'shape',
  label: '白板对象',
  geometry: { x: 48, y: 48, width: 120, height: 90, rotation: 0 },
  geometryVersion: 0n,
  locked: false,
};

async function unavailable(): Promise<never> {
  throw new Error('Unexpected operation in undo fixture.');
}

function makeUndoFixture() {
  let objects: readonly WhiteboardObject[] = [object];
  let revision = 0n;
  let sequence = 0;
  const reverseCalls: ReverseBoardEditCommand[] = [];
  const receiptQueries: { boardId: string; commandId: string; signal?: AbortSignal }[] = [];
  const service: WhiteboardService = {
    async getScene() {
      return { boardId, title: '撤销重做回归', revision, canEdit: true, objects };
    },
    getPayloads: async () => [],
    moveObjects: unavailable,
    getReceipt: unavailable,
  };

  function apply(commandId: string, present: boolean): BoardEditReceipt {
    revision += 1n;
    objects = present ? [{ ...object, geometryVersion: revision }] : [];

    return {
      kind: 'applied',
      boardId,
      commandId,
      revision,
      objects,
      removedIds: present ? [] : [object.id],
      order: [],
      payloads: [],
    };
  }

  const editService: WhiteboardEditService = {
    async editGeometry({ commandId, operation }) {
      expect(operation.kind).toBe('delete');

      return apply(commandId, false);
    },
    async reverseEdit(command) {
      reverseCalls.push(command);
      if (reverseCalls.length === 1) {
        throw new Error('编辑回执暂未到达。');
      }

      return apply(command.commandId, reverseCalls.length === 2);
    },
    editContent: unavailable,
    attachImage: unavailable,
    async getReceipt(boardId, commandId, signal) {
      receiptQueries.push({ boardId, commandId, signal });

      return undefined;
    },
  };
  const app = createAppMock(service, {
    editService,
    createCommandId: () => 'undo-command-' + ++sequence,
  });

  async function key(key: string, options: KeyboardEventInit = {}) {
    await app.update(() => {
      app
        .canvas()
        .dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
        );
    });
  }

  return { app, key, reverseCalls, receiptQueries };
}

test('replays a failed undo with the original command ID and redoes the confirmed reversal', async () => {
  const { app, key, reverseCalls, receiptQueries } = makeUndoFixture();
  const selector = '[data-canvas-object="' + object.id + '"]';
  try {
    await app.open(boardId);
    expect(app.host.querySelector(selector)).not.toBeNull();
    await key('a', { ctrlKey: true });
    await key('Delete');
    expect(app.host.querySelector(selector)).toBeNull();

    await key('z', { ctrlKey: true });
    expect(app.host.textContent).toContain('撤销或重做结果待确认');
    expect(receiptQueries).toEqual([
      { boardId, commandId: 'undo-command-2', signal: expect.any(AbortSignal) },
    ]);
    await app.click('重试');
    expect(reverseCalls[1]).toEqual(reverseCalls[0]);
    expect(app.host.querySelector(selector)).not.toBeNull();

    await key('Z', { ctrlKey: true, shiftKey: true });
    expect(reverseCalls[2]).toEqual({
      boardId,
      commandId: 'undo-command-3',
      source: { kind: 'edit', commandId: 'undo-command-2' },
    });
    expect(app.host.querySelector(selector)).toBeNull();
  } finally {
    app.dispose();
  }
});
