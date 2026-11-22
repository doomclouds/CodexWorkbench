import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { SavedVersion } from '../core/ports/studio-repository.js';
import {
  CHECKPOINT_WORK_KEY,
  corruptCheckpoint as corrupt,
  readCheckpointWork,
  type CheckpointWork,
} from './sqlite-checkpoint-work.js';
import {
  orderUnits,
  type OrderedUnitReference,
  type UnitReference,
} from './sqlite-incremental-order.js';

export interface PackedContent {
  payload: string;
  units?: UnitReference[];
}

export interface OrderedContent {
  payload: string;
  units?: OrderedUnitReference[];
}

export interface HistoryVersionRow {
  id: string;
  revision: number;
  entry_json: string;
  artifact_json: string;
  payload_hash: string;
  split: number;
}

const CHECKPOINT_INTERVAL = 20;
const CHECKPOINT_BATCH_SIZE = 256;
const MAINTENANCE_ROW_BUDGET = 128;
const CHECKPOINT_STEP_ROWS = MAINTENANCE_ROW_BUDGET - 1;
const RETAINED_REVISIONS = 200;
const VERSION_COLUMNS = 'id,revision,entry_json,artifact_json,payload_hash,split';
export const INCREMENTAL_TABLES = [
  'history_checkpoints',
  'history_checkpoint_units',
  'history_unit_changes',
  'storage_gc_queue',
];
export const INCREMENTAL_INDEXES = {
  history_versions_payload: 'history_versions(payload_hash)',
  history_checkpoint_payload: 'history_checkpoint_units(payload_hash)',
  history_changes_payload: 'history_unit_changes(payload_hash)',
};
export const INCREMENTAL_SCHEMA = `
  CREATE TABLE history_versions (
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, entry_json TEXT NOT NULL,
    artifact_json TEXT NOT NULL, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash),
    split INTEGER NOT NULL CHECK(split IN (0,1))
  ) WITHOUT ROWID;
  CREATE TABLE history_checkpoints (revision INTEGER PRIMARY KEY);
  CREATE TABLE history_checkpoint_units (
    revision INTEGER NOT NULL REFERENCES history_checkpoints(revision) ON DELETE CASCADE,
    id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload_hash TEXT NOT NULL REFERENCES payload_blobs(hash),
    PRIMARY KEY(revision,id)
  ) WITHOUT ROWID;
  CREATE TABLE history_unit_changes (
    revision INTEGER NOT NULL, id TEXT NOT NULL, ordinal INTEGER,
    payload_hash TEXT REFERENCES payload_blobs(hash),
    CHECK((ordinal IS NULL) = (payload_hash IS NULL)),
    PRIMARY KEY(revision,id)
  ) WITHOUT ROWID;
  CREATE TABLE storage_gc_queue (hash TEXT PRIMARY KEY) WITHOUT ROWID;
`;

function orderedReference(row: { id: unknown; payload_hash: unknown; ordinal: unknown }) {
  const ordinal = row.ordinal;
  const validOrdinal = typeof ordinal === 'number' && Number.isSafeInteger(ordinal);
  if (!validOrdinal || typeof row.id !== 'string' || typeof row.payload_hash !== 'string') {
    throw corrupt();
  }

  return { id: row.id, hash: row.payload_hash, ordinal };
}

function sortedReferences(units: Iterable<OrderedUnitReference>): OrderedUnitReference[] {
  const sorted = [...units].sort((left, right) => left.ordinal - right.ordinal);
  if (sorted.some((unit, index) => unit.ordinal === sorted[index - 1]?.ordinal)) {
    throw corrupt();
  }

  return sorted;
}

export class SqliteIncrementalHistory {
  private readonly known = new WeakSet<object>();
  constructor(private readonly database: DatabaseSync) {}

  rows(): HistoryVersionRow[] {
    return this.database
      .prepare(`SELECT ${VERSION_COLUMNS} FROM history_versions ORDER BY revision`)
      .all() as unknown as HistoryVersionRow[];
  }

  revision(revision: number): HistoryVersionRow | undefined {
    return this.database
      .prepare(`SELECT ${VERSION_COLUMNS} FROM history_versions WHERE revision=?`)
      .get(revision) as unknown as HistoryVersionRow | undefined;
  }

  latest(): HistoryVersionRow | undefined {
    return this.database
      .prepare(`SELECT ${VERSION_COLUMNS} FROM history_versions ORDER BY revision DESC LIMIT 1`)
      .get() as unknown as HistoryVersionRow | undefined;
  }

