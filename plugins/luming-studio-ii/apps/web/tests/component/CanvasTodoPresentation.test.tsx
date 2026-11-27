import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Canvas,
  type CanvasObjectPayload,
  type CanvasProps,
} from '../../src/ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../src/ui/domain/objects/index.js';
import { createControlFixture } from '../support/render-control.js';

const id = 'tasks';
const title = '发布清单';
const task = '检查白板观看与演示';
const scene: CanvasProps['scene'] = {
  boardId: 'todo-presentation',
  revision: 1,
  objects: [
    {
      id,
      kind: 'todo',
      label: title,
      version: 1,
      geometry: { x: 20, y: 20, width: 320, height: 220, rotation: 0 },
    },
  ],
};
const payloadById = new Map<string, CanvasObjectPayload>([
  [
    id,
    {
      version: 1,
      value: { id, title, revision: 1, items: [{ id: 'check', text: task, checked: true }] },
    },
  ],
]);

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

describe('Canvas Todo presentation', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 900, 550),
    );
  });

  afterEach(() => {
    fixture.dispose();
    vi.restoreAllMocks();
  });

  function render(props: Partial<CanvasProps> = {}) {
    fixture.render(
      <Canvas
        viewId="todo-presentation"
        label="白板画布"
        scene={scene}
        selection={[id]}
        tool="select"
        canEdit
        initialViewport={{ x: 0, y: 0, zoom: 1 }}
        objectExtensions={studioObjectExtensions}
        payloadById={payloadById}
        onSelectionChange={vi.fn()}
        onEditIntent={vi.fn()}
        {...props}
      />,
    );
  }

  function expand() {
    const button = fixture.host.querySelector<HTMLButtonElement>('[aria-label="展开任务清单"]');
    if (!button) {
      throw new Error('Expected the Todo object to expose its expand button.');
    }

    act(() => {
      button.click();
    });
  }

  it('opens the fitted viewer and keeps the same task list read-only without body permission', () => {
    const onOpenPresentation = vi.fn<(ids: readonly string[]) => void>();
    const onObjectIntent = vi.fn<NonNullable<CanvasProps['onObjectIntent']>>();
    render({ onOpenPresentation, onObjectIntent });
    const original = fixture.host.querySelector('[data-todo-id]');
    expand();
    expect(onOpenPresentation).toHaveBeenCalledExactlyOnceWith([id]);
    expect(fixture.host.querySelector('dialog')).toBeNull();

    render({
      canEdit: false,
      onOpenPresentation,
      onObjectIntent,
      presentation: { objectIds: [id], expandedObjectId: id },
    });
    const reading = fixture.host.querySelector('[data-todo-expanded]');
    expect(reading).toBe(original);
    expect(fixture.host.querySelector<HTMLElement>('[data-canvas-object]')?.style.width).toBe(
      '320px',
    );
    expect(reading?.querySelector('[aria-label="任务列表"]')?.textContent).toContain(task);
    expect(reading?.textContent).toContain('1/1 完成');
    expect(reading?.querySelector('[aria-label="展开任务清单"]')).toBeNull();
    expect(reading?.querySelector('[aria-label^="完成任务："]')).toBeNull();
    expect(fixture.host.querySelector('dialog')).toBeNull();
    expect(onObjectIntent).not.toHaveBeenCalled();

    render({ onOpenPresentation, onObjectIntent });
    expect(fixture.host.querySelector('[data-todo-expanded]')).toBeNull();
    expect(fixture.host.querySelector('[data-todo-id]')).toBe(original);
  });

  it('sends the real row edit when the expanded task list has content permission', async () => {
    const result = { id, title, revision: 2, items: [{ id: 'check', text: task, checked: false }] };
    const onObjectIntent = vi.fn<NonNullable<CanvasProps['onObjectIntent']>>().mockResolvedValue({
      ok: true,
      payload: { version: result.revision, value: result },
    });
    render({
      canEdit: false,
      canEditExpandedObject: true,
      onOpenPresentation: vi.fn(),
      onObjectIntent,
      presentation: { objectIds: [id], expandedObjectId: id },
    });
    const control = fixture.host.querySelector<HTMLInputElement>('[aria-label^="完成任务："]');
    if (!control) {
      throw new Error('Expected an editable checkbox in the expanded task list.');
    }

    await act(async () => control.click());

    expect(onObjectIntent).toHaveBeenCalledExactlyOnceWith({
      name: 'todo.edit',
      objectId: id,
      kind: 'todo',
      expectedVersion: 1,
      value: {
        objectId: id,
        expectedRevision: 1,
        changes: [{ op: 'update', id: 'check', changes: { checked: false } }],
      },
    });
    expect(control.checked).toBe(false);
    expect(fixture.host.querySelector('dialog')).toBeNull();
  });

  it('keeps an expanded dialog available when no shared viewer is configured', () => {
    render();
    expand();
    const dialog = fixture.host.querySelector('dialog[open]');
    expect(dialog?.querySelector('[aria-label="任务列表"]')?.textContent).toContain(task);
    expect(dialog?.querySelector('[aria-label="关闭待办"]')).not.toBeNull();
  });
});
