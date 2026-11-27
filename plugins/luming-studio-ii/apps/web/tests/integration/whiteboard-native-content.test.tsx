import { expect, test } from 'vitest';
import type {
  BoardEditReceipt,
  EditObjectContentCommand,
  EditObjectContentOperation,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { boardCommandId, createAppMock } from '../support/whiteboard-app-mock.js';

type NativeKind = 'table' | 'html' | 'diagram' | 'sticker' | 'image';
type NativeValue = Exclude<WhiteboardPayload['body'], { kind: 'ink' }>;

const boardId = 'native-edit-board';
const objectId = 'native-object';
const selectPoint = { x: 60, y: 60 };
const tableBody = {
  kind: 'table',
  value: {
    data: {
      rows: [
        ['第一列', '第二列'],
        ['甲', '乙'],
      ],
      rowIds: ['r0', 'r1'],
      columnIds: ['c0', 'c1'],
      columnWidths: [300, 300],
      head: true,
    },
  },
} as const satisfies NativeValue;
const embedBody = {
  kind: 'embed',
  value: { html: '<p>初始源码</p>', sourceRevision: 0n, title: '图解', state: { votes: 1 } },
} as const satisfies NativeValue;
const picture = 'data:image/png;base64,AA';
const pictureBody = {
  kind: 'image',
  value: {
    src: picture,
    crop: { zoom: 2, x: 0.25, y: 1 },
    naturalSize: { width: 400, height: 200 },
  },
} as const satisfies NativeValue;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function closeModal(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

function savedBody(
  native: NativeValue,
  edit: EditObjectContentOperation,
  acceptedWidth?: number,
): NativeValue {
  switch (edit.kind) {
    case 'table': {
      const { text, ...data } = edit.value;
      const columns = data.columnWidths;
      const requestedWidth = edit.widthChange?.width;
      const adjustedColumns =
        acceptedWidth && requestedWidth && columns
          ? columns.map((width) => (width * acceptedWidth) / requestedWidth)
          : columns;

      return { kind: 'table', value: { text, data: { ...data, columnWidths: adjustedColumns } } };
    }
    case 'embedSource':
      return {
        kind: 'embed',
        value: {
          ...native.value,
          html: edit.value.html,
          title: edit.value.title,
          sourceRevision: edit.value.expectedSourceRevision + 1n,
        },
      };
    case 'embedState':
      return { kind: 'embed', value: { ...native.value, state: edit.value } };
    case 'sticker':
      return { kind: 'sticker', value: { ...edit.value } };
    case 'crop':
      return { kind: 'image', value: { ...native.value, ...edit.value } };
    case 'document':
    case 'link':
    case 'text':
    case 'todo':
      throw new Error('Unexpected content operation for a native-object fixture.');
  }
}

interface MockOptions {
  readonly locked?: boolean;
  readonly acceptedWidth?: number;
  readonly loseFirstResponse?: boolean;
}

function nativeFixture(kind: NativeKind, initial: NativeValue, options: MockOptions = {}) {
  const writes: EditObjectContentCommand[] = [];
  const reads: string[] = [];
  let body = initial;
  let revision = 0n;
  let object: WhiteboardObject = {
    id: objectId,
    kind,
    label: '原生对象',
    geometryVersion: 0n,
    payloadVersion: 0n,
    locked: options.locked ?? false,
    geometry: { x: 20, y: 20, width: 600, height: 350, rotation: 0 },
  };

  function payload() {
    return { id: objectId, version: revision, body };
  }

  const service: WhiteboardService = {
    async getScene() {
      return { boardId, title: '原生对象编辑', revision, canEdit: true, objects: [object] };
    },
    async getPayloads(_boardId, ids) {
      return ids.includes(objectId) ? [{ kind: 'loaded', payload: payload() }] : [];
    },
    async moveObjects() {
      throw new Error('Native body edits must not use the move API.');
    },
    async getReceipt() {
      return undefined;
    },
  };
  const editService: WhiteboardEditService = {
    async editContent(command) {
      writes.push(command);
      if (options.loseFirstResponse && writes.length === 1) {
        throw new Error('网络在保存回执前中断');
      }

      const { edit } = command;
      const width =
        edit.kind === 'table' && edit.widthChange
          ? (options.acceptedWidth ?? edit.widthChange.width)
          : object.geometry.width;
      body = savedBody(body, edit, options.acceptedWidth);
      revision += 1n;
      const resized = width !== object.geometry.width;
      object = {
        ...object,
        payloadVersion: revision,
        geometry: { ...object.geometry, width },
        geometryVersion: resized ? object.geometryVersion + 1n : object.geometryVersion,
      };

      return {
        kind: 'applied',
        boardId,
        commandId: command.commandId,
        revision,
        objects: [object],
        payloads: [{ kind: 'loaded', payload: payload() }],
        removedIds: [],
        order: [],
      } satisfies BoardEditReceipt;
    },
    async getReceipt(_boardId, commandId) {
      reads.push(commandId);

      return undefined;
    },
    async editGeometry() {
      throw new Error('Native body edits must not use the geometry API.');
    },
    async attachImage() {
      throw new Error('Native body edits must not use the upload API.');
    },
  };
  const app = createAppMock(service, { editService });

  return { app, writes, reads };
}

function required<T extends HTMLElement>(scope: ParentNode, selector: string): T {
  const element = scope.querySelector<T>(selector);
  if (!element) {
    throw new Error('Missing native object control: ' + selector);
  }

  return element;
}

function doubleClick(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent('dblclick', {
      bubbles: true,
      clientX: selectPoint.x,
      clientY: selectPoint.y,
    }),
  );
}

function typeText(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const property = Object.getOwnPropertyDescriptor(prototype, 'value');
  property?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function handlePointer(target: HTMLElement, type: string, clientX: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 13,
      clientX,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

function columnWidthStyles(host: ParentNode) {
  return Array.from(host.querySelectorAll('col'), (column) => column.style.width);
}

test('keeps locked table cells editable and adds columns without changing the outer width', async () => {
  const typedTable = {
    kind: 'table',
    value: {
      data: {
        ...tableBody.value.data,
        rows: [
          ['第一列', '第二列', '数值', '标志', '留空'],
          ['甲', '乙', 0, false, null],
        ],
        columnIds: ['c0', 'c1', 'c2', 'c3', 'c4'],
        columnWidths: [120, 120, 120, 120, 120],
      },
    },
  } as const satisfies NativeValue;
  const { app, writes } = nativeFixture('table', typedTable, { locked: true });
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    expect(app.host.querySelector('[role="separator"]')).toBeNull();
    await app.update(() => doubleClick(required(app.host, '[data-cell="1:0"]')));
    const editor = required(app.host, '[role="textbox"][contenteditable="true"]');
    await app.update(() => {
      editor.textContent = '修订后的单元格';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: editor.textContent }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(writes[0]?.edit).toMatchObject({
      kind: 'table',
      value: {
        rows: [
          ['第一列', '第二列', '数值', '标志', '留空'],
          ['修订后的单元格', '乙', 0, false, null],
        ],
      },
      widthChange: undefined,
    });
    await app.click('添加表格列');
    expect(writes[1]?.edit).toMatchObject({
      kind: 'table',
      widthChange: { expectedWidth: 600, width: 600 },
    });
    await app.open(boardId, 'reopened');
    expect(required(app.host, '[data-cell="1:0"]').textContent).toBe('修订后的单元格');
    expect(app.host.querySelectorAll('col')).toHaveLength(6);
  } finally {
    app.dispose();
  }
});

test('accepts the table width from the object metadata returned by the writer', async () => {
  const { app, writes } = nativeFixture('table', tableBody, { acceptedWidth: 620 });
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    const handle = required(app.host, '[role="separator"]');
    await app.update(() => handlePointer(handle, 'pointerdown', 100));
    await app.update(() => handlePointer(handle, 'pointermove', 140));
    await app.update(() => handlePointer(handle, 'pointerup', 140));

    const edit = writes[0]?.edit;
    if (edit?.kind !== 'table' || !edit.widthChange) {
      throw new Error('The column gesture must send the table and its expected width.');
    }

    expect(edit.widthChange.expectedWidth).toBe(600);
    expect(edit.widthChange.width).toBeGreaterThan(620);
    expect(required(app.host, '[data-canvas-object]').style.width).toBe('620px');
    const widths = columnWidthStyles(app.host).map((width) => Number.parseFloat(width));
    expect(widths.reduce((total, width) => total + width, 0)).toBeCloseTo(620);
    expect(app.host.textContent).not.toContain('草稿已保留');
  } finally {
    app.dispose();
  }
});

test('retries the same source command and keeps the HTML draft until it is approved', async () => {
  const { app, writes, reads } = nativeFixture('html', embedBody, { loseFirstResponse: true });
  const nextHtml = '<p>完成后的源码</p>';
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    await app.update(() => doubleClick(app.canvas()));
    expect(app.host.querySelector('dialog[open]')).toBeNull();
    await app.update(() => {
      app.canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    });
    const field = required<HTMLTextAreaElement>(app.host, 'dialog[open] textarea');
    await app.update(() => typeText(field, nextHtml));
    await app.click('保存源码');

    expect(field.value).toBe(nextHtml);
    expect(app.host.querySelector('dialog[open]')).not.toBeNull();
    await app.click('保存源码');

    expect(writes[0]).toMatchObject({
      expectedPayloadVersion: 0n,
      edit: { kind: 'embedSource', value: { html: nextHtml, expectedSourceRevision: 0n } },
    });
    expect(writes[1]).toBe(writes[0]);
    expect(reads).toEqual([boardCommandId, boardCommandId]);
    expect(app.host.querySelector('dialog[open]')).toBeNull();
    expect(required<HTMLIFrameElement>(app.host, 'iframe').srcdoc).toContain(nextHtml);
  } finally {
    app.dispose();
  }
});

function sendFirstHtmlState(frame: HTMLIFrameElement) {
  const channel = /"channel":"([^"]+)"/u.exec(frame.srcdoc)?.[1];
  if (!channel) {
    throw new Error('Missing generated frame identity.');
  }

  window.dispatchEvent(
    new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        type: 'studio-html-state',
        channel,
        regionId: objectId,
        sourceRevision: 0,
        baseVersion: 0,
        saveId: 1,
        state: { votes: 2 },
      },
    }),
  );
}

