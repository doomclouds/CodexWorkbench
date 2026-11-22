import { createHash } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import type { BoardOpenScene, BoardSceneUnit } from '../contracts/board-open.js';
import { isBoardElementProjection, isBoardProjection } from '../contracts/board-shape.js';
import { projectBoardSceneUnit } from '../shared/whiteboard-scene.js';
import type {
  ArtifactAuthorization,
  ArtifactState,
  ArtifactUnitProjection,
  ArtifactUnitRequest,
  LocalUnitMutation,
  LocalUnitMutationRequest,
  LocalUnitMutationWrite,
  SavedVersion,
} from '../core/ports/studio-repository.js';
import { isRecord as object } from '../shared/is-record.js';
import { StudioError } from '../shared/studio-error.js';
import { CHECKPOINT_WORK_KEY } from './sqlite-checkpoint-work.js';
import {
  INCREMENTAL_INDEXES,
  INCREMENTAL_SCHEMA,
  INCREMENTAL_TABLES,
  SqliteIncrementalHistory,
  type HistoryVersionRow,
  type OrderedContent,
  type PackedContent,
} from './sqlite-incremental-history.js';
import { orderUnits, type OrderedUnitReference } from './sqlite-incremental-order.js';
import {
  captureLocalUnitBudget,
  isLocalClock,
  localOperationRecord,
  LOCAL_UNIT_BUDGET,
  MAX_SAVED_OPERATIONS,
  type LocalUnitBudget,
  parseLocalUnitBudget,
  unitJsonBytes,
  validLocalUpdate,
} from './sqlite-local-unit.js';

export const ARTIFACT_DATABASE_VERSION = 2;
export const ARTIFACT_DATABASE_APPLICATION_ID = 0x41535455;
const RETIRED_DATABASE_VERSION = 1_001;
const GC_BATCH_SIZE = 256;
const ROW_CHUNK_SIZE = 32;
const CONTENT_LINK_BATCH_SIZE = 256;
const MAX_RETAINED_HISTORY = 200;
const DERIVED_METADATA_KEYS = new Set([CHECKPOINT_WORK_KEY, LOCAL_UNIT_BUDGET]);
const WRITE_PAGE_CACHE_KIB = 32 * 1024;
const READ_PAYLOAD = 'SELECT json FROM payload_blobs WHERE hash=?';
const FIND_PAYLOAD = 'SELECT 1 AS present FROM payload_blobs WHERE hash=?';
const SHARED_INDEXES = {
  payload_links_child: 'payload_links(child_hash)',
  current_units_payload: 'current_units(payload_hash)',
  state_records_payload: 'state_records(payload_hash)',
};
const LEGACY_INDEXES = {
  ...SHARED_INDEXES,
  content_payloads_payload: 'content_payloads(payload_hash)',
};
const V2_INDEXES = { ...SHARED_INDEXES, ...INCREMENTAL_INDEXES };
const LEGACY_SCHEMA = `
  CREATE TABLE content_manifests (hash TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE content_payloads (manifest_hash TEXT NOT NULL REFERENCES content_manifests(hash) ON DELETE CASCADE, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash), PRIMARY KEY(manifest_hash,payload_hash)) WITHOUT ROWID;
  CREATE TABLE history_versions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, entry_json TEXT NOT NULL, artifact_json TEXT NOT NULL, content_hash TEXT NOT NULL REFERENCES content_manifests(hash)) WITHOUT ROWID;
`;
const ENCODED_STRING_REFERENCE_BYTES = Buffer.byteLength(JSON.stringify({ blob: '0'.repeat(64) }));

type EncodedObject = { object: [string, Encoded][] };
type Encoded =
  | null
  | boolean
  | number
  | string
  | Encoded[]
  | EncodedObject
  | { blob: string }
  | { reference: string }
  | { segments: string[] };
interface ContentManifest {
  fields?: string;
  units?: { id: string; hash: string }[];
  value?: string;
}
type SplitContentManifest = Required<Pick<ContentManifest, 'fields' | 'units'>>;
interface StateWriteCache {
  contents: WeakMap<object, string>;
  values: WeakMap<object, string>;
  strings: Map<string, string>;
  payloads: Set<string>;
  unlinked: Set<string>;
  bytes: Map<string, number>;
  manifests: Set<string>;
  contentLinks: Map<number, ReturnType<DatabaseSync['prepare']>>;
}
interface LocalUnitBasis {
  budget: LocalUnitBudget;
  request: LocalUnitMutationRequest;
  current: OrderedUnitReference;
  historical: OrderedUnitReference;
  clockHash: string;
  nextOperationOrdinal: number;
}
type SqlRow = Record<string, string | number | bigint | Uint8Array | null>;
type CollectionKind = 'array' | 'record' | 'value';
type CollectionRecord = readonly [id: string, value: unknown];

function stateWriteCache(): StateWriteCache {
  return {
    contents: new WeakMap(),
    values: new WeakMap(),
    strings: new Map(),
    payloads: new Set(),
    unlinked: new Set(),
    bytes: new Map(),
    manifests: new Set(),
    contentLinks: new Map(),
  };
}

function localHeadMatches(head: HistoryVersionRow | undefined, budget: LocalUnitBudget) {
  return (
    head?.split === 1 &&
    head.revision === budget.revision &&
    head.payload_hash === budget.fieldsHash
  );
}

function readCollectionRecordId(item: unknown, ordinal: number): string {
  if (!object(item)) {
    return String(ordinal);
  }
  if (typeof item.id === 'string') {
    return item.id;
  }

  return typeof item.operationId === 'string' ? item.operationId : String(ordinal);
}

function describeCollection(value: unknown): { kind: CollectionKind; records: CollectionRecord[] } {
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      records: value.map((item, ordinal) => [readCollectionRecordId(item, ordinal), item]),
    };
  }
  if (object(value)) {
    return { kind: 'record', records: Object.entries(value) };
  }

  return { kind: 'value', records: [['value', value]] };
}

export function freezeArtifactValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) {
      freezeArtifactValue(descriptor.value);
    }
  }

  return Object.freeze(value);
}

export function readRetiredMigration(file: string, artifactId: string): unknown {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF');
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== RETIRED_DATABASE_VERSION) {
      return;
    }

    return (
      database
        .prepare('SELECT generation,revision FROM migration_target WHERE artifact_id=?')
        .get(artifactId) ?? null
    );
  } finally {
    database.close();
  }
}

export async function backupArtifactDatabase(source: string, target: string): Promise<void> {
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF');
    await backup(database, target);
  } finally {
    database.close();
  }
}

