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
      };
    case 'section':
      return { ...common, kind: 'section', transparent: detail.transparent };
    case 'ink':
      return { ...common, kind: 'ink', ink: { width: detail.width, points: [] } };
    case 'connector':
      return { ...common, kind: 'connector', connection: detail.connection };
    case undefined:
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

function projectPayloadValue(
  body: Exclude<WhiteboardPayload['body'], { kind: 'ink' }>,
  object: CanvasObject,
  version: number,
): Readonly<Record<string, unknown>> {
  const { kind, value } = body;

  switch (kind) {
    case 'document':
      return { ...value, version };
    case 'embed': {
      const sourceRevision = value.sourceRevision;

      return {
        ...value,
        id: object.id,
        version,
        sourceRevision:
          typeof sourceRevision === 'bigint' ? safeVersion(sourceRevision) : sourceRevision,
      };
    }
    case 'todo':
      return {
        ...value,
        id: object.id,
        revision: version,
        items: Array.isArray(value.items) ? value.items.map(convertTodoSource) : [],
      };
    case 'table':
      return { ...value, id: object.id, version, width: object.geometry.width };
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

    payloadById.set(id, { version, value: projectPayloadValue(body, object, version) });
  }

  return { scene: sceneWithInk(projection.scene, inkById), payloadById, unsafePayloadVersion };
}
