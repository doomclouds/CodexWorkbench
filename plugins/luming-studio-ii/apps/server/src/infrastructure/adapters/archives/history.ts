import type { SqliteConnection } from '../../platform/index.js';

interface ArchiveHistoryPayload {
  readonly version: bigint;
  readonly kind: string;
  readonly json: string;
}

export interface ArchiveHistoryObject {
  readonly objectId: string;
  readonly kind: string;
  readonly label: string;
  readonly layerIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly geometryVersion: bigint;
  readonly locked: boolean;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly appearanceJson?: string;
  readonly detailJson?: string;
  readonly payload?: ArchiveHistoryPayload;
}

export interface ArchiveHistorySnapshot {
  readonly revision: bigint;
  readonly title: string;
  readonly kind:
    | 'baseline'
    | 'geometry'
    | 'content'
    | 'image'
    | 'restore'
    | 'trash'
    | 'restoreTrash';
  readonly actorId?: string;
  readonly agentName?: string;
  readonly savedAtMillis?: number;
  readonly sourceRevision?: bigint;
  readonly changedObjectCount: number;
  readonly objects: readonly ArchiveHistoryObject[];
}

const objectColumns = [
  'kind',
  'label',
  'layer_index',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'geometry_version',
  'locked',
  'parent_id',
  'group_id',
  'appearance_json',
  'detail_json',
];
const absentObject = objectColumns.map(() => null);

function objectValues(object: ArchiveHistoryObject) {
  return [
    object.kind,
    object.label,
    object.layerIndex,
    object.x,
    object.y,
    object.width,
    object.height,
    object.rotation,
    object.geometryVersion,
    Number(object.locked),
    object.parentId ?? null,
    object.groupId ?? null,
    object.appearanceJson ?? null,
    object.detailJson ?? null,
  ];
}

function sameObject(
  before: ArchiveHistoryObject,
  after: ArchiveHistoryObject | undefined,
): boolean {
  return (
    before === after ||
    (after !== undefined &&
      before.kind === after.kind &&
      before.label === after.label &&
      before.layerIndex === after.layerIndex &&
      before.x === after.x &&
      before.y === after.y &&
      before.width === after.width &&
      before.height === after.height &&
      before.rotation === after.rotation &&
      before.geometryVersion === after.geometryVersion &&
      before.locked === after.locked &&
      before.parentId === after.parentId &&
      before.groupId === after.groupId &&
      before.appearanceJson === after.appearanceJson &&
      before.detailJson === after.detailJson)
  );
}

function samePayload(
  before: ArchiveHistoryPayload | undefined,
  after: ArchiveHistoryPayload | undefined,
): boolean {
  return (
    before?.version === after?.version &&
    before?.kind === after?.kind &&
    before?.json === after?.json
  );
}

function historyWriter(connection: SqliteConnection, boardId: string) {
  const insertVersion = connection.prepare(`
    INSERT INTO board_versions (
      board_id, revision, title, actor_id, kind, saved_at_millis, source_revision,
      changed_object_count, lifecycle_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertObject = connection.prepare(`
    INSERT INTO board_history_objects (
      board_id, change_revision, object_id, ${objectColumns.join(', ')}
    ) VALUES (?, ?, ?, ${objectColumns.map(() => '?').join(', ')})
  `);
  const insertPayload = connection.prepare(`
    INSERT INTO board_history_payloads (
      board_id, change_revision, object_id, payload_version, body_kind, body_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const reserveObject = connection.prepare(`
    INSERT OR IGNORE INTO board_used_object_ids (board_id, object_id) VALUES (?, ?)
  `);

  return {
    version(snapshot: ArchiveHistorySnapshot) {
      const { kind } = snapshot;
      const lifecycleKind = kind === 'trash' || kind === 'restoreTrash' ? kind : null;
      insertVersion.run(
        boardId,
        snapshot.revision,
        snapshot.title,
        snapshot.actorId ?? null,
        lifecycleKind ? 'content' : kind,
        snapshot.savedAtMillis ?? null,
        snapshot.sourceRevision ?? null,
        snapshot.changedObjectCount,
        lifecycleKind,
      );
    },
    object(revision: bigint, objectId: string, before?: ArchiveHistoryObject) {
      const values = before ? objectValues(before) : absentObject;
      insertObject.run(boardId, revision, objectId, ...values);
    },
    payload(revision: bigint, objectId: string, before?: ArchiveHistoryPayload) {
      insertPayload.run(
        boardId,
        revision,
        objectId,
        before?.version ?? null,
        before?.kind ?? null,
        before?.json ?? null,
      );
    },
    reserve(objectId: string) {
      reserveObject.run(boardId, objectId);
    },
  };
}

function writeChanges(
  writer: ReturnType<typeof historyWriter>,
  revision: bigint,
  before: ReadonlyMap<string, ArchiveHistoryObject>,
  after: ReadonlyMap<string, ArchiveHistoryObject>,
): void {
  for (const [id, previous] of before) {
    const next = after.get(id);
    if (!sameObject(previous, next)) {
      writer.object(revision, id, previous);
    }
    if (!samePayload(previous.payload, next?.payload)) {
      writer.payload(revision, id, previous.payload);
    }
    if (!next) {
      writer.reserve(id);
    }
  }

  for (const [id, next] of after) {
    if (before.has(id)) {
      continue;
    }

    writer.object(revision, id);
    if (next.payload) {
      writer.payload(revision, id);
    }
  }
}

export function writeArchiveHistory(
  connection: SqliteConnection,
  boardId: string,
  snapshots: readonly ArchiveHistorySnapshot[],
): void {
  const writer = historyWriter(connection, boardId);
  let previous: ReadonlyMap<string, ArchiveHistoryObject> | undefined;

  for (const snapshot of snapshots) {
    const current = new Map(snapshot.objects.map((object) => [object.objectId, object]));
    writer.version(snapshot);
    if (previous) {
      writeChanges(writer, snapshot.revision, previous, current);
    }

    previous = current;
  }
}
