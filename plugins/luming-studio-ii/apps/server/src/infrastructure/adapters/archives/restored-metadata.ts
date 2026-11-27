import type { SqliteConnection } from '../../platform/index.js';
import { unsigned } from './restore-scene.js';
import {
  ArchiveObjectError,
  numberValue,
  record,
  requiredId,
  sequence,
  stringValue,
  type ArchiveData,
} from './scene-values.js';

type ColumnValue = string | number | bigint | null;
type ColumnReader = (value: unknown, name: string) => ColumnValue;
type Columns = Readonly<Record<string, ColumnReader>>;

const statuses = new Set(['open', 'resolved']);
const actorKinds = new Set(['human', 'agent']);
const roles = new Set(['owner', 'editor', 'commenter', 'viewer']);
const maximumDate = 8_640_000_000_000_000n;

function nullable(reader: ColumnReader): ColumnReader {
  return (value, name) => (value === null ? null : reader(value, name));
}

function oneOf(values: ReadonlySet<string>): ColumnReader {
  return (value, name) => {
    const entry = stringValue(value, name);
    if (!values.has(entry)) {
      throw new ArchiveObjectError(`Invalid archived ${name}.`);
    }

    return entry;
  };
}

function within(maximum: bigint, minimum = 0n) {
  return (value: unknown, name: string) => {
    const number = unsigned(value, name);
    if (number < minimum || number > maximum) {
      throw new ArchiveObjectError(`Invalid archived ${name}.`);
    }

    return number;
  };
}

