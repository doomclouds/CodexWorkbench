import { act, createRef } from 'react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { tableExtension, TableObject } from '../../../src/ui/domain/objects/table/index.js';
import type {
  TableObjectDraft,
  TableObjectHandle,
  TableObjectProps,
  TableObjectValue,
} from '../../../src/ui/domain/objects/table/index.js';
import { createControlFixture } from '../../support/render-control.js';

const initial: TableObjectValue = {
  id: 'test-table',
  version: 1,
  width: 400,
  data: {
    rows: [
      ['A', 'B'],
      ['C', 'D'],
    ],
    source: 'preserve',
  },
};

type TableViewProps = ComponentProps<NonNullable<typeof tableExtension.View>>;
type TableViewReceipt = Awaited<ReturnType<TableViewProps['request']>>;

const tableViewGeometry = { x: 0, y: 0, width: 600, height: 240, rotation: 0 };

function confirmed(draft: TableObjectDraft, version = draft.base.version + 1) {
  return { ...draft.value, version };
}

let view: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  view = createControlFixture();
});

afterEach(() => {
  view.dispose();
  vi.useRealTimers();
});

function mount(value: TableObjectValue = initial, props: Partial<TableObjectProps> = {}) {
  const save = vi.fn(async (draft: TableObjectDraft) => confirmed(draft));
  view.render(<TableObject value={value} selected canEdit onSave={save} {...props} />);

  return save;
}

function editable(
  value: TableObjectValue = initial,
  props: Partial<TableObjectProps> = {},
  nextVersion: (base: number) => number = (base) => base + 1,
) {
  let current = value;
  const save = vi.fn(async (draft: TableObjectDraft) => {
    current = confirmed(draft, nextVersion(draft.base.version));
    return current;
  });
  mount(value, { onSave: save, ...props });

  return { save, current: () => current };
}

function mountExtension(request: TableViewProps['request'], props: Partial<TableViewProps> = {}) {
  const View = tableExtension.View;
  if (!View) {
    throw new Error('Expected the registered table view');
  }

  view.render(
    <View
      id={initial.id}
      object={{ kind: 'table', label: '表格', geometry: tableViewGeometry }}
      geometry={tableViewGeometry}
      payload={{ version: initial.version, value: initial }}
      zoom={1}
      selected
      interactive
      readOnly={false}
      request={request}
      {...props}
    />,
  );
}

function find<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = view.host,
) {
  const node = parent.querySelector<T>(selector);
  if (!node) {
    throw new Error('Expected ' + selector);
  }

  return node;
}

function cell(row: number, column: number) {
  return find<HTMLTableCellElement>('[data-cell="' + row + ':' + column + '"]');
}

function editor() {
  return find<HTMLDivElement>('[contenteditable][role="textbox"]');
}

function toolbarButton(label: string) {
  const button = [...view.host.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === label,
  );

  if (!button) {
    throw new Error('Expected button ' + label);
  }

  return button;
}

function rowsInView() {
  return [...view.host.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th,td')].map((node) => node.textContent),
  );
}

function columnWidths() {
  return [...view.host.querySelectorAll('col')].map((column) => column.style.width);
}

async function mouse(target: Element, type: string, init: MouseEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    await Promise.resolve();
  });
}

async function pointer(target: Element, type: string, init: PointerEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 23, ...init }),
    );
    await Promise.resolve();
  });
}

async function key(value: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    editor().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...init }),
    );
    await Promise.resolve();
  });
}

function type(value: string) {
  act(() => {
    const field = editor();
    field.textContent = value;
    field.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
    );
  });
}

function selectText(value: string) {
  act(() => {
    const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const position = node.textContent?.indexOf(value) ?? -1;
      if (position >= 0) {
        const range = document.createRange();
        range.setStart(node, position);
        range.setEnd(node, position + value.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }

      node = walker.nextNode();
    }

    throw new Error('No matching editor text: ' + value);
  });
}

function format(
  handle: TableObjectHandle | null,
  style: Parameters<TableObjectHandle['format']>[0],
  url?: string,
) {
  let applied = false;
  act(() => {
    applied = handle?.format(style, url) ?? false;
  });

  return applied;
}

