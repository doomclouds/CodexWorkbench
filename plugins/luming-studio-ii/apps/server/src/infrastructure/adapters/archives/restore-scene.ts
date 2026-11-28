import type { ArchiveRestoration } from '../../platform/archives/index.js';
import type { ArchiveHistoryObject, ArchiveHistorySnapshot } from './history.js';
import type { ArchiveSceneOrigin } from './scene-content.js';
import { readGeometry } from './scene-geometry.js';
import {
  ArchiveObjectError,
  booleanValue,
  optionalNumber,
  optionalString,
  record,
  remapMarkup,
  requiredId,
  stringValue,
  unsignedInteger,
  type ArchiveData,
  type SourceResolver,
} from './scene-values.js';
import { indexArchiveObjects, prepareArchiveObject, type ArchiveSceneObject } from './scene.js';

type VersionKind = ArchiveHistorySnapshot['kind'];

const maxInteger = 9_223_372_036_854_775_807n;
const decimal = /^(?:0|[1-9][0-9]{0,18})$/u;
const nativeKinds = new Set([
  'shape',
  'text',
  'image',
  'video',
  'html',
  'document',
  'table',
  'link',
  'note',
  'sticker',
  'diagram',
  'chart',
  'todo',
  'section',
  'ink',
  'connector',
]);
const payloadKinds = new Set([
  'text',
  'image',
  'video',
  'document',
  'todo',
  'table',
  'link',
  'embed',
  'ink',
  'sticker',
  'extension',
]);
const objectIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;

export type ValidateNativeObject = (object: ArchiveHistoryObject) => void;

export function unsigned(value: unknown, name: string): bigint {
  if (typeof value === 'string' && decimal.test(value)) {
    const parsed = BigInt(value);
    if (parsed <= maxInteger) {
      return parsed;
    }
  }
  if (typeof value === 'number') {
    return BigInt(unsignedInteger(value, name));
  }

  throw new ArchiveObjectError(`Invalid archived ${name}.`);
}

function optionalVersion(value: unknown, name: string): bigint | undefined {
  return value === undefined ? undefined : unsigned(value, name);
}

function archivedDate(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return unsignedInteger(Date.parse(stringValue(value, name)), name);
}

function versionKind(value: unknown): VersionKind {
  switch (value) {
    case 'baseline':
    case 'geometry':
    case 'content':
    case 'image':
    case 'restore':
      return value;
    default:
      throw new ArchiveObjectError('Invalid archived version kind.');
  }
}

function archivedVersionKind(kind: unknown, lifecycleKind: unknown): VersionKind {
  const legacyKind = versionKind(kind);
  if (lifecycleKind === undefined) {
    return legacyKind;
  }
  if (legacyKind === 'content' && (lifecycleKind === 'trash' || lifecycleKind === 'restoreTrash')) {
    return lifecycleKind;
  }

  throw new ArchiveObjectError('Invalid archived lifecycle version kind.');
}

function projection(object: ArchiveSceneObject, layerIndex: number): ArchiveHistoryObject {
  return {
    ...object,
    layerIndex,
    geometryVersion: 0n,
    appearanceJson: object.appearance && JSON.stringify(object.appearance),
    detailJson: object.detail && JSON.stringify(object.detail),
    payload: object.payload && {
      version: 0n,
      kind: object.payload.bodyKind,
      json: JSON.stringify(object.payload.data),
    },
  };
}

function legacySceneReader(resolveSource: SourceResolver, origin: ArchiveSceneOrigin) {
  const cache = new WeakMap<ArchiveData, ArchiveHistoryObject>();

  return (raw: readonly unknown[]) => {
    const { ids, objectsById } = indexArchiveObjects(raw);

    return objectsById.map(({ id, element }, layerIndex) => {
      if (element.type === 'arrow') {
        return projection(
          prepareArchiveObject(id, element, ids, resolveSource, origin),
          layerIndex,
        );
      }

      let cached = cache.get(element);
      if (!cached) {
        cached = projection(
          prepareArchiveObject(id, element, ids, resolveSource, origin),
          layerIndex,
        );
        cache.set(element, cached);
      }

      return cached.layerIndex === layerIndex ? cached : { ...cached, layerIndex };
    });
  };
}

function rewriteNative(
  value: unknown,
  resolveSource: SourceResolver,
  assetPrefix: string,
  field?: string,
): unknown {
  if (typeof value === 'string') {
    const sourceField = field === 'src' || field === 'poster' || field === 'url';
    if (sourceField && value.startsWith(assetPrefix)) {
      return resolveSource(value, 'reference');
    }

    return remapMarkup(value, resolveSource);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => rewriteNative(item, resolveSource, assetPrefix));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteNative(item, resolveSource, assetPrefix, key),
      ]),
    );
  }

  return value;
}

