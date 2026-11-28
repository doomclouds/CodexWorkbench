import { act, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTodoObjectEdit,
  TodoObject,
  todoExtension,
} from '../../../src/ui/domain/objects/todo/index.js';
import type {
  TodoObjectEdit,
  TodoObjectProps,
  TodoObjectSnapshot,
} from '../../../src/ui/domain/objects/todo/index.js';
import { createControlFixture } from '../../support/render-control.js';

function taskList(): TodoObjectSnapshot {
  return {
    id: 'checklist',
    revision: 2,
    title: '发布验收',
    items: [
      { id: 'plan', text: '整理需求', checked: true },
      {
        id: 'limits',
        text: '核对读取上限',
        checked: false,
        sourceRef: { elementId: 'api', blockId: 'bounds' },
      },
    ],
  };
}

let fixture: ReturnType<typeof createControlFixture>;
let props: TodoObjectProps;

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

beforeEach(() => {
  fixture = createControlFixture();
  let value = taskList();
  props = {
    value,
    onEdit: vi.fn(async (edit: TodoObjectEdit) => {
      const confirmed = applyTodoObjectEdit(value, edit);
      if (confirmed) {
        value = confirmed;
      }

      return confirmed;
    }),
  };
});

afterEach(() => fixture.dispose());

function render(changes: Partial<TodoObjectProps> = {}) {
  props = { ...props, ...changes };
  fixture.render(<TodoObject {...props} />);
}

function required<T extends HTMLElement>(selector: string) {
  const node = fixture.host.querySelector<T>(selector);
  if (!node) {
    throw new Error('Missing node ' + selector);
  }

  return node;
}

function button(label: string, scope: ParentNode = fixture.host) {
  const found = [...scope.querySelectorAll('button')].find((element) => {
    const text = [...element.childNodes]
      .filter(
        (node) => !(node instanceof HTMLElement && node.getAttribute('aria-hidden') === 'true'),
      )
      .map((node) => node.textContent)
      .join('')
      .trim();

    return (element.getAttribute('aria-label') ?? text) === label;
  });

  if (!found) {
    throw new Error('Missing button ' + label);
  }

  return found;
}

function input(label: string) {
  const found = [...fixture.host.querySelectorAll('input')].find(
    (element) => element.getAttribute('aria-label') === label,
  );

  if (!found) {
    throw new Error('Missing field ' + label);
  }

  return found;
}

async function click(target: string | HTMLElement) {
  const element = typeof target === 'string' ? button(target) : target;
  await act(async () => element.click());
}

