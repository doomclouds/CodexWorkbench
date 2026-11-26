import { act } from 'react';
import { expect, test } from 'vitest';
import type {
  BoardEditReceipt,
  EditObjectContentCommand,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

const boardId = 'content-test-board';
const commandId = 'content-command';
const initialVersion = 4n;
const archiveImage = '/studio-archive-assets/content-test-board/sample-image';
const displayImage = 'https://studio.example' + archiveImage;
const task = { id: 'review', text: '检查文档', checked: false };
const selectPoint = { x: 50, y: 50 };

function scrollTo(this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop = options.top ?? this.scrollTop;
  this.scrollLeft = options.left ?? this.scrollLeft;
}

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true });
}

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function close(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: close, configurable: true },
  });
}

type AppliedReceipt = Extract<BoardEditReceipt, { kind: 'applied' }>;

interface MockOptions {
  readonly canEdit?: boolean;
  readonly loseFirstResponse?: boolean;
  readonly recordFirstWrite?: boolean;
  readonly conflictFirstWrite?: boolean;
  readonly objectKind?: 'text' | 'note';
}

function nextPayload(command: EditObjectContentCommand): WhiteboardPayload {
  const { objectId: id, expectedPayloadVersion, edit } = command;
  const version = expectedPayloadVersion + 1n;
  if (edit.kind === 'todo') {
    return {
      id,
      version,
      body: { kind: 'todo', value: { title: '工作清单', items: [{ ...task, checked: true }] } },
    };
  }
  if (edit.kind !== 'document' && edit.kind !== 'text') {
    throw new Error('The fixture only accepts document, todo and text edits.');
  }

  return { id, version, body: { kind: edit.kind, value: { ...edit.value } } };
}

function createContentMock(initial: WhiteboardPayload, options: MockOptions = {}) {
  const commands: EditObjectContentCommand[] = [];
  const lookups: string[] = [];
  let payload = initial;
  let revision = 0n;
  let recorded: AppliedReceipt | undefined;

  function boardObject(): WhiteboardObject {
    return {
      id: payload.id,
      kind: options.objectKind ?? payload.body.kind,
      label: payload.body.kind === 'document' ? '示例文档' : '工作清单',
      geometryVersion: 0n,
      payloadVersion: payload.version,
      geometry: { x: 20, y: 20, width: 640, height: 500, rotation: 0 },
      locked: false,
    };
  }

  function write(command: EditObjectContentCommand): AppliedReceipt {
    payload = nextPayload(command);
    revision += 1n;

    return {
      kind: 'applied',
      boardId,
      commandId: command.commandId,
      revision,
      objects: [boardObject()],
      payloads: [{ kind: 'loaded', payload }],
      removedIds: [],
      order: [],
    };
  }

  const service: WhiteboardService = {
    async getScene() {
      return {
        boardId,
        title: '正文编辑白板',
        revision,
        canEdit: options.canEdit ?? true,
        objects: [boardObject()],
      };
    },
    async getPayloads(_boardId, ids) {
      return ids.includes(payload.id) ? [{ kind: 'loaded', payload }] : [];
    },
    async moveObjects() {
      throw new Error('Content editing must not use the move service.');
    },
    async getReceipt() {
      return undefined;
    },
  };
  const editService: WhiteboardEditService = {
    async editContent(command) {
      commands.push(command);
      if (options.conflictFirstWrite && commands.length === 1) {
        payload = {
          ...payload,
          version: payload.version + 1n,
          body: {
            kind: 'todo',
            value: { title: '工作清单', items: [{ ...task, text: '其他成员的修改' }] },
          },
        };
        revision += 1n;

        return {
          kind: 'conflict',
          boardId,
          commandId: command.commandId,
          revision,
          objects: [boardObject()],
          payloads: [{ kind: 'loaded', payload }],
        };
      }
      if (options.loseFirstResponse && commands.length === 1) {
        if (options.recordFirstWrite) {
          recorded = write(command);
        }
        throw new Error('连接断开');
      }

      recorded = write(command);

      return recorded;
    },
    async getReceipt(_boardId, commandId) {
      lookups.push(commandId);

      return recorded;
    },
    async editGeometry() {
      throw new Error('Content editing must not use the geometry service.');
    },
    async attachImage() {
      throw new Error('Content editing must not upload images.');
    },
  };

  return { service, editService, commands, lookups };
}

