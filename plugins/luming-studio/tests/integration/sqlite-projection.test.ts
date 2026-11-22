import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';
import type { ArtifactState } from '../../src/core/shared/model.js';
import { initialWhiteboard, type WhiteboardContent } from '../../src/core/products/whiteboard.js';

let directory: string;
let service: ComposedStudioService;
let artifactId: string;
let historyLoads: number[];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-sqlite-projection-'));
  service = createStudioService({ dataRoot: directory });
  const created = await service.execute('artifact_manage', {
    action: 'create',
    elements: [{ id: 'text', type: 'text', text: 'Version 199' }],
  });
  artifactId = created.artifact.id;
  const state = await service.store.read(artifactId);
  const content = state.content as WhiteboardContent;
  const initialHistoryId = state.history[0]!.entry.id;
  state.history = Array.from({ length: 200 }, (_, revision) => ({
    entry: {
      id: revision === 0 ? initialHistoryId : randomUUID(),
      revision,
      createdAt: state.artifact.createdAt,
      actor: service.owner,
      summary: `Revision ${revision}`,
      changedIds: ['text'],
    },
    artifact: { ...state.artifact, revision },
    content: {
      ...structuredClone(content),
      elements: [{ ...content.elements[0]!, text: `Version ${revision}`, version: revision + 1 }],
    },
  }));
  state.artifact.revision = 199;
  state.content = structuredClone(state.history.at(-1)!.content);
  state.unitClocks = { text: { version: 200, incarnationStart: 1 } };
  state.assets.image = {
    id: 'image',
    filename: 'sample.png',
    mimeType: 'image/png',
    size: png.length,
  };
  await service.store.write(state);
  const assets = join(service.store.folder(artifactId), 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, 'image'), png);
  historyLoads = [];
  const read = SqliteArtifactRepository.prototype.readState;
  vi.spyOn(SqliteArtifactRepository.prototype, 'readState').mockImplementation(function <C, A, S>(
    this: SqliteArtifactRepository,
    options: { maxExpandedBytes?: number } = {},
  ) {
    const state = read.call(this, options) as ArtifactState<C, A, S>;
    state.history = state.history.map((saved) => ({
      entry: saved.entry,
      artifact: saved.artifact,
      get content() {
        historyLoads.push(saved.entry.revision);

        return saved.content;
      },
    }));

    return state;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected projection test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

it('checks inactive sharing at startup without loading the stored board or its history', async () => {
  await service.resetSharingSessions();
  expect(await service.hasShares()).toBe(false);
  expect(SqliteArtifactRepository.prototype.readState).not.toHaveBeenCalled();
  expect(historyLoads).toEqual([]);
});

it('opens a SQLite document and reads current data and history entries without loading historical contents', async () => {
  await service.execute('studio_open', { artifactId });
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'board' })).elements[0].text,
  ).toBe('Version 199');
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'objects', ids: ['text'] }))
      .elements[0].version,
  ).toBe(200);
  expect((await service.execute('artifact_read', { artifactId, mode: 'summary' })).totalCount).toBe(
    1,
  );
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'history' })).history,
  ).toHaveLength(200);
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'assets' })).assets,
  ).toHaveLength(1);
  expect(await service.hasShares()).toBe(false);
  expect(Buffer.from((await service.getAsset(artifactId, 'image')).data)).toEqual(png);
  const exported = await service.execute('artifact_export', { artifactId, format: 'json' });
  const data = JSON.parse(
    Buffer.from((await service.getExport(exported.exportId)).data).toString('utf8'),
  );
  expect(data.elements[0].text).toBe('Version 199');
  expect(historyLoads).toEqual([]);
});

it('loads only the requested historical content and returns detached data after closing SQLite', async () => {
  const requested = await service.execute('artifact_read', {
    artifactId,
    mode: 'version',
    revision: 37,
  });
  expect(requested.board.elements[0]).toMatchObject({ text: 'Version 37', version: 38 });
  expect(historyLoads).toEqual([37]);
  requested.board.elements[0].text = 'Caller local edit';
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'version', revision: 37 })).board
      .elements[0].text,
  ).toBe('Version 37');
  expect(historyLoads).toEqual([37, 37]);
});