function nativePayloadData(
  value: unknown,
  kind: string,
  resolveSource: SourceResolver,
  origin: ArchiveSceneOrigin,
) {
  const assetPrefix = '/assets/' + origin.sourceBoardId + '/';
  const data = record(rewriteNative(value, resolveSource, assetPrefix), 'object content');
  if (kind !== 'todo' || !Array.isArray(data.items)) {
    return data;
  }

  return {
    ...data,
    items: data.items.map((raw: unknown) => {
      const item = record(raw, 'todo item');
      if (item.sourceRef === undefined) {
        return item;
      }

      const source = record(item.sourceRef, 'todo source');

      return source.boardId === origin.sourceBoardId
        ? { ...item, sourceRef: { ...source, boardId: origin.boardId } }
        : item;
    }),
  };
}

function readAppearance(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const { fill, stroke, strokeWidth, dashed, hollow } = record(value, 'object appearance');

  return JSON.stringify({
    fill: optionalString(fill, 'fill'),
    stroke: optionalString(stroke, 'stroke'),
    strokeWidth: optionalNumber(strokeWidth, 'stroke width'),
    dashed: dashed === undefined ? undefined : booleanValue(dashed, 'dashed stroke'),
    hollow: hollow === undefined ? undefined : booleanValue(hollow, 'hollow object'),
  });
}

function nativeObject(
  data: ArchiveData,
  resolveSource: SourceResolver,
  origin: ArchiveSceneOrigin,
): ArchiveHistoryObject {
  const native = record(data.studioII, 'Studio II object');
  const kind = stringValue(native.kind, 'object kind');
  const geometryVersion = unsigned(native.geometryVersion, 'geometry version');
  const objectId = requiredId(data.id, 'object ID');
  const payloadVersion = optionalVersion(native.payloadVersion, 'payload version');
  const bodyKind = optionalString(native.bodyKind, 'object content kind');
  const invalidObject = !nativeKinds.has(kind) || !objectIdentifier.test(objectId);
  const unknownBody = bodyKind !== undefined && !payloadKinds.has(bodyKind);
  const missingVersion = (bodyKind === undefined) !== (payloadVersion === undefined);
  const missingData = (bodyKind === undefined) !== (native.data === undefined);
  const invalidPayload = unknownBody || missingVersion || missingData;
  if (invalidObject || invalidPayload) {
    throw new ArchiveObjectError('Invalid archived Studio II object content.');
  }

  const payload =
    bodyKind !== undefined && payloadVersion !== undefined
      ? {
          kind: bodyKind,
          version: payloadVersion,
          json: JSON.stringify(nativePayloadData(native.data, bodyKind, resolveSource, origin)),
        }
      : undefined;

  return {
    objectId,
    kind,
    label: optionalString(kind === 'connector' ? data.label : data.text, 'object label') ?? '',
    layerIndex: 0,
    ...readGeometry(data),
    geometryVersion,
    locked: booleanValue(data.locked, 'object lock'),
    parentId: optionalString(data.parentId, 'object parent'),
    groupId: optionalString(data.groupId, 'object group'),
    payload,
    appearanceJson: readAppearance(native.appearance),
    detailJson:
      native.detail === undefined
        ? undefined
        : JSON.stringify(record(native.detail, 'object detail')),
  };
}

function nativeSceneReader(
  resolveSource: SourceResolver,
  origin: ArchiveSceneOrigin,
  validate: ValidateNativeObject,
) {
  const cache = new WeakMap<ArchiveData, ArchiveHistoryObject>();

  return (raw: readonly unknown[]) => {
    const ids = new Set<string>();

    return raw.map((value, index) => {
      const data = record(value, 'object');
      let object = cache.get(data);
      if (!object) {
        object = { ...nativeObject(data, resolveSource, origin), layerIndex: index };
        try {
          validate(object);
        } catch (error) {
          throw new ArchiveObjectError('Invalid archived Studio II object.', { cause: error });
        }
        cache.set(data, object);
      }
      if (ids.has(object.objectId)) {
        throw new ArchiveObjectError('Duplicate archived object identifier.');
      }

      ids.add(object.objectId);

      return object.layerIndex === index ? object : { ...object, layerIndex: index };
    });
  };
}

function legacyActor(value: unknown) {
  if (value === undefined) {
    return;
  }

  const actor = record(value, 'version actor');

  return {
    id: requiredId(actor.id, 'actor ID'),
    agentName:
      actor.kind === 'agent' && typeof actor.name === 'string' ? actor.name.trim() : undefined,
  };
}

function versionDate(value: unknown, name: string) {
  return value === undefined ? undefined : unsignedInteger(value, name);
}

