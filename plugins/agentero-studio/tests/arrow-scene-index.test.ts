import { expect, it, vi } from 'vitest';
import type { BoardElement } from '../src/contracts/studio.js';
import {
  arrowGeometry,
  createArrowElementIndex,
} from '../src/core/products/whiteboard-geometry.js';

const shape = (id: string, x: number, y = 20): BoardElement => ({
  id,
  type: 'shape',
  x,
  y,
  w: 80,
  h: 60,
  version: 1,
});

const arrow = (extra: Partial<BoardElement> = {}): BoardElement => ({
  id: 'edge',
  type: 'arrow',
  x: 12,
  y: 18,
  w: 220,
  h: 105,
  version: 1,
  from: 'left',
  to: 'right',
  fromSide: 'right',
  toSide: 'left',
  label: 'Label',
  ...extra,
});

const routingCases: [string, Partial<BoardElement>][] = [
  ['bound endpoints', {}],
  ['coordinate endpoints', { from: [10, 30], to: [100, 80] }],
  ['missing bound endpoint', { to: 'removed' }],
  ['omitted endpoints', { from: undefined, to: undefined }],
  [
    'legacy explicit bends and label offset',
    { bends: [150, 66, 178, 106], labelOffset: { x: 7, y: -3 } },
  ],
  ['relative bends', { bends: ['h', 70, 52, 160] }],
];

it.each(routingCases)('preserves the geometry for %s', (_description, extra) => {
  const elements = [{ ...shape('left', 0), rotation: 20 }, shape('right', 310, 180)];
  const edge = arrow(extra);

  expect(arrowGeometry(edge, createArrowElementIndex(elements))).toEqual(
    arrowGeometry(edge, elements),
  );
});

it('uses the first element for a repeated ID, matching the array lookup', () => {
  const left = shape('left', 0);
  const elements = [left, shape('left', 140, 200), shape('right', 310)];
  const index = createArrowElementIndex(elements);
  const edge = arrow();
  const route = arrowGeometry(edge, index);

  expect(index.get('left')).toBe(left);
  expect(route.points[0]).toEqual({ x: 80, y: 50 });
  expect(route).toEqual(arrowGeometry(edge, elements));
});

it('uses displaced endpoints when indexed from a new preview scene', () => {
  const elements = [shape('left', 0), shape('right', 310)];
  const preview = [elements[0]!, { ...elements[1]!, x: 490, y: 140, rotation: 25 }];
  const edge = arrow();
  const current = arrowGeometry(edge, createArrowElementIndex(elements));
  const moving = arrowGeometry(edge, createArrowElementIndex(preview));

  expect(moving).toEqual(arrowGeometry(edge, preview));
  expect(moving.points.at(-1)).not.toEqual(current.points.at(-1));
});

it('reads scene IDs once, then uses two indexed lookups per bound arrow', () => {
  const shapeCount = 2048;
  const arrowCount = 128;
  const shapes = Array.from({ length: shapeCount }, (_, index) =>
    shape(`box-${index}`, index * 120),
  );
  const edges = Array.from({ length: arrowCount }, (_, index) =>
    arrow({
      id: `edge-${index}`,
      from: `box-${shapeCount - 2}`,
      to: `box-${shapeCount - 1}`,
    }),
  );
  let elementIdReads = 0;
  const scene = [...shapes, ...edges].map((element) => {
    const id = element.id;

    return {
      ...element,
      get id() {
        elementIdReads++;
        return id;
      },
    };
  });
  const arrayRoutes = edges.map((edge) => arrowGeometry(edge, scene));

  expect(elementIdReads).toBe(arrowCount * (2 * shapeCount - 1));

  elementIdReads = 0;
  const index = createArrowElementIndex(scene);
  const lookup = vi.spyOn(index, 'get');
  const indexedRoutes = edges.map((edge) => arrowGeometry(edge, index));

  expect(indexedRoutes).toEqual(arrayRoutes);
  expect(elementIdReads).toBe(scene.length);
  expect(lookup).toHaveBeenCalledTimes(2 * arrowCount);
});