it('keeps read argument errors and unavailable historical versions observable', async () => {
  await expect(
    service.execute('artifact_read', { artifactId, mode: 'assets', limit: 101 }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(
    service.execute('artifact_read', { artifactId, mode: 'version', revision: 500 }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    service.execute('artifact_read', { artifactId, mode: 'unsupported-mode' }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  expect(historyLoads).toEqual([]);
});

it('reads only selected SQLite unit payloads for exact current and retained revisions', async () => {
  const state = await service.store.read(artifactId);
  const current = state.content as WhiteboardContent;
  const saved = state.history[37]!;
  const before = saved.content as WhiteboardContent;
  const html = '<p>requested</p>';
  state.content = {
    ...current,
    orderVersion: 18,
    elements: [
      ...current.elements,
      ...initialWhiteboard([{ id: 'current-heavy', type: 'html', html: 'c'.repeat(600_000) }])
        .elements,
    ],
  };
  saved.content = {
    ...before,
    orderVersion: 7,
    motion: { duration: 12 },
    elements: [
      ...before.elements,
      ...initialWhiteboard([
        { id: 'prior-heavy', type: 'html', html: 'p'.repeat(600_000) },
        { id: 'selected', type: 'html', html },
      ]).elements,
    ],
  };
  await service.store.write(state);

  const db = new DatabaseSync(service.store.file(artifactId), { readOnly: true });
  const heavy = new Set(
    db
      .prepare('SELECT hash FROM payload_blobs WHERE octet_length(json) > 500000')
      .all()
      .map((row) => String(row.hash)),
  );
  db.close();
  expect(heavy.size).toBe(2);

  const reads: unknown[] = [];
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const statement = prepare.call(this, sql);
    if (sql === 'SELECT json FROM payload_blobs WHERE hash=?') {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
        reads.push(bindings[0]);
        return get(...bindings);
      });
    }

    return statement;
  });
  const readState = vi.mocked(SqliteArtifactRepository.prototype.readState);
  readState.mockClear();
  const ids = ['selected', '$order', 'text', '$style', '$motion', 'selected'];
  const read = (atRevision: number, actor = service.owner) =>
    service.execute('artifact_read', { artifactId, mode: 'units', atRevision, ids }, actor);

  const past = await read(37);
  expect(past.artifact.revision).toBe(37);
  expect(past.units).toEqual([
    { id: 'selected', after: expect.objectContaining({ html }) },
    { id: '$order', after: { version: 7, ids: ['text', 'prior-heavy', 'selected'] } },
    { id: 'text', after: expect.objectContaining({ text: 'Version 37', version: 38 }) },
    { id: '$style', after: before.style },
    { id: '$motion', after: { duration: 12 } },
  ]);
  const latest = await read(199);
  expect(latest.artifact.revision).toBe(199);
  expect(latest.units).toEqual([
    { id: 'selected', after: null },
    { id: '$order', after: { version: 18, ids: ['text', 'current-heavy'] } },
    { id: 'text', after: expect.objectContaining({ text: 'Version 199', version: 200 }) },
    { id: '$style', after: current.style },
    { id: '$motion', after: null },
  ]);
  const model = await read(37, { ...service.owner, kind: 'agent' });
  expect(model.units[0].after).toEqual(expect.objectContaining({ htmlLength: html.length }));
  expect(model.units[0].after).not.toHaveProperty('html');
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.some((hash) => typeof hash === 'string' && heavy.has(hash))).toBe(false);
  expect(readState).not.toHaveBeenCalled();
});