export class SqliteArtifactRepository {
  readonly database: DatabaseSync;
  readonly storageVersion: 1 | 2;
  private readonly incremental?: SqliteIncrementalHistory;
  private readonly values = new Map<string, unknown>();
  private readonly manifests = new Map<string, ContentManifest>();
  private readonly costs = new Map<string, number>();
  private readonly historyContents = new WeakMap<object, string>();
  private readonly localUnitBases = new WeakMap<LocalUnitMutation, LocalUnitBasis>();
  private sharedUnitHashes?: WeakMap<object, string>;
  private readPayload?: ReturnType<DatabaseSync['prepare']>;
  private findPayload?: ReturnType<DatabaseSync['prepare']>;
  constructor(file: string, create = false, createVersion: 1 | 2 = ARTIFACT_DATABASE_VERSION) {
    this.database = new DatabaseSync(file, {
      readOnly: !create,
      enableForeignKeyConstraints: true,
    });

    try {
      this.database.exec('PRAGMA busy_timeout=5000');
      const application = Number(
        this.database.prepare('PRAGMA application_id').get()!.application_id,
      );
      const version = Number(this.database.prepare('PRAGMA user_version').get()!.user_version);
      const missingFormat = application === 0 && version === 0;
      if (create && missingFormat && this.emptyStorage()) {
        this.storageVersion = createVersion;
        this.initialize();
      } else if (
        application === ARTIFACT_DATABASE_APPLICATION_ID &&
        (version === 1 || version === 2)
      ) {
        this.storageVersion = version;
      } else {
        throw new StudioError('UNSUPPORTED_STORAGE', '此作品数据库版本暂不受支持。');
      }

      this.database.exec('PRAGMA trusted_schema=OFF');
      this.assertSchema();
      this.incremental =
        this.storageVersion === 2 ? new SqliteIncrementalHistory(this.database) : undefined;

      if (create) {
        this.database.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON');
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private emptyStorage(): boolean {
    return !this.database
      .prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1")
      .get();
  }

  private get lookupIndexes() {
    return this.storageVersion === 2 ? V2_INDEXES : LEGACY_INDEXES;
  }

  private createLookupIndexes(): string {
    return Object.entries(this.lookupIndexes)
      .map(([name, columns]) => `CREATE INDEX ${name} ON ${columns};`)
      .join('\n');
  }

  private assertSchema(): void {
    const tables = new Set([
      'storage_meta',
      'payload_blobs',
      'payload_links',
      'current_units',
      'history_versions',
      'state_records',
      ...(this.storageVersion === 2
        ? INCREMENTAL_TABLES
        : ['content_manifests', 'content_payloads']),
    ]);

    for (const row of this.database
      .prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
      .all()) {
      if (row.type === 'table' && tables.delete(String(row.name))) {
        continue;
      }
      if (row.type === 'index' && Object.hasOwn(this.lookupIndexes, String(row.name))) {
        continue;
      }

      throw new StudioError('UNSUPPORTED_STORAGE', '作品数据库含有不受支持的结构。');
    }
    if (tables.size) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品数据库结构不完整。');
    }
    if (this.database.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'delete') {
      throw new StudioError('UNSUPPORTED_STORAGE', '此作品数据库的日志格式暂不受支持。');
    }
  }

  private initialize(): void {
    const bytes = this.storageVersion === 2 ? ', bytes INTEGER NOT NULL CHECK(bytes>0)' : '';
    const history = this.storageVersion === 2 ? INCREMENTAL_SCHEMA : LEGACY_SCHEMA;
    const scene = this.storageVersion === 2 ? ', scene_json TEXT, scene_hash TEXT' : '';
    this.database.exec(`PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      BEGIN IMMEDIATE;
      CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE payload_blobs (hash TEXT PRIMARY KEY, json TEXT NOT NULL${bytes}) WITHOUT ROWID;
      CREATE TABLE payload_links (parent_hash TEXT NOT NULL REFERENCES payload_blobs(hash) ON DELETE CASCADE, child_hash TEXT NOT NULL REFERENCES payload_blobs(hash), PRIMARY KEY(parent_hash,child_hash)) WITHOUT ROWID;
      CREATE TABLE current_units (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash)${scene}) WITHOUT ROWID;
      CREATE TABLE state_records (collection TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash), PRIMARY KEY(collection,id)) WITHOUT ROWID;
      ${history}
      ${this.createLookupIndexes()}
      PRAGMA application_id=${ARTIFACT_DATABASE_APPLICATION_ID};
      PRAGMA user_version=${this.storageVersion};
      COMMIT;`);
  }
  close(): void {
    this.database.close();
  }
  retireForMigration(artifactId: string, generation: string, revision: number): void {
    if (this.storageVersion !== 1 || !this.database.isTransaction) {
      throw new Error('Retiring legacy storage requires a v1 write transaction.');
    }

    this.database.exec(
      'CREATE TABLE migration_target (artifact_id TEXT PRIMARY KEY, generation TEXT NOT NULL, revision INTEGER NOT NULL) WITHOUT ROWID',
    );
    this.database
      .prepare('INSERT INTO migration_target(artifact_id,generation,revision) VALUES(?,?,?)')
      .run(artifactId, generation, revision);
    this.database.exec('ALTER TABLE storage_meta RENAME TO retired_storage_meta');
    this.database.exec(`PRAGMA user_version=${RETIRED_DATABASE_VERSION}`);
  }
  private jsonRow(sql: string, ...args: string[]): SqlRow {
    const statement =
      sql === READ_PAYLOAD
        ? (this.readPayload ??= this.database.prepare(READ_PAYLOAD))
        : this.database.prepare(sql);
    const row = statement.get(...args) as SqlRow | undefined;
    if (!row) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品数据库缺少被引用的数据。');
    }

    return row;
  }
  private hash(json: string): string {
    return createHash('sha256').update(json).digest('hex');
  }
  private putBlob(json: string, write: StateWriteCache, bytes = Buffer.byteLength(json)): string {
    const hash = this.hash(json);
    if (!write.payloads.has(hash)) {
      const find = (this.findPayload ??= this.database.prepare(FIND_PAYLOAD));
      if (!find.get(hash)) {
        if (this.storageVersion === 2) {
          this.database
            .prepare('INSERT INTO payload_blobs(hash,json,bytes) VALUES(?,?,?)')
            .run(hash, json, bytes);
          write.unlinked.add(hash);
        } else {
          this.database.prepare('INSERT INTO payload_blobs(hash,json) VALUES(?,?)').run(hash, json);
        }
      }

      write.payloads.add(hash);
      write.bytes.set(hash, bytes);
    }

    return hash;
  }
  private encode(value: unknown, references: Set<string>, write: StateWriteCache): Encoded {
    if (value === null || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new StudioError('INVALID_ARGUMENT', '作品包含无法保存的数值。');
      }

      return value;
    }
    if (typeof value === 'string') {
      if (value.length <= 1024) {
        return value;
      }

      let hash = write.strings.get(value);
      if (hash === undefined) {
        hash = this.putBlob(JSON.stringify(value), write);
        write.strings.set(value, hash);
      }
      references.add(hash);

      return { blob: hash };
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.encode(item === undefined ? null : item, references, write));
    }
    if (!object(value)) {
      throw new StudioError('INVALID_ARGUMENT', '作品包含无法保存的值。');
    }