function parsed(value: unknown, name: string): unknown {
  const text = stringValue(value, name);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`, { cause: error });
  }
}

function contentAnchor(value: unknown, name: string): string {
  const unit = record(parsed(value, name), name);
  switch (unit.kind) {
    case 'document':
      sequence(unit.blockIds, name).forEach((id) => requiredId(id, name));
      break;
    case 'todo':
      requiredId(unit.itemId, name);
      break;
    case 'html':
      sequence(unit.nodeIds, name).forEach((id) => requiredId(id, name));
      stringValue(unit.sourceRevision, name);
      unsigned(unit.sourceRevision, name);
      break;
    default:
      throw new ArchiveObjectError(`Invalid archived ${name} kind.`);
  }

  return JSON.stringify(unit);
}

function targetIds(value: unknown, name: string): string {
  const ids = sequence(parsed(value, name), name);
  ids.forEach((id) => requiredId(id, name));

  return JSON.stringify(ids);
}

function targets(value: unknown, name: string): string {
  const entries = sequence(parsed(value, name), name);
  for (const entry of entries) {
    const target = record(entry, name);
    requiredId(target.objectId, name);
    requiredId(target.kind, name);
    stringValue(target.geometryVersion, name);
    unsigned(target.geometryVersion, name);
    if (target.payloadVersion !== undefined) {
      stringValue(target.payloadVersion, name);
      unsigned(target.payloadVersion, name);
    }

    const geometry = record(target.geometry, name);
    for (const field of ['x', 'y', 'width', 'height', 'rotation']) {
      numberValue(geometry[field], field);
    }
  }

  return JSON.stringify(entries);
}

const tally = within(0xffffffffn);
const version = within(9_223_372_036_854_775_807n, 1n);
const date = within(maximumDate);

const threadColumns = {
  thread_id: requiredId,
  status: oneOf(statuses),
  source_board_revision: unsigned,
  frozen_x: numberValue,
  frozen_y: numberValue,
  object_id: nullable(requiredId),
  object_u: nullable(numberValue),
  object_v: nullable(numberValue),
  object_geometry_version: nullable(unsigned),
  object_kind: nullable(requiredId),
  object_label: nullable(stringValue),
  object_x: nullable(numberValue),
  object_y: nullable(numberValue),
  object_width: nullable(numberValue),
  object_height: nullable(numberValue),
  object_rotation: nullable(numberValue),
  version,
  updated_at_millis: date,
  reply_count: tally,
} satisfies Columns;

const messageColumns = {
  thread_id: requiredId,
  message_id: requiredId,
  author_actor_id: requiredId,
  author_name: (value: unknown, field: string) =>
    value === undefined || value === null ? null : stringValue(value, field),
  text: stringValue,
  created_at_millis: date,
  updated_at_millis: date,
  version,
  position: tally,
} satisfies Columns;

const anchorColumns = {
  thread_id: requiredId,
  payload_version: unsigned,
  unit_json: contentAnchor,
  frozen_excerpt: nullable(stringValue),
} satisfies Columns;

const reviewColumns = {
  source_id: requiredId,
  owner_actor_id: requiredId,
  board_revision: unsigned,
  object_ids_json: targetIds,
  feedback_thread_id: nullable(requiredId),
} satisfies Columns;

const snapshotColumns = {
  source_id: requiredId,
  targets_board_revision: unsigned,
  targets_json: targets,
} satisfies Columns;

const actorColumns = {
  actor_id: requiredId,
  name: stringValue,
  kind: oneOf(actorKinds),
  role: oneOf(roles),
} satisfies Columns;

function rows<T extends Columns>(value: unknown, name: string, columns: T) {
  const values = value === undefined ? [] : sequence(value, name);

  return values.map((value) => {
    const row = record(value, name);

    return Object.fromEntries(
      Object.entries(columns).map(([key, read]) => [key, read(row[key], key)]),
    ) as { [Key in keyof T]: ReturnType<T[Key]> };
  });
}

function actorRows(value: unknown) {
  const values = value === undefined ? [] : sequence(value, 'actors');
  const translated = values.map((entry) => {
    const actor = record(entry, 'actor');

    return { actor_id: actor.id, name: actor.name, kind: actor.kind, role: actor.role };
  });

  return rows(translated, 'actors', actorColumns);
}

function optionalRecord(value: unknown, name: string): ArchiveData {
  return value === undefined ? {} : record(value, name);
}

function uniqueIds<T>(values: readonly T[], key: (value: T) => string, name: string): Set<string> {
  const ids = new Set(values.map(key));
  if (ids.size !== values.length) {
    throw new ArchiveObjectError(`Duplicate archived ${name}.`);
  }

  return ids;
}

function checkThreads(
  threads: ReturnType<typeof rows<typeof threadColumns>>,
  messages: ReturnType<typeof rows<typeof messageColumns>>,
  anchors: ReturnType<typeof rows<typeof anchorColumns>>,
) {
  const ids = uniqueIds(threads, (thread) => thread.thread_id, 'thread ID');
  const anchorsById = uniqueIds(anchors, (anchor) => anchor.thread_id, 'content anchor');
  uniqueIds(
    messages,
    (message) => JSON.stringify([message.thread_id, message.message_id]),
    'message ID',
  );
  uniqueIds(messages, (message) => message.thread_id + ':' + message.position, 'message position');
  if ([...anchorsById].some((id) => !ids.has(id))) {
    throw new ArchiveObjectError('An archived anchor has no feedback thread.');
  }

  const counts = new Map<string, { replies: bigint; root: boolean }>();
  for (const message of messages) {
    if (
      !ids.has(message.thread_id) ||
      (message.position === 0n) !== (message.thread_id === message.message_id) ||
      message.updated_at_millis < message.created_at_millis
    ) {
      throw new ArchiveObjectError('Invalid archived feedback message.');
    }

    const current = counts.get(message.thread_id) ?? { replies: 0n, root: false };
    counts.set(message.thread_id, {
      replies: current.replies + (message.position === 0n ? 0n : 1n),
      root: current.root || message.position === 0n,
    });
  }

  for (const thread of threads) {
    const count = counts.get(thread.thread_id);
    const fields = [
      thread.object_u,
      thread.object_v,
      thread.object_geometry_version,
      thread.object_kind,
      thread.object_label,
      thread.object_x,
      thread.object_y,
      thread.object_width,
      thread.object_height,
      thread.object_rotation,
    ];
    const wrongCounts = !count?.root || count.replies !== thread.reply_count;
    const incompleteObject = fields.some(
      (value) => (thread.object_id === null) !== (value === null),
    );
    const missingObject = thread.object_id === null && anchorsById.has(thread.thread_id);
    if (wrongCounts || incompleteObject || missingObject) {
      throw new ArchiveObjectError('Invalid archived feedback thread.');
    }
  }
}

export function prepareRestoredMetadata(details: ArchiveData, ownerActorId: string) {
  const feedback = optionalRecord(details.feedback, 'feedback details');
  const threads = rows(feedback.threads, 'threads', threadColumns);
  const messages = rows(feedback.messages, 'feedback messages', messageColumns);
  const anchors = rows(feedback.contentAnchors, 'content anchors', anchorColumns);
  checkThreads(threads, messages, anchors);

  const review = optionalRecord(details.reviewSources, 'review source details');
  const sources = rows(review.sources, 'review sources', reviewColumns);
  const snapshots = rows(review.targetSnapshots, 'review target snapshots', snapshotColumns);
  const sourceIds = uniqueIds(sources, (source) => source.source_id, 'review source');
  uniqueIds(snapshots, (snapshot) => snapshot.source_id, 'review target snapshot');
  if (snapshots.some((snapshot) => !sourceIds.has(snapshot.source_id))) {
    throw new ArchiveObjectError('An archived target snapshot has no review source.');
  }

  const actors = actorRows(details.actors);
  uniqueIds(actors, (actor) => actor.actor_id, 'actor');
  const names = new Map(actors.map((actor) => [actor.actor_id, actor.name]));

  return {
    threads,
    messages: messages.map((message) => ({
      ...message,
      author_name: message.author_name ?? names.get(message.author_actor_id) ?? null,
    })),
    anchors,
    sources: sources.map((source) => ({
      ...source,
      owner_actor_id: ownerActorId,
    })),
    snapshots,
    actors,
  };
}

function writeRows(
  connection: SqliteConnection,
  boardId: string,
  table: string,
  columns: Columns,
  values: readonly Readonly<Record<string, ColumnValue>>[],
) {
  if (!values.length) {
    return;
  }

  const keys = Object.keys(columns);
  const insert = connection.prepare(
    `INSERT INTO ${table} (board_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
  );

  for (const row of values) {
    insert.run(boardId, ...keys.map((key) => row[key] ?? null));
  }
}

export function writeRestoredMetadata(
  connection: SqliteConnection,
  boardId: string,
  metadata: ReturnType<typeof prepareRestoredMetadata>,
) {
  writeRows(connection, boardId, 'feedback_threads', threadColumns, metadata.threads);
  writeRows(connection, boardId, 'feedback_messages', messageColumns, metadata.messages);
  writeRows(connection, boardId, 'feedback_content_anchors', anchorColumns, metadata.anchors);
  writeRows(connection, boardId, 'board_review_sources', reviewColumns, metadata.sources);
  writeRows(
    connection,
    boardId,
    'board_review_target_snapshots',
    snapshotColumns,
    metadata.snapshots,
  );
  writeRows(connection, boardId, 'board_archive_actors', actorColumns, metadata.actors);
}
