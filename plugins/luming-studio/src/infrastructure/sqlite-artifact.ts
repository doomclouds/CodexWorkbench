import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ArtifactAuthorization,
  ArtifactState,
  ArtifactUnitProjection,
  ArtifactUnitRequest,
  SavedVersion,
} from '../core/ports/studio-repository.js';
import { isRecord as object } from '../shared/is-record.js';
import { StudioError } from '../shared/studio-error.js';

export const ARTIFACT_DATABASE_VERSION = 1;
export const ARTIFACT_DATABASE_APPLICATION_ID = 0x41535455;
const CONTENT_LINK_BATCH_SIZE = 256;
const MAX_RETAINED_HISTORY = 200;
const WRITE_PAGE_CACHE_KIB = 32 * 1024;
const READ_PAYLOAD = 'SELECT json FROM payload_blobs WHERE hash=?';
const FIND_PAYLOAD = 'SELECT 1 AS present FROM payload_blobs WHERE hash=?';
const LOOKUP_INDEXES = {
  payload_links_child: 'payload_links(child_hash)',
  content_payloads_payload: 'content_payloads(payload_hash)',
  current_units_payload: 'current_units(payload_hash)',
  state_records_payload: 'state_records(payload_hash)',
};
const CREATE_LOOKUP_INDEXES = Object.entries(LOOKUP_INDEXES)
  .map(([name, columns]) => `CREATE INDEX ${name} ON ${columns};`)
  .join('\n');
const DROP_LOOKUP_INDEXES = Object.keys(LOOKUP_INDEXES)
  .map((name) => `DROP INDEX ${name};`)
  .join('\n');
const ENCODED_STRING_REFERENCE_BYTES = Buffer.byteLength(JSON.stringify({ blob: '0'.repeat(64) }));

type EncodedObject = { object: [string, Encoded][] };
type Encoded = null | boolean | number | string | Encoded[] | EncodedObject | { blob: string };
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
  manifests: Set<string>;
  contentLinks: Map<number, ReturnType<DatabaseSync['prepare']>>;
}
type SqlRow = Record<string, string | number | bigint | Uint8Array | null>;
type CollectionKind = 'array' | 'record' | 'value';
type CollectionRecord = readonly [id: string, value: unknown];

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

