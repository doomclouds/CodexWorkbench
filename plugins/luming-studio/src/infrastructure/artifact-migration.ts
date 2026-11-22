import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL_ACTOR } from '../contracts/studio.js';
import type { ArtifactState } from '../core/ports/studio-repository.js';
import { isRecord } from '../shared/is-record.js';
import { safeId, StudioError } from '../shared/studio-error.js';
import { atomicWrite } from './filesystem/atomic-write.js';
import { regularFile, resourceScope, samePath } from './filesystem/owned-file.js';
import {
  backupArtifactDatabase,
  readRetiredMigration,
  SqliteArtifactRepository,
} from './sqlite-artifact.js';

const databaseName = 'artifact.sqlite';
const maximumLegacyElements = 2_000;
const maximumLegacyBytes = 8 * 1024 * 1024;

export interface ArtifactLocation {
  readonly folder: string;
  readonly file: string;
}

interface MigrationTarget {
  generation: string;
  revision: number;
}

function location(folder: string): ArtifactLocation {
  return { folder, file: join(folder, databaseName) };
}

function invalidMigration() {
  return new StudioError('CORRUPT_ARTIFACT', '作品升级记录不完整，请保留原库和恢复副本。');
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function directory(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || !samePath(await realpath(path), path)) {
    throw resourceScope();
  }
}

async function exists(path: string, check: (path: string) => Promise<unknown>) {
  try {
    await check(path);

    return true;
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }

    return false;
  }
}

function targetRecord(value: unknown): MigrationTarget {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw invalidMigration();
  }

  return { generation: safeId(value.generation, '存储代'), revision: Number(value.revision) };
}

async function readTarget(file: string): Promise<MigrationTarget | undefined> {
  if (!(await exists(file, regularFile))) {
    return;
  }

  return targetRecord(JSON.parse(await readFile(file, 'utf8')) as unknown);
}

function currentState<C, A, S>(state: ArtifactState<C, A, S>): ArtifactState<C, A, S> {
  const { artifact, content } = state;

  return {
    ...state,
    history: [
      {
        artifact,
        content,
        entry: {
          id: randomUUID(),
          revision: artifact.revision,
          createdAt: artifact.updatedAt,
          actor: LOCAL_ACTOR,
          summary: '存储迁移基线',
          changedIds: [],
        },
      },
    ],
    operations: state.operations.map((record) => ({ ...record, receiptUnavailable: true })),
  };
}

function sameCurrentState<C, A, S>(
  persisted: ArtifactState<C, A, S>,
  expected: ArtifactState<C, A, S>,
): boolean {
  return isDeepStrictEqual(persisted, { ...expected, history: [] });
}

function writeSnapshot<C, A, S>(file: string, state: ArtifactState<C, A, S>, version: 1 | 2): void {
  const repository = new SqliteArtifactRepository(file, true, version);
  try {
    repository.database.exec('BEGIN IMMEDIATE');
    repository.writeState(state);
    repository.database.exec('COMMIT');
  } finally {
    repository.close();
  }

  const reopened = new SqliteArtifactRepository(file);
  try {
    const persisted = reopened.readState<C, A, S>({ currentOnly: true });
    const history = reopened.readState<C, A, S>().history;
    const currentMatches =
      reopened.storageVersion === version && sameCurrentState(persisted, state);
    const baselineMatches =
      history.length === 1 &&
      history[0]?.entry.id === state.history[0]?.entry.id &&
      isDeepStrictEqual(history[0]?.content, state.content);

    if (!currentMatches || !baselineMatches) {
      throw invalidMigration();
    }
  } finally {
    reopened.close();
  }
}

async function digestFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

async function assetPath(folder: string, assetId: string) {
  const active = join(folder, 'assets', assetId);
  if (await exists(active, regularFile)) {
    return active;
  }

  const recycled = join(folder, 'recycle-assets', assetId);
  await regularFile(recycled);

  return recycled;
}

async function copyAssets(
  from: string,
  to: string,
  assets: ArtifactState<unknown>['assets'],
): Promise<void> {
  const destination = join(to, 'assets');
  await mkdir(destination, { mode: 0o700 });

  for (const [id, asset] of Object.entries(assets)) {
    const source = await assetPath(from, safeId(id, '资源 ID'));
    const target = join(destination, id);
    const recordedSize = (await regularFile(source)).size;
    if (asset.id !== id || recordedSize !== asset.size) {
      throw new StudioError('RESOURCE_STATE', '作品资源登记与文件不一致，未切换存储。');
    }

    await copyFile(source, target, constants.COPYFILE_EXCL);
    const targetSize = (await regularFile(target)).size;
    if (targetSize !== recordedSize || (await digestFile(target)) !== (await digestFile(source))) {
      throw new StudioError('RESOURCE_STATE', '作品资源复制校验失败，未切换存储。');
    }
  }
}

async function copyGuestIdentity(root: string, target: string) {
  const source = join(root, 'guest-auth.json');
  if (await exists(source, regularFile)) {
    await copyFile(source, join(target, 'guest-auth.json'), constants.COPYFILE_EXCL);
  }
}

async function backupDatabase(source: string, target: string, id: string) {
  await backupArtifactDatabase(source, target);
  const saved = new SqliteArtifactRepository(target);
  try {
    if (saved.storageVersion !== 1 || saved.readAuthorization().artifact.id !== id) {
      throw invalidMigration();
    }
  } finally {
    saved.close();
  }
}