  appendUnit(
    saved: Pick<SavedVersion<unknown>, 'artifact' | 'entry'>,
    payload: string,
    unit: OrderedUnitReference | undefined,
    obsolete: Set<string>,
  ): void {
    const { revision } = saved.entry;
    this.database
      .prepare(`INSERT INTO history_versions(${VERSION_COLUMNS}) VALUES(?,?,?,?,?,1)`)
      .run(
        saved.entry.id,
        revision,
        JSON.stringify(saved.entry),
        JSON.stringify(saved.artifact),
        payload,
      );

    if (unit) {
      this.database
        .prepare('INSERT INTO history_unit_changes VALUES(?,?,?,?)')
        .run(revision, unit.id, unit.ordinal, unit.hash);
    }

    const oldest = this.database
      .prepare('SELECT revision FROM history_versions ORDER BY revision DESC LIMIT 1 OFFSET ?')
      .get(RETAINED_REVISIONS - 1);

    if (typeof oldest?.revision === 'number') {
      this.removeBefore(oldest.revision, obsolete);
    }
  }

  remember(saved: object): void {
    this.known.add(saved);
  }

  newCount(snapshots: readonly object[]): number {
    return snapshots.filter((saved) => !this.known.has(saved)).length;
  }

  content(row: HistoryVersionRow): OrderedContent {
    return {
      payload: row.payload_hash,
      ...(row.split ? { units: this.unitsAt(row.revision) } : {}),
    };
  }

  unitAt(revision: number, id: string): OrderedUnitReference | undefined {
    const anchor = this.anchorAt(revision);
    if (anchor === undefined) {
      throw corrupt();
    }

    const changed = this.database
      .prepare(
        'SELECT id,ordinal,payload_hash FROM history_unit_changes WHERE id=? AND revision>? AND revision<=? ORDER BY revision DESC LIMIT 1',
      )
      .get(id, anchor, revision);
    const row =
      changed ??
      this.database
        .prepare(
          'SELECT id,ordinal,payload_hash FROM history_checkpoint_units WHERE revision=? AND id=?',
        )
        .get(anchor, id);

    if (!row || row.payload_hash === null) {
      return;
    }

    return orderedReference({ id: row.id, ordinal: row.ordinal, payload_hash: row.payload_hash });
  }

  private anchorAt(revision: number): number | undefined {
    const row = this.database
      .prepare(`
        SELECT max(checkpoint.revision) AS anchor FROM history_checkpoints AS checkpoint
        WHERE checkpoint.revision<=? AND NOT EXISTS(
          SELECT 1 FROM storage_meta WHERE key=? AND (
            json_type(value,'$.revision') IS NOT 'integer'
            OR json_extract(value,'$.revision') NOT BETWEEN 0 AND ?
            OR json_extract(value,'$.revision')=checkpoint.revision
          )
        )
      `)
      .get(revision, CHECKPOINT_WORK_KEY, Number.MAX_SAFE_INTEGER);

    return typeof row?.anchor === 'number' ? row.anchor : undefined;
  }

  private checkpointUnits(revision: number) {
    return this.database
      .prepare('SELECT id,ordinal,payload_hash FROM history_checkpoint_units WHERE revision=?')
      .all(revision)
      .map((row) =>
        orderedReference({ id: row.id, ordinal: row.ordinal, payload_hash: row.payload_hash }),
      );
  }

  private unitsAt(revision: number): OrderedUnitReference[] {
    const anchor = this.anchorAt(revision);
    if (anchor === undefined) {
      throw corrupt();
    }

    const units = new Map(this.checkpointUnits(anchor).map((unit) => [unit.id, unit]));
    const changes = this.database
      .prepare(
        'SELECT id,ordinal,payload_hash FROM history_unit_changes WHERE revision>? AND revision<=? ORDER BY revision,id',
      )
      .all(anchor, revision);

    for (const row of changes) {
      if (row.payload_hash === null) {
        units.delete(String(row.id));
      } else {
        const unit = orderedReference({
          id: row.id,
          ordinal: row.ordinal,
          payload_hash: row.payload_hash,
        });
        units.set(unit.id, unit);
      }
    }

    return sortedReferences(units.values());
  }

  private writeCheckpoint(revision: number, units: readonly OrderedUnitReference[]): void {
    this.database.prepare('INSERT INTO history_checkpoints VALUES(?)').run(revision);
    this.writeCheckpointUnits(revision, units);
  }

