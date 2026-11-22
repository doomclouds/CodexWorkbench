import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TodoRegion from '../../src/app/features/whiteboard/canvas/objects/todo/TodoRegion.js';
import type { BoardElement, Operation } from '../../src/contracts/studio.js';
import {
  applyTodoOperations,
  normalizeTodoItems,
  type TodoOperation,
} from '../../src/contracts/todo.js';

type Props = ComponentProps<typeof TodoRegion>;

const taskList = (): BoardElement => ({
  id: 'checklist',
  type: 'todo',
  x: 30,
  y: 70,
  w: 450,
  h: 380,
  version: 2,
  text: '发布验收',
  data: {
    items: [
      { id: 'plan', text: '整理需求', checked: true },
      {
        id: 'limits',
        text: '核对读取上限',
        checked: false,
        sourceRef: { elementId: 'api', blockId: 'bounds' },
      },
    ],
  },
});
let container: HTMLDivElement;
let root: Root;
let props: Props;

function persist(operations: Operation[], base: BoardElement): BoardElement {
  let next = { ...base, version: base.version + 1 };
  for (const op of operations) {
    if (op.op === 'update') {
      next = { ...next, ...op.changes };
    }
    if (op.op === 'todo') {
      next.data = {
        ...next.data,
        items: applyTodoOperations(
          normalizeTodoItems(next.data?.items),
          op.data?.operations as TodoOperation[],
        ),
      };
    }
  }

  return next;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  container.className = 'studio-whiteboard';
  document.body.append(container);
  root = createRoot(container);
  props = {
    element: taskList(),
    interactive: true,
    canEdit: true,
    onExpand: vi.fn(),
    onSave: vi.fn(async (operations, base) => persist(operations, base)),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(changes: Partial<Props> = {}) {
  props = { ...props, ...changes };
  await act(async () => root.render(<TodoRegion {...props} />));
}

function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(
    (node) => (node.getAttribute('aria-label') ?? node.textContent) === label,
  );

  if (!found) {
    throw new Error('Missing button ' + label);
  }

  return found;
}

function input(label: string) {
  return container.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]')!;
}

async function click(node: HTMLElement | string) {
  await act(async () => (typeof node === 'string' ? button(node) : node).click());
}

async function write(node: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(node: HTMLElement, value: string, init: KeyboardEventInit = {}) {
  await act(async () =>
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init }),
    ),
  );
}

const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-todo-item-id]'));

it('keeps a board overview at title and progress, and exposes the actual task rows after explicit expansion', async () => {
  const renderOutsideRows = vi.fn(() => <span data-test-outside-pin />);
  await render({ overview: true, interactive: false, uiScale: 1.8, renderOutsideRows });
  const region = container.querySelector<HTMLElement>('[data-todo-id]')!;
  expect(region.dataset.todoLayout).toBe('overview');
  expect(region.textContent).toContain('发布验收');
  expect(region.textContent).toContain('1/2 完成');
  expect(region.querySelector('progress')?.value).toBe(1);
  expect(region.style.getPropertyValue('--todo-ui-scale')).toBe('1.8');
  expect(renderOutsideRows).toHaveBeenLastCalledWith([]);
  expect(region.querySelector('.studio-todo-outside-rows [data-test-outside-pin]')).toBeTruthy();
  expect(rows()).toHaveLength(0);
  await click('展开任务清单');
  expect(props.onExpand).toHaveBeenCalledOnce();
  await render({ expanded: true });
  expect(region.dataset.todoLayout).toBe('full');
  expect(renderOutsideRows).toHaveBeenLastCalledWith(['plan', 'limits']);
  expect(rows().map((row) => row.dataset.todoItemId)).toEqual(['plan', 'limits']);
  expect(input('完成任务：整理需求').checked).toBe(true);
  expect(props.onSave).not.toHaveBeenCalled();
});

it('uses a targeted explicit checked value and only exposes row write controls when interactive', async () => {
  await render({ interactive: false });
  expect(rows()).toHaveLength(2);
  expect(container.querySelectorAll('input')).toHaveLength(0);
  await render({ interactive: true });
  await click(input('完成任务：核对读取上限'));
  expect(props.onSave).toHaveBeenCalledWith(
    [
      {
        op: 'todo',
        id: 'checklist',
        data: {
          operations: [{ op: 'update', id: 'limits', changes: { checked: true } }],
        },
      },
    ],
    props.element,
  );
  expect(input('完成任务：核对读取上限').checked).toBe(true);
  expect(container.textContent).toContain('2/2 完成');
});

it('keeps the add input available for consecutive Enter submissions and marks each new task with a unique ID', async () => {
  await render();
  await click('添加任务');
  let added = input('新增任务');
  expect(document.activeElement).toBe(added);
  await write(added, '复查备注位置');
  await key(added, 'Enter', { isComposing: true });
  expect(props.onSave).not.toHaveBeenCalled();
  await key(added, 'Enter');
  added = input('新增任务');
  expect(added.value).toBe('');
  expect(document.activeElement).toBe(added);
  await write(added, '验证缩放显示');
  await key(added, 'Enter');
  const list = rows().map((row) => row.dataset.todoItemId);
  expect(list).toHaveLength(4);
  expect(new Set(list).size).toBe(4);
  expect(list.slice(0, 2)).toEqual(['plan', 'limits']);
  expect(props.onSave).toHaveBeenCalledTimes(2);
  expect(vi.mocked(props.onSave).mock.calls[1]![1].version).toBe(3);
});