function menuAction(label: string) {
  const menu = find('[role="menu"]', document.body);
  const item = [...menu.querySelectorAll('button')].find((choice) => choice.textContent === label);
  if (!item) {
    throw new Error('Expected available cell action ' + label);
  }

  return item;
}

it('renders and edits the original TSV table without substituting sample cells', async () => {
  const value: TableObjectValue = {
    ...initial,
    width: 900,
    text: '名称\t说明\t状态\r\n项目 A\t双击单元格编辑\t进行中\r\n项目 B\t后续安排\t待处理',
    data: undefined,
  };
  const { save, current } = editable(value);
  expect(view.host.querySelectorAll('[data-cell]')).toHaveLength(9);
  expect(cell(1, 1).textContent).toBe('双击单元格编辑');
  expect(cell(2, 2).textContent).toBe('待处理');

  await mouse(cell(2, 1), 'dblclick');
  type('已安排');
  await key('Escape');

  expect(save.mock.calls[0]?.[0].base).toBe(value);
  expect(current().data?.rows).toEqual([
    ['名称', '说明', '状态'],
    ['项目 A', '双击单元格编辑', '进行中'],
    ['项目 B', '已安排', '待处理'],
  ]);
  expect(current().text).toBe(value.text);
});

it('gives explicit structured rows precedence over legacy TSV content', () => {
  mount({ ...initial, text: '旧\t表\n应\t忽略' });
  expect(view.host.querySelectorAll('[data-cell]')).toHaveLength(4);
  expect(rowsInView()).toEqual([
    ['A', 'B'],
    ['C', 'D'],
  ]);
});

it('shows the original header and first two preview rows while retaining cell targets', async () => {
  const value = {
    ...initial,
    data: {
      rows: [
        ['[名称](https://example.com)\n第二行', '说明'],
        ['项目 A', '一'],
        ['项目 B', '二'],
        ['项目 C', '三'],
      ],
      columnWidths: [120, 280],
    },
  };
  mount(value, { detail: 'preview', zoom: 0.5 });

  expect(columnWidths()).toEqual(['120px', '280px']);
  expect(rowsInView()).toHaveLength(3);
  expect(cell(0, 0).textContent).toBe('名称');
  expect(view.host.querySelector('a')).toBeNull();
  expect(view.host.querySelector('[role="separator"]')).toBeNull();
  expect(toolbarButton('添加表格行')).toBeTruthy();

  mount(value, { detail: 'preview', zoom: 0.28 });
  expect(cell(0, 0).textContent).toBe('');
  expect(cell(0, 0).querySelector('[aria-hidden="true"]')).toBeTruthy();
  await mouse(cell(2, 1), 'dblclick');
  expect(editor().getAttribute('aria-label')).toBe('表格第3行第2列');
  expect(cell(3, 0).textContent).toBe('项目 C');
});

it('opens outline editing from the public request and retains the editor across zoom changes', async () => {
  const save = mount(initial, { detail: 'outline', zoom: 0.1 });
  expect(view.host.querySelector('table')).toBeNull();
  expect(find('[data-table-detail]').dataset.tableDetail).toBe('outline');

  mount(initial, { detail: 'outline', zoom: 0.1, editRequest: 1, onSave: save });
  const original = editor();
  type('正在编辑');

  mount(initial, { detail: 'preview', zoom: 0.28, editRequest: 1, onSave: save });
  expect(editor()).toBe(original);
  expect(document.activeElement).toBe(original);
  expect(editor().textContent).toBe('正在编辑');
  expect(find('[data-table-detail]').dataset.tableDetail).toBe('full');
});