    return {
      object: Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, this.encodeProperty(key, item, references, write)]),
    };
  }

  private encodeProperty(
    key: string,
    value: unknown,
    references: Set<string>,
    write: StateWriteCache,
  ): Encoded {
    const chunks =
      this.storageVersion === 2 &&
      ['blocks', 'children', 'items'].includes(key) &&
      Array.isArray(value) &&
      value.every((item) => object(item) && typeof item.id === 'string');

    if (!chunks) {
      return this.encode(value, references, write);
    }

    const hashes = value.map((item) => this.putValue(item, write));
    if (hashes.length <= ROW_CHUNK_SIZE) {
      return hashes.map((hash) => {
        references.add(hash);
        return { reference: hash };
      });
    }

    const segments: string[] = [];
    for (let offset = 0; offset < hashes.length; offset += ROW_CHUNK_SIZE) {
      const batch = hashes.slice(offset, offset + ROW_CHUNK_SIZE);
      const bytes = batch.reduce((sum, hash) => sum + write.bytes.get(hash)! + 1, 1);
      const hash = this.putEncoded(
        batch.map((reference) => ({ reference })),
        new Set(batch),
        write,
        bytes,
      );
      references.add(hash);
      segments.push(hash);
    }

    return { segments };
  }

  private decode(value: Encoded, depth = 0): unknown {
    if (depth > 128) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容嵌套过深。');
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.decode(item, depth + 1));
    }
    if ('blob' in value) {
      return this.stringBlob(value.blob);
    }
    if ('reference' in value) {
      return this.value(value.reference, depth);
    }
    if ('segments' in value) {
      return value.segments.flatMap((hash) => {
        const rows = this.value(hash, depth);
        if (!Array.isArray(rows)) {
          throw new StudioError('CORRUPT_ARTIFACT', '作品行数据引用无效。');
        }

        return rows;
      });
    }

    return Object.fromEntries(
      value.object.map(([key, item]) => [key, this.decode(item, depth + 1)]),
    );
  }
  private putValue(value: unknown, write: StateWriteCache): string {
    const identity = value !== null && typeof value === 'object' ? value : undefined;
    const cached = identity && write.values.get(identity);
    if (cached) {
      return cached;
    }

    const references = new Set<string>();
    const encoded = this.encode(value, references, write);
    const bytes = this.storageVersion === 2 ? Buffer.byteLength(JSON.stringify(value)) : undefined;
    const hash = this.putEncoded(encoded, references, write, bytes);
    if (identity) {
      write.values.set(identity, hash);
    }

    return hash;
  }

  private putEncoded(
    value: Encoded,
    references: Set<string>,
    write: StateWriteCache,
    bytes?: number,
  ): string {
    const hash = this.putBlob(JSON.stringify(value), write, bytes);
    if (references.size && (this.storageVersion === 1 || write.unlinked.delete(hash))) {
      const link = this.database.prepare(
        'INSERT OR IGNORE INTO payload_links(parent_hash,child_hash) VALUES(?,?)',
      );

      for (const child of references) {
        link.run(hash, child);
      }
    }
    return hash;
  }
  private value(hash: string, depth = 0): unknown {
    if (depth > 128) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容嵌套过深。');
    }
    if (this.values.has(hash)) {
      return this.values.get(hash);
    }

    const row = this.jsonRow(READ_PAYLOAD, hash);
    if (this.hash(String(row.json)) !== hash) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容校验失败。');
    }

    const parsed = this.decode(JSON.parse(String(row.json)) as Encoded, depth);
    const frozen = freezeArtifactValue(parsed);
    this.values.set(hash, frozen);

    return frozen;
  }
  private stringBlob(hash: string): string {
    const cached = this.values.get(hash);
    if (typeof cached === 'string') {
      return cached;
    }

    const json = String(this.jsonRow(READ_PAYLOAD, hash).json);
    if (this.hash(json) !== hash) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容校验失败。');
    }

    const value: unknown = JSON.parse(json);
    if (typeof value !== 'string') {
      throw new StudioError('CORRUPT_ARTIFACT', '作品大文本引用无效。');
    }

    this.values.set(hash, value);

    return value;
  }
  private expandedValueBytes(hash: string, visiting = new Set<string>(), originDepth = 0): number {
    const cached = this.costs.get(hash);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(hash)) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容引用成环。');
    }

    const raw = String(this.jsonRow(READ_PAYLOAD, hash).json);
    if (this.hash(raw) !== hash) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容校验失败。');
    }

    visiting.add(hash);
    const count = (value: Encoded, depth: number): number => {
      if (depth > 128) {
        throw new StudioError('CORRUPT_ARTIFACT', '作品内容嵌套过深。');
      }
      if (!value || typeof value !== 'object') {
        return Buffer.byteLength(JSON.stringify(value));
      }
      if (Array.isArray(value)) {
        return (
          2 +
          Math.max(0, value.length - 1) +
          value.reduce<number>((size, item) => size + count(item, depth + 1), 0)
        );
      }
      if ('blob' in value) {
        return Buffer.byteLength(JSON.stringify(this.stringBlob(value.blob)));
      }
      if ('reference' in value) {
        return this.expandedValueBytes(value.reference, visiting, depth);
      }

      if ('segments' in value) {
        const parts = value.segments
          .map((segment) => this.expandedValueBytes(segment, visiting, depth) - 2)
          .filter((bytes) => bytes > 0);

        return 2 + Math.max(0, parts.length - 1) + parts.reduce((sum, bytes) => sum + bytes, 0);
      }

      return (
        2 +
        Math.max(0, value.object.length - 1) +
        value.object.reduce(
          (size, [key, item]) =>
            size + Buffer.byteLength(JSON.stringify(key)) + 1 + count(item, depth + 1),
          0,
        )
      );
    };

    const bytes = count(JSON.parse(raw) as Encoded, originDepth);
    visiting.delete(hash);
    this.costs.set(hash, bytes);

    return bytes;
  }
  private expandedContentBytes(hash: string): number {
    const manifest = this.manifest(hash);
    if (manifest.value) {
      return this.expandedValueBytes(manifest.value);
    }

    return (
      this.expandedValueBytes(manifest.fields!) +
      16 +
      manifest.units!.reduce((total, unit) => total + this.expandedValueBytes(unit.hash) + 1, 0)
    );
  }
  private packContent(
    content: unknown,
    write: StateWriteCache,
    storedHashes?: ReadonlyMap<string, string>,
  ): PackedContent {
    const split =
      object(content) &&
      Array.isArray(content.elements) &&
      content.elements.every((element) => object(element) && typeof element.id === 'string');

    if (!split) {
      return { payload: this.putValue(content, write) };
    }

    const { elements, ...fields } = content;
    const rows = elements as Record<string, unknown>[];
    if (this.incremental && new Set(rows.map((row) => row.id)).size !== rows.length) {
      return { payload: this.putValue(content, write) };
    }

    const units = rows.map((element) => {
      const id = String(element.id);
      const shared = this.sharedUnitHashes?.get(element);

      return {
        id,
        hash: shared && storedHashes?.get(id) === shared ? shared : this.putValue(element, write),
      };
    });

    return { payload: this.putValue(fields, write), units };
  }
  private putContent(content: unknown, write: StateWriteCache): string {
    const identity = content !== null && typeof content === 'object' ? content : undefined;
    const cached = identity && write.contents.get(identity);
    if (cached) {
      return cached;
    }

    const packed = this.packContent(content, write);
    const manifest: ContentManifest = packed.units
      ? { fields: packed.payload, units: packed.units }
      : { value: packed.payload };
    const json = JSON.stringify(manifest);
    const hash = this.hash(json);
    if (!write.manifests.has(hash)) {
      this.database
        .prepare('INSERT OR IGNORE INTO content_manifests(hash,json) VALUES(?,?)')
        .run(hash, json);
      this.writeContentLinks(hash, manifest, write);
      write.manifests.add(hash);
      this.manifests.set(hash, manifest);
    }
    if (identity) {
      write.contents.set(identity, hash);
    }

    return hash;
  }

  private writeContentLinks(hash: string, manifest: ContentManifest, write: StateWriteCache): void {
    const references = [
      manifest.fields,
      manifest.value,
      ...(manifest.units ?? []).map((unit) => unit.hash),
    ];
    const payloads = [
      ...new Set(references.filter((value): value is string => value !== undefined)),
    ].sort();

    for (let index = 0; index < payloads.length; index += CONTENT_LINK_BATCH_SIZE) {
      const batch = payloads.slice(index, index + CONTENT_LINK_BATCH_SIZE);
      let link = write.contentLinks.get(batch.length);
      if (!link) {
        const placeholders = batch.map(() => '(?,?)').join(',');
        link = this.database.prepare(
          `INSERT OR IGNORE INTO content_payloads(manifest_hash,payload_hash) VALUES${placeholders}`,
        );
        write.contentLinks.set(batch.length, link);
      }

      link.run(...batch.flatMap((payload) => [hash, payload]));
    }
  }
  private manifest(hash: string): ContentManifest {
    const cached = this.manifests.get(hash);
    if (cached) {
      return cached;
    }

    const json = String(this.jsonRow('SELECT json FROM content_manifests WHERE hash=?', hash).json);
    if (this.hash(json) !== hash) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品版本校验失败。');
    }

    const parsed = JSON.parse(json) as ContentManifest;
    this.manifests.set(hash, parsed);

    return parsed;
  }
  private content(hash: string): unknown {
    const manifest = this.manifest(hash);
    if (manifest.value) {
      return this.value(manifest.value);
    }

    return freezeArtifactValue({
      ...(this.value(manifest.fields!) as Record<string, unknown>),
      elements: manifest.units!.map((unit) => this.value(unit.hash)),
    });
  }

  private currentUnits(): OrderedUnitReference[] {
    const rows = this.database
      .prepare('SELECT id,ordinal,payload_hash FROM current_units ORDER BY ordinal,id')
      .all();
    const units = rows.map((row) => ({
      id: String(row.id),
      hash: String(row.payload_hash),
      ordinal: Number(row.ordinal),
    }));

    if (
      this.incremental &&
      units.some(
        (unit, index) =>
          !Number.isSafeInteger(unit.ordinal) || unit.ordinal === units[index - 1]?.ordinal,
      )
    ) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品当前对象顺序无效。');
    }

    return units;
  }

  private currentV2(payload: string, kind: string | undefined): OrderedContent {
    if (kind === 'split') {
      return { payload, units: this.currentUnits() };
    }
    if (kind === 'value') {
      return { payload };
    }

    throw new StudioError('CORRUPT_ARTIFACT', '作品数据库缺少有效的当前内容类型。');
  }

  private unpackContent(snapshot: PackedContent): unknown {
    const fields = this.value(snapshot.payload);
    if (!snapshot.units) {
      return fields;
    }

    return freezeArtifactValue({
      ...(fields as Record<string, unknown>),
      elements: snapshot.units.map((unit) => this.value(unit.hash)),
    });
  }

  private shareCurrentUnits(snapshot: PackedContent): unknown {
    const fields = this.value(snapshot.payload);
    const hashes = new WeakMap<object, string>();
    const elements = snapshot.units!.map((unit) => {
      const value = this.value(unit.hash);
      if (object(value) && value.id === unit.id) {
        hashes.set(value, unit.hash);
      }

      return value;
    });
    this.sharedUnitHashes = hashes;

    return { ...(structuredClone(fields) as Record<string, unknown>), elements };
  }

  private readCurrentV2Content(snapshot: PackedContent, shareContentUnits?: boolean): unknown {
    if (shareContentUnits && snapshot.units && this.database.isTransaction) {
      return this.shareCurrentUnits(snapshot);
    }

    return structuredClone(this.unpackContent(snapshot));
  }

  private packedContentBytes(snapshot: PackedContent): number {
    const bytes = this.expandedValueBytes(snapshot.payload);
    if (!snapshot.units) {
      return bytes;
    }

    return (
      bytes +
      16 +
      snapshot.units.reduce((total, unit) => total + this.expandedValueBytes(unit.hash) + 1, 0)
    );
  }
  readMetadata(): unknown {
    const artifact = JSON.parse(
      String(this.jsonRow("SELECT value FROM storage_meta WHERE key='artifact'").value),
    );
    const enabled = this.database
      .prepare("SELECT payload_hash FROM state_records WHERE collection='sharing' AND id='enabled'")
      .get() as SqlRow | undefined;

    return {
      ...artifact,
      sharing: enabled ? this.value(String(enabled.payload_hash)) === true : false,
    };
  }

  readAuthorization(): ArtifactAuthorization {
    const artifact: unknown = JSON.parse(
      String(this.jsonRow("SELECT value FROM storage_meta WHERE key='artifact'").value),
    );
    const select = this.database.prepare(
      'SELECT id,payload_hash FROM state_records WHERE collection=? ORDER BY ordinal LIMIT 100001',
    );
    const readRecord = (collection: string): Record<string, unknown> => {
      const rows = select.all(collection) as SqlRow[];
      if (rows.length > 100_000) {
        throw new StudioError('TOO_LARGE', '作品数据库授权记录超过读取容量。');
      }

      return Object.fromEntries(
        rows.map((row) => [String(row.id), this.value(String(row.payload_hash))]),
      );
    };
    const sharing = readRecord('sharing');
    const validArtifact =
      object(artifact) &&
      typeof artifact.id === 'string' &&
      Number.isSafeInteger(artifact.revision);

    if (!validArtifact || typeof sharing.enabled !== 'boolean' || !object(sharing.tokens)) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品数据库授权信息无效。');
    }

    return {
      artifact: artifact as unknown as ArtifactAuthorization['artifact'],
      sharing: sharing as unknown as ArtifactAuthorization['sharing'],
      guestNames: readRecord('guestNames') as ArtifactAuthorization['guestNames'],
    };
  }

  readLocalUnitMutation(request: LocalUnitMutationRequest): LocalUnitMutation | undefined {
    if (!this.incremental || !this.database.isTransaction) {
      return;
    }

    const head = this.readLocalUnitHead(request);
    if (!head) {
      return;
    }

    const { authorization, budget } = head;
    const records = this.database.prepare(
      'SELECT ordinal,payload_hash FROM state_records WHERE collection=? AND id=?',
    );

    if (records.get('operations', request.operationId)) {
      return;
    }

    const row = this.database
      .prepare('SELECT ordinal,payload_hash FROM current_units WHERE id=?')
      .get(request.id);
    const historical = this.incremental.unitAt(budget.revision, request.id);
    const clockHash = records.get('unitClocks', request.id)?.payload_hash;

    if (!historical || row?.payload_hash !== historical.hash || typeof clockHash !== 'string') {
      return;
    }

    const unit = this.value(historical.hash);
    const fields = this.value(budget.fieldsHash);
    const clock = this.value(clockHash);
    const textUnit =
      isBoardElementProjection(unit) && unit.id === request.id && unit.type === 'text';
    const ordinal = row.ordinal;
    const validOrdinal = typeof ordinal === 'number' && Number.isSafeInteger(ordinal);

    if (!object(fields) || !textUnit || !validOrdinal) {
      return;
    }
    if (!isLocalClock(clock) || clock.version !== unit.version) {
      return;
    }

    const nextOperationOrdinal = this.nextLocalOperationOrdinal();
    if (nextOperationOrdinal === undefined) {
      return;
    }

    const current = { id: request.id, hash: historical.hash, ordinal };
    const basis = freezeArtifactValue({
      authorization,
      fields,
      unit,
      clock,
      hasLockedArrow: budget.hasLockedArrow,
    });
    this.localUnitBases.set(basis, {
      budget,
      request: { ...request },
      current,
      historical,
      clockHash,
      nextOperationOrdinal,
    });

    return basis;
  }

  private nextLocalOperationOrdinal(): number | undefined {
    const stored = this.database
      .prepare(
        "SELECT coalesce(max(ordinal),-1) AS latest FROM state_records WHERE collection='operations'",
      )
      .get()?.latest;

    return typeof stored === 'number' && Number.isSafeInteger(stored + 1) ? stored + 1 : undefined;
  }

  private readLocalUnitHead(request: LocalUnitMutationRequest) {
    const budget = this.readLocalUnitBudget();
    if (
      !budget ||
      budget.bytes > request.maximumBytes ||
      budget.elements > request.maximumElements
    ) {
      return;
    }

    this.assertReadCapacity();
    const authorization = this.readAuthorization();
    const artifact = authorization.artifact;
    const matchingRevision =
      artifact.revision === budget.revision && localHeadMatches(this.incremental?.latest(), budget);

    if (artifact.type !== 'whiteboard' || !matchingRevision) {
      return;
    }

    return { authorization, budget };
  }

  private readLocalUnitBudget(): LocalUnitBudget | undefined {
    const row = this.database
      .prepare(`SELECT marker.value FROM storage_meta AS marker
        JOIN storage_meta AS fields ON fields.key='content'
        JOIN storage_meta AS kind ON kind.key='content_kind' AND kind.value='split'
        WHERE marker.key=? AND json_valid(marker.value)
          AND json_extract(marker.value,'$.fieldsHash')=fields.value`)
      .get(LOCAL_UNIT_BUDGET);

    return parseLocalUnitBudget(row?.value);
  }

  writeLocalUnitMutation(basis: LocalUnitMutation, update: LocalUnitMutationWrite): boolean {
    const proof = this.localUnitBases.get(basis);
    if (!this.incremental || !this.database.isTransaction || !proof) {
      return false;
    }

    const { request, budget, current, historical, clockHash, nextOperationOrdinal } = proof;
    const { artifact, entry, unit } = update;
    if (
      !validLocalUpdate(basis, update, request) ||
      this.readLocalUnitBudget()?.revision !== budget.revision
    ) {
      return false;
    }

    const bytes = budget.bytes - unitJsonBytes(basis.unit) + unitJsonBytes(unit);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > request.maximumBytes) {
      return false;
    }

    this.localUnitBases.delete(basis);
    const write = stateWriteCache();
    const newHash = this.putValue(unit, write);
    const obsolete = new Set([current.hash, clockHash]);
    const scene = JSON.stringify(projectBoardSceneUnit(unit));
    const sceneHash = this.hash(newHash + '\\n' + scene);
    this.database
      .prepare('UPDATE current_units SET payload_hash=?,scene_json=?,scene_hash=? WHERE id=?')
      .run(newHash, scene, sceneHash, current.id);
    this.incremental.appendUnit(
      { artifact, entry },
      budget.fieldsHash,
      newHash === historical.hash ? undefined : { ...historical, hash: newHash },
      obsolete,
    );
    this.updateLocalMutationRecords(update, nextOperationOrdinal, write, obsolete);

    const meta = this.database.prepare('UPDATE storage_meta SET value=? WHERE key=?');
    meta.run(JSON.stringify(artifact), 'artifact');
    meta.run(JSON.stringify({ ...budget, bytes, revision: artifact.revision }), LOCAL_UNIT_BUDGET);
    this.enqueueGarbage(obsolete);

    return true;
  }

  private updateLocalMutationRecords(
    { unit, clock, operation }: LocalUnitMutationWrite,
    ordinal: number,
    write: StateWriteCache,
    obsolete: Set<string>,
  ): void {
    this.database
      .prepare("UPDATE state_records SET payload_hash=? WHERE collection='unitClocks' AND id=?")
      .run(this.putValue(clock, write), unit.id);
    this.database
      .prepare(
        "INSERT INTO state_records(collection,id,ordinal,payload_hash) VALUES('operations',?,?,?)",
      )
      .run(operation.id, ordinal, this.putValue(operation, write));

    const expired = this.database.prepare(`
      SELECT record.id,record.payload_hash FROM state_records AS record
      JOIN payload_blobs AS blob ON blob.hash=record.payload_hash
      WHERE record.collection='operations'
        AND NOT EXISTS (
          SELECT 1 FROM json_each(blob.json,'$.object') AS field
          WHERE json_extract(field.value,'$[0]')='receiptUnavailable'
            AND json_extract(field.value,'$[1]')=1
        ) AND NOT EXISTS (
          SELECT 1 FROM json_each(blob.json,'$.object') AS field
          JOIN history_versions AS version ON version.id=json_extract(field.value,'$[1]')
          WHERE json_extract(field.value,'$[0]')='historyId'
        )
    `);
    this.deleteLocalOperationRecords(expired.all(), obsolete);

    const excess = this.database.prepare(`
      SELECT id,payload_hash FROM state_records WHERE collection='operations'
      ORDER BY ordinal DESC LIMIT -1 OFFSET ?
    `);
    this.deleteLocalOperationRecords(excess.all(MAX_SAVED_OPERATIONS), obsolete);
  }

  private deleteLocalOperationRecords(records: SqlRow[], obsolete: Set<string>): void {
    const remove = this.database.prepare(
      "DELETE FROM state_records WHERE collection='operations' AND id=?",
    );

    for (const row of records) {
      const hash = String(row.payload_hash);
      const record = this.value(hash);
      if (!localOperationRecord(record) || record.id !== row.id) {
        throw new StudioError('CORRUPT_ARTIFACT', '作品数据库操作回执无效。');
      }

      remove.run(record.id);
      obsolete.add(hash);
    }
  }

  private assertReadCapacity(): void {
    for (const [table, maximum] of [
      ['history_versions', MAX_RETAINED_HISTORY],
      ['current_units', 2000],
      ['state_records', 100_000],
    ] as const) {
      if (
        Number(this.database.prepare(`SELECT count(*) AS total FROM ${table}`).get()!.total) >
        maximum
      ) {
        throw new StudioError('TOO_LARGE', '作品数据库超过读取容量。');
      }
    }
  }

  private splitManifest(hash: string): SplitContentManifest | undefined {
    const manifest = this.manifest(hash);
    if (!manifest.value && typeof manifest.fields === 'string' && Array.isArray(manifest.units)) {
      return { fields: manifest.fields, units: manifest.units };
    }
  }

  readBoardScene(maximumBytes?: number): BoardOpenScene | undefined {
    if (!this.incremental) {
      return;
    }

    this.assertReadCapacity();
    const metadata: unknown = JSON.parse(
      String(this.jsonRow("SELECT value FROM storage_meta WHERE key='artifact'").value),
    );
    const manifest = this.currentUnitManifest();
    if (!manifest || !object(metadata) || metadata.type !== 'whiteboard') {
      return;
    }
    if (maximumBytes !== undefined && !this.withinContentBudget(manifest, maximumBytes)) {
      return;
    }

    const fields = this.value(manifest.fields);
    if (!object(fields)) {
      return;
    }

    return this.readProjectedScene(metadata, fields);
  }

  private readProjectedScene(
    artifact: unknown,
    fields: Record<string, unknown>,
  ): BoardOpenScene | undefined {
    const units: BoardSceneUnit[] = [];
    const rows = this.database
      .prepare(
        'SELECT id,payload_hash,scene_json,scene_hash FROM current_units ORDER BY ordinal,id',
      )
      .all();

    for (const row of rows) {
      const unit = this.decodeSceneUnit(row);
      if (!unit) {
        return;
      }

      units.push(unit);
    }

    const projection = {
      artifact,
      style: fields.style,
      orderVersion: fields.orderVersion,
      elements: units.map((unit) => (unit.state === 'complete' ? unit.element : unit.geometry)),
    };

    if (!isBoardProjection(projection)) {
      return;
    }

    return {
      artifact: projection.artifact,
      style: projection.style,
      orderVersion: projection.orderVersion,
      units,
    };
  }

  private decodeSceneUnit(row: SqlRow): BoardSceneUnit | undefined {
    if (
      typeof row.payload_hash !== 'string' ||
      typeof row.scene_json !== 'string' ||
      this.hash(row.payload_hash + '\\n' + row.scene_json) !== row.scene_hash
    ) {
      return;
    }

    let unit: unknown;
    try {
      unit = JSON.parse(row.scene_json);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return;
      }

      throw error;
    }
    if (!object(unit)) {
      return;
    }
    if (
      unit.state === 'complete' &&
      isBoardElementProjection(unit.element) &&
      unit.element.id === row.id
    ) {
      return { state: 'complete', element: unit.element };
    }
    if (
      unit.state === 'unloaded' &&
      isBoardElementProjection(unit.geometry) &&
      unit.geometry.id === row.id
    ) {
      return { state: 'unloaded', geometry: unit.geometry };
    }
  }

  private currentUnitManifest(): SplitContentManifest | undefined {
    const payload = String(
      this.jsonRow("SELECT value FROM storage_meta WHERE key='content'").value,
    );

    if (!this.incremental) {
      return this.splitManifest(payload);
    }

    const kind = String(
      this.jsonRow("SELECT value FROM storage_meta WHERE key='content_kind'").value,
    );
    const snapshot = this.currentV2(payload, kind);

    return snapshot.units ? { fields: snapshot.payload, units: snapshot.units } : undefined;
  }

  private withinContentBudget(manifest: SplitContentManifest, maximum: number): boolean {
    const hashes = [manifest.fields, ...manifest.units.map((unit) => unit.hash)];
    if (this.incremental) {
      const result = this.database
        .prepare(
          'SELECT count(*) AS copies,sum(blob.bytes) AS bytes FROM json_each(?) AS roots JOIN payload_blobs AS blob ON blob.hash=roots.value',
        )
        .get(JSON.stringify(hashes));

      return (
        Number(result?.copies) === hashes.length &&
        Number(result?.bytes) + 16 + manifest.units.length <= maximum
      );
    }

    const result = this.database
      .prepare(
        `WITH roots AS (
           SELECT value AS hash, count(*) AS copies FROM json_each(?) GROUP BY value
         )
         SELECT sum(roots.copies) AS copies, sum(roots.copies * (
           octet_length(root.json) + coalesce((
             SELECT sum(coalesce(octet_length(child.json), ?) - ?)
             FROM json_tree(root.json) AS reference
             LEFT JOIN payload_blobs AS child ON child.hash = reference.atom
             WHERE reference.key = 'blob'
           ), 0)
         )) AS bytes
         FROM roots JOIN payload_blobs AS root ON root.hash = roots.hash`,
      )
      .get(
        JSON.stringify(hashes),
        maximum + ENCODED_STRING_REFERENCE_BYTES + 1,
        ENCODED_STRING_REFERENCE_BYTES,
      );
    const boardOverhead = 16 + manifest.units.length;

    return (
      Number(result?.copies) === hashes.length && Number(result?.bytes) + boardOverhead <= maximum
    );
  }

  private unitContent(
    manifest: SplitContentManifest,
    fields: Record<string, unknown>,
    ids: ReadonlySet<string>,
  ): Record<string, unknown> {
    const elements = manifest.units
      .filter((unit) => ids.has(unit.id))
      .map((unit) => this.value(unit.hash));

    return { ...fields, elements };
  }

  private unitClocks(ids: readonly string[]) {
    const rows = this.database
      .prepare(
        "SELECT id,payload_hash FROM state_records WHERE collection='unitClocks' AND id IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(ids)) as SqlRow[];

    return Object.fromEntries(
      rows.map((row) => [String(row.id), this.value(String(row.payload_hash))]),
    );
  }

  readUnitProjection(
    authorization: ArtifactAuthorization,
    request: ArtifactUnitRequest,
  ): { current: unknown; projection: ArtifactUnitProjection } | undefined {
    this.assertReadCapacity();
    const kinds: unknown = JSON.parse(
      String(this.jsonRow("SELECT value FROM storage_meta WHERE key='collections'").value),
    );
    const currentShape =
      object(kinds) &&
      kinds.unitClocks === 'record' &&
      kinds.sharing === 'record' &&
      kinds.feedback === 'array' &&
      kinds.operations === 'array' &&
      kinds.sources === 'record' &&
      kinds.assets === 'record';

    if (!currentShape) {
      return;
    }

    const currentManifest = this.currentUnitManifest();

    if (
      !currentManifest ||
      currentManifest.units.length > request.maximumElements ||
      !this.withinContentBudget(currentManifest, request.maximumBytes)
    ) {
      return;
    }

    const currentFields = this.value(currentManifest.fields);
    if (!object(currentFields)) {
      return;
    }

    const ids = new Set(request.ids);
    const isCurrent = request.revision === authorization.artifact.revision;
    const current = {
      ...authorization,
      schemaVersion: 2,
      content: isCurrent
        ? this.unitContent(currentManifest, currentFields, ids)
        : { ...currentFields, elements: [] },
      history: [],
      feedback: [],
      operations: [],
      sources: {},
      assets: {},
      unitClocks: isCurrent ? this.unitClocks(request.ids) : {},
    };

    if (isCurrent) {
      return {
        current,
        projection: {
          snapshot: { artifact: authorization.artifact, content: current.content },
          order: request.includeOrder ? currentManifest.units.map((unit) => unit.id) : [],
        },
      };
    }

    const projection = this.historicalUnitProjection(authorization, request, ids);

    return projection && { current, projection };
  }

  private historicalUnitProjection(
    authorization: ArtifactAuthorization,
    request: ArtifactUnitRequest,
    ids: ReadonlySet<string>,
  ): ArtifactUnitProjection | undefined {
    if (this.incremental) {
      const row = this.incremental.revision(request.revision);
      if (!row) {
        return { snapshot: null, order: [] };
      }

      const snapshot = this.incremental.content(row);
      const saved = snapshot.units && { fields: snapshot.payload, units: snapshot.units };

      return this.projectHistoricalUnits(authorization, request, ids, row.artifact_json, saved);
    }

    const row = this.database
      .prepare(
        "SELECT artifact_json,content_hash FROM history_versions WHERE json_extract(artifact_json, '$.revision')=? ORDER BY revision LIMIT 1",
      )
      .get(request.revision);

    if (!row) {
      return { snapshot: null, order: [] };
    }

    return this.projectHistoricalUnits(
      authorization,
      request,
      ids,
      String(row.artifact_json),
      this.splitManifest(String(row.content_hash)),
    );
  }

  private projectHistoricalUnits(
    authorization: ArtifactAuthorization,
    request: ArtifactUnitRequest,
    ids: ReadonlySet<string>,
    metadata: string,
    saved: SplitContentManifest | undefined,
  ): ArtifactUnitProjection | undefined {
    const artifact: unknown = JSON.parse(metadata);
    const validArtifact =
      object(artifact) &&
      artifact.id === authorization.artifact.id &&
      artifact.revision === request.revision;

    if (!saved || !validArtifact || saved.units.length > request.maximumElements) {
      return;
    }

    const fields = request.includeFields ? this.value(saved.fields) : {};
    if (!object(fields)) {
      return;
    }

    return {
      snapshot: {
        artifact: artifact as unknown as ArtifactAuthorization['artifact'],
        content: this.unitContent(saved, fields, ids),
      },
      order: request.includeOrder ? saved.units.map((unit) => unit.id) : [],
    };
  }

  readState<C, A, S>(
    options: { maxExpandedBytes?: number; currentOnly?: boolean; shareContentUnits?: boolean } = {},
  ): ArtifactState<C, A, S> {
    this.assertReadCapacity();

    const metadata = new Map(
      (this.database.prepare('SELECT key,value FROM storage_meta').all() as SqlRow[]).map((row) => [
        String(row.key),
        String(row.value),
      ]),
    );

    if (!metadata.has('artifact') || !metadata.has('content')) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品数据库缺少当前内容。');
    }

    let expandedBytes = Array.from(metadata.entries()).reduce(
      (total, [key, value]) =>
        total + (DERIVED_METADATA_KEYS.has(key) ? 0 : Buffer.byteLength(value)),
      0,
    );
    const checkBudget = (bytes: number) => {
      expandedBytes += bytes;
      if (options.maxExpandedBytes !== undefined && expandedBytes > options.maxExpandedBytes) {
        throw new StudioError('TOO_LARGE', '作品展开内容超过导入容量。');
      }
    };

    const counted = new Set<string>();
    const content = (hash: string, identity: string) => {
      if (options.maxExpandedBytes !== undefined && !counted.has(identity)) {
        checkBudget(this.expandedContentBytes(hash));
        counted.add(identity);
      }

      return this.content(hash);
    };

    const payload = metadata.get('content')!;
    const snapshot = this.incremental && this.currentV2(payload, metadata.get('content_kind'));
    if (snapshot && options.maxExpandedBytes !== undefined) {
      checkBudget(this.packedContentBytes(snapshot));
    }

    const state: Record<string, unknown> = {
      schemaVersion: 2,
      artifact: JSON.parse(metadata.get('artifact')!),
      content: snapshot
        ? this.readCurrentV2Content(snapshot, options.shareContentUnits)
        : structuredClone(content(payload, 'current')),
    };
    const collections = new Map<string, { id: string; value: unknown }[]>();
    for (const row of this.database
      .prepare('SELECT collection,id,payload_hash FROM state_records ORDER BY collection,ordinal')
      .all() as SqlRow[]) {
      const key = String(row.collection);
      const records = collections.get(key) ?? [];
      if (options.maxExpandedBytes !== undefined) {
        checkBudget(this.expandedValueBytes(String(row.payload_hash)));
      }

      records.push({
        id: String(row.id),
        value: structuredClone(this.value(String(row.payload_hash))),
      });
      collections.set(key, records);
    }

    const kinds = JSON.parse(metadata.get('collections') ?? '{}') as Record<
      string,
      'array' | 'record' | 'value'
    >;

    for (const [key, kind] of Object.entries(kinds)) {
      const records = collections.get(key) ?? [];
      if (kind === 'array') {
        state[key] = records.map((record) => record.value);
      } else if (kind === 'record') {
        state[key] = Object.fromEntries(records.map((record) => [record.id, record.value]));
      } else {
        state[key] = records[0]?.value;
      }
    }

    state.history = this.readHistory<C>(options, checkBudget, content);

    return state as unknown as ArtifactState<C, A, S>;
  }

  private readHistory<C>(
    options: { maxExpandedBytes?: number; currentOnly?: boolean },
    checkBudget: (bytes: number) => void,
    content: (hash: string, identity: string) => unknown,
  ): SavedVersion<C>[] {
    if (options.currentOnly) {
      return [];
    }
    if (this.incremental) {
      return this.readIncrementalHistory<C>(
        this.incremental,
        checkBudget,
        options.maxExpandedBytes !== undefined,
      );
    }

    return (
      this.database
        .prepare(
          'SELECT id,entry_json,artifact_json,content_hash FROM history_versions ORDER BY revision',
        )
        .all() as SqlRow[]
    ).map((row) => {
      if (options.maxExpandedBytes !== undefined) {
        checkBudget(
          Buffer.byteLength(String(row.entry_json)) + Buffer.byteLength(String(row.artifact_json)),
        );
      }

      const hash = String(row.content_hash);
      const saved = {
        entry: JSON.parse(String(row.entry_json)),
        artifact: JSON.parse(String(row.artifact_json)),
      } as SavedVersion<C>;
      Object.defineProperty(saved, 'content', {
        enumerable: true,
        get: () => content(hash, String(row.id)),
      });
      this.historyContents.set(saved, hash);

      return saved;
    });
  }

  private readIncrementalHistory<C>(
    history: SqliteIncrementalHistory,
    checkBudget: (bytes: number) => void,
    bounded: boolean,
  ): SavedVersion<C>[] {
    return history.rows().map((row) => {
      if (bounded) {
        checkBudget(Buffer.byteLength(row.entry_json) + Buffer.byteLength(row.artifact_json));
      }

      const saved = {
        entry: JSON.parse(row.entry_json),
        artifact: JSON.parse(row.artifact_json),
      } as SavedVersion<C>;
      let loaded: { content: unknown } | undefined;
      Object.defineProperty(saved, 'content', {
        enumerable: true,
        get: () => {
          if (!loaded) {
            const snapshot = history.content(row);
            if (bounded) {
              checkBudget(this.packedContentBytes(snapshot));
            }
            loaded = { content: this.unpackContent(snapshot) };
          }

          return loaded.content;
        },
      });
      history.remember(saved);

      return saved;
    });
  }

  keepWritePageCacheForRetainedHistory(history: readonly object[]): void {
    if (
      !this.incremental &&
      history.length === MAX_RETAINED_HISTORY &&
      this.newHistoryCount(history) === 1
    ) {
      this.increaseWritePageCache();
    }
  }

  writeImportedState<C, A, S>(state: ArtifactState<C, A, S>): void {
    if (
      !this.database.isTransaction ||
      this.database.prepare('SELECT 1 FROM storage_meta LIMIT 1').get()
    ) {
      throw new Error('Archive import requires an empty database inside a write transaction.');
    }

    const drop = Object.keys(this.lookupIndexes)
      .map((index) => `DROP INDEX ${index};`)
      .join('\n');
    this.database.exec(drop);
    this.writeState(state);
    this.database.exec(this.createLookupIndexes());
  }

  writeState<C, A, S>(state: ArtifactState<C, A, S>): void {
    const restorePageCache =
      this.newHistoryCount(state.history) > 1 ? this.increaseWritePageCache() : undefined;

    const ownsTransaction = this.incremental && !this.database.isTransaction;
    try {
      if (ownsTransaction) {
        this.database.exec('BEGIN IMMEDIATE');
      }
      this.writeSnapshot(state);
      if (ownsTransaction) {
        this.database.exec('COMMIT');
      }
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }

      throw error;
    } finally {
      restorePageCache?.();
    }
  }

  private newHistoryCount(history: readonly object[]): number {
    return (
      this.incremental?.newCount(history) ??
      history.filter((saved) => !this.historyContents.has(saved)).length
    );
  }

  private increaseWritePageCache(): (() => void) | undefined {
    const previous = Number(this.database.prepare('PRAGMA cache_size').get()!.cache_size);
    if (!Number.isSafeInteger(previous)) {
      return;
    }

    const pageBytes =
      previous > 0 ? Number(this.database.prepare('PRAGMA page_size').get()!.page_size) : 0;
    const previousKiB = previous > 0 ? (previous * pageBytes) / 1024 : -previous;
    if (previousKiB >= WRITE_PAGE_CACHE_KIB) {
      return;
    }

    this.database.exec(`PRAGMA cache_size = -${WRITE_PAGE_CACHE_KIB}`);

    return () => this.database.exec(`PRAGMA cache_size = ${previous}`);
  }

  private writeSnapshot<C, A, S>(state: ArtifactState<C, A, S>): void {
    const obsolete = new Set<string>();
    const write = stateWriteCache();
    const meta = this.database.prepare(
      'INSERT INTO storage_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value',
    );
    const currentHash = this.writeContentAndHistory(state, write, obsolete, meta);
    meta.run('artifact', JSON.stringify(state.artifact));
    meta.run('content', currentHash);
    const kinds = this.writeCollections(state, obsolete, write);
    meta.run('collections', JSON.stringify(kinds));
    if (this.incremental) {
      this.enqueueGarbage(obsolete);
    } else {
      this.collectObsoletePayloads(currentHash, obsolete);
    }
  }

  private writeContentAndHistory<C, A, S>(
    state: ArtifactState<C, A, S>,
    write: StateWriteCache,
    obsolete: Set<string>,
    meta: ReturnType<DatabaseSync['prepare']>,
  ): string {
    if (!this.incremental) {
      const hash = this.putContent(state.content, write);
      const units = (this.manifest(hash).units ?? []).map((unit, ordinal) => ({
        ...unit,
        ordinal,
      }));
      this.writeCurrentUnits(units, obsolete);
      this.writeHistory(state.history, write);

      return hash;
    }

    if (state.history.length > MAX_RETAINED_HISTORY) {
      throw new StudioError('TOO_LARGE', '作品历史超过可保留的版本数。');
    }

    const before = this.currentUnits();
    const storedHashes =
      this.sharedUnitHashes && new Map(before.map((unit) => [unit.id, unit.hash]));
    const current = this.packContent(state.content, write, storedHashes);
    const previousPayload = this.database
      .prepare("SELECT value FROM storage_meta WHERE key='content'")
      .get()?.value;

    if (typeof previousPayload === 'string' && previousPayload !== current.payload) {
      obsolete.add(previousPayload);
    }

    meta.run('content_kind', current.units ? 'split' : 'value');
    const units = current.units ? orderUnits(current.units, before) : [];
    this.writeProjectedUnits(units, before, state.content, obsolete);
    this.incremental.write(
      state.history,
      (content) => this.packContent(content, write, storedHashes),
      obsolete,
    );
    this.writeLocalUnitBudget(state, current, units, meta);

    return current.payload;
  }

  private writeLocalUnitBudget(
    state: ArtifactState<unknown>,
    current: PackedContent,
    units: readonly OrderedUnitReference[],
    meta: ReturnType<DatabaseSync['prepare']>,
  ): void {
    const budget = current.units && captureLocalUnitBudget(state, current.payload);
    const head = budget && this.incremental?.latest();
    if (budget && head && localHeadMatches(head, budget)) {
      const historical = this.incremental?.content(head).units;
      const matches =
        historical?.length === units.length &&
        units.every(({ id, hash, ordinal }, index) => {
          const prior = historical[index];

          return prior?.id === id && prior.hash === hash && prior.ordinal === ordinal;
        });

      if (matches) {
        meta.run(LOCAL_UNIT_BUDGET, JSON.stringify(budget));

        return;
      }
    }

    this.database.prepare('DELETE FROM storage_meta WHERE key=?').run(LOCAL_UNIT_BUDGET);
  }

  private writeProjectedUnits(
    units: readonly OrderedUnitReference[],
    previous: readonly OrderedUnitReference[],
    content: unknown,
    obsolete: Set<string>,
  ): void {
    const before = new Map(previous.map((unit) => [unit.id, unit]));
    const items = object(content) && Array.isArray(content.elements) ? content.elements : [];
    const byId = new Map(items.filter(object).map((item) => [item.id, item]));
    const storeUnit = this.database.prepare(
      'INSERT INTO current_units(id,ordinal,payload_hash,scene_json,scene_hash) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,payload_hash=excluded.payload_hash,scene_json=excluded.scene_json,scene_hash=excluded.scene_hash',
    );
    const reorder = this.database.prepare('UPDATE current_units SET ordinal=? WHERE id=?');
    for (const unit of units) {
      const old = before.get(unit.id);
      if (!old || old.hash !== unit.hash) {
        if (old) {
          obsolete.add(old.hash);
        }

        const value = byId.get(unit.id);
        const scene = isBoardElementProjection(value)
          ? JSON.stringify(projectBoardSceneUnit(value))
          : null;
        const digest = scene === null ? null : this.hash(unit.hash + '\\n' + scene);
        storeUnit.run(unit.id, unit.ordinal, unit.hash, scene, digest);
      } else if (old.ordinal !== unit.ordinal) {
        reorder.run(unit.ordinal, unit.id);
      }
      before.delete(unit.id);
    }

    this.deleteCurrentUnits(before, obsolete);
  }

  private writeCurrentUnits(
    units: readonly OrderedUnitReference[],
    obsolete: Set<string>,
    previous = this.currentUnits(),
  ): void {
    const oldUnits = new Map(previous.map((unit) => [unit.id, unit]));
    const setUnit = this.database.prepare(
      'INSERT INTO current_units(id,ordinal,payload_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,payload_hash=excluded.payload_hash WHERE ordinal<>excluded.ordinal OR payload_hash<>excluded.payload_hash',
    );

    for (const unit of units) {
      const old = oldUnits.get(unit.id);
      if (old && old.hash !== unit.hash) {
        obsolete.add(old.hash);
      }
      if (!old || old.hash !== unit.hash || old.ordinal !== unit.ordinal) {
        setUnit.run(unit.id, unit.ordinal, unit.hash);
      }

      oldUnits.delete(unit.id);
    }

    this.deleteCurrentUnits(oldUnits, obsolete);
  }

  private deleteCurrentUnits(
    remaining: ReadonlyMap<string, OrderedUnitReference>,
    obsolete: Set<string>,
  ): void {
    const remove = this.database.prepare('DELETE FROM current_units WHERE id=?');
    for (const [id, old] of remaining) {
      obsolete.add(old.hash);
      remove.run(id);
    }
  }

  private writeHistory<C>(history: SavedVersion<C>[], write: StateWriteCache): void {
    const retained = new Set(history.map((saved) => saved.entry.id));
    for (const row of this.database.prepare('SELECT id FROM history_versions').all() as SqlRow[]) {
      if (!retained.has(String(row.id))) {
        this.database.prepare('DELETE FROM history_versions WHERE id=?').run(String(row.id));
      }
    }

    const setHistory = this.database.prepare(
      'INSERT INTO history_versions(id,revision,entry_json,artifact_json,content_hash) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,entry_json=excluded.entry_json,artifact_json=excluded.artifact_json,content_hash=excluded.content_hash WHERE entry_json<>excluded.entry_json OR artifact_json<>excluded.artifact_json OR content_hash<>excluded.content_hash',
    );

    for (const saved of history) {
      const hash = this.historyContents.get(saved) ?? this.putContent(saved.content, write);
      setHistory.run(
        saved.entry.id,
        saved.entry.revision,
        JSON.stringify(saved.entry),
        JSON.stringify(saved.artifact),
        hash,
      );
    }
  }

  private writeCollections<C, A, S>(
    state: ArtifactState<C, A, S>,
    obsolete: Set<string>,
    write: StateWriteCache,
  ): Record<string, CollectionKind> {
    const oldRecords = new Map(
      (
        this.database
          .prepare('SELECT collection,id,ordinal,payload_hash FROM state_records')
          .all() as SqlRow[]
      ).map((row) => [JSON.stringify([row.collection, row.id]), row]),
    );
    const setRecord = this.database.prepare(
      'INSERT INTO state_records(collection,id,ordinal,payload_hash) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET ordinal=excluded.ordinal,payload_hash=excluded.payload_hash WHERE ordinal<>excluded.ordinal OR payload_hash<>excluded.payload_hash',
    );
    const kinds: Record<string, CollectionKind> = {};
    for (const [key, value] of Object.entries(state)) {
      if (
        ['schemaVersion', 'artifact', 'content', 'history'].includes(key) ||
        value === undefined
      ) {
        continue;
      }

      const { kind, records } = describeCollection(value);
      kinds[key] = kind;
      this.writeCollectionRecords(key, records, oldRecords, obsolete, setRecord, write);
    }

    for (const [key, row] of oldRecords) {
      const [collection, id] = JSON.parse(key) as string[];
      obsolete.add(String(row.payload_hash));
      this.database
        .prepare('DELETE FROM state_records WHERE collection=? AND id=?')
        .run(collection!, id!);
    }

    return kinds;
  }

  private writeCollectionRecords(
    key: string,
    records: CollectionRecord[],
    oldRecords: Map<string, SqlRow>,
    obsolete: Set<string>,
    setRecord: ReturnType<DatabaseSync['prepare']>,
    write: StateWriteCache,
  ): void {
    const previous = Array.from(oldRecords.values())
      .filter((row) => row.collection === key)
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
    const retainedIds = records
      .map(([id]) => id)
      .filter((id) => oldRecords.has(JSON.stringify([key, id])));
    const newIds = new Set(records.map(([id]) => id));
    const stableOrder =
      JSON.stringify(previous.filter((row) => newIds.has(String(row.id))).map((row) => row.id)) ===
        JSON.stringify(retainedIds) &&
      records.every(([id], index) =>
        index < retainedIds.length
          ? oldRecords.has(JSON.stringify([key, id]))
          : !oldRecords.has(JSON.stringify([key, id])),
      );
    let nextOrdinal =
      previous.reduce((maximum, row) => Math.max(maximum, Number(row.ordinal)), -1) + 1;

    for (const [index, [id, record]] of records.entries()) {
      const recordKey = JSON.stringify([key, id]);
      const hash = this.putValue(record, write);
      const old = oldRecords.get(recordKey);
      let ordinal = index;
      if (stableOrder) {
        ordinal = old ? Number(old.ordinal) : nextOrdinal++;
      }
      if (old && old.payload_hash !== hash) {
        obsolete.add(String(old.payload_hash));
      }
      if (!old || old.payload_hash !== hash || Number(old.ordinal) !== ordinal) {
        setRecord.run(key, id, ordinal, hash);
      }

      oldRecords.delete(recordKey);
    }
  }

  get needsMaintenance(): boolean {
    if (!this.incremental) {
      return false;
    }

    return (
      this.incremental.needsMaintenance ||
      Boolean(this.database.prepare('SELECT 1 FROM storage_gc_queue LIMIT 1').get())
    );
  }

  maintainStorage(): boolean {
    if (!this.incremental) {
      return false;
    }
    if (!this.database.isTransaction) {
      throw new Error('Storage maintenance requires an active write transaction.');
    }

    const obsolete = new Set<string>();
    this.incremental.maintain(obsolete);
    this.enqueueGarbage(obsolete);
    this.collectGarbageBatch();

    return this.needsMaintenance;
  }

  private enqueueGarbage(hashes: Iterable<string>): void {
    const insert = this.database.prepare('INSERT OR IGNORE INTO storage_gc_queue(hash) VALUES(?)');
    const referenced = this.incrementalReferences();
    for (const hash of hashes) {
      if (!referenced.get(hash)) {
        insert.run(hash);
      }
    }
  }

  private collectGarbageBatch(): void {
    const queued = this.database
      .prepare('SELECT hash FROM storage_gc_queue ORDER BY hash LIMIT ?')
      .all(GC_BATCH_SIZE);
    const erase = this.database.prepare('DELETE FROM storage_gc_queue WHERE hash=?');
    const children = this.database.prepare(
      'SELECT child_hash FROM payload_links WHERE parent_hash=?',
    );
    const deletePayload = this.database.prepare('DELETE FROM payload_blobs WHERE hash=?');
    const referenced = this.incrementalReferences();

    for (const row of queued) {
      const hash = String(row.hash);
      erase.run(hash);
      if (referenced.get(hash)) {
        continue;
      }

      const nested = children.all(hash).map((child) => String(child.child_hash));
      deletePayload.run(hash);
      this.enqueueGarbage(nested);
      this.values.delete(hash);
      this.costs.delete(hash);
    }
  }

  private incrementalReferences() {
    return this.database.prepare(`
      SELECT 1 WHERE
        EXISTS(SELECT 1 FROM storage_meta WHERE key='content' AND value=?1)
        OR EXISTS(SELECT 1 FROM current_units WHERE payload_hash=?1)
        OR EXISTS(SELECT 1 FROM state_records WHERE payload_hash=?1)
        OR EXISTS(SELECT 1 FROM history_versions WHERE payload_hash=?1)
        OR EXISTS(SELECT 1 FROM history_checkpoint_units WHERE payload_hash=?1)
        OR EXISTS(SELECT 1 FROM history_unit_changes WHERE payload_hash=?1)
        OR EXISTS(SELECT 1 FROM payload_links WHERE child_hash=?1)
    `);
  }

  private collectObsoletePayloads(currentHash: string, obsolete: Set<string>): void {
    const obsoleteManifests = this.database
      .prepare(
        'SELECT hash FROM content_manifests WHERE hash<>? AND hash NOT IN (SELECT content_hash FROM history_versions)',
      )
      .all(currentHash) as SqlRow[];
    const currentPayloads = new Set<string>();
    if (obsoleteManifests.length) {
      const linkedPayloads = this.database.prepare(
        'SELECT payload_hash FROM content_payloads WHERE manifest_hash=?',
      );
      const deleteManifest = this.database.prepare('DELETE FROM content_manifests WHERE hash=?');
      for (const row of linkedPayloads.all(currentHash)) {
        currentPayloads.add(String(row.payload_hash));
      }

      for (const row of obsoleteManifests) {
        const manifest = String(row.hash);
        for (const child of linkedPayloads.all(manifest)) {
          obsolete.add(String(child.payload_hash));
        }

        deleteManifest.run(manifest);
      }
    }

    const referenced = this.database.prepare(
      'SELECT 1 AS present WHERE EXISTS(SELECT 1 FROM content_payloads WHERE payload_hash=?) OR EXISTS(SELECT 1 FROM current_units WHERE payload_hash=?) OR EXISTS(SELECT 1 FROM state_records WHERE payload_hash=?) OR EXISTS(SELECT 1 FROM payload_links WHERE child_hash=?)',
    );

    while (obsolete.size) {
      const hash = obsolete.values().next().value!;
      obsolete.delete(hash);
      if (currentPayloads.has(hash) || referenced.get(hash, hash, hash, hash)) {
        continue;
      }

      for (const child of this.database
        .prepare('SELECT child_hash FROM payload_links WHERE parent_hash=?')
        .all(hash) as SqlRow[]) {
        obsolete.add(String(child.child_hash));
      }

      this.database.prepare('DELETE FROM payload_blobs WHERE hash=?').run(hash);
    }
  }
}
