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
import { createBoardDraftStorage, createCommandId } from '../../src/platform/browser/index.js';
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

function mountContent(
  mock: ReturnType<typeof createContentMock>,
  options: Parameters<typeof createAppMock>[1] = {},
) {
  let completed = 0;

  return createAppMock(mock.service, {
    ...options,
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
      await expect
        .poll(() => editing.querySelector('[data-document-editor]'), { timeout: 10_000 })
        .not.toBeNull();
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
      expect(required(reading, 'input[aria-label="文档标题"]')).toHaveProperty(
        'value',
        '确认正文版本',
      );

      if (entry === 'keyboard') {
        await press(required(reading, '[aria-label="文档正文"]'), 'Escape');
      } else {
        await click(button(reading, '返回画板'));
      }
      expect(app.host.querySelector('[data-document-focused-reading]')).toBeNull();

      await app.open(boardId, 'reopened');
      await expect
        .poll(() => app.host.querySelector('h2[aria-label="文档标题"]')?.textContent)
        .toBe('确认正文版本');
    } finally {
      app.dispose();
    }
  },
  15_000,
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
    expect(button(reading, '阅读文档').disabled).toBe(false);
    const reader = required(reading, '[aria-label="文档正文"]');
    await press(reader, 'F2');
    expect(required(app.host, '[data-document-focused-reading]').dataset.documentView).toBe('read');
    expect(mock.commands).toEqual([]);
    await click(button(reading, '返回画板'));
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

function localTextCandidate(objectId: string, text: string): string {
  return JSON.stringify({
    objectId,
    kind: 'text',
    name: 'text.commit',
    expectedVersion: Number(initialVersion),
    value: { text },
  });
}

async function editContentText(app: ReturnType<typeof mountContent>, text: string) {
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
    editor.replaceChildren(document.createTextNode(text));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

test('shows a single page-top text save error and reconciles the retry with the draft', async () => {
  const mock = createContentMock(
    {
      id: 'editable-text',
      version: initialVersion,
      body: { kind: 'text', value: { text: '原有文字' } },
    },
    { loseFirstResponse: true },
  );
  const app = mountContent(mock);

  try {
    await app.open(boardId);
    await editContentText(app, '保留的文字草稿');
    const notices = required(app.host, '[role="region"][aria-label="操作通知"]');
    const editor = '[role="textbox"][contenteditable="true"]';
    expect(required(app.canvas(), editor).textContent).toBe('保留的文字草稿');
    expect(required(notices, '[role="alert"]').textContent).toContain('正文保存结果未知');
    expect(app.host.textContent?.match(/正文保存结果未知/g)).toHaveLength(1);
    expect(app.canvas().querySelector('[role="alert"]')).toBeNull();

    await click(button(notices, '重试保存文字'));
    expect(mock.commands).toHaveLength(2);
    expect(mock.commands[1]).toBe(mock.commands[0]);
    expect(notices.textContent).toBe('');
    expect(app.canvas().querySelector(editor)).toBeNull();
    expect(app.canvas().textContent).toContain('保留的文字草稿');
  } finally {
    app.dispose();
  }
});

test.each([undefined, initialVersion])(
  'only opens a connector label editor before payload loading when no version is recorded (%s)',
  async (payloadVersion) => {
    const objectId = 'legacy-connector';
    const label = '原有连接线';
    const revision = 9n;
    const start = { x: 30, y: 50 };
    const end = { x: 350, y: 50 };
    const position = { x: 120, y: 50 };
    const mock = createContentMock({
      id: objectId,
      version: initialVersion,
      body: { kind: 'text', value: { text: label } },
    });
    const app = createAppMock(
      {
        ...mock.service,
        async getScene() {
          const scene = await mock.service.getScene(boardId);

          return {
            ...scene,
            revision,
            objects: [
              {
                id: objectId,
                kind: 'connector',
                label,
                geometryVersion: 0n,
                payloadVersion,
                geometry: { ...start, width: 320, height: 1, rotation: 0 },
                locked: false,
                detail: {
                  kind: 'connector',
                  connection: { start: { point: start }, end: { point: end } },
                },
              },
            ],
          };
        },
        getPayloads: () => new Promise(() => {}),
      },
      { editService: mock.editService },
    );

    try {
      await app.open(boardId);
      await app.drag(position, position);
      await press(app.canvas(), 'Enter');
      const selector = '[role="textbox"][aria-label="连接线文字"]';
      if (payloadVersion !== undefined) {
        expect(app.host.querySelector(selector)).toBeNull();
        expect(mock.commands).toHaveLength(0);
        return;
      }

      const editor = required(app.host, selector);
      expect(editor.textContent).toBe(label);
      const text = '改写原有连接线';
      await app.update(() => {
        editor.replaceChildren(document.createTextNode(text));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(mock.commands).toMatchObject([
        { objectId, expectedPayloadVersion: revision, edit: { kind: 'text', value: { text } } },
      ]);
    } finally {
      app.dispose();
    }
  },
);

test('keeps independent local drafts after remount and only applies a manually compared current version', async () => {
  const objectId = 'saved-text';
  const actorId = 'local-draft-owner';
  const scope = JSON.stringify([actorId, boardId]);
  const otherScope = JSON.stringify([actorId, 'another-board']);
  const otherIdentity = JSON.stringify(['another-owner', boardId]);
  const storage = createBoardDraftStorage(createCommandId);
  storage.write(scope, 'orphan', localTextCandidate('old-object', '保留的另一份草稿'));
  storage.write(otherScope, 'external-board', localTextCandidate('outside-object', '另一张板草稿'));
  storage.write(
    otherIdentity,
    'different-owner',
    localTextCandidate('outside-owner', '另一身份草稿'),
  );

  const mock = createContentMock(
    {
      id: objectId,
      version: initialVersion,
      body: { kind: 'text', value: { text: '已保存正文' } },
    },
    { loseFirstResponse: true },
  );
  const copies: string[] = [];
  const downloads: string[] = [];
  const app = mountContent(mock, {
    localDrafts: { actorId, storage },
    clipboard: {
      async writeText(text) {
        copies.push(text);
      },
      async readText() {
        return '';
      },
    },
    downloadObjectFile({ content }) {
      downloads.push(new TextDecoder().decode(content));
    },
  });

  try {
    await app.open(boardId);
    await editContentText(app, '未确认正文');
    expect(mock.commands).toHaveLength(1);
    const original = storage.list(scope).find(({ id }) => id !== 'orphan');
    expect(original?.data).toContain('未确认正文');
    expect(original?.data).not.toContain(commandId);

    await app.open(boardId, 'fresh-board');
    expect(mock.commands).toHaveLength(1);
    await app.click('本机草稿');
    expect(app.host.textContent).not.toContain('outside-object');
    expect(app.host.textContent).not.toContain('outside-owner');
    await app.click('文字草稿 · old-object');
    expect(button(app.host, '应用已比较的草稿').disabled).toBe(true);
    await app.click('复制草稿');
    await app.click('下载草稿副本');
    expect(copies[0]).toContain('保留的另一份草稿');
    expect(downloads).toEqual(copies);
    await app.click('放弃上次草稿');

    await app.click('文字草稿 · saved-text');
    expect(app.host.textContent).toContain('已保存正文');
    expect(app.host.textContent).toContain('未确认正文');
    await app.click('应用已比较的草稿');
    expect(mock.commands).toHaveLength(2);
    expect(mock.commands[1]?.commandId).not.toBe(commandId);
    expect(storage.list(scope)).toEqual([]);
    expect(storage.list(otherScope)).toHaveLength(1);
    expect(storage.list(otherIdentity)).toHaveLength(1);
    await app.click('关闭本机草稿提示');
    expect(
      Array.from(app.host.querySelectorAll('button')).some(
        ({ textContent }) => textContent === '本机草稿',
      ),
    ).toBe(false);
  } finally {
    app.dispose();
    storage.remove(scope, 'orphan');
    storage.remove(otherScope, 'external-board');
    storage.remove(otherIdentity, 'different-owner');
  }
});

test('does not expose saved drafts when a freshly opened board is read-only', async () => {
  const objectId = 'read-only-text';
  const actorId = 'read-only-draft-owner';
  const scope = JSON.stringify([actorId, boardId]);
  const storage = createBoardDraftStorage(createCommandId);
  storage.write(scope, 'read-only-draft', localTextCandidate(objectId, '仅本机可恢复'));
  const mock = createContentMock(
    { id: objectId, version: initialVersion, body: { kind: 'text', value: { text: '当前正文' } } },
    { canEdit: false },
  );
  const app = mountContent(mock, { localDrafts: { actorId, storage } });
  try {
    await app.open(boardId);
    expect(app.host.textContent).toContain('当前正文');
    expect(app.host.textContent).not.toContain('本机草稿');
    expect(app.host.textContent).not.toContain('仅本机可恢复');
    expect(mock.commands).toEqual([]);
  } finally {
    app.dispose();
    storage.remove(scope, 'read-only-draft');
  }
});

test('rechecks the current write grant before copying or restoring an already compared draft', async () => {
  const objectId = 'downgraded-object';
  const actorId = 'downgraded-owner';
  const scope = JSON.stringify([actorId, boardId]);
  const storage = createBoardDraftStorage(createCommandId);
  storage.write(scope, 'board-draft', localTextCandidate(objectId, '只在获得权限时可见'));
  const mock = createContentMock({
    id: objectId,
    version: initialVersion,
    body: { kind: 'text', value: { text: '当前授权正文' } },
  });
  let editable = true;
  const service: WhiteboardService = {
    ...mock.service,
    async getScene(id, signal) {
      const scene = await mock.service.getScene(id, signal);

      return { ...scene, canEdit: editable };
    },
  };
  const copied: string[] = [];
  const app = createAppMock(service, {
    editService: mock.editService,
    localDrafts: { actorId, storage },
    clipboard: {
      async writeText(text) {
        copied.push(text);
      },
      async readText() {
        return '';
      },
    },
  });

  try {
    await app.open(boardId);
    await app.click('本机草稿');
    await app.click('文字草稿 · downgraded-object');
    expect(app.host.textContent).toContain('只在获得权限时可见');

    editable = false;
    await app.click('复制草稿');
    expect(copied).toEqual([]);
    expect(mock.commands).toEqual([]);
    expect(app.host.textContent).not.toContain('只在获得权限时可见');
  } finally {
    app.dispose();
    storage.remove(scope, 'board-draft');
  }
});