it('formats only the selected rich cell text and submits its original version', async () => {
  const ref = createRef<TableObjectHandle>();
  const value = {
    ...initial,
    data: {
      rows: [
        ['Alpha beta gamma', 'Untouched'],
        ['C', 'D'],
      ],
    },
  };
  const { save, current } = editable(value, {
    ref,
    headerPaint: { background: '#f9e56f', color: '#222222' },
  });
  expect(cell(0, 0).style.background).toBe('rgb(249, 229, 111)');

  await mouse(cell(0, 0), 'dblclick');
  selectText('beta');
  expect(format(ref.current, 'bold')).toBe(true);
  expect(editor().querySelector('strong')?.textContent).toBe('beta');
  expect(format(ref.current, 'italic')).toBe(true);
  expect(editor().querySelector('strong em, em strong')?.textContent).toBe('beta');
  expect(format(ref.current, 'bold')).toBe(true);
  expect(editor().querySelector('strong')).toBeNull();
  await key('Escape');

  expect(save.mock.calls[0]?.[0].base.version).toBe(1);
  expect(current().data?.rows).toEqual([
    ['Alpha _beta_ gamma', 'Untouched'],
    ['C', 'D'],
  ]);
  expect(cell(0, 0).querySelector('em')?.textContent).toBe('beta');
});

it('formats real lists and rejects unsupported links without changing another cell', async () => {
  const ref = createRef<TableObjectHandle>();
  const value = { ...initial, data: { rows: [['one\ntwo', 'Other']] } };
  const { current } = editable(value, { ref });

  await mouse(cell(0, 0), 'dblclick');
  selectText('one');
  expect(format(ref.current, 'bullets')).toBe(true);
  expect(editor().querySelector('ul li')?.textContent).toBe('one');
  selectText('two');
  expect(format(ref.current, 'numbered')).toBe(true);
  expect(editor().querySelector('ol li')?.textContent).toBe('two');
  selectText('one');
  expect(format(ref.current, 'link', 'javascript:void(0)')).toBe(false);
  expect(format(ref.current, 'link', 'https://example.test')).toBe(true);
  expect(editor().querySelector('a')?.getAttribute('href')).toBe('https://example.test/');
  await key('Escape');

  expect(current().data?.rows?.[0]?.[1]).toBe('Other');
});

it('keeps a rich cell selected while an existing toolbar receives focus', async () => {
  const ref = createRef<TableObjectHandle>();
  const { save } = editable({ ...initial, data: { rows: [['Alpha beta', 'Other']] } }, { ref });
  await mouse(cell(0, 0), 'dblclick');
  selectText('beta');
  await key('b', { ctrlKey: true });

  const toolbar = document.createElement('div');
  toolbar.className = 'studio-selection-toolbar';
  const input = document.createElement('input');
  toolbar.append(input);
  document.body.append(toolbar);
  try {
    act(() => input.focus());
    expect(save).not.toHaveBeenCalled();
    expect(format(ref.current, 'italic')).toBe(true);
    expect(editor().querySelector('strong em, em strong')?.textContent).toBe('beta');

    await key('Escape');
    expect(save.mock.calls[0]?.[0].value.data?.rows).toEqual([['Alpha **_beta_**', 'Other']]);
  } finally {
    toolbar.remove();
  }
});

it('requests a link callback with Ctrl K and restores the real DOM selection after focus changes', async () => {
  const ref = createRef<TableObjectHandle>();
  const onRequestLink = vi.fn();
  const { save } = editable(
    { ...initial, data: { rows: [['Before chosen after', 'Other']] } },
    { ref, onRequestLink },
  );
  await mouse(cell(0, 0), 'dblclick');
  selectText('chosen');
  await key('k', { ctrlKey: true });
  expect(onRequestLink).toHaveBeenCalledWith('');

  const field = document.createElement('input');
  document.body.append(field);
  try {
    act(() => {
      field.value = 'https://example.test/reference';
      field.focus();
      field.select();
    });
    expect(save).not.toHaveBeenCalled();
    expect(format(ref.current, 'link', field.value)).toBe(true);
    expect(editor().querySelector('a')?.textContent).toBe('chosen');
    await key('Escape');
    expect(save.mock.calls[0]?.[0].value.data?.rows).toEqual([
      ['Before [chosen](https://example.test/reference) after', 'Other'],
    ]);
  } finally {
    field.remove();
  }
});

