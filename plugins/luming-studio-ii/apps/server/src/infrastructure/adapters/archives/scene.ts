import { payloadFor, type ArchiveSceneOrigin, type ArchiveScenePayload } from './scene-content.js';
import { appearance, geometryDetail, readGeometry, type SceneGeometry } from './scene-geometry.js';
import {
  ArchiveObjectError,
  booleanValue,
  optionalString,
  record,
  requiredId,
  stringValue,
  type ArchiveData,
  type SourceResolver,
} from './scene-values.js';

export { ArchiveObjectError } from './scene-values.js';

export interface ArchiveSceneObject extends SceneGeometry {
  readonly objectId: string;
  readonly kind: string;
  readonly label: string;
  readonly locked: boolean;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly appearance?: ArchiveData;
  readonly detail?: ArchiveData;
  readonly payload?: ArchiveScenePayload;
}

const kinds = new Set([
  'shape',
  'text',
  'image',
  'html',
  'document',
  'table',
  'link',
  'note',
  'sticker',
  'diagram',
  'chart',
  'todo',
]);
const renamedKinds = new Map([
  ['container', 'section'],
  ['stroke', 'ink'],
  ['arrow', 'connector'],
]);
const objectIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;

function sceneKind(element: ArchiveData): string {
  const type = stringValue(element.type, 'object type');
  if (type === 'image' && element.video) {
    return 'video';
  }

  const renamed = renamedKinds.get(type);
  if (renamed) {
    return renamed;
  }
  if (!kinds.has(type)) {
    throw new ArchiveObjectError('Unsupported archived object type.');
  }

  return type;
}

export function prepareArchiveObject(
  objectId: string,
  element: ArchiveData,
  ids: ReadonlySet<string>,
  resolveSource: SourceResolver,
  origin: ArchiveSceneOrigin | undefined,
): ArchiveSceneObject {
  const kind = sceneKind(element);
  const text = kind === 'connector' ? element.label : element.text;
  const label = optionalString(text, 'object label') ?? '';
  const geometry = readGeometry(element);

  return {
    objectId,
    kind,
    label,
    ...geometry,
    locked: booleanValue(element.locked, 'object lock'),
    parentId: optionalString(element.parentId, 'parent identifier'),
    groupId: optionalString(element.groupId, 'group identifier'),
    appearance: appearance(element),
    detail: geometryDetail(element, geometry, ids),
    payload: payloadFor(element, { geometry, kind, label, resolveSource, origin }),
  };
}

export function indexArchiveObjects(values: readonly unknown[]) {
  const ids = new Set<string>();
  const objectsById = values.map((value) => {
    const element = record(value, 'object');
    const id = requiredId(element.id, 'object identifier');
    if (!objectIdentifier.test(id)) {
      throw new ArchiveObjectError('Invalid archived object identifier.');
    }
    if (ids.has(id)) {
      throw new ArchiveObjectError('Duplicate archived object identifier.');
    }

    ids.add(id);
    return { id, element };
  });

  return { ids, objectsById };
}