async function enterText(element: HTMLInputElement, text: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!descriptor?.set) {
    throw new Error('Missing input value setter');
  }

  await act(async () => {
    descriptor.set?.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(element: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

async function paste(element: HTMLElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  await act(async () => element.dispatchEvent(event));

  return event;
}

function rows() {
  return [...fixture.host.querySelectorAll<HTMLElement>('[data-todo-item-id]')];
}

function rowIds() {
  return rows().map((row) => row.dataset.todoItemId);
}

function requests() {
  if (!props.onEdit) {
    throw new Error('Missing edit callback');
  }

  return vi.mocked(props.onEdit).mock.calls.map(([request]) => request);
}

describe('TodoObject', () => {
  it('shows read-only task summaries below compact progress and exposes editing after expansion', async () => {
    const expand = vi.fn();
    const renderOutsideRows = vi.fn(() => <span data-fallback-pin />);
    render({
      overview: true,
      interactive: false,
      appearance: { uiScale: 1.8 },
      onRequestExpand: expand,
      renderOutsideRows,
    });

    const region = required('[data-todo-id]');
    expect(region.dataset.todoLayout).toBe('overview');
    expect(region.style.getPropertyValue('--todo-ui-scale')).toBe('1.8');
    expect(region.textContent).toContain('发布验收');
    expect(region.textContent).toContain('1/2 完成');
    const progress = required<HTMLProgressElement>('progress');
    expect(progress.value).toBe(1);
    expect(progress.previousElementSibling?.tagName).toBe('HEADER');
    expect(renderOutsideRows).toHaveBeenLastCalledWith([]);
    expect(region.querySelector('[data-fallback-pin]')).toBeTruthy();
    const preview = required('[aria-label="任务预览"]');
    expect([...preview.querySelectorAll('li')].map((row) => row.textContent)).toEqual([
      '✓整理需求',
      '核对读取上限',
    ]);
    expect(preview.querySelector('[aria-label="未完成"]')).toBeTruthy();
    expect(preview.querySelector('button, input')).toBeNull();
    expect(rows()).toHaveLength(0);

    await click('展开任务清单');
    expect(expand).toHaveBeenCalledOnce();
    render({ expanded: true });
    expect(region.dataset.todoLayout).toBe('full');
    expect(renderOutsideRows).toHaveBeenLastCalledWith(['plan', 'limits']);
    expect(rowIds()).toEqual(['plan', 'limits']);
    expect(input('完成任务：整理需求').checked).toBe(true);
    expect(requests()).toEqual([]);
  });

  it('keeps progress as the fallback for a card with no room for preview rows', () => {
    render({ overview: true, overviewRows: 0 });
    expect(required<HTMLProgressElement>('progress').value).toBe(1);
    expect(fixture.host.querySelector('[aria-label="任务预览"]')).toBeNull();
  });

  it('uses an explicit checked value and only exposes write controls when interactive', async () => {
    render({ interactive: false });
    expect(rowIds()).toEqual(['plan', 'limits']);
    expect(fixture.host.querySelectorAll('input')).toHaveLength(0);
    render({ interactive: true, readOnly: true });
    expect(fixture.host.querySelectorAll('input')).toHaveLength(0);
    render({ readOnly: false });
    await click(input('完成任务：核对读取上限'));
    expect(requests()).toEqual([
      {
        objectId: 'checklist',
        expectedRevision: 2,
        changes: [{ op: 'update', id: 'limits', changes: { checked: true } }],
      },
    ]);
    expect(input('完成任务：核对读取上限').checked).toBe(true);
    expect(fixture.host.textContent).toContain('2/2 完成');
  });

  it('keeps the add input focused through consecutive Enter edits with stable unique IDs', async () => {
    render();
    await click('添加任务');
    const field = input('新增任务');
    expect(document.activeElement).toBe(field);
    await enterText(field, '复查备注位置');
    await key(field, 'Enter', { isComposing: true });
    expect(requests()).toEqual([]);
    await key(field, 'Enter');

    expect(input('新增任务')).toBe(field);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    await enterText(field, '验证缩放显示');
    await key(field, 'Enter');
    const ids = rowIds();
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(0, 2)).toEqual(['plan', 'limits']);
    expect(requests().map(({ expectedRevision }) => expectedRevision)).toEqual([2, 3]);
  });

  it('combines multiline clipboard text with the input selection into one bounded edit', async () => {
    render();
    await click('添加任务');
    const field = input('新增任务');
    await enterText(field, '实机');
    field.setSelectionRange(2, 2);
    const event = await paste(field, '布局对照\r\n\r\n交互回归\n实机验收');
    expect(event.defaultPrevented).toBe(true);
    expect(requests()).toHaveLength(1);
    expect(
      requests()[0]?.changes.map((op) => (op.op === 'insert' ? op.item.text : undefined)),
    ).toEqual(['实机布局对照', '交互回归', '实机验收']);
  });

  it('uses the original source anchor and stable task IDs after keyboard reordering', async () => {
    const openSource = vi.fn();
    render({ onOpenSource: openSource, sourceLabel: () => '接口方案' });
    await key(button('调整顺序：整理需求'), 'ArrowDown');
    expect(rowIds()).toEqual(['limits', 'plan']);
    expect(requests()[0]?.changes).toEqual([{ op: 'move', id: 'plan', afterId: 'limits' }]);
    await click('打开任务来源：接口方案');
    expect(openSource).toHaveBeenCalledWith({ elementId: 'api', blockId: 'bounds' });
  });

  it('retains the original failed request and its inline draft until retry succeeds', async () => {
    const onEdit = vi.fn<(edit: TodoObjectEdit) => Promise<TodoObjectSnapshot | false>>();
    onEdit.mockResolvedValueOnce(false);
    onEdit.mockImplementationOnce(async (edit) => applyTodoObjectEdit(taskList(), edit));
    render({ onEdit });
    await click('编辑任务：核对读取上限');
    await enterText(input('任务文字'), '核对每页上限');
    await key(input('任务文字'), 'Enter');

    expect(required('[role="alert"]').textContent).toContain('清单草稿未保存');
    render({ overview: true });
    expect(input('任务文字').value).toBe('核对每页上限');
    await click('重试保存');
    expect(onEdit.mock.calls[1]).toEqual(onEdit.mock.calls[0]);
    expect(fixture.host.querySelector('[role="alert"]')).toBeNull();
    render({ overview: false });
    expect(rows()[1]?.textContent).toContain('核对每页上限');
  });

  it('uses the revision captured at edit start when a remote view changes the object', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('任务清单已有新版本。'));
    render({ onEdit });
    await click('编辑任务：核对读取上限');
    await enterText(input('任务文字'), '本机输入');
    render({
      value: {
        ...taskList(),
        revision: 3,
        items: [{ id: 'limits', text: '远端输入', checked: false }],
      },
    });

    await key(input('任务文字'), 'Enter');
    expect(requests()[0]?.expectedRevision).toBe(2);
    expect(input('任务文字').value).toBe('本机输入');
    expect(required('[role="alert"]').textContent).toContain('已有新版本');
  });

  it.each([
    ['#182232', 'dark'],
    ['#ededed', 'light'],
  ])('keeps exact annotation coordinates and stable row identity on %s', async (paper, scheme) => {
    const annotate = vi.fn();
    render({ appearance: { paper }, annotationActive: true, onAnnotateItem: annotate });
    expect(required('[data-todo-id]').dataset.todoScheme).toBe(scheme);
    const anchor = button('备注任务：核对读取上限');
    await act(async () => {
      anchor.dispatchEvent(
        new MouseEvent('click', {
          detail: 1,
          clientX: 132,
          clientY: 94,
          bubbles: true,
        }),
      );
    });
    expect(annotate).toHaveBeenCalledWith('limits', { x: 132, y: 94 });
    await click(anchor);
    expect(annotate).toHaveBeenLastCalledWith('limits', undefined);
    expect(requests()).toEqual([]);
  });

  it('uses the measured row for Canvas annotations and does not send a point for a hidden row', async () => {
    const annotate = vi.fn<NonNullable<TodoObjectProps['onAnnotateContent']>>();
    render({
      annotationActive: true,
      movable: true,
      onRequestExpand: vi.fn(),
      onAnnotateContent: annotate,
    });
    const row = required('[data-todo-item-id="limits"]');
    const measure = vi
      .spyOn(row, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 20, 200, 44));
    const text = button('备注任务：核对读取上限');
    expect(button('移动任务清单').disabled).toBe(true);
    expect(button('展开任务清单').disabled).toBe(true);

    await act(async () => {
      text.dispatchEvent(
        new MouseEvent('click', { detail: 1, clientX: 150, clientY: 53, bubbles: true }),
      );
    });
    const target = { kind: 'todo', itemId: 'limits' };
    expect(annotate).toHaveBeenNthCalledWith(1, { target, u: 0.25, v: 0.75 });

    await click(text);
    expect(annotate).toHaveBeenNthCalledWith(2, { target, u: 192 / 200, v: 40 / 44 });

    measure.mockReturnValue(new DOMRect());
    await click(text);
    expect(annotate).toHaveBeenCalledTimes(2);
    expect(requests()).toEqual([]);
  });

  it('keeps the open task editor and completion control when note mode pauses edits', async () => {
    render({ onAnnotateItem: vi.fn() });
    await click('编辑任务：核对读取上限');
    const editor = input('任务文字');
    const completion = input('完成任务：核对读取上限');
    await enterText(editor, '尚未提交的任务文字');

    render({ annotationActive: true });
    expect(input('任务文字')).toBe(editor);
    expect(editor.value).toBe('尚未提交的任务文字');
    expect(editor.readOnly).toBe(true);
    expect(input('完成任务：核对读取上限')).toBe(completion);
    expect(completion.disabled).toBe(true);
    await key(editor, 'Enter');
    await key(editor, 'Escape');
    expect(requests()).toEqual([]);
    expect(input('任务文字')).toBe(editor);

    render({ annotationActive: false });
    expect(editor.readOnly).toBe(false);
    await key(editor, 'Enter');
    expect(requests()).toHaveLength(1);
    expect(required('[data-todo-item-id="limits"]').textContent).toContain('尚未提交的任务文字');
  });

  it('keeps pins outside the scroller and aligned to visible row padding boxes', async () => {
    render({ renderItemAdornment: (id) => <span data-task-pin={id} /> });
    const body = required('.studio-object-todo__body');
    const scroller = required('[aria-label="任务列表"]');
    Object.defineProperty(body, 'clientHeight', { value: 85 });
    rows().forEach((row, index) => {
      Object.defineProperties(row, {
        offsetTop: { value: index * 43 },
        offsetLeft: { value: 0 },
        offsetWidth: { value: 430 },
        offsetHeight: { value: 42 },
      });
    });
    async function scroll(top: number) {
      scroller.scrollTop = top;
      await act(async () => scroller.dispatchEvent(new Event('scroll')));
    }

    await scroll(0);
    const pin = required('[data-todo-adornment-for="plan"]');
    expect(scroller.querySelector('[data-task-pin]')).toBeNull();
    expect(pin.style.top).toBe('0px');
    expect(pin.style.width).toBe('430px');
    expect(pin.style.height).toBe('42px');
    await scroll(12);
    expect(pin.style.top).toBe('-12px');
    expect(required('[data-todo-adornment-for="limits"]').style.top).toBe('31px');
    await scroll(43);
    expect(fixture.host.querySelector('[data-todo-adornment-for="plan"]')).toBeNull();
    expect(required('[data-todo-adornment-for="limits"]').style.top).toBe('0px');
    expect(requests()).toEqual([]);
  });

  it('reorders on an actual drag and drop event with stable item IDs', async () => {
    render();
    const grip = required<HTMLElement>('[data-todo-item-id="plan"] [draggable="true"]');
    const target = required<HTMLElement>('[data-todo-item-id="limits"]');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 200, 24));
    const transfer = { setData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' };
    async function drag(type: string, element: HTMLElement, y = 0) {
      const event = new MouseEvent(type, { clientY: y, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      await act(async () => element.dispatchEvent(event));
    }

    await drag('dragstart', grip);
    await drag('dragover', target, 67);
    expect(target.dataset.todoDrop).toBe('after');
    await drag('drop', target, 67);
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'plan');
    expect(rowIds()).toEqual(['limits', 'plan']);
    expect(requests()[0]?.changes).toEqual([{ op: 'move', id: 'plan', afterId: 'limits' }]);
  });

  it('renames and deletes through stable edits and cancels a subsequent draft with Escape', async () => {
    render();
    await click('编辑清单标题：发布验收');
    await enterText(input('任务清单标题'), '  新清单  ');
    await key(input('任务清单标题'), 'Enter');
    expect(required('[data-todo-id]').getAttribute('aria-label')).toBe('新清单');
    await click('删除任务：整理需求');
    expect(rowIds()).toEqual(['limits']);
    await click('编辑任务：核对读取上限');
    await enterText(input('任务文字'), '尚未提交');
    await key(input('任务文字'), 'Escape');
    expect(fixture.host.textContent).toContain('核对读取上限');
    expect(requests().map(({ changes }) => changes)).toEqual([
      [{ op: 'rename', title: '新清单' }],
      [{ op: 'delete', id: 'plan' }],
    ]);
  });

  it('commits an open row when focus leaves the selection but preserves it after permission loss', async () => {
    render({ editRequest: 1 });
    const field = input('任务文字');
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('整理需求');
    await enterText(field, '离开选区时保存');
    render({ interactive: false });
    await act(async () => field.blur());

    expect(requests()[0]?.changes).toEqual([
      { op: 'update', id: 'plan', changes: { text: '离开选区时保存' } },
    ]);

    render({ interactive: true, editRequest: 2 });
    const revokedField = input('任务文字');
    await enterText(revokedField, '只读时保留');
    render({ readOnly: true });
    await act(async () => revokedField.blur());

    expect(revokedField.value).toBe('只读时保留');
    expect(revokedField.readOnly).toBe(true);
    expect(requests()).toHaveLength(1);
  });

  it('shows the original add prompt and warns about the UTF-8 row limit before submission', async () => {
    render();
    await click('添加任务');
    const field = input('新增任务');
    expect(field.placeholder).toBe('输入任务');
    expect(field.maxLength).toBe(2_000);
    await enterText(field, '测'.repeat(667));

    expect(required('[role="alert"]').textContent).toBe('任务文字须在 2,000 UTF-8 字节以内。');
    expect(requests()).toEqual([]);

    await enterText(field, '测'.repeat(666));
    expect(fixture.host.querySelector('[role="alert"]')).toBeNull();
    await key(field, 'Escape');
    expect(requests()).toEqual([]);
  });

  it('uses the inverse zoom for a tiny checklist in overview even above 100 percent zoom', () => {
    render({ overview: true, appearance: { paper: '#EFEFEF', uiScale: 0.5 } });

    expect(
      required('[data-todo-layout="overview"]').style.getPropertyValue('--todo-ui-scale'),
    ).toBe('0.5');
  });
});

