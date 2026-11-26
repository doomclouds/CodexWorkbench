import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Canvas, type CanvasProps, type CanvasScene } from '../../src/ui/domain/canvas/index.js';
import { createControlFixture } from '../support/render-control.js';

const scene: CanvasScene = {
  boardId: 'selection-chrome',
  revision: 1,
  objects: [
    {
      id: 'card',
      kind: 'shape',
      label: '交互与校验',
      geometry: { x: 80, y: 120, width: 60, height: 40, rotation: 0 },
      version: 1,
    },
  ],
};

describe('Canvas selection chrome', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds(
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-canvas-selection-actions')
        ? new DOMRect(0, 0, 100, 42)
        : new DOMRect(0, 0, 640, 480);
    });
  });

  afterEach(() => {
    fixture.dispose();
    vi.restoreAllMocks();
  });

  function renderCanvas(props: Partial<CanvasProps> = {}) {
    const onSelectionChange = vi.fn();
    const onEditIntent = vi.fn();
    const onViewportChange = vi.fn();
    fixture.render(
      <Canvas
        viewId="selection-chrome"
        label="选择状态画布"
        scene={scene}
        selection={['card']}
        tool="select"
        canEdit
        onSelectionChange={onSelectionChange}
        onEditIntent={onEditIntent}
        onViewportChange={onViewportChange}
        {...props}
      />,
    );
    onViewportChange.mockClear();

    return { onSelectionChange, onEditIntent, onViewportChange };
  }

  it('shows four inert corner indicators for an editable move-only card', () => {
    renderCanvas({
      objectExtensions: [
        {
          kind: 'shape',
          capabilities: {
            move: true,
            resize: false,
            rotate: false,
            connect: false,
            content: 'passive',
          },
        },
      ],
    });

    const indicators = fixture.host.querySelectorAll('[data-canvas-static-corner]');
    expect(indicators).toHaveLength(4);
    expect(
      Array.from(indicators).every((node) => node.getAttribute('aria-hidden') === 'true'),
    ).toBe(true);
    expect(fixture.host.querySelector('[data-canvas-handle]')).toBeNull();
    expect(fixture.host.querySelector('[data-canvas-locked-corner]')).toBeNull();
  });

  it('keeps interactive resize controls and the locked corner treatment distinct', () => {
    renderCanvas();
    expect(fixture.host.querySelector('button[data-canvas-handle="nw"]')).not.toBeNull();
    expect(fixture.host.querySelector('[data-canvas-static-corner]')).toBeNull();

    renderCanvas({ canEdit: false });
    expect(fixture.host.querySelectorAll('[data-canvas-locked-corner]')).toHaveLength(4);
    expect(fixture.host.querySelector('[data-canvas-handle]')).toBeNull();
  });

  it('keeps selection actions in front of the canvas and exposes their own focus and pointer events', () => {
    const open = vi.fn();
    const { onSelectionChange, onEditIntent, onViewportChange } = renderCanvas({
      selectionActions: <button onClick={open}>观看选区</button>,
    });
    const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');
    const action = toolbar?.querySelector('button');
    if (!toolbar || !action) {
      throw new Error('Expected selection actions above the card.');
    }

    expect(toolbar.style.left).toBe('60px');
    expect(toolbar.style.top).toBe('70px');

    act(() => {
      action.focus();
      action.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true }),
      );
      action.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 }),
      );
      action.click();
    });

    expect(document.activeElement).toBe(action);
    expect(open).toHaveBeenCalledOnce();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onEditIntent).not.toHaveBeenCalled();
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it('moves the action toolbar below a top-edge selection and clamps it inside the viewport', () => {
    renderCanvas({
      initialViewport: { x: -80, y: -110, zoom: 1 },
      selectionActions: <button>观看选区</button>,
    });
    const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');

    expect(toolbar?.style.left).toBe('12px');
    expect(toolbar?.style.top).toBe('58px');
  });
});
