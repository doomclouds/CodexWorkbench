import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas, type CanvasScene } from '../../src/ui/domain/canvas/index.js';
import { createControlFixture } from '../support/render-control.js';

const connection = {
  start: { point: { x: 80, y: 80 } },
  end: { point: { x: 320, y: 120 } },
} as const;

const scene: CanvasScene = {
  boardId: 'connector-legacy',
  revision: 1,
  objects: [
    {
      id: 'default-caption',
      kind: 'connector',
      label: '连接线说明',
      geometry: { x: 80, y: 80, width: 240, height: 40, rotation: 0 },
      connection,
      version: 1,
      strokeWidth: 1,
      dashed: true,
    },
    {
      id: 'custom-caption',
      kind: 'connector',
      label: '',
      geometry: { x: 80, y: 200, width: 240, height: 40, rotation: 0 },
      connection: {
        start: { point: { x: 80, y: 200 } },
        end: { point: { x: 320, y: 240 } },
      },
      version: 1,
    },
  ],
};

describe('Canvas connector legacy presentation', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 720, 500),
    );
  });

  afterEach(() => {
    fixture.dispose();
    vi.restoreAllMocks();
  });

  async function renderCanvas(zoom: number) {
    fixture.render(
      <Canvas
        viewId="connector-legacy-view"
        label="连接线画布"
        scene={scene}
        selection={[]}
        tool="select"
        canEdit
        viewportRequest={{ requestId: String(zoom), viewport: { x: 0, y: 0, zoom } }}
        contentById={new Map([['custom-caption', '自定义说明']])}
        onSelectionChange={vi.fn()}
        onEditIntent={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }

  it('shows default and custom connector captions when the effective font reaches eight pixels', async () => {
    await renderCanvas(0.6);
    expect(fixture.host.querySelectorAll('.studio-ui-canvas-connector-label')).toHaveLength(0);

    await renderCanvas(8 / 13);
    const captions = [...fixture.host.querySelectorAll('.studio-ui-canvas-connector-label')];

    expect(captions.map((caption) => caption.textContent)).toEqual(['连接线说明', '自定义说明']);
  });

  it('protects the distant line while retaining the route, hit stroke, dash and head', async () => {
    const selector = '[data-canvas-object="default-caption"]';
    await renderCanvas(0.5);
    const original = fixture.host.querySelector(`${selector} path`);
    const route = original?.getAttribute('d');

    expect(fixture.host.querySelectorAll(`${selector} path`)).toHaveLength(1);
    expect(original?.getAttribute('stroke-width')).toBe('1');

    const zoom = 0.1;
    await renderCanvas(zoom);
    const hit = fixture.host.querySelector(`${selector} [data-canvas-geometry-hit]`);
    const painted = fixture.host.querySelector(`${selector} path[pointer-events="none"]`);
    const head = fixture.host.querySelector(`${selector} polyline`);

    expect(painted?.getAttribute('d')).toBe(route);
    expect(Number(painted?.getAttribute('stroke-width')) * zoom).toBeCloseTo(0.7);
    expect(painted?.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(hit?.getAttribute('stroke-width')).toBe('1');
    expect(hit?.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(head?.getAttribute('stroke-width')).toBe('1');
  });
});
