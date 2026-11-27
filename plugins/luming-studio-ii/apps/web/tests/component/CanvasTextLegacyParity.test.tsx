import { expect, test, vi } from 'vitest';
import { Canvas, type CanvasScene } from '../../src/ui/domain/canvas/index.js';
import {
  connectorExtension,
  sectionExtension,
  shapeExtension,
} from '../../src/ui/domain/objects/text/index.js';
import { createControlFixture } from '../support/render-control.js';

const scene: CanvasScene = {
  boardId: 'caption-parity',
  revision: 3,
  objects: [
    {
      id: 'shape',
      kind: 'shape',
      label: '形状标题',
      geometry: { x: 40, y: 40, width: 200, height: 80, rotation: 0 },
      version: 1,
    },
    {
      id: 'section',
      kind: 'section',
      label: '分区标题',
      geometry: { x: 40, y: 160, width: 200, height: 90, rotation: 0 },
      version: 1,
    },
    {
      id: 'connector',
      kind: 'connector',
      label: '连线标题',
      geometry: { x: 40, y: 300, width: 200, height: 30, rotation: 0 },
      version: 1,
      connection: { start: { point: { x: 40, y: 300 } }, end: { point: { x: 240, y: 330 } } },
    },
  ],
};

test('renders the persisted shape, section, and connector caption once through the Canvas extensions', () => {
  const fixture = createControlFixture();
  const bounds = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 720, 500));

  try {
    const payloadById = new Map(
      scene.objects.map(({ id, label }) => [
        id,
        { version: 3, value: { text: label, bold: true, italic: true } },
      ]),
    );
    fixture.render(
      <Canvas
        viewId="caption-parity-view"
        label="复开白板"
        scene={scene}
        selection={[]}
        tool="select"
        canEdit={false}
        initialViewport={{ x: 0, y: 0, zoom: 1 }}
        objectExtensions={[shapeExtension, sectionExtension, connectorExtension]}
        payloadById={payloadById}
        onSelectionChange={vi.fn()}
        onEditIntent={vi.fn()}
      />,
    );

    for (const { id, label } of scene.objects) {
      const object = fixture.host.querySelector(`[data-canvas-object="${id}"]`);
      expect(object?.textContent).toBe(label);
      const text = object?.querySelector<HTMLElement>('.studio-ui-text-object');
      expect(text?.style.fontWeight).toBe('700');
      expect(text?.style.fontStyle).toBe('italic');
    }
  } finally {
    fixture.dispose();
    bounds.mockRestore();
  }
});