it('leaves read-only tables visible without any editing or geometry commands', async () => {
  const activity = vi.fn();
  const save = mount(initial, { canEdit: false, onActivityChange: activity });
  await mouse(cell(0, 0), 'dblclick');
  await mouse(cell(0, 0), 'contextmenu', { button: 2 });
  expect(view.host.querySelector('[role="textbox"]')).toBeNull();
  expect(view.host.querySelector('[role="toolbar"]')).toBeNull();
  expect(view.host.querySelector('[role="separator"]')).toBeNull();
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(activity.mock.lastCall?.[0]).toEqual({
    editing: false,
    dirty: false,
    saving: false,
    resizing: false,
  });
});

it('saves Tab and Enter against the response version and appends the final Tab row', async () => {
  const { save, current } = editable(initial, {}, (base) => (base === 1 ? 7 : base + 1));
  await mouse(cell(0, 0), 'dblclick');
  type('First edit');
  await key('Tab');
  expect(editor().getAttribute('aria-label')).toBe('表格第1行第2列');

  type('Second edit');
  await key('Enter');
  expect(save.mock.calls.map(([draft]) => draft.base.version)).toEqual([1, 7]);
  expect(editor().getAttribute('aria-label')).toBe('表格第2行第2列');
  await key('Tab', { shiftKey: true });
  expect(editor().getAttribute('aria-label')).toBe('表格第2行第1列');
  await pointer(cell(1, 1), 'pointerdown');
  await key('Tab');
  expect(editor().getAttribute('aria-label')).toBe('表格第3行第1列');
  expect(current().data?.rows).toEqual([
    ['First edit', 'Second edit'],
    ['C', 'D'],
    ['', ''],
  ]);
  expect(current().data?.source).toBe('preserve');
  await key('Escape');
  expect(view.host.querySelector('[role="textbox"]')).toBeNull();
  expect(save).toHaveBeenCalledTimes(3);
});

it('preserves changed cell content in the same write as an added row and later header toggle', async () => {
  const { save, current } = editable();
  await mouse(cell(0, 0), 'dblclick');
  type('Draft before add');
  await mouse(toolbarButton('添加表格行'), 'click');

  expect(save).toHaveBeenCalledTimes(1);
  expect(current().data?.rows).toEqual([
    ['Draft before add', 'B'],
    ['C', 'D'],
    ['', ''],
  ]);
  expect(editor().getAttribute('aria-label')).toBe('表格第3行第1列');

  await mouse(toolbarButton('切换表头'), 'click');
  expect(view.host.querySelectorAll('th')).toHaveLength(0);
  expect(current().data?.head).toBe(false);
  expect(save.mock.calls[1]?.[0].base.version).toBe(2);
});

it('retains failed drafts and their original CAS base when remote content arrives', async () => {
  const onSave = vi.fn(async (): Promise<false> => false);
  const activity = vi.fn();
  const props = { onSave, onActivityChange: activity };
  mount(initial, props);
  await mouse(cell(0, 0), 'dblclick');
  type('Local draft');
  await key('Escape');

  mount(
    {
      ...initial,
      version: 2,
      data: {
        rows: [
          ['Remote edit', 'B'],
          ['C', 'D'],
        ],
      },
    },
    props,
  );
  expect(editor().textContent).toBe('Local draft');
  expect(activity.mock.lastCall?.[0]).toMatchObject({ editing: true, dirty: true });
  await mouse(toolbarButton('重试保存表格'), 'click');
  expect(onSave).toHaveBeenNthCalledWith(2, expect.objectContaining({ base: initial }));

  await mouse(toolbarButton('放弃表格草稿'), 'click');
  expect(cell(0, 0).textContent).toBe('Remote edit');
  expect(view.host.querySelector('[role="textbox"]')).toBeNull();
});

it('keeps newer input responsive during a save and retains it after rejection', async () => {
  let rejectPending: ((failure: Error) => void) | undefined;
  const pending = new Promise<TableObjectValue | false>((_resolve, reject) => {
    rejectPending = reject;
  });
  const onSave = vi.fn(() => pending);
  mount(initial, { onSave });
  await mouse(cell(0, 0), 'dblclick');
  type('Pending');
  await key('Escape');
  expect(editor().getAttribute('aria-disabled')).toBeNull();
  type('Newer pending');
  await key('Escape');
  expect(onSave).toHaveBeenCalledTimes(1);

  await act(async () => {
    rejectPending?.(new Error('Network unavailable'));
    await Promise.resolve();
  });
  expect(editor().textContent).toBe('Newer pending');
  expect(editor().getAttribute('aria-disabled')).toBeNull();
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('Network unavailable');
});