  private writeCheckpointUnits(revision: number, units: readonly OrderedUnitReference[]): void {
    const statements = new Map<number, StatementSync>();
    for (let offset = 0; offset < units.length; offset += CHECKPOINT_BATCH_SIZE) {
      const batch = units.slice(offset, offset + CHECKPOINT_BATCH_SIZE);
      let insert = statements.get(batch.length);
      if (!insert) {
        const placeholders = batch.map(() => '(?1,?,?,?)').join(',');
        insert = this.database.prepare(
          `INSERT INTO history_checkpoint_units VALUES${placeholders}`,
        );
        statements.set(batch.length, insert);
      }

      insert.run(revision, ...batch.flatMap(({ id, ordinal, hash }) => [id, ordinal, hash]));
    }
  }

  private writeChanges(
    revision: number,
    previous: readonly OrderedUnitReference[],
    next: readonly OrderedUnitReference[],
  ): void {
    const before = new Map(previous.map((unit) => [unit.id, unit]));
    const insert = this.database.prepare('INSERT INTO history_unit_changes VALUES(?,?,?,?)');
    for (const unit of next) {
      const old = before.get(unit.id);
      if (!old || old.ordinal !== unit.ordinal || old.hash !== unit.hash) {
        insert.run(revision, unit.id, unit.ordinal, unit.hash);
      }
      before.delete(unit.id);
    }
    for (const id of before.keys()) {
      insert.run(revision, id, null, null);
    }
  }

  private removeBefore(revision: number, obsolete: Set<string>): void {
    const expire = this.database.prepare(
      'DELETE FROM history_versions WHERE revision<? RETURNING payload_hash',
    );

    for (const row of expire.all(revision)) {
      obsolete.add(String(row.payload_hash));
    }
  }

  private clear(obsolete: Set<string>): void {
    const candidates = this.database.prepare(`
      SELECT payload_hash FROM history_versions
      UNION SELECT payload_hash FROM history_checkpoint_units
      UNION SELECT payload_hash FROM history_unit_changes WHERE payload_hash IS NOT NULL
    `);

    for (const row of candidates.all()) {
      obsolete.add(String(row.payload_hash));
    }

    this.database.exec(
      'DELETE FROM history_versions; DELETE FROM history_checkpoints; DELETE FROM history_unit_changes;',
    );
    this.clearWork();
  }

  private appendable<C>(
    kept: readonly SavedVersion<C>[],
    incoming: readonly SavedVersion<C>[],
    rows: readonly HistoryVersionRow[],
  ): boolean {
    const tail = rows.slice(rows.length - kept.length);
    if (tail.length !== kept.length || (rows.length && !kept.length)) {
      return false;
    }
    if (incoming.length && incoming[0]!.entry.revision <= (rows.at(-1)?.revision ?? -1)) {
      return false;
    }

    return kept.every((saved, index) => {
      const row = tail[index]!;
      return (
        this.known.has(saved) &&
        row.id === saved.entry.id &&
        row.entry_json === JSON.stringify(saved.entry) &&
        row.artifact_json === JSON.stringify(saved.artifact)
      );
    });
  }

  write<C>(
    history: readonly SavedVersion<C>[],
    pack: (content: C) => PackedContent,
    obsolete: Set<string>,
  ): void {
    const versions = [...history].sort((left, right) => left.entry.revision - right.entry.revision);
    const rows = this.rows();
    const latest = rows.at(-1);
    const kept = versions.filter((saved) => saved.entry.revision <= (latest?.revision ?? -1));
    const incoming = versions.slice(kept.length);
    const append = this.appendable(kept, incoming, rows);
    const additions = (append ? incoming : versions).map((saved) => ({
      saved,
      packed: pack(saved.content),
    }));

    if (!append) {
      this.clear(obsolete);
    } else if (versions.length) {
      this.removeBefore(versions[0]!.entry.revision, obsolete);
    }

    if (!additions.length) {
      return;
    }

    const initial = append && latest ? this.content(latest) : undefined;
    this.writeAdditions(additions, initial, append && additions.length === 1);
  }

  private writeAdditions<C>(
    additions: readonly { saved: SavedVersion<C>; packed: PackedContent }[],
    initial: OrderedContent | undefined,
    append: boolean,
  ): void {
    const insert = this.database.prepare(
      `INSERT INTO history_versions(${VERSION_COLUMNS}) VALUES(?,?,?,?,?,?)`,
    );
    let before = initial;
    let lastCheckpoint = before && this.anchorAt(additions[0]!.saved.entry.revision - 1);
    for (const { saved, packed } of additions) {
      const { revision } = saved.entry;
      const units = packed.units ? orderUnits(packed.units, before?.units ?? []) : undefined;
      insert.run(
        saved.entry.id,
        revision,
        JSON.stringify(saved.entry),
        JSON.stringify(saved.artifact),
        packed.payload,
        units ? 1 : 0,
      );
      const shapeChanged = !before || Boolean(before.units) !== Boolean(units);
      const loadingFullHistory =
        !append && lastCheckpoint !== undefined && revision - lastCheckpoint >= CHECKPOINT_INTERVAL;

      if (shapeChanged || loadingFullHistory) {
        this.writeCheckpoint(revision, units ?? []);
        lastCheckpoint = revision;
      } else if (units) {
        this.writeChanges(revision, before?.units ?? [], units);
      }

      before = { payload: packed.payload, units };
    }
  }