function required<T extends HTMLElement>(scope: ParentNode, selector: string): T {
  const element = scope.querySelector<T>(selector);
  if (!element) {
    throw new Error('Missing content element: ' + selector);
  }

  return element;
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const control = [...scope.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent).trim() === label,
  );

  if (!control) {
    throw new Error('Missing content action: ' + label);
  }

  return control;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function press(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function replaceTitle(input: HTMLInputElement, title: string) {
  const property = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    property?.set?.call(input, title);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: title }));
  });
}

function mountContent(mock: ReturnType<typeof createContentMock>) {
  let completed = 0;

  return createAppMock(mock.service, {
    editService: mock.editService,
    createCommandId: () => (completed++ === 0 ? commandId : 'content-command-' + completed),
  });
}

const initialDocument: WhiteboardPayload = {
  id: 'document-region',
  version: initialVersion,
  body: {
    kind: 'document',
    value: {
      title: '示例文档',
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'first-paragraph',
            type: 'paragraph',
            props: {},
            content: '文档示例',
            children: [{ id: 'nested-image', type: 'image', props: { url: displayImage } }],
          },
        ],
      },
    },
  },
};

const initialTodo: WhiteboardPayload = {
  id: 'todo-region',
  version: initialVersion,
  body: { kind: 'todo', value: { title: '工作清单', items: [task] } },
};

test.each(['toolbar', 'keyboard'] as const)(
  'saves a document title without dropping its nested image through the %s entry',
  async (entry) => {
    const mock = createContentMock(initialDocument);
    const app = mountContent(mock);
    try {
      await app.open(boardId);
      if (entry === 'toolbar') {
        await click(button(app.host, '编辑文档'));
      } else {
        await click(button(app.host, '展开文档'));
        const reader = required(
          app.host,
          '[data-document-focused-reading] [aria-label="文档正文"]',
        );
        await press(reader, 'F2');
      }

      const editing = required(
        app.host,
        '[data-document-focused-reading][data-document-view="edit"]',
      );
      expect(app.host.querySelector('dialog[open]')).toBeNull();
      const title = required<HTMLInputElement>(editing, 'input:not([type="search"])');
      replaceTitle(title, '确认正文版本');
      if (entry === 'keyboard') {
        await press(title, 'Escape');
      } else {
        await click(button(editing, '阅读文档'));
      }

      expect(mock.commands).toHaveLength(1);
      expect(mock.commands[0]).toMatchObject({
        boardId,
        commandId,
        objectId: initialDocument.id,
        expectedPayloadVersion: initialVersion,
        edit: {
          kind: 'document',
          value: {
            title: '确认正文版本',
            document: {
              schemaVersion: 1,
              blocks: [
                {
                  id: 'first-paragraph',
                  children: [{ id: 'nested-image', props: { url: displayImage } }],
                },
              ],
            },
          },
        },
      });
      const reading = required(
        app.host,
        '[data-document-focused-reading][data-document-view="read"]',
      );
      expect(reading.textContent).toContain('确认正文版本');
      if (entry === 'keyboard') {
        await press(required(reading, '[aria-label="文档正文"]'), 'Escape');
      } else {
        await click(button(reading, '返回白板'));
      }
      expect(app.host.querySelector('[data-document-focused-reading]')).toBeNull();

      await app.open(boardId, 'reopened');
      expect(app.host.textContent).toContain('确认正文版本');
    } finally {
      app.dispose();
    }
  },
);

test('keeps the document focus surface read-only for a viewer', async () => {
  const mock = createContentMock(initialDocument, { canEdit: false });
  const app = mountContent(mock);
  try {
    await app.open(boardId);
    await click(button(app.host, '展开文档'));
    const reading = required(
      app.host,
      '[data-document-focused-reading][data-document-view="read"]',
    );
    expect(button(reading, '编辑文档').disabled).toBe(true);
    const reader = required(reading, '[aria-label="文档正文"]');
    await press(reader, 'F2');
    expect(required(app.host, '[data-document-focused-reading]').dataset.documentView).toBe('read');
    expect(mock.commands).toEqual([]);
    await click(button(reading, '返回白板'));
    expect(app.host.querySelector('[data-document-focused-reading]')).toBeNull();
  } finally {
    app.dispose();
  }
});