export class SqliteArtifactRepository {
  readonly database: DatabaseSync;
  private readonly values = new Map<string, unknown>();
  private readonly manifests = new Map<string, ContentManifest>();
  private readonly costs = new Map<string, number>();
  private readonly historyContents = new WeakMap<object, string>();
  private readPayload?: ReturnType<DatabaseSync['prepare']>;
  private findPayload?: ReturnType<DatabaseSync['prepare']>;
  constructor(file: string, create = false) {
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
      if (
        create &&
        missingFormat &&
        !this.database
          .prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1")
          .get()
      ) {
        this.initialize();
      } else if (
        application !== ARTIFACT_DATABASE_APPLICATION_ID ||
        version !== ARTIFACT_DATABASE_VERSION
      ) {
        throw new StudioError('UNSUPPORTED_STORAGE', '此作品数据库版本暂不受支持。');
      }

      this.database.exec('PRAGMA trusted_schema=OFF');
      const tables = new Set([
        'storage_meta',
        'payload_blobs',
        'payload_links',
        'content_manifests',
        'content_payloads',
        'current_units',
        'history_versions',
        'state_records',
      ]);

      for (const row of this.database
        .prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
        .all() as SqlRow[]) {
        if (row.type === 'table' && tables.delete(String(row.name))) {
          continue;
        }
        if (row.type === 'index' && Object.hasOwn(LOOKUP_INDEXES, String(row.name))) {
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

      if (create) {
        this.database.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON');
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }
  private initialize(): void {
    this.database.exec(`PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      BEGIN IMMEDIATE;
      CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE payload_blobs (hash TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE payload_links (parent_hash TEXT NOT NULL REFERENCES payload_blobs(hash) ON DELETE CASCADE, child_hash TEXT NOT NULL REFERENCES payload_blobs(hash), PRIMARY KEY(parent_hash,child_hash)) WITHOUT ROWID;
      CREATE TABLE content_manifests (hash TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE content_payloads (manifest_hash TEXT NOT NULL REFERENCES content_manifests(hash) ON DELETE CASCADE, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash), PRIMARY KEY(manifest_hash,payload_hash)) WITHOUT ROWID;
      CREATE TABLE current_units (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash)) WITHOUT ROWID;
      CREATE TABLE history_versions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, entry_json TEXT NOT NULL, artifact_json TEXT NOT NULL, content_hash TEXT NOT NULL REFERENCES content_manifests(hash)) WITHOUT ROWID;
      CREATE TABLE state_records (collection TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash), PRIMARY KEY(collection,id)) WITHOUT ROWID;
      ${CREATE_LOOKUP_INDEXES}
      PRAGMA application_id=${ARTIFACT_DATABASE_APPLICATION_ID};
      PRAGMA user_version=${ARTIFACT_DATABASE_VERSION};
      COMMIT;`);
  }
  close(): void {
    this.database.close();
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
  private putBlob(json: string, write: StateWriteCache): string {
    const hash = this.hash(json);
    if (!write.payloads.has(hash)) {
      const find = (this.findPayload ??= this.database.prepare(FIND_PAYLOAD));
      if (!find.get(hash)) {
        this.database.prepare('INSERT INTO payload_blobs(hash,json) VALUES(?,?)').run(hash, json);
      }

      write.payloads.add(hash);
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
        .map(([key, item]) => [key, this.encode(item, references, write)]),
    };
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
    const hash = this.putBlob(JSON.stringify(this.encode(value, references, write)), write);
    if (references.size) {
      const link = this.database.prepare(
        'INSERT OR IGNORE INTO payload_links(parent_hash,child_hash) VALUES(?,?)',
      );

      for (const child of references) {
        link.run(hash, child);
      }
    }
    if (identity) {
      write.values.set(identity, hash);
    }

    return hash;
  }
  private value(hash: string): unknown {
    if (this.values.has(hash)) {
      return this.values.get(hash);
    }

    const row = this.jsonRow(READ_PAYLOAD, hash);
    if (this.hash(String(row.json)) !== hash) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品内容校验失败。');
    }

    const parsed = this.decode(JSON.parse(String(row.json)) as Encoded);
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
  private expandedValueBytes(hash: string, visiting = new Set<string>()): number {
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

    const bytes = count(JSON.parse(raw) as Encoded, 0);
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
  private putContent(content: unknown, write: StateWriteCache): string {
    const identity = content !== null && typeof content === 'object' ? content : undefined;
    const cached = identity && write.contents.get(identity);
    if (cached) {
      return cached;
    }

    let manifest: ContentManifest;
    if (
      object(content) &&
      Array.isArray(content.elements) &&
      content.elements.every((element) => object(element) && typeof element.id === 'string')
    ) {
      const { elements, ...fields } = content;
      manifest = {
        fields: this.putValue(fields, write),
        units: (elements as Record<string, unknown>[]).map((element) => ({
          id: String(element.id),
          hash: this.putValue(element, write),
        })),
      };
    } else {
      manifest = { value: this.putValue(content, write) };
    }

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

  private withinContentBudget(manifest: SplitContentManifest, maximum: number): boolean {
    const hashes = [manifest.fields, ...manifest.units.map((unit) => unit.hash)];
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

    const currentManifest = this.splitManifest(
      String(this.jsonRow("SELECT value FROM storage_meta WHERE key='content'").value),
    );

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
    const row = this.database
      .prepare(
        "SELECT artifact_json,content_hash FROM history_versions WHERE json_extract(artifact_json, '$.revision')=? ORDER BY revision LIMIT 1",
      )
      .get(request.revision);

    if (!row) {
      return { snapshot: null, order: [] };
    }

    const artifact: unknown = JSON.parse(String(row.artifact_json));
    const saved = this.splitManifest(String(row.content_hash));
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

  readState<C, A, S>(options: { maxExpandedBytes?: number } = {}): ArtifactState<C, A, S> {
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

    let expandedBytes = Array.from(metadata.values()).reduce(
      (total, value) => total + Buffer.byteLength(value),
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

    const state: Record<string, unknown> = {
      schemaVersion: 2,
      artifact: JSON.parse(metadata.get('artifact')!),
      content: structuredClone(content(metadata.get('content')!, 'current')),
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

    state.history = (
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

    return state as unknown as ArtifactState<C, A, S>;
  }
  keepWritePageCacheForRetainedHistory(history: readonly object[]): void {
    if (history.length === MAX_RETAINED_HISTORY && this.newHistoryCount(history) === 1) {
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

    this.database.exec(DROP_LOOKUP_INDEXES);
    this.writeState(state);
    this.database.exec(CREATE_LOOKUP_INDEXES);
  }

  writeState<C, A, S>(state: ArtifactState<C, A, S>): void {
    const restorePageCache =
      this.newHistoryCount(state.history) > 1 ? this.increaseWritePageCache() : undefined;

    try {
      this.writeSnapshot(state);
    } finally {
      restorePageCache?.();
    }
  }

  private newHistoryCount(history: readonly object[]): number {
    return history.filter((saved) => !this.historyContents.has(saved)).length;
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
    const write: StateWriteCache = {
      contents: new WeakMap(),
      values: new WeakMap(),
      strings: new Map(),
      payloads: new Set(),
      manifests: new Set(),
      contentLinks: new Map(),
    };
    const currentHash = this.putContent(state.content, write);
    const manifest = this.manifest(currentHash);
    const meta = this.database.prepare(
      'INSERT INTO storage_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value',
    );
    meta.run('artifact', JSON.stringify(state.artifact));
    meta.run('content', currentHash);
    this.writeCurrentUnits(manifest, obsolete);
    this.writeHistory(state.history, write);
    const kinds = this.writeCollections(state, obsolete, write);
    meta.run('collections', JSON.stringify(kinds));
    this.collectObsoletePayloads(currentHash, obsolete);
  }

  private writeCurrentUnits(manifest: ContentManifest, obsolete: Set<string>): void {
    const oldUnits = new Map(
      (
        this.database.prepare('SELECT id,ordinal,payload_hash FROM current_units').all() as SqlRow[]
      ).map((row) => [String(row.id), row]),
    );
    const setUnit = this.database.prepare(
      'INSERT INTO current_units(id,ordinal,payload_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,payload_hash=excluded.payload_hash WHERE ordinal<>excluded.ordinal OR payload_hash<>excluded.payload_hash',
    );

    for (const [ordinal, unit] of (manifest.units ?? []).entries()) {
      const old = oldUnits.get(unit.id);
      if (old && old.payload_hash !== unit.hash) {
        obsolete.add(String(old.payload_hash));
      }
      if (!old || old.payload_hash !== unit.hash || Number(old.ordinal) !== ordinal) {
        setUnit.run(unit.id, ordinal, unit.hash);
      }

      oldUnits.delete(unit.id);
    }

    for (const [id, old] of oldUnits) {
      obsolete.add(String(old.payload_hash));
      this.database.prepare('DELETE FROM current_units WHERE id=?').run(id);
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
