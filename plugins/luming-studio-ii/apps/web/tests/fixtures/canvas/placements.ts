import type {
  CanvasObject,
  CanvasPlacement,
  CanvasShape,
} from '../../../src/ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../../src/ui/domain/objects/index.js';

const shapeNames: Readonly<Record<CanvasShape, string>> = {
  rounded: '圆角矩形',
  rect: '矩形',
  ellipse: '椭圆',
  diamond: '菱形',
  pill: '胶囊',
  hexagon: '六边形',
  parallelogram: '平行四边形',
  database: '数据库',
  queue: '队列',
  document: '文档形状',
  cloud: '云',
  person: '人物',
};

interface PlacementPreset {
  id: string;
  object: CanvasPlacement;
}

const shapes = Object.entries(shapeNames) as [CanvasShape, string][];
const shapePlacement = shapes.map(([shape, label]): PlacementPreset => ({
  id: 'shape:' + shape,
  object: { kind: 'shape', label, shape, width: 144, height: 100 },
}));

const objectPlacement = studioObjectExtensions.flatMap(({ kind, placement }) =>
  kind !== 'shape' && placement ? [{ id: kind, object: placement }] : [],
);

export const placementPresets = [...shapePlacement, ...objectPlacement];

const galleryRows = [
  ['text', 'note', 'sticker', 'link', 'image', 'video'],
  ['diagram', 'chart'],
  shapePlacement.map(({ id }) => id),
];

export const galleryObjects: readonly CanvasObject[] = galleryRows.flatMap((row, index) => {
  let x = 42;

  return row.flatMap((id) => {
    const preset = placementPresets.find((item) => item.id === id);
    if (!preset) {
      return [];
    }

    const { width, height, ...object } = preset.object;
    const geometry = { x, y: 710 + index * 265, width, height, rotation: 0 };
    x += width + 28;

    return [{ ...object, id: 'gallery-' + id, version: 1, geometry }];
  });
});