test('saves checklist changes from the fitted native object while it is expanded', async () => {
  const mock = createContentMock(initialTodo);
  const app = mountContent(mock);
  try {
    await app.open(boardId);
    const collapsed = required(app.host, '[data-todo-id]');
    await click(button(collapsed, '展开任务清单'));
    const expanded = required(app.host, '[data-todo-expanded]');
    expect(expanded).toBe(collapsed);
    expect(expanded.querySelector('[aria-label="展开任务清单"]')).toBeNull();
    expect(app.host.querySelector('dialog[open]')).toBeNull();
    await click(required(expanded, 'input[type="checkbox"]'));
    expect(mock.commands[0]?.edit).toEqual({
      kind: 'todo',
      value: [{ op: 'update', id: task.id, changes: { checked: true } }],
    });
  } finally {
    app.dispose();
  }
});

test.each([
  { recordFirstWrite: false, submits: 2, lookups: 2 },
  { recordFirstWrite: true, submits: 1, lookups: 1 },
])(
  'recovers a todo save using its original command with recordFirstWrite=$recordFirstWrite',
  async ({ recordFirstWrite, submits, lookups }) => {
    const mock = createContentMock(initialTodo, { loseFirstResponse: true, recordFirstWrite });
    const app = mountContent(mock);
    try {
      await app.open(boardId);
      await app.drag(selectPoint, selectPoint);
      await click(required(app.host, '[data-todo-id] input[type="checkbox"]'));
      if (!recordFirstWrite) {
        expect(app.host.textContent).toContain('正文保存结果未知');
        await click(button(required(app.host, '[data-todo-id]'), '重试保存'));
      }

      expect(mock.lookups).toEqual(Array<string>(lookups).fill(commandId));
      expect(mock.commands).toHaveLength(submits);
      expect(mock.commands[0]).toMatchObject({
        objectId: initialTodo.id,
        expectedPayloadVersion: initialVersion,
        edit: { kind: 'todo', value: [{ op: 'update', id: task.id, changes: { checked: true } }] },
      });
      expect(mock.commands.every((command) => command === mock.commands[0])).toBe(true);
      await app.open(boardId, 'reopened');
      await app.drag(selectPoint, selectPoint);
      expect(
        required<HTMLInputElement>(app.host, '[data-todo-id] input[type="checkbox"]').checked,
      ).toBe(true);
    } finally {
      app.dispose();
    }
  },
);

test('renders the todo state on a read-only board without exposing a completion control', async () => {
  const mock = createContentMock(initialTodo, { canEdit: false });
  const app = mountContent(mock);
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    expect(app.host.textContent).toContain(task.text);
    expect(app.host.querySelector('[data-todo-id] input[type="checkbox"]')).toBeNull();
    expect(mock.commands).toEqual([]);
  } finally {
    app.dispose();
  }
});

test('preserves a conflicting todo draft until the user accepts the latest saved content', async () => {
  const mock = createContentMock(initialTodo, { conflictFirstWrite: true });
  const app = mountContent(mock);
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    await click(required(app.host, '[data-todo-id] input[type="checkbox"]'));
    const todo = required(app.host, '[data-todo-id]');
    expect(todo.textContent).toContain('正文已被其他操作修改');
    expect(todo.textContent).toContain('1/1 完成');
    expect(mock.commands).toHaveLength(1);

    await click(button(todo, '放弃本次修改'));
    expect(todo.textContent).toContain('其他成员的修改');
    expect(todo.textContent).toContain('0/1 完成');
    await click(required(todo, 'input[type="checkbox"]'));
    expect(mock.commands[1]).toMatchObject({ expectedPayloadVersion: initialVersion + 1n });
    expect(mock.commands[1]?.commandId).not.toBe(commandId);
  } finally {
    app.dispose();
  }
});

test.each(['text', 'note'] as const)('saves and reopens edited %s content', async (objectKind) => {
  const objectId = 'editable-text';
  const mock = createContentMock(
    {
      id: objectId,
      version: initialVersion,
      body: { kind: 'text', value: { text: '原有文字' } },
    },
    { objectKind },
  );
  const app = mountContent(mock);
  try {
    await app.open(boardId);
    await app.drag(selectPoint, selectPoint);
    await app.update(() => {
      app.canvas().dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          clientX: selectPoint.x,
          clientY: selectPoint.y,
        }),
      );
    });
    const editor = required(app.host, '[role="textbox"][contenteditable="true"]');
    await app.update(() => {
      editor.replaceChildren(document.createTextNode('已保存文字'));
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(mock.commands).toEqual([
      {
        boardId,
        commandId,
        objectId,
        expectedPayloadVersion: initialVersion,
        edit: { kind: 'text', value: { text: '已保存文字' } },
      },
    ]);
    await app.open(boardId, 'reopened');
    expect(app.host.textContent).toContain('已保存文字');
  } finally {
    app.dispose();
  }
});