it('checks live authorization in the selected revision transaction before loading units', async () => {
  service.configureLocalOrigin('http://127.0.0.1');
  const { links } = await service.execute('artifact_share', {
    artifactId,
    action: 'start',
    access: 'local',
  });
  const url = new URL(links.viewer, 'http://127.0.0.1');
  const credential = url.searchParams.get('share')!;
  const { actor, grantId } = await service.guestSession(artifactId, credential, 'guest-viewer', {
    name: 'Viewer',
  });
  const authority = { owner: false, actorId: actor.id, credential, grantId, viaLan: false };
  const input = { artifactId, mode: 'units', atRevision: 37, ids: ['text'] };
  const readAuthorization = SqliteArtifactRepository.prototype.readAuthorization;
  const sessions = new WeakMap<ReturnType<typeof readAuthorization>, SqliteArtifactRepository>();
  vi.spyOn(SqliteArtifactRepository.prototype, 'readAuthorization').mockImplementation(function (
    this: SqliteArtifactRepository,
  ) {
    const authorization = readAuthorization.call(this);
    sessions.set(authorization, this);

    return authorization;
  });
  const read = SqliteArtifactRepository.prototype.readUnitProjection;
  const selected = vi
    .spyOn(SqliteArtifactRepository.prototype, 'readUnitProjection')
    .mockImplementation(function (this: SqliteArtifactRepository, authorization, request) {
      expect(this.database.isTransaction).toBe(true);
      expect(sessions.get(authorization) === this).toBe(true);
      return read.call(this, authorization, request);
    });
  const readState = vi.mocked(SqliteArtifactRepository.prototype.readState);
  readState.mockClear();

  expect((await service.execute('artifact_read', input, actor, authority)).units).toEqual([
    { id: 'text', after: expect.objectContaining({ text: 'Version 37' }) },
  ]);
  expect(selected).toHaveBeenCalledOnce();
  expect(readState).not.toHaveBeenCalled();

  await service.execute('artifact_share', { artifactId, action: 'remove', memberId: actor.id });
  selected.mockClear();
  await expect(service.execute('artifact_read', input, actor, authority)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(selected).not.toHaveBeenCalled();
});

it('still rejects an oversized current board when only a small historical unit was requested', async () => {
  const state = await service.store.read(artifactId);
  const current = state.content as WhiteboardContent;
  const html = '🟠'.repeat(200_000);
  const oversized = initialWhiteboard([{ id: 'expanded', type: 'html', html }]).elements[0]!;
  oversized.state = { repeated: Array.from({ length: 11 }, () => html) };
  state.content = { ...current, elements: [...current.elements, oversized] };
  const repo = new SqliteArtifactRepository(service.store.file(artifactId), true);
  try {
    repo.writeState(state);
  } finally {
    repo.close();
  }

  await expect(
    service.execute('artifact_read', { artifactId, mode: 'units', atRevision: 37, ids: ['text'] }),
  ).rejects.toMatchObject({ code: 'TOO_LARGE' });
});

it('uses the existing revision reader when a stored board predates version clocks', async () => {
  const state = await service.store.read(artifactId);
  delete state.unitClocks;
  const repo = new SqliteArtifactRepository(service.store.file(artifactId), true);
  try {
    repo.writeState(state);
  } finally {
    repo.close();
  }

  const readState = vi.mocked(SqliteArtifactRepository.prototype.readState);
  readState.mockClear();
  const result = await service.execute('artifact_read', {
    artifactId,
    mode: 'units',
    atRevision: 37,
    ids: ['text'],
  });
  expect(result.units).toEqual([
    { id: 'text', after: expect.objectContaining({ text: 'Version 37', version: 38 }) },
  ]);
  expect(readState).toHaveBeenCalledOnce();
});

it('keeps validation and expired revision errors on the exact unit path', async () => {
  const readState = vi.mocked(SqliteArtifactRepository.prototype.readState);
  readState.mockClear();
  const input = { artifactId, mode: 'units' };
  await expect(
    service.execute('artifact_read', { ...input, atRevision: 37, ids: [] }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(
    service.execute('artifact_read', { ...input, atRevision: 2.5, ids: ['text'] }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  readState.mockClear();
  await expect(
    service.execute('artifact_read', { ...input, atRevision: 500, ids: ['text'] }),
  ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  expect(readState).not.toHaveBeenCalled();
});
