import { expect, test } from 'vitest';
import {
  conflicted,
  createWhiteboardRpcMock,
  moved,
  sampleBoardId,
} from '../fixtures/whiteboard-rpc.js';
import { boardCommandId, createAppMock } from '../support/whiteboard-app-mock.js';

const from = { x: 70, y: 70 };
const to = { x: 116, y: 94 };

function position(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLElement>('[data-canvas-object="rectangle"]')?.style.left;
}

test('opens a scene, reads visible bodies, and keeps the drag visible until the receipt', async () => {
  let completeMove: () => void = () => {
    throw new Error('A move must be in progress.');
  };

  const rpc = createWhiteboardRpcMock({
    move: (request) =>
      new Promise((resolve) => {
        completeMove = () => resolve(moved(request));
      }),
  });
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    expect(app.host.querySelector('h1')?.textContent).toBe('一期测试白板');
    expect(rpc.payloadReads).toEqual([['caption']]);
    expect(app.canvas().textContent).toContain('从服务读取的正文');
    expect(position(app.canvas())).toBe('40px');
    expect(
      app.canvas().querySelector('[data-canvas-object="rectangle"].studio-ui-canvas-object--shape'),
    ).not.toBeNull();

    await app.drag(from, to);
    expect(app.host.textContent).toContain('保存中');
    expect(position(app.canvas())).toBe('86px');
    expect(rpc.moves).toHaveLength(1);
    expect(rpc.moves[0]).toMatchObject({
      boardId: sampleBoardId,
      commandId: boardCommandId,
      delta: { dx: 46, dy: 20 },
      targets: [{ objectId: 'rectangle', expectedGeometryVersion: 0n }],
    });

    await app.update(completeMove);
    expect(app.host.textContent).toContain('已保存');
    expect(position(app.canvas())).toBe('86px');
    expect(rpc.payloadReads).toEqual([['caption']]);
  } finally {
    app.dispose();
  }
});

test('retries the original move after the service returns no recorded receipt', async () => {
  const rpc = createWhiteboardRpcMock({
    move: (request, attempt) => {
      if (attempt === 1) {
        throw new Error('连接在回执返回前中断');
      }

      return moved(request);
    },
  });
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    await app.drag(from, to);
    expect(app.host.textContent).toContain('保存结果未知');
    expect(rpc.receiptReads).toEqual([boardCommandId]);
    expect(position(app.canvas())).toBe('86px');

    await app.click('重试原移动');
    expect(rpc.moves).toHaveLength(2);
    expect(rpc.moves[1]).toEqual(rpc.moves[0]);
    expect(app.host.textContent).toContain('已保存');
    expect(position(app.canvas())).toBe('86px');
  } finally {
    app.dispose();
  }
});

test('clears a conflicting preview and reloads the confirmed scene', async () => {
  const rpc = createWhiteboardRpcMock({ move: conflicted });
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    await app.drag(from, to);

    expect(app.host.textContent).toContain('移动冲突');
    expect(rpc.sceneReads).toEqual([sampleBoardId, sampleBoardId]);
    expect(position(app.canvas())).toBe('40px');
  } finally {
    app.dispose();
  }
});

test('keeps the canvas navigable on a read-only board without submitting a move', async () => {
  const rpc = createWhiteboardRpcMock({ canEdit: false });
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    await app.drag(from, to);

    expect(app.host.textContent).toContain('只读');
    expect(rpc.moves).toHaveLength(0);
    expect(position(app.canvas())).toBe('40px');
  } finally {
    app.dispose();
  }
});