test('opens and saves the source of an imported diagram through its selection controls', async () => {
  const { app, writes } = nativeFixture('diagram', embedBody, { locked: true });
  const html = '<main>更新图解</main>';
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    await app.click('编辑 HTML 源码');
    const field = required<HTMLTextAreaElement>(app.host, 'dialog[open] textarea');
    expect(field.value).toBe(embedBody.value.html);
    await app.update(() => typeText(field, html));
    await app.click('保存源码');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      expectedPayloadVersion: 0n,
      edit: { kind: 'embedSource', value: { html, expectedSourceRevision: 0n } },
    });
    expect(app.host.querySelector('dialog[open]')).toBeNull();
    await app.open(boardId, 'reopened');
    expect(required<HTMLIFrameElement>(app.host, 'iframe').srcdoc).toContain(html);
  } finally {
    app.dispose();
  }
});

test.each(['html', 'diagram'] as const)(
  'handles state saving from an initial %s frame',
  async (kind) => {
    const { app, writes } = nativeFixture(kind, embedBody);
    try {
      await app.open(boardId);
      await app.drag(selectPoint, selectPoint);
      const frame = required<HTMLIFrameElement>(app.host, 'iframe');
      const sourceBefore = frame.srcdoc;
      await app.update(() => sendFirstHtmlState(frame));

      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        expectedPayloadVersion: 0n,
        edit: { kind: 'embedState', value: { votes: 2 } },
      });
      expect(required<HTMLIFrameElement>(app.host, 'iframe')).toBe(frame);
      expect(frame.srcdoc).toBe(sourceBefore);
    } finally {
      app.dispose();
    }
  },
);

