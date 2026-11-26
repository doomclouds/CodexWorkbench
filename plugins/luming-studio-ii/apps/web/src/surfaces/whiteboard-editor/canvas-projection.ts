import type {
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';
import type {
  CanvasInk,
  CanvasObject,
  CanvasObjectKind,
  CanvasObjectPayload,
  CanvasScene,
  CanvasShape,
} from '../../ui/domain/canvas/index.js';

type ContentKind = Exclude<CanvasObjectKind, 'shape' | 'section' | 'ink' | 'connector'>;

interface SceneProjection {
  readonly scene: CanvasScene;
  readonly objectsById: ReadonlyMap<string, CanvasObject>;
}

const shapes = new Set<string>([
  'rounded',
  'rect',
  'ellipse',
  'diamond',
  'pill',
  'hexagon',
  'parallelogram',
  'database',
  'queue',
  'document',
  'cloud',
  'person',
]);

const contentKinds = new Set<string>([
  'native',
  'html',
  'document',
  'todo',
  'table',
  'image',
  'video',
  'link',
  'diagram',
  'chart',
  'text',
  'note',
  'sticker',
]);

const legacyShapeColors = new Map([
  ['paper', 'var(--studio-ui-canvas, #f5f5f5)'],
  ['paper-2', 'var(--studio-ui-canvas-paper-secondary, #ececec)'],
  ['ink', 'var(--studio-ui-canvas-ink, #2d3142)'],
  ['muted', 'var(--studio-ui-canvas-muted, #4f5d75)'],
  ['accent', 'var(--studio-ui-accent, #eb6c36)'],
  ['link', 'var(--studio-ui-canvas-link, #2e5aa8)'],
  ['soft', 'var(--studio-ui-canvas-soft, #68738a)'],
  ['rule', 'var(--studio-ui-canvas-rule, #bfc0c0)'],
  ['ink-strong', '#111111'],
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['transparent', '#00000000'],
  ['yellow', '#f6e39c'],
  ['peach', '#f4c3a4'],
  ['pink', '#edbdd5'],
  ['green', '#bcd6be'],
  ['blue', '#b8d2ed'],
  ['purple', '#d0c0e5'],
  ['terracotta', '#b64e2a'],
  ['none', 'none'],
]);
const legacyColorLiteral = /^(?:#[\da-f]{3,8}|rgba?\([\d., /]+\))$/iu;
const shapePaperFallback = 'var(--studio-ui-canvas-paper-secondary, #ececec)';

function shapeColor(value?: string, fallback?: string): string | undefined {
  const color = value?.trim();
  if (!color) {
    return undefined;
  }

  return (
    legacyShapeColors.get(color.toLowerCase()) ??
    (legacyColorLiteral.test(color) ? color : fallback)
  );
}

function isShape(value: string): value is CanvasShape {
  return shapes.has(value);
}

function isContentKind(value: string): value is ContentKind {
  return contentKinds.has(value) || value.includes(':');
}

function safeVersion(value: bigint): number | undefined {
  const version = Number(value);

  return Number.isSafeInteger(version) && version >= 0 ? version : undefined;
}

function projectObject(object: WhiteboardObject, version: number): CanvasObject {
  const { id, kind, label, geometry, locked, parentId, groupId, appearance, detail } = object;
  const common = { id, label, geometry, version, locked, parentId, groupId, ...appearance };

  switch (detail?.kind) {
    case 'shape':
      return {
        ...common,
        kind: 'shape',
        shape: isShape(detail.outline) ? detail.outline : undefined,
        fill: shapeColor(appearance?.fill, shapePaperFallback),
        stroke: shapeColor(appearance?.stroke, 'transparent'),
      };
    case 'section':
      return { ...common, kind: 'section', transparent: detail.transparent };
    case 'ink':
      return { ...common, kind: 'ink', ink: { width: detail.width, points: [] } };
    case 'connector':
      return { ...common, kind: 'connector', connection: detail.connection };
    case undefined:
      if (kind === 'shape') {
        return {
          ...common,
          kind: 'shape',
          shape: 'rounded',
          fill: shapeColor(appearance?.fill, shapePaperFallback),
          stroke: shapeColor(appearance?.stroke, 'transparent'),
        };
      }

      return { ...common, kind: isContentKind(kind) ? kind : 'native' };
  }
}

export function projectScene(board: WhiteboardScene): SceneProjection | undefined {
  const revision = safeVersion(board.revision);
  if (revision === undefined) {
    return undefined;
  }

  const objectsById = new Map<string, CanvasObject>();
  for (const object of board.objects) {
    const version = safeVersion(object.geometryVersion);
    if (version === undefined) {
      return undefined;
    }

    objectsById.set(object.id, projectObject(object, version));
  }

  const objects = [...objectsById.values()];

  return { scene: { boardId: board.boardId, revision, objects }, objectsById };
}

function convertTodoSource(item: unknown): unknown {
  if (typeof item !== 'object' || item === null || !('sourceRef' in item)) {
    return item;
  }

  const source = item.sourceRef;
  if (typeof source !== 'object' || source === null || !('version' in source)) {
    return item;
  }
  if (typeof source.version !== 'bigint') {
    return item;
  }

  return { ...item, sourceRef: { ...source, version: safeVersion(source.version) } };
}

function projectTodoValue(value: Readonly<Record<string, unknown>>, id: string, version: number) {
  return {
    ...value,
    id,
    revision: version,
    items: Array.isArray(value.items) ? value.items.map(convertTodoSource) : [],
  };
}

export function projectEditablePayload(
  payload: WhiteboardPayload,
  object?: WhiteboardObject,
): CanvasObjectPayload | undefined {
  const { id, version: sourceVersion, body } = payload;
  const version = safeVersion(sourceVersion);
  if (version === undefined || body.kind === 'ink') {
    return undefined;
  }

  const value = projectPayloadValue(body, id, version, object?.geometry.width);

  return value && { version, value };
}

function projectPayloadValue(
  body: Exclude<WhiteboardPayload['body'], { kind: 'ink' }>,
  id: string,
  version: number,
  width?: number,
): Readonly<Record<string, unknown>> | undefined {
  const { kind, value } = body;

  switch (kind) {
    case 'document':
      return { ...value, version };
    case 'embed': {
      const sourceRevision = value.sourceRevision;

      return {
        ...value,
        id,
        version,
        sourceRevision:
          typeof sourceRevision === 'bigint' ? safeVersion(sourceRevision) : sourceRevision,
      };
    }
    case 'todo':
      return projectTodoValue(value, id, version);
    case 'table':
      return width === undefined ? undefined : { ...value, id, version, width };
    case 'extension':
    case 'image':
    case 'link':
    case 'sticker':
    case 'text':
    case 'video':
      return value;
  }
}

function sceneWithInk(scene: CanvasScene, inkById: ReadonlyMap<string, CanvasInk>): CanvasScene {
  if (inkById.size === 0) {
    return scene;
  }

  const objects = scene.objects.map((object) => {
    const ink = inkById.get(object.id);

    return object.kind === 'ink' && ink ? { ...object, ink } : object;
  });

  return { ...scene, objects };
}

export function projectPayloads(
  projection: SceneProjection,
  payloads: ReadonlyMap<string, WhiteboardPayload>,
) {
  const payloadById = new Map<string, CanvasObjectPayload>();
  const inkById = new Map<string, CanvasInk>();
  let unsafePayloadVersion = false;

  for (const { id, version: sourceVersion, body } of payloads.values()) {
    const object = projection.objectsById.get(id);
    if (!object) {
      continue;
    }

    const version = safeVersion(sourceVersion);
    if (version === undefined) {
      unsafePayloadVersion = true;
      continue;
    }

    if (body.kind === 'ink') {
      if (object.kind === 'ink') {
        inkById.set(id, { ...object.ink, points: body.points });
      }

      continue;
    }

    const value = projectPayloadValue(body, id, version, object.geometry.width);
    if (value) {
      payloadById.set(id, { version, value });
    }
  }

  return { scene: sceneWithInk(projection.scene, inkById), payloadById, unsafePayloadVersion };
}
