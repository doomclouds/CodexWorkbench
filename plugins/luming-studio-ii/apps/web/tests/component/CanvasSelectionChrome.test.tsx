import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Canvas, type CanvasProps, type CanvasScene } from '../../src/ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../src/ui/domain/objects/index.js';
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
  let controlBounds: DOMRect;
  let titleBounds: DOMRect;
  let handleBounds: DOMRect;
  let dockBounds: DOMRect;
  let canvasBounds: DOMRect;
  let toolbarWidth: number;

  beforeEach(() => {
    fixture = createControlFixture();
    controlBounds = new DOMRect();
    titleBounds = new DOMRect();
    handleBounds = new DOMRect();
    dockBounds = new DOMRect();
    canvasBounds = new DOMRect(0, 0, 640, 480);
    toolbarWidth = 100;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds(
      this: HTMLElement,
    ) {
      if (this.hasAttribute('data-canvas-selection-actions')) {
        return new DOMRect(0, 0, toolbarWidth, 42);
      }
      if (this.hasAttribute('data-canvas-root')) {
        return canvasBounds;
      }
      if (this.hasAttribute('data-canvas-toolbar-obstacle')) {
        return this.hasAttribute('data-test-dock') ? dockBounds : controlBounds;
      }
      if (this.hasAttribute('data-canvas-section-title')) {
        return titleBounds;
      }
      if (
        this.hasAttribute('data-canvas-external-title') ||
        this.getAttribute('aria-label') === '移动 HTML 图解'
      ) {
        return titleBounds;
      }

      return this.hasAttribute('data-canvas-handle') ? handleBounds : new DOMRect();
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
      <div data-canvas-toolbar-scope="">
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
        />
        <div data-canvas-toolbar-obstacle="">
          <button type="button">缩放</button>
        </div>
        <div data-canvas-toolbar-obstacle="" data-test-dock="" />
      </div>,
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

  it('shifts the action toolbar sideways to keep the top-right viewport controls clear', () => {
    controlBounds = new DOMRect(490, 20, 136, 56);
    renderCanvas({
      initialViewport: { x: 415, y: 0, zoom: 1 },
      selectionActions: <button>观看选区</button>,
    });
    const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');

    expect(toolbar?.style.visibility).toBe('visible');
    expect(toolbar?.style.left).toBe('382px');
    expect(toolbar?.style.top).toBe('70px');
  });

  it('keeps the external HTML grip clear when its caption text is below the readable scale', () => {
    titleBounds = new DOMRect(80, 88, 24, 24);
    renderCanvas({
      scene: {
        ...scene,
        objects: [
          {
            id: 'card',
            kind: 'html',
            label: '缩略图解',
            geometry: { x: 0, y: 0, width: 360, height: 280, rotation: 0 },
            version: 1,
          },
        ],
      },
      initialViewport: { x: 80, y: 120, zoom: 0.05 },
      objectExtensions: studioObjectExtensions,
      payloadById: new Map([
        [
          'card',
          { version: 1, value: { id: 'card', version: 1, html: '<input type="checkbox">' } },
        ],
      ]),
      selectionActions: <button>观看选区</button>,
    });
    const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');
    const grip = fixture.host.querySelector('[aria-label="移动 HTML 图解"]');
    expect(grip).not.toBeNull();
    expect(grip?.parentElement?.textContent).toBe('');
    expect(toolbar?.style.top).toBe('38px');
  });

  it('uses the space above the selected HTML grip in a short viewport', () => {
    canvasBounds = new DOMRect(0, 0, 420, 290);
    controlBounds = new DOMRect(274, 12, 132, 38);
    dockBounds = new DOMRect(65, 229, 289, 45);
    handleBounds = new DOMRect(126, 80, 168, 132);
    titleBounds = new DOMRect(137, 59, 118, 22);
    toolbarWidth = 298;
    renderCanvas({
      scene: {
        ...scene,
        objects: [
          {
            id: 'card',
            kind: 'html',
            label: '缩略图解',
            geometry: { x: 137, y: 91, width: 144, height: 108, rotation: 0 },
            version: 1,
          },
        ],
      },
      objectExtensions: studioObjectExtensions,
      payloadById: new Map([
        ['card', { version: 1, value: { id: 'card', version: 1, html: '<p>图解</p>' } }],
      ]),
      selectionActions: <button>更多操作</button>,
    });
    const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');
    expect(toolbar?.style.visibility).toBe('visible');
    expect(toolbar?.style.top).toBe('13px');
    expect(toolbar?.style.maxInlineSize).toBe('258px');
  });

  it('places a full toolbar above the selection without measuring text ranges in distant rows', () => {
    titleBounds = new DOMRect(100, 360, 90, 33);
    const ranges = vi.spyOn(document, 'createRange');
    try {
      renderCanvas({
        scene: {
          ...scene,
          objects: [
            ...scene.objects,
            {
              id: 'far-section',
              kind: 'section',
              label: '远处标题',
              geometry: { x: 100, y: 395, width: 90, height: 80, rotation: 0 },
              version: 1,
            },
          ],
        },
        selectionActions: <button>观看选区</button>,
      });
      const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');
      expect(toolbar?.style.top).toBe('70px');
      expect(ranges).not.toHaveBeenCalled();
    } finally {
      ranges.mockRestore();
    }
  });

  it('keeps neighboring section titles and the selected object handles clear', () => {
    handleBounds = new DOMRect(80, 100, 10, 26);
    titleBounds = new DOMRect(100, 42, 90, 33);
    renderCanvas({
      scene: {
        ...scene,
        objects: [
          ...scene.objects,
          {
            id: 'nearby-section',
            kind: 'section',
            label: '相邻标题',
            geometry: { x: 100, y: 78, width: 90, height: 100, rotation: 0 },
            version: 1,
          },
        ],
      },
      selectionActions: <button>观看选区</button>,
    });
    const toolbar = fixture.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');

    expect(toolbar?.style.visibility).toBe('visible');
    expect(toolbar?.style.left).toBe('198px');
    expect(toolbar?.style.top).toBe('50px');
  });
});