it('turns multiline clipboard text in the add field into one bounded save', async () => {
  await render();
  await click('添加任务');
  const draft = input('新增任务');
  await write(draft, '实机');
  draft.setSelectionRange(2, 2);
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => '布局对照\r\n\r\n交互回归\n实机验收' },
  });
  await act(async () => draft.dispatchEvent(event));
  const operations = vi.mocked(props.onSave).mock.calls[0]![0][0]!.data
    ?.operations as TodoOperation[];
  expect(operations.map((op) => op.op === 'insert' && op.item.text)).toEqual([
    '实机布局对照',
    '交互回归',
    '实机验收',
  ]);
  expect(event.defaultPrevented).toBe(true);
  expect(props.onSave).toHaveBeenCalledTimes(1);
});

it('keeps stable task IDs when reordering from the keyboard and opens the exact source reference', async () => {
  const onOpenSource = vi.fn();
  const onMoveStart = vi.fn();
  await render({ onOpenSource, onMoveStart, sourceLabel: () => '接口方案' });
  await key(button('调整顺序：整理需求'), 'ArrowDown');
  expect(rows().map((item) => item.dataset.todoItemId)).toEqual(['limits', 'plan']);
  expect(vi.mocked(props.onSave).mock.calls[0]![0][0]!.data?.operations).toEqual([
    { op: 'move', id: 'plan', afterId: 'limits' },
  ]);
  await click('打开任务来源：接口方案');
  expect(onOpenSource).toHaveBeenCalledWith({ elementId: 'api', blockId: 'bounds' });
  await act(async () =>
    button('移动任务清单').dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, bubbles: true }),
    ),
  );
  expect(onMoveStart).toHaveBeenCalledOnce();
});

it('keeps an unsaved row draft as the original version and operation until a retry succeeds', async () => {
  const onSave = vi
    .fn(
      async (_operations: Operation[], _base: BoardElement): Promise<BoardElement | false> => false,
    )
    .mockImplementationOnce(async () => false)
    .mockImplementationOnce(async (operations, base) => persist(operations, base));
  await render({ onSave });
  await click('编辑任务：核对读取上限');
  await write(input('任务文字'), '核对每页上限');
  await key(input('任务文字'), 'Enter');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('清单草稿未保存');
  expect(input('任务文字').value).toBe('核对每页上限');
  await render({ overview: true });
  expect(input('任务文字').value).toBe('核对每页上限');
  await click('重试保存');
  expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await render({ overview: false });
  expect(rows()[1]?.textContent).toContain('核对每页上限');
});

it('uses the version captured on opening a row draft when another view modifies the element', async () => {
  const onSave = vi.fn(
    async (_operations: Operation[], _base: BoardElement): Promise<BoardElement | false> => {
      throw new Error('任务清单已有新版本。');
    },
  );
  await render({ onSave });
  await click('编辑任务：核对读取上限');
  await write(input('任务文字'), '本机输入');
  const remote = taskList();
  await render({
    element: {
      ...remote,
      version: 3,
      data: { items: [{ id: 'limits', text: '远端输入', checked: false }] },
    },
  });
  await key(input('任务文字'), 'Enter');
  expect(onSave.mock.calls[0]?.[1].version).toBe(2);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('已有新版本');
  expect(input('任务文字').value).toBe('本机输入');
});

it('binds annotations to stable task IDs and actual client coordinates on either paper scheme', async () => {
  const annotate = vi.fn();
  await render({
    element: { ...taskList(), fill: '#182232' },
    annotationActive: true,
    onAnnotateItem: annotate,
  });
  expect(container.querySelector('[data-todo-id]')?.getAttribute('data-todo-scheme')).toBe('dark');
  const anchor = button('备注任务：核对读取上限');
  await act(async () =>
    anchor.dispatchEvent(
      new MouseEvent('click', { detail: 1, clientX: 132, clientY: 94, bubbles: true }),
    ),
  );
  expect(annotate).toHaveBeenCalledWith('limits', { x: 132, y: 94 });
  await click(anchor);
  expect(annotate).toHaveBeenLastCalledWith('limits', undefined);
  expect(props.onSave).not.toHaveBeenCalled();
});

it('positions visible row pins in the card overlay and follows the row padding box during scrolling', async () => {
  await render({ renderItemAdornment: (id) => <span data-test-pin={id} /> });
  const scroller = container.querySelector<HTMLElement>('.studio-todo-body')!;
  Object.defineProperties(scroller, {
    offsetTop: { value: 46 },
    clientHeight: { value: 85 },
    scrollTop: { value: 0, writable: true },
    scrollLeft: { value: 0, writable: true },
  });
  rows().forEach((row, index) => {
    Object.defineProperties(row, {
      offsetTop: { value: 46 + index * 43 },
      offsetLeft: { value: 0 },
      offsetHeight: { value: 43 },
      clientWidth: { value: 430 },
      clientHeight: { value: 42 },
    });
  });
  const scroll = async () => {
    await act(async () => scroller.dispatchEvent(new Event('scroll')));
  };

  const outside = (id: string) =>
    container.querySelector<HTMLElement>(
      '.studio-todo-row-adornments [data-todo-adornment-for="' + id + '"]',
    );
  await scroll();
  expect(scroller.querySelector('[data-test-pin]')).toBeNull();
  expect(outside('plan')?.querySelector('[data-test-pin="plan"]')).toBeTruthy();
  expect(outside('plan')?.style.top).toBe('46px');
  expect(outside('plan')?.style.height).toBe('42px');
  expect(outside('plan')?.style.width).toBe('430px');
  scroller.scrollTop = 12;
  await scroll();
  expect(outside('plan')?.style.top).toBe('34px');
  expect(outside('limits')?.style.top).toBe('77px');
  scroller.scrollTop = 43;
  await scroll();
  expect(outside('plan')).toBeNull();
  expect(outside('limits')?.style.top).toBe('46px');
  expect(props.onSave).not.toHaveBeenCalled();
});