it('rebases later local typing onto an accepted revision while retaining another updated cell', async () => {
  let acceptPending: ((value: TableObjectValue) => void) | undefined;
  const pending = new Promise<TableObjectValue>((resolve) => {
    acceptPending = resolve;
  });
  const onSave = vi.fn(async (draft: TableObjectDraft) => confirmed(draft));
  onSave.mockImplementationOnce(() => pending);
  mount(initial, { onSave });
  await mouse(cell(0, 0), 'dblclick');
  type('Pending');
  await key('Escape');
  type('Later draft');
  await key('Escape');

  await act(async () => {
    acceptPending?.({
      ...initial,
      version: 7,
      data: {
        rows: [
          ['Pending', 'Remote second cell'],
          ['C', 'D'],
        ],
      },
    });
    await Promise.resolve();
  });

  expect(onSave.mock.calls.map(([draft]) => draft.base.version)).toEqual([1, 7]);
  expect(rowsInView()).toEqual([
    ['Later draft', 'Remote second cell'],
    ['C', 'D'],
  ]);
});

it('uses clipboard event text to edit only the intended cell and retains literal markup', async () => {
  const { current } = editable();
  await mouse(cell(0, 0), 'dblclick');
  selectText('A');
  const pasted = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(pasted, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? '<b>literal</b>' : '') },
  });
  await act(async () => {
    editor().dispatchEvent(pasted);
    await Promise.resolve();
  });
  expect(editor().querySelector('b')).toBeNull();
  await key('Escape');
  expect(current().data?.rows?.[0]?.[1]).toBe('B');
  expect(cell(0, 0).textContent).toBe('<b>literal</b>');
});

it('projects separate table header and body paints without mutating their source', () => {
  const bodyPaint = { background: '#1d4266', color: '#ffffff' };
  const headerPaint = { background: '#f9e56f', color: '#161616' };
  mount(initial, { bodyPaint, headerPaint });
  expect(getComputedStyle(find('table')).backgroundColor).toBe('rgb(29, 66, 102)');
  expect(getComputedStyle(cell(1, 0)).color).toBe('rgb(255, 255, 255)');
  expect(getComputedStyle(cell(0, 0)).backgroundColor).toBe('rgb(249, 229, 111)');
  expect(getComputedStyle(cell(0, 0)).color).toBe('rgb(22, 22, 22)');
  expect(initial.data?.rows).toEqual([
    ['A', 'B'],
    ['C', 'D'],
  ]);
});

it('uses projected geometry while a table extension draft saves through the versioned receipt', async () => {
  const request = vi.fn<TableViewProps['request']>();
  const saved = {
    ...initial,
    version: 7,
    width: 520,
    data: {
      rows: [
        ['Edited', 'B'],
        ['C', 'D'],
      ],
    },
  };
  request.mockResolvedValue({ ok: true, payload: { version: 7, value: saved } });
  mountExtension(request);
  expect(tableExtension.capabilities).toEqual({
    content: 'native',
    move: true,
    resize: true,
    rotate: false,
    connect: true,
  });
  expect(tableExtension.placement?.kind).toBe('table');
  expect(columnWidths()).toEqual(['300px', '300px']);

  await mouse(cell(0, 0), 'dblclick');
  type('Edited');
  const originalEditor = editor();
  mountExtension(request, { geometry: { ...tableViewGeometry, width: 520 } });
  expect(columnWidths()).toEqual(['260px', '260px']);
  expect(editor()).toBe(originalEditor);
  expect(editor().textContent).toBe('Edited');

  await key('Escape');
  expect(request).toHaveBeenCalledWith({
    name: 'table.save',
    expectedVersion: 1,
    value: expect.objectContaining({
      base: expect.objectContaining({ id: initial.id, version: 1 }),
    }),
  });
  expect(cell(0, 0).textContent).toBe('Edited');
});