function parseVersion(entry: ArchiveData, artifact: ArchiveData, native: boolean) {
  const revision = unsigned(entry.revision, 'history revision');
  const title = requiredId(artifact.title, 'history title');
  if (unsigned(artifact.revision, 'history board revision') !== revision) {
    throw new ArchiveObjectError('The archived version does not match its whiteboard revision.');
  }

  const data = native ? record(entry.studioII, 'Studio II version') : undefined;
  const actor = data ? undefined : legacyActor(entry.actor);
  const actorId = data ? optionalString(data.actorId, 'version actor') : actor?.id;
  const savedAtMillis = data
    ? versionDate(data.savedAtMillis, 'version date')
    : archivedDate(entry.createdAt, 'version date');
  const source = /^revision-(\d+)$/u.exec(
    optionalString(entry.restoredFrom, 'version source') ?? '',
  );
  const sourceRevision = optionalVersion(
    data ? data.sourceRevision : source?.[1],
    'source revision',
  );
  const kind = archivedVersionKind(data ? data.kind : entry.summary, data?.lifecycleKind);
  const missingActorOrDate = actorId === undefined || savedAtMillis === undefined;
  const unknownCommit = kind !== 'baseline' && missingActorOrDate;
  const invalidSource = sourceRevision !== undefined && sourceRevision >= revision;
  if (unknownCommit || invalidSource) {
    throw new ArchiveObjectError('Invalid archived version provenance.');
  }

  return {
    revision,
    title,
    actorId,
    agentName: actor?.agentName,
    savedAtMillis,
    sourceRevision,
    kind,
    changedObjectCount: unsignedInteger(
      data ? data.changedObjectCount : entry.changedObjectCount,
      'changed object count',
    ),
  };
}

function boardMetadata(restoration?: ArchiveRestoration) {
  const details = restoration?.details;
  const sourceRevision = restoration?.artifact.revision;
  const revision = restoration
    ? unsigned(details?.revision ?? sourceRevision, 'board revision')
    : 0n;

  if (
    details &&
    (details.version !== 1 || unsigned(sourceRevision, 'board revision') !== revision)
  ) {
    throw new ArchiveObjectError('Invalid archived Studio II version.');
  }

  return {
    revision,
    createdAtMillis:
      versionDate(details?.createdAtMillis, 'board creation date') ??
      archivedDate(restoration?.artifact.createdAt, 'board creation date'),
    updatedAtMillis:
      versionDate(details?.updatedAtMillis, 'board modification date') ??
      archivedDate(restoration?.artifact.updatedAt, 'board modification date'),
    pinned: booleanValue(restoration?.artifact.pinned, 'pinned board'),
  };
}

type ReadScene = (raw: readonly unknown[]) => readonly ArchiveHistoryObject[];

function compareScenes(
  left: readonly ArchiveHistoryObject[],
  right: readonly ArchiveHistoryObject[],
) {
  const normalize = (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value;

  return left === right || JSON.stringify(left, normalize) === JSON.stringify(right, normalize);
}

function readVersions(
  restoration: ArchiveRestoration,
  revision: bigint,
  sourceBoardId: string,
  objects: readonly ArchiveHistoryObject[],
  scene: ReadScene,
) {
  const history: ArchiveHistorySnapshot[] = [];
  for (const item of restoration.history) {
    const version = parseVersion(item.entry, item.artifact, restoration.details !== undefined);
    const previous = history.at(-1)?.revision;
    const discontinuity = previous !== undefined && version.revision !== previous + 1n;
    if (item.artifact.id !== sourceBoardId || version.revision > revision || discontinuity) {
      throw new ArchiveObjectError('Archived revisions do not form a continuous board history.');
    }

    const savedObjects = scene(item.objects);
    if (version.revision === revision && !compareScenes(savedObjects, objects)) {
      throw new ArchiveObjectError(
        'The latest archived version does not match the whiteboard scene.',
      );
    }

    history.push({ ...version, objects: savedObjects });
  }

  const latest = history.at(-1);
  if (restoration.details && !latest) {
    throw new ArchiveObjectError('The archived Studio II snapshot has no version record.');
  }
  if (latest && latest.revision !== revision) {
    throw new ArchiveObjectError('The archived revision does not match the latest version.');
  }

  return history;
}

export function prepareArchiveScene(
  values: readonly unknown[],
  resolveSource: SourceResolver,
  origin: ArchiveSceneOrigin,
  validate: ValidateNativeObject,
  restoration?: ArchiveRestoration,
) {
  const metadata = boardMetadata(restoration);
  const sceneCache = new Map<readonly unknown[], readonly ArchiveHistoryObject[]>();
  const readScene = restoration?.details
    ? nativeSceneReader(resolveSource, origin, validate)
    : legacySceneReader(resolveSource, origin);

  function scene(raw: readonly unknown[]) {
    const cached = sceneCache.get(raw);
    if (cached) {
      return cached;
    }

    const objects = readScene(raw);
    sceneCache.set(raw, objects);

    return objects;
  }

  const objects = scene(values);
  const history = restoration
    ? readVersions(restoration, metadata.revision, origin.sourceBoardId, objects, scene)
    : [];

  return {
    ...metadata,
    objects,
    history,
  };
}
