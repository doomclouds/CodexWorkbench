import { expect, test } from 'vitest';

import type {
  EditObjectContentCommand,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

const boardId = 'whiteboard-inline-format';
const link = 'https://example.org/design';
const geometry = { x: 48, y: 48, width: 320, height: 160, rotation: 0 };
const caption: WhiteboardObject = {
  id: 'caption',
  kind: 'text',
  label: '设计入口',
  geometry,
  geometryVersion: 2n,
  payloadVersion: 4n,
  locked: false,
};
const table: WhiteboardObject = { ...caption, id: 'table', kind: 'table' };
const captionPayload: WhiteboardPayload = {
  id: caption.id,
  version: 4n,
  body: { kind: 'text', value: { text: 'alpha beta' } },
};
const tablePayload: WhiteboardPayload = {
  id: table.id,
  version: 4n,
  body: {
    kind: 'table',
    value: {
      data: { rows: [['alpha beta', 'unchanged']], rowIds: ['r1'], columnIds: ['c1', 'c2'] },
    },
  },
};

async function unexpected(): Promise<never> {
  throw new Error('Unexpected whiteboard operation.');
}

function nextBody({ edit }: EditObjectContentCommand): WhiteboardPayload['body'] {
  if (edit.kind === 'text') {
    return { kind: 'text', value: { text: edit.value.text } };
  }

  if (edit.kind === 'table') {
    const { text, ...data } = edit.value;

    return { kind: 'table', value: { text, data } };
  }

  throw new Error('Unexpected inline formatting edit.');
}

function fixture(object: WhiteboardObject, initial: WhiteboardPayload) {
  let current = object;
  let payload = initial;
  let revision = 1n;
  const commands: EditObjectContentCommand[] = [];

  const service: WhiteboardService = {
    getScene: async () => ({
      boardId,
      title: '格式验收',
      revision,
      canEdit: true,
      objects: [current],
    }),
    getPayloads: async () => [{ kind: 'loaded', payload }],
    moveObjects: unexpected,
    getReceipt: unexpected,
  };
  const editService: WhiteboardEditService = {
    editGeometry: unexpected,
    editContent: async (command) => {
      commands.push(command);
      const { expectedPayloadVersion, commandId } = command;
      expect(expectedPayloadVersion).toBe(payload.version);
      expect(command.objectId).toBe(object.id);
      payload = { ...payload, version: payload.version + 1n, body: nextBody(command) };
      current = { ...current, payloadVersion: payload.version };
      revision += 1n;

      return {
        kind: 'applied',
        boardId,
        commandId,
        revision,
        objects: [current],
        removedIds: [],
        order: [],
        payloads: [{ kind: 'loaded', payload }],
      };
    },
    attachImage: unexpected,
    getReceipt: unexpected,
  };
  const app = createAppMock(service, {
    editService,
    createCommandId: () => 'inline-' + (commands.length + 1),
  });

  return { ...app, commands };
}

type AppFixture = ReturnType<typeof fixture>;

function find<T extends HTMLElement>(app: AppFixture, selector: string) {
  const element = app.host.querySelector<T>(selector);
  if (!element) {
    throw new Error('Missing ' + selector);
  }

  return element;
}

function keyboard(app: AppFixture, key: string, modifiers: KeyboardEventInit = {}) {
  const editor = find(app, '[contenteditable][role="textbox"]');

  return app.update(() => {
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...modifiers }),
    );
  });
}

function linkField(app: AppFixture, label: string) {
  const field = [...app.host.querySelectorAll('label')].find((item) => item.textContent === label);
  if (!(field?.control instanceof HTMLInputElement)) {
    throw new Error('Missing link field ' + label);
  }

  return field.control;
}

function submitLinkAddress(app: AppFixture, label: string, address: string) {
  const input = linkField(app, label);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  return app.update(() => {
    descriptor?.set?.call(input, address);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function selectWord(app: AppFixture, word: string) {
  const editor = find(app, '[contenteditable][role="textbox"]');

  return app.update(() => {
    const nodes = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const position = nodes.currentNode.textContent?.indexOf(word) ?? -1;
      if (position >= 0) {
        const selection = document.getSelection();
        const range = document.createRange();
        range.setStart(nodes.currentNode, position);
        range.setEnd(nodes.currentNode, position + word.length);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
    }

    throw new Error('Missing selected text ' + word);
  });
}

test('opens the selected text editor through the external link entry and persists the real Markdown', async () => {
  const app = fixture(caption, captionPayload);

  try {
    await app.open(boardId);
    await app.drag({ x: 80, y: 75 }, { x: 80, y: 75 });
    await app.click('文字链接');
    await submitLinkAddress(app, '链接地址', link);
    await app.click('应用链接');
    await keyboard(app, 'Escape');

    expect(app.commands.at(-1)?.edit).toMatchObject({
      kind: 'text',
      value: { text: '[alpha beta](' + link + ')' },
    });
    await app.open(boardId, 'reopen');
    expect(app.host.querySelector('a[href="' + link + '"]')?.textContent).toBe('alpha beta');
  } finally {
    app.dispose();
  }
});

test('uses the note editor to persist a real list from the selection toolbar', async () => {
  const note = { ...caption, id: 'note', kind: 'note' };
  const payload = { ...captionPayload, id: note.id };
  const app = fixture(note, payload);

  try {
    await app.open(boardId);
    await app.drag({ x: 80, y: 75 }, { x: 80, y: 75 });
    await app.click('切换列表');
    await keyboard(app, 'Escape');

    expect(app.commands.at(-1)?.edit).toMatchObject({
      kind: 'text',
      value: { text: '- alpha beta' },
    });
    await app.open(boardId, 'reopen');
    expect(app.host.querySelector('.studio-ui-rich-text-line.is-list')?.textContent).toContain(
      'alpha beta',
    );
  } finally {
    app.dispose();
  }
});

test('formats only the selected table cell and uses Ctrl+K for its actual link editor', async () => {
  const app = fixture(table, tablePayload);

  try {
    await app.open(boardId);
    await app.drag({ x: 80, y: 75 }, { x: 80, y: 75 });
    const cell = find(app, '[data-cell="0:0"]');
    await app.update(() => {
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    });

    await selectWord(app, 'beta');
    await app.click('加粗');
    expect(find(app, '[contenteditable] strong').textContent).toBe('beta');
    await app.click('斜体');
    expect(find(app, '[contenteditable] em').textContent).toBe('beta');

    await app.click('文字链接');
    expect(document.activeElement).toBe(linkField(app, '文字链接地址'));
    await app.click('取消链接编辑');
    expect(document.activeElement).toBe(find(app, '[contenteditable][role="textbox"]'));

    await keyboard(app, 'k', { ctrlKey: true });
    expect(document.activeElement).toBe(linkField(app, '文字链接地址'));
    await submitLinkAddress(app, '文字链接地址', link);
    await app.click('应用');
    await app.click('切换列表');
    await keyboard(app, 'Escape');

    const edit = app.commands.at(-1)?.edit;
    expect(edit?.kind).toBe('table');
    if (edit?.kind !== 'table') {
      throw new Error('Expected table content to be saved.');
    }

    expect(edit.value.rows[0]?.[1]).toBe('unchanged');
    expect(edit.value.rows[0]?.[0]).toMatch(/^- alpha /u);
    expect(edit.value.rows[0]?.[0]).toContain(link);
    await app.open(boardId, 'reopen');
    expect(app.host.querySelector('a[href="' + link + '"]')?.textContent).toBe('beta');
  } finally {
    app.dispose();
  }
});