it('keeps a rejected table extension draft editable with the frame locked', async () => {
  const request = vi.fn<TableViewProps['request']>();
  request.mockResolvedValue({ ok: false, message: '版本冲突' });
  mountExtension(request, { locked: true, editRequest: 1 });
  expect(view.host.querySelector('[role="separator"]')).toBeNull();
  type('Local draft');

  await key('Escape');
  expect(request).toHaveBeenCalledTimes(1);
  expect(editor().textContent).toBe('Local draft');
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('草稿已保留');
});

it('uses the supplied fallback for a malformed canvas table payload', () => {
  const request = vi.fn<TableViewProps['request']>();
  mountExtension(request, {
    payload: { version: 1, value: { ...initial, data: { rows: ['not a table row'] } } },
    content: <p>表格内容不可用</p>,
  });

  expect(view.host.textContent).toBe('表格内容不可用');
  expect(request).not.toHaveBeenCalled();
});

it('retains the table during an in-flight edit and releases it after settlement', async () => {
  const onRetentionChange = vi.fn<(retain: boolean) => void>();
  let settle: ((value: TableViewReceipt) => void) | undefined;
  const pending = new Promise<TableViewReceipt>((resolve) => {
    settle = resolve;
  });
  const request = vi.fn<TableViewProps['request']>(() => pending);
  mountExtension(request, { onRetentionChange });
  expect(onRetentionChange).toHaveBeenLastCalledWith(false);

  await mouse(cell(0, 0), 'dblclick');
  expect(onRetentionChange).toHaveBeenLastCalledWith(true);
  type('Pending value');
  await key('Escape');
  expect(request).toHaveBeenCalledTimes(1);
  mountExtension(request, { onRetentionChange, selected: false });
  expect(onRetentionChange).toHaveBeenLastCalledWith(true);

  await act(async () => {
    settle?.({
      ok: true,
      payload: {
        version: 2,
        value: {
          ...initial,
          version: 2,
          width: tableViewGeometry.width,
          data: {
            rows: [
              ['Pending value', 'B'],
              ['C', 'D'],
            ],
          },
        },
      },
    });
    await Promise.resolve();
  });
  expect(onRetentionChange).toHaveBeenLastCalledWith(false);
});

it('keeps the table retained only during a column gesture when no cell is being edited', async () => {
  const onRetentionChange = vi.fn<(retain: boolean) => void>();
  const request = vi.fn<TableViewProps['request']>();
  mountExtension(request, { onRetentionChange });
  expect(onRetentionChange).toHaveBeenLastCalledWith(false);

  const handle = find('[role="separator"]');
  await pointer(handle, 'pointerdown', { clientX: 130 });
  expect(onRetentionChange).toHaveBeenLastCalledWith(true);
  await pointer(handle, 'pointercancel');
  expect(onRetentionChange).toHaveBeenLastCalledWith(false);
  expect(request).not.toHaveBeenCalled();
});