test('keeps a graphic sticker placed without opening an editor on double-click', async () => {
  const { app, writes } = nativeFixture('sticker', { kind: 'sticker', value: { id: 'heart' } });
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    await app.update(() => doubleClick(app.canvas()));

    expect(app.host.querySelector('dialog[open]')).toBeNull();
    expect(writes).toEqual([]);
    expect(app.host.querySelector('svg[data-sticker-icon-id="heart"]')).not.toBeNull();
  } finally {
    app.dispose();
  }
});

test('updates and reopens a legacy sticker using its confirmed text', async () => {
  const { app, writes } = nativeFixture('sticker', { kind: 'sticker', value: { fallback: '★' } });
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    await app.update(() => doubleClick(app.canvas()));
    const input = required<HTMLInputElement>(app.host, 'input[aria-label="编辑文字"]');
    await app.update(() => typeText(input, '✦'));
    await app.update(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(writes[0]?.edit).toEqual({ kind: 'sticker', value: { fallback: '✦' } });
    expect(app.host.querySelector('input[aria-label="编辑文字"]')).toBeNull();
    await app.open(boardId, 'reopened');
    expect(required(app.host, '.luming-sticker-fallback').textContent).toBe('✦');
  } finally {
    app.dispose();
  }
});

test.each([false, true])(
  'updates crop metadata only for an unlocked image (locked=%s)',
  async (locked) => {
    const { app, writes } = nativeFixture('image', pictureBody, { locked });
    try {
      await app.open(boardId);
      await app.drag(selectPoint, selectPoint);
      await app.update(() => doubleClick(required(app.host, 'img')));
      if (locked) {
        expect(app.host.querySelector('dialog[open]')).toBeNull();
        expect(writes).toEqual([]);
        return;
      }

      const range = required<HTMLInputElement>(app.host, 'dialog[open] input[type="range"]');
      await app.update(() => {
        range.value = '3';
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await app.click('保存裁剪');

      expect(writes[0]?.edit).toEqual({
        kind: 'crop',
        value: { crop: { zoom: 3, x: 0.25, y: 1 }, naturalSize: { width: 400, height: 200 } },
      });
      await app.open(boardId, 'reopened');
      expect(required<HTMLImageElement>(app.host, 'img').getAttribute('src')).toBe(picture);
    } finally {
      app.dispose();
    }
  },
);
