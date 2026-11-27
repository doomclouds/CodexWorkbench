import { expect, test } from 'vitest';
import type {
  EditBoardGeometryCommand,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

const boardId = 'selection-format-board';
const rectangle: WhiteboardObject = {
  id: 'shape-a',
  kind: 'shape',
  label: '需求卡片',
  geometry: { x: 48, y: 48, width: 100, height: 64, rotation: 0 },
  geometryVersion: 2n,
  payloadVersion: 4n,
  locked: false,
  detail: { kind: 'shape', outline: 'rounded' },
  appearance: { fill: '#EFEFEF', stroke: '#2F7CC4', dashed: false, hollow: false },
};

const note: WhiteboardObject = {
  ...rectangle,
  id: 'note-b',
  kind: 'note',
  label: '备注卡片',
  geometry: { ...rectangle.geometry, x: 220 },
  detail: undefined,
  payloadVersion: undefined,
};
const text: WhiteboardPayload = {
  id: rectangle.id,
  version: 4n,
  body: {
    kind: 'text',
    value: { text: '需做设计', fontSize: 28, color: '#0B0B0B', align: 'left' },
  },
};

async function unexpected(): Promise<never> {
  throw new Error('Unexpected whiteboard operation.');
}

function selectionApp(objects: readonly WhiteboardObject[], canEdit = true) {
  const commands: EditBoardGeometryCommand[] = [];
  const service: WhiteboardService = {
    getScene: async () => ({ boardId, title: '格式栏验收', revision: 1n, objects, canEdit }),
    getPayloads: async () => [{ kind: 'loaded', payload: text }],
    moveObjects: unexpected,
    getReceipt: unexpected,
  };
  const editService: WhiteboardEditService = {
    async editGeometry(command) {
      commands.push(command);
      return {
        kind: 'applied',
        boardId,
        commandId: command.commandId,
        revision: 1n + BigInt(commands.length),
        objects: [],
        removedIds: [],
        order: [],
        payloads: [],
      };
    },
    editContent: unexpected,
    attachImage: unexpected,
    getReceipt: unexpected,
  };

  return {
    ...createAppMock(service, {
      editService,
      createCommandId: () => 'format-' + (commands.length + 1),
    }),
    commands,
  };
}

async function changeSelect(app: ReturnType<typeof selectionApp>, label: string, value: string) {
  const select = [...app.host.querySelectorAll('select')].find(
    (field) => field.getAttribute('aria-label') === label,
  );

  if (!select) {
    throw new Error('Missing format selector ' + label);
  }

  await app.update(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('uses the selected body format and submits its current payload version from the toolbar', async () => {
  const app = selectionApp([rectangle]);

  try {
    await app.open(boardId);
    await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    const font = app.host.querySelector<HTMLSelectElement>('select[aria-label="文字大小"]');
    expect(font?.value).toBe('28');

    await app.click('加粗');
    expect(app.commands[0]?.operation).toEqual({
      kind: 'style',
      patch: { bold: true },
      targets: [
        { target: { id: rectangle.id, expectedGeometryVersion: 2n }, expectedPayloadVersion: 4n },
      ],
    });

    await app.click('文字对齐');
    await app.click('文字center');
    expect(app.commands[1]?.operation).toMatchObject({
      kind: 'style',
      patch: { textAlign: 'center' },
    });
  } finally {
    app.dispose();
  }
});

test('emits the original fill and stroke values and applies shape form through geometry', async () => {
  const app = selectionApp([rectangle]);

  try {
    await app.open(boardId);
    await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    await changeSelect(app, '形状类型', 'ellipse');
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'style',
      patch: { shapeForm: 'ellipse' },
    });

    await app.click('填充颜色');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('填充 黄色');
    await app.click('填充 黄色');
    expect(app.commands[1]?.operation).toMatchObject({
      kind: 'style',
      patch: { fill: '#F9E56F', hollow: false },
    });

    await app.click('边框与线条');
    await app.update(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('边框与线条');
    await app.click('边框与线条');
    await app.click('虚线');
    expect(app.commands[2]?.operation).toMatchObject({
      kind: 'style',
      patch: { stroke: '#2F7CC4', dashed: true },
    });
  } finally {
    app.dispose();
  }
});

test('arranges two selected objects and leaves read-only formatting unavailable', async () => {
  const app = selectionApp([rectangle, note]);

  try {
    await app.open(boardId);
    await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    await app.drag({ x: 240, y: 70 }, { x: 240, y: 70 }, undefined, { shiftKey: true });
    await app.click('对齐对象');
    await app.click('顶部对齐');
    expect(app.commands[0]?.operation).toEqual({
      kind: 'arrange',
      preset: 'top',
      targets: [
        { id: rectangle.id, expectedGeometryVersion: 2n },
        { id: note.id, expectedGeometryVersion: 2n },
      ],
    });
  } finally {
    app.dispose();
  }

  const reader = selectionApp([rectangle], false);
  try {
    await reader.open(boardId);
    await reader.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    expect(reader.host.querySelector('[aria-label="文字大小"]')).toBeNull();
    expect(reader.commands).toEqual([]);
  } finally {
    reader.dispose();
  }
});