it('offers row and column insertion and deletion while preserving the last cell', async () => {
  const { current } = editable();
  await mouse(cell(0, 1), 'contextmenu', { button: 2, clientX: 120, clientY: 40 });
  expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(6);

  await mouse(menuAction('在左侧插入列'), 'click');
  expect(current().data?.rows).toEqual([
    ['A', '', 'B'],
    ['C', '', 'D'],
  ]);
  await mouse(toolbarButton('删除当前列'), 'click');
  expect(current().data?.rows).toEqual([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  await mouse(toolbarButton('删除当前行'), 'click');
  expect(current().data?.rows).toEqual([['C', 'D']]);
  expect(toolbarButton('删除当前行').disabled).toBe(true);
  await mouse(toolbarButton('删除当前列'), 'click');
  expect(toolbarButton('删除当前列').disabled).toBe(true);
  expect(current().data?.rows).toEqual([['C']]);
});

it('keeps a dirty cell open when its menu receives focus and submits it with the inserted row', async () => {
  const { save, current } = editable();
  await mouse(cell(0, 0), 'dblclick');
  type('Draft before menu');
  await mouse(cell(0, 0), 'contextmenu', { button: 2 });
  expect(save).not.toHaveBeenCalled();
  expect(editor().textContent).toBe('Draft before menu');

  await mouse(menuAction('在下方插入行'), 'click');
  expect(save).toHaveBeenCalledTimes(1);
  expect(current().data?.rows).toEqual([
    ['Draft before menu', 'B'],
    ['', ''],
    ['C', 'D'],
  ]);
});

it('cancels an in-progress width change when another actor locks the table', async () => {
  const activity = vi.fn();
  const onSave = mount(initial, { onActivityChange: activity });
  const handle = find('[role="separator"]');
  await pointer(handle, 'pointerdown', { clientX: 100 });
  await pointer(handle, 'pointermove', { clientX: 180 });
  expect(columnWidths()).toEqual(['280px', '200px']);

  mount({ ...initial, version: 2 }, { locked: true, onSave, onActivityChange: activity });
  expect(columnWidths()).toEqual(['200px', '200px']);
  expect(view.host.querySelector('[role="separator"]')).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  expect(activity.mock.lastCall?.[0]).toMatchObject({ editing: false, resizing: false });
});

it('converts a screen-space column resize into persisted column widths and outer width', async () => {
  const { save, current } = editable(initial, { zoom: 0.5 });
  const handle = find('[role="separator"]');
  await pointer(handle, 'pointerdown', { clientX: 100 });
  await pointer(handle, 'pointermove', { clientX: 125 });
  expect(columnWidths()).toEqual(['250px', '200px']);
  expect(save).not.toHaveBeenCalled();
  await pointer(handle, 'pointerup', { clientX: 125 });

  expect(save.mock.calls[0]?.[0].value).toMatchObject({
    width: 450,
    data: {
      columnWidths: [250, 200],
      rows: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    },
  });
  expect(current().width).toBe(450);
  expect(columnWidths()).toEqual(['250px', '200px']);
});

it('cancels a column drag and keeps locked content editable at the same outer width', async () => {
  const save = mount();
  const handle = find('[role="separator"]');
  await pointer(handle, 'pointerdown', { clientX: 100 });
  await pointer(handle, 'pointermove', { clientX: 180 });
  await pointer(handle, 'pointercancel');
  expect(save).not.toHaveBeenCalled();
  expect(columnWidths()).toEqual(['200px', '200px']);

  const { current } = editable(initial, { locked: true });
  expect(view.host.querySelector('[role="separator"]')).toBeNull();
  await mouse(cell(0, 0), 'dblclick');
  type('Locked content');
  await key('Escape');
  await mouse(toolbarButton('添加表格列'), 'click');
  expect(current().width).toBe(400);
  expect(current().data?.rows).toEqual([
    ['Locked content', 'B', ''],
    ['C', 'D', ''],
  ]);
});

it('keeps an unmounted table draft recoverable and distinguishes clean editing from unsaved content', async () => {
  const onDraftChange = vi.fn<(draft: TableObjectDraft | null) => void>();
  const onActivityChange = vi.fn();
  const save = mount(initial, { onDraftChange, onActivityChange });
  await mouse(cell(0, 0), 'dblclick');
  expect(onActivityChange.mock.lastCall?.[0]).toMatchObject({ editing: true, dirty: false });
  type('Lost table cell');
  expect(onActivityChange.mock.lastCall?.[0]).toMatchObject({ editing: true, dirty: true });
  const draft = onDraftChange.mock.lastCall?.[0] ?? undefined;
  expect(draft?.value.data?.rows?.[0]?.[0]).toBe('Lost table cell');
  type('A');
  expect(onDraftChange.mock.lastCall?.[0]).toBeNull();
  expect(onActivityChange.mock.lastCall?.[0]).toMatchObject({ editing: true, dirty: false });
  expect(editor()).toBeTruthy();
  type('Lost table cell');
  view.render(null);
  expect(onDraftChange.mock.lastCall?.[0]?.value.data?.rows?.[0]?.[0]).toBe('Lost table cell');

  mount(initial, { onSave: save, initialDraft: draft, editRequest: 1 });
  expect(editor().textContent).toBe('Lost table cell');
});