  private limits() {
    const row = this.database
      .prepare('SELECT min(revision) AS oldest,max(revision) AS newest FROM history_versions')
      .get();

    if (typeof row?.oldest !== 'number' || typeof row.newest !== 'number') {
      return;
    }

    const latestAnchor = this.anchorAt(row.newest);
    const earliestAnchor = this.anchorAt(row.oldest);
    if (latestAnchor === undefined || earliestAnchor === undefined) {
      throw corrupt();
    }

    return { oldest: row.oldest, newest: row.newest, latestAnchor, earliestAnchor };
  }

  get needsMaintenance(): boolean {
    if (this.work()) {
      return true;
    }

    const limits = this.limits();
    if (!limits) {
      return false;
    }

    return Boolean(
      limits.newest - limits.latestAnchor >= CHECKPOINT_INTERVAL ||
      this.expiredCheckpoint(limits.earliestAnchor) !== undefined ||
      this.database
        .prepare('SELECT 1 FROM history_unit_changes WHERE revision<=? LIMIT 1')
        .get(limits.earliestAnchor),
    );
  }

  maintain(obsolete: Set<string>): void {
    const work = this.work();
    if (work) {
      this.advance(work, obsolete);

      return;
    }

    const limits = this.limits();
    if (!limits) {
      return;
    }

    if (limits.newest - limits.latestAnchor >= CHECKPOINT_INTERVAL) {
      this.startCheckpoint(limits);

      return;
    }

    const anchor = limits.earliestAnchor;
    const expired = this.expiredCheckpoint(anchor);
    if (expired !== undefined) {
      this.writeWork({ phase: 'retire', revision: expired, anchor });

      return;
    }

    this.pruneChanges(anchor, obsolete);
  }

  private work(): CheckpointWork | undefined {
    const row = this.database
      .prepare('SELECT value FROM storage_meta WHERE key=?')
      .get(CHECKPOINT_WORK_KEY);

    return row ? readCheckpointWork(row.value) : undefined;
  }