export class ArtifactMigration {
  constructor(private readonly root: string) {}

  private async generations(id: string) {
    return join(await realpath(this.root), 'artifact-generations', safeId(id));
  }

  private async targetLocation(parent: string, target: MigrationTarget) {
    const staging = join(parent, target.generation);
    await directory(staging);
    const prepared = await readTarget(join(staging, 'prepared.json'));
    if (!isDeepStrictEqual(prepared, target)) {
      throw invalidMigration();
    }

    const active = location(join(staging, 'current'));
    await directory(active.folder);
    await regularFile(active.file);

    return active;
  }

  async active(id: string, source: ArtifactLocation): Promise<ArtifactLocation> {
    const generations = await this.generations(id);
    if (!(await exists(generations, directory))) {
      return source;
    }

    const active = await readTarget(join(generations, 'active.json'));
    if (active) {
      return this.targetLocation(generations, active);
    }

    if (await exists(source.file, regularFile)) {
      const record = readRetiredMigration(source.file, id);
      if (record !== undefined) {
        const fence = targetRecord(record);
        const recovered = await this.targetLocation(generations, fence);
        await this.publishLocator(generations, fence);

        return recovered;
      }
    }

    return source;
  }

  async upgrade<C, A, S>(
    source: ArtifactLocation,
    repository: SqliteArtifactRepository,
    read: (repository: SqliteArtifactRepository) => ArtifactState<C, A, S>,
    id: string,
    assertLocked: () => void,
  ): Promise<ArtifactLocation> {
    const database = repository.database;
    const original = await regularFile(source.file);
    let temporary: string | undefined;
    database.exec('BEGIN IMMEDIATE');

    try {
      const state = currentState(read(repository));
      const generations = await this.generations(id);
      await mkdir(dirname(generations), { recursive: true, mode: 0o700 });
      await directory(dirname(generations));
      await mkdir(generations, { recursive: true, mode: 0o700 });
      await directory(generations);
      const staging = await mkdtemp(join(generations, 'g-'));
      temporary = staging;
      const target = { generation: basename(staging), revision: state.artifact.revision };
      const active = location(join(staging, 'current'));
      const previousRoot = join(staging, 'previous-v1');
      const previous = location(join(previousRoot, 'artifacts', id));
      await mkdir(active.folder, { recursive: true, mode: 0o700 });
      await mkdir(previous.folder, { recursive: true, mode: 0o700 });
      await copyAssets(source.folder, active.folder, state.assets);
      await copyAssets(active.folder, previous.folder, state.assets);
      await copyGuestIdentity(await realpath(this.root), previousRoot);
      await backupDatabase(source.file, previous.file, id);
      writeSnapshot(active.file, state, 2);
      await atomicWrite(join(staging, 'prepared.json'), JSON.stringify(target));

      const live = await regularFile(source.file);
      if (live.dev !== original.dev || live.ino !== original.ino) {
        throw new StudioError('LOCK_LOST', '迁移期间原作品文件已改变，未切换存储。');
      }

      assertLocked();
      repository.retireForMigration(id, target.generation, target.revision);
      assertLocked();
      database.exec('COMMIT');
      await this.publishLocator(generations, target);

      return active;
    } catch (error) {
      if (database.isTransaction) {
        database.exec('ROLLBACK');
        if (temporary) {
          await rm(temporary, { recursive: true, force: true }).catch((cleanup: unknown) => {
            process.emitWarning(String(cleanup), { code: 'STUDIO_MIGRATION_CLEANUP_FAILED' });
          });
        }
      }

      throw error;
    }
  }

  private async publishLocator(generations: string, target: MigrationTarget): Promise<void> {
    await atomicWrite(join(generations, 'active.json'), JSON.stringify(target)).catch(
      (error: unknown) => {
        process.emitWarning(String(error), { code: 'STUDIO_MIGRATION_LOCATOR_FAILED' });
      },
    );
  }

  async legacyRollback<C, A, S>(
    source: ArtifactLocation,
    input: ArtifactState<C, A, S>,
    assertLocked: () => void,
  ): Promise<string> {
    const elements = isRecord(input.content) ? input.content.elements : undefined;
    if (
      (Array.isArray(elements) && elements.length > maximumLegacyElements) ||
      Buffer.byteLength(JSON.stringify(input.content)) > maximumLegacyBytes
    ) {
      throw new StudioError('TOO_LARGE', '当前作品超过旧版容量，已保留新版作品。');
    }

    const canonical = await realpath(this.root);
    const backups = join(canonical, 'legacy-rollbacks');
    await mkdir(backups, { recursive: true, mode: 0o700 });
    await directory(backups);
    const target = await mkdtemp(join(backups, 'rollback-'));
    const output = location(join(target, 'artifacts', safeId(input.artifact.id)));
    await mkdir(output.folder, { recursive: true, mode: 0o700 });
    await copyAssets(source.folder, output.folder, input.assets);
    await copyGuestIdentity(canonical, target);
    writeSnapshot(output.file, currentState(input), 1);
    assertLocked();
    await atomicWrite(
      join(target, 'verified.json'),
      JSON.stringify({ revision: input.artifact.revision }),
    );

    return target;
  }

  async migratedDirectory(id: string): Promise<string | undefined> {
    const path = await this.generations(id);

    return (await exists(path, directory)) ? path : undefined;
  }
}