describe('applyTodoObjectEdit', () => {
  it('rejects stale and oversized batches while retaining the original snapshot', () => {
    const value = taskList();
    const stale = applyTodoObjectEdit(value, {
      objectId: value.id,
      expectedRevision: 1,
      changes: [{ op: 'delete', id: 'plan' }],
    });
    expect(stale).toBe(false);
    const invalid: TodoObjectEdit = {
      objectId: value.id,
      expectedRevision: value.revision,
      changes: [
        { op: 'delete', id: 'plan' },
        { op: 'insert', item: { id: 'later', text: '项'.repeat(667), checked: false } },
      ],
    };
    expect(() => applyTodoObjectEdit(value, invalid)).toThrow('2,000 UTF-8');
    expect(value).toEqual(taskList());
  });
});

describe('todoExtension', () => {
  type TodoView = NonNullable<typeof todoExtension.View>;
  type TodoViewProps = ComponentProps<TodoView>;

  function extensionView() {
    const View = todoExtension.View;
    if (!View) {
      throw new Error('Missing to-do extension view');
    }

    const value = taskList();
    const geometry = { x: 0, y: 0, width: 540, height: 420, rotation: 0 };
    const request = vi.fn();
    const onRetentionChange = vi.fn();
    const options = {
      id: value.id,
      geometry,
      object: { kind: 'todo', label: value.title, geometry } as const,
      zoom: 1,
      selected: true,
      interactive: true,
      readOnly: false,
      request,
      onRetentionChange,
    };

    function render(loaded = true, changes: Partial<TodoViewProps> = {}) {
      const payload = loaded ? { version: value.revision, value } : undefined;
      const Component = View;
      if (!Component) {
        throw new Error('Todo extension View is missing.');
      }

      fixture.render(<Component {...options} payload={payload} {...changes} />);
    }

    return { render, value, request, onRetentionChange };
  }

  it('opens a real source through the Canvas bridge and scrolls only the requested row once', async () => {
    const { render, value, request } = extensionView();
    const onOpenNativeSource = vi.fn();
    const nativeSourceLabel = vi.fn(() => '读取设计');
    const controls = { onOpenNativeSource, nativeSourceLabel };
    render(true, controls);
    await click('打开任务来源：读取设计');
    expect(onOpenNativeSource).toHaveBeenCalledExactlyOnceWith({
      elementId: 'api',
      blockId: 'bounds',
    });

    const row = required('[data-todo-item-id="limits"]');
    const scrollIntoView = vi.fn();
    Object.defineProperty(row, 'scrollIntoView', { value: scrollIntoView });
    const source = { elementId: value.id, itemId: 'limits' };
    render(true, { ...controls, nativeSourceRequest: { sequence: 1, source } });
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest' });

    render(true, { ...controls, readOnly: true, nativeSourceRequest: { sequence: 1, source } });
    render(true, {
      ...controls,
      nativeSourceRequest: { sequence: 2, source: { ...source, elementId: 'another' } },
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('requests a row annotation only in Canvas annotation mode', async () => {
    const { render, request } = extensionView();
    const onAnnotateContent = vi.fn();
    render(true, { onAnnotateContent, annotationActive: false });
    expect(fixture.host.querySelector('[aria-label^="备注任务："]')).toBeNull();
    render(true, { onAnnotateContent, annotationActive: true, readOnly: true });
    const row = required('[data-todo-item-id="limits"]');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 40, 200, 40));
    await click('备注任务：核对读取上限');
    expect(onAnnotateContent).toHaveBeenCalledExactlyOnceWith({
      target: { kind: 'todo', itemId: 'limits' },
      u: 0.96,
      v: 0.9,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps a lightweight unloaded view and delegates edits by payload revision', async () => {
    const { render, value, request } = extensionView();
    request.mockResolvedValue({
      ok: true,
      payload: {
        version: 3,
        value: {
          ...value,
          revision: 3,
          items: value.items.map((item) => ({ ...item, checked: true })),
        },
      },
    });
    render(false);
    expect(fixture.host.textContent).toContain('正文尚未加载');
    expect(rows()).toHaveLength(0);

    render();
    await click(input('完成任务：核对读取上限'));
    expect(request).toHaveBeenCalledWith({
      name: 'todo.edit',
      expectedVersion: 2,
      value: {
        objectId: 'checklist',
        expectedRevision: 2,
        changes: [{ op: 'update', id: 'limits', changes: { checked: true } }],
      },
    });
    expect(fixture.host.textContent).toContain('2/2 完成');
  });

  it('retains an unfocused rejected draft until the original edit is confirmed', async () => {
    const { render, value, request, onRetentionChange } = extensionView();
    request.mockResolvedValueOnce({ ok: false, message: '版本冲突' });
    request.mockResolvedValueOnce({
      ok: true,
      payload: {
        version: 3,
        value: {
          ...value,
          revision: 3,
          items: value.items.map((item) =>
            item.id === 'limits' ? { ...item, text: '失焦时保存' } : item,
          ),
        },
      },
    });
    render();
    expect(onRetentionChange).toHaveBeenLastCalledWith(false);
    await click('编辑任务：核对读取上限');
    await enterText(input('任务文字'), '失焦时保存');
    expect(onRetentionChange).toHaveBeenLastCalledWith(true);

    await act(async () => button('展开任务清单').focus());
    expect(request).toHaveBeenCalledOnce();
    expect(onRetentionChange).toHaveBeenLastCalledWith(true);
    expect(input('任务文字').value).toBe('失焦时保存');
    expect(required('[role="alert"]').textContent).toContain('版本冲突');
    await click('重试保存');
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
    expect(onRetentionChange).toHaveBeenLastCalledWith(false);
    expect(fixture.host.querySelector('[role="alert"]')).toBeNull();
  });

  it('retains the expanded panel and preserves a rejected draft through closing and reopening', async () => {
    const { render, request, onRetentionChange } = extensionView();
    request.mockResolvedValue({ ok: false, message: '保存失败' });
    render();
    await click('展开任务清单');
    let dialog = required<HTMLDialogElement>('dialog[open]');
    expect(onRetentionChange).toHaveBeenLastCalledWith(true);
    await click(button('关闭待办', dialog));
    expect(onRetentionChange).toHaveBeenLastCalledWith(false);

    await click('展开任务清单');
    dialog = required<HTMLDialogElement>('dialog[open]');
    await click(button('编辑任务：核对读取上限', dialog));
    await enterText(input('任务文字'), '窗口关闭前的草稿');
    await key(input('任务文字'), 'Enter');
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
    await click(button('关闭待办', dialog));
    expect(dialog.open).toBe(false);
    expect(onRetentionChange).toHaveBeenLastCalledWith(true);
    await click('展开任务清单');
    expect(dialog.open).toBe(true);
    expect(input('任务文字').value).toBe('窗口关闭前的草稿');
    expect(request).toHaveBeenCalledOnce();

    fixture.render(null);
    expect(onRetentionChange).toHaveBeenLastCalledWith(false);
  });
});