  private writeWork(work: CheckpointWork): void {
    this.database
      .prepare(
        'INSERT INTO storage_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(CHECKPOINT_WORK_KEY, JSON.stringify(work));
  }

  private clearWork(): void {
    this.database.prepare('DELETE FROM storage_meta WHERE key=?').run(CHECKPOINT_WORK_KEY);
  }

  private startCheckpoint(limits: { oldest: number; latestAnchor: number }): void {
    const target = this.database
      .prepare(
        'SELECT revision,split FROM history_versions WHERE revision>=? ORDER BY revision LIMIT 1',
      )
      .get(Math.max(limits.oldest, limits.latestAnchor + CHECKPOINT_INTERVAL));

    if (typeof target?.revision !== 'number' || target.revision <= limits.latestAnchor) {
      throw corrupt();
    }

    this.database.prepare('INSERT INTO history_checkpoints VALUES(?)').run(target.revision);
    if (target.split === 1) {
      this.writeWork({ phase: 'copy', revision: target.revision, anchor: limits.latestAnchor });
    }
  }

  private expiredCheckpoint(anchor: number): number | undefined {
    const expired = this.database
      .prepare(
        'SELECT revision FROM history_checkpoints WHERE revision<? ORDER BY revision LIMIT 1',
      )
      .get(anchor);

    return typeof expired?.revision === 'number' ? expired.revision : undefined;
  }

  private advance(work: CheckpointWork, obsolete: Set<string>): void {
    switch (work.phase) {
      case 'copy':
        this.copyCheckpointBatch(work);
        break;
      case 'replay':
        this.replayCheckpointBatch(work);
        break;
      case 'retire':
        this.retireCheckpointBatch(work, obsolete);
        break;
    }
  }

  private copyCheckpointBatch(work: Extract<CheckpointWork, { phase: 'copy' }>): void {
    const select = 'SELECT id,ordinal,payload_hash FROM history_checkpoint_units WHERE revision=?';
    const order = ' ORDER BY id LIMIT ?';
    const rows =
      work.afterId === undefined
        ? this.database.prepare(select + order).all(work.anchor, CHECKPOINT_STEP_ROWS)
        : this.database
            .prepare(select + ' AND id>?' + order)
            .all(work.anchor, work.afterId, CHECKPOINT_STEP_ROWS);
    const units = rows.map((row) =>
      orderedReference({ id: row.id, ordinal: row.ordinal, payload_hash: row.payload_hash }),
    );

    this.writeCheckpointUnits(work.revision, units);
    if (units.length < CHECKPOINT_STEP_ROWS) {
      this.writeWork({ phase: 'replay', revision: work.revision, anchor: work.anchor });

      return;
    }

    this.writeWork({ ...work, afterId: units.at(-1)!.id });
  }

  private replayCheckpointBatch(work: Extract<CheckpointWork, { phase: 'replay' }>): void {
    const select =
      'SELECT revision,id,ordinal,payload_hash FROM history_unit_changes WHERE revision<=?';
    const order = ' ORDER BY revision,id LIMIT ?';
    const changes = work.after
      ? this.database
          .prepare(select + ' AND (revision,id)>(?,?)' + order)
          .all(work.revision, work.after.revision, work.after.id, CHECKPOINT_STEP_ROWS)
      : this.database
          .prepare(select + ' AND revision>?' + order)
          .all(work.revision, work.anchor, CHECKPOINT_STEP_ROWS);

    if (!changes.length) {
      this.publishCheckpoint(work.revision);

      return;
    }

    const write = this.database.prepare(
      'INSERT INTO history_checkpoint_units VALUES(?,?,?,?) ON CONFLICT(revision,id) DO UPDATE SET ordinal=excluded.ordinal,payload_hash=excluded.payload_hash',
    );
    const remove = this.database.prepare(
      'DELETE FROM history_checkpoint_units WHERE revision=? AND id=?',
    );

    for (const row of changes) {
      if (row.payload_hash === null) {
        remove.run(work.revision, String(row.id));
      } else {
        const unit = orderedReference({
          id: row.id,
          ordinal: row.ordinal,
          payload_hash: row.payload_hash,
        });
        write.run(work.revision, unit.id, unit.ordinal, unit.hash);
      }
    }

    if (changes.length < CHECKPOINT_STEP_ROWS) {
      this.publishCheckpoint(work.revision);

      return;
    }

    const last = changes.at(-1)!;
    this.writeWork({ ...work, after: { revision: Number(last.revision), id: String(last.id) } });
  }

  private publishCheckpoint(revision: number): void {
    const duplicateOrdinal = this.database
      .prepare(
        'SELECT ordinal FROM history_checkpoint_units WHERE revision=? GROUP BY ordinal HAVING count(*)>1 LIMIT 1',
      )
      .get(revision);

    if (duplicateOrdinal) {
      throw corrupt();
    }

    this.clearWork();
  }

  private retireCheckpointBatch(
    work: Extract<CheckpointWork, { phase: 'retire' }>,
    obsolete: Set<string>,
  ): void {
    const rows = this.database
      .prepare(`
        SELECT unit.id,unit.ordinal,unit.payload_hash,
          EXISTS(SELECT 1 FROM history_checkpoint_units WHERE revision=? AND payload_hash=unit.payload_hash) AS kept
        FROM history_checkpoint_units AS unit WHERE unit.revision=? ORDER BY unit.id LIMIT ?
      `)
      .all(work.anchor, work.revision, CHECKPOINT_STEP_ROWS);

    const remove = this.database.prepare(
      'DELETE FROM history_checkpoint_units WHERE revision=? AND id=?',
    );

    for (const row of rows) {
      const unit = orderedReference({
        id: row.id,
        ordinal: row.ordinal,
        payload_hash: row.payload_hash,
      });
      remove.run(work.revision, unit.id);
      if (!row.kept) {
        obsolete.add(unit.hash);
      }
    }
    if (rows.length < CHECKPOINT_STEP_ROWS) {
      this.database.prepare('DELETE FROM history_checkpoints WHERE revision=?').run(work.revision);
      this.clearWork();
    }
  }

  private pruneChanges(anchor: number, obsolete: Set<string>): void {
    const removed = this.database.prepare(`
      DELETE FROM history_unit_changes WHERE (revision,id) IN (
        SELECT revision,id FROM history_unit_changes WHERE revision<=? ORDER BY revision,id LIMIT ?
      ) RETURNING payload_hash
    `);

    for (const row of removed.all(anchor, CHECKPOINT_STEP_ROWS)) {
      if (typeof row.payload_hash === 'string') {
        obsolete.add(row.payload_hash);
      }
    }
  }
}
