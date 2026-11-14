import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArtifactStore } from '../src/core/shared/store.js';
import { createState } from '../src/core/shared/history.js';
import { LOCAL_ACTOR } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), rename: vi.fn(actual.rename) };
});
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
type Content = { value: string; nested: { count: number }; normalized?: boolean };
let folder: string;
const services: StudioService[] = [];
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'studio-store-cache-'));
  vi.mocked(readFile).mockReset().mockImplementation(actualFs.readFile);
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
});
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  vi.restoreAllMocks();
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected cache fixture');
  await rm(folder, { recursive: true, force: true });
});
function fixture(value = 'AAA') {
  const now = new Date().toISOString();
  return createState({ id: randomUUID(), type: 'test', title: 'Cache', revision: 0, createdAt: now, updatedAt: now, pinned: false }, { value, nested: { count: 1 } } as Content, LOCAL_ACTOR, 'create', ['unit']);
}
function stores() {
  const validated = vi.fn((state: ReturnType<typeof fixture>) => { state.content.normalized = true; });
  return { first: new ArtifactStore<Content>(folder, undefined, validated), second: new ArtifactStore<Content>(folder), validated };
}

describe('bounded parsed artifact cache', () => {
  it('normalizes once, freezes every nested private value, and returns mutable isolated copies', async () => {
    const state = fixture(), { first, validated } = stores(); await first.write(state);
    const one = await first.read(state.artifact.id);
    expect(one.content.normalized).toBe(true); one.content.nested.count = 99; one.sharing.enabled = true; one.history.length = 0;
    const two = await first.read(state.artifact.id);
    expect(two.content.nested.count).toBe(1); expect(two.sharing.enabled).toBe(false); expect(two.history).toHaveLength(1); expect(validated).toHaveBeenCalledTimes(1);
    const projection = await first.readProjection(state.artifact.id, current => {
      expect(Object.isFrozen(current)).toBe(true); expect(Object.isFrozen(current.content.nested)).toBe(true); expect(Object.isFrozen(current.history[0]!.content.nested)).toBe(true);
      return { content: current.content, sharing: current.sharing };
    });
    projection.content.nested.count = 200; projection.sharing.enabled = true;
    expect((await first.readProjection(state.artifact.id, current => current.content.nested)).count).toBe(1);
  });
  it('rejects a mutating selector and evicts its entry instead of retaining a damaged authorization snapshot', async () => {
    const state = fixture(), { first, validated } = stores(); await first.write(state); await first.read(state.artifact.id);
    await expect(first.readProjection(state.artifact.id, current => { current.sharing.enabled = true; return current.sharing; })).rejects.toBeInstanceOf(TypeError);
    expect((await first.read(state.artifact.id)).sharing.enabled).toBe(false); expect(validated).toHaveBeenCalledTimes(2);
  });
  it('detects a different instance atomic replacement even with exactly equal size and mtime', async () => {
    const state = fixture(), next = structuredClone(state), { first, second, validated } = stores(); next.content.value = 'BBB';
    const fixed = new Date('2020-01-02T03:04:05.000Z');
    await first.write(state); await utimes(first.file(state.artifact.id), fixed, fixed);
    const before = await stat(first.file(state.artifact.id), { bigint: true }); await first.read(state.artifact.id);
    await second.write(next); await utimes(first.file(state.artifact.id), fixed, fixed);
    const after = await stat(first.file(state.artifact.id), { bigint: true });
    expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs);
    expect([after.dev, after.ino, after.ctimeNs].join(':')).not.toBe([before.dev, before.ino, before.ctimeNs].join(':'));
    expect((await first.readProjection(state.artifact.id, current => current.content.value))).toBe('BBB'); expect(validated).toHaveBeenCalledTimes(2);
  });
  it('does not tag bytes read before an atomic replacement with the new file signature', async () => {
    const state = fixture(), next = structuredClone(state), { first, second, validated } = stores(); next.content.value = 'BBB'; await first.write(state);
    vi.mocked(readFile).mockImplementationOnce(async (...args) => {
      const raw = await Reflect.apply(actualFs.readFile, actualFs, args); await second.write(next); return raw;
    });
    expect((await first.read(state.artifact.id)).content.value).toBe('AAA');
    expect((await first.read(state.artifact.id)).content.value).toBe('BBB');
    expect((await first.read(state.artifact.id)).content.value).toBe('BBB'); expect(validated).toHaveBeenCalledTimes(2);
  });
  it('evicts missing and corrupt files and never serves the previous cached grant as fallback', async () => {
    const state = fixture(), { first, second } = stores(); await first.write(state); await first.read(state.artifact.id);
    await rm(first.file(state.artifact.id)); await expect(first.readProjection(state.artifact.id, current => current.sharing)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await second.write(state); await first.read(state.artifact.id);
    await writeFile(first.file(state.artifact.id), '{broken json'); await expect(first.read(state.artifact.id)).rejects.toMatchObject({ code: 'CORRUPT_ARTIFACT' });
    state.content.value = 'BBB'; await second.write(state); expect((await first.read(state.artifact.id)).content.value).toBe('BBB');
  });
  it('evicts on failed writes and failed transactions without publishing their in-memory mutations', async () => {
    const state = fixture(), { first, validated } = stores(); await first.write(state); await first.read(state.artifact.id);
    const next = structuredClone(state); next.content.value = 'BBB';
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(Error('Synthetic I/O failure'), { code: 'EIO' }));
    await expect(first.write(next)).rejects.toMatchObject({ code: 'EIO' });
    expect((await first.read(state.artifact.id)).content.value).toBe('AAA'); expect(validated).toHaveBeenCalledTimes(2);
    await expect(first.transaction(state.artifact.id, current => { current.content.value = 'CCC'; throw Error('Rejected transaction'); })).rejects.toThrow('Rejected transaction');
    expect((await first.read(state.artifact.id)).content.value).toBe('AAA'); expect(validated).toHaveBeenCalledTimes(3);
  });
  it('keeps only four least-recently-used entries', async () => {
    const { first, validated } = stores(), values = Array.from({ length: 5 }, () => fixture());
    for (const value of values) await first.write(value);
    for (const value of values.slice(0, 4)) await first.readProjection(value.artifact.id, current => current.artifact.id);
    await first.read(values[0]!.artifact.id); await first.read(values[4]!.artifact.id); expect(validated).toHaveBeenCalledTimes(5);
    await first.read(values[0]!.artifact.id); expect(validated).toHaveBeenCalledTimes(5);
    await first.read(values[1]!.artifact.id); expect(validated).toHaveBeenCalledTimes(6);
  });
  it('enforces the 64MiB serialized-byte budget without writing large fixtures to disk', async () => {
    const { first, validated } = stores(), a = fixture(), b = fixture(); await first.write(a); await first.write(b);
    const padding = ' '.repeat(33 * 1024 * 1024), files = new Map([[first.file(a.artifact.id), padding + JSON.stringify(a)], [first.file(b.artifact.id), padding + JSON.stringify(b)]]);
    vi.mocked(readFile).mockImplementation(async (...args) => files.get(String(args[0])) ?? Reflect.apply(actualFs.readFile, actualFs, args));
    await first.readProjection(a.artifact.id, current => current.artifact.id); await first.readProjection(b.artifact.id, current => current.artifact.id);
    expect(validated).toHaveBeenCalledTimes(2);
    await first.readProjection(a.artifact.id, current => current.artifact.id); expect(validated).toHaveBeenCalledTimes(3);
  });
  it('holds fresh authorization projection under the same cross-instance transaction lock', async () => {
    const state = fixture(), { first, second } = stores(); await first.write(state); await first.read(state.artifact.id);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const reading = first.withProjectionLock(state.artifact.id, current => ({ artifact: current.artifact, sharing: current.sharing }), async selected => { selected.sharing.enabled = true; entered(); await hold; return selected.artifact.id; });
    await ready; let wrote = false;
    const writing = second.transaction(state.artifact.id, current => { current.content.value = 'BBB'; wrote = true; });
    await delay(25); const held = !wrote; release();
    await Promise.all([reading, writing]);
    expect(held).toBe(true);
    expect(await first.withProjectionLock(state.artifact.id, current => current.content.value, value => value)).toBe('BBB');
    expect((await first.read(state.artifact.id)).sharing.enabled).toBe(false);
  });
  it('evicts the parsed snapshot after purge', async () => {
    const state = fixture(), { first } = stores(); state.artifact.trashedAt = new Date().toISOString(); await first.write(state); await first.read(state.artifact.id);
    await first.purge(state.artifact.id, async () => {});
    await expect(first.read(state.artifact.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('service permission and CAS behavior with cached projections', () => {
  it('rejects an old role after a same-size, same-mtime atomic grant replacement', async () => {
    const first = new StudioService({ dataRoot: folder }), second = new StudioService({ dataRoot: folder }); services.push(first, second);
    const { artifact } = await first.execute('artifact_manage', { action: 'create' });
    const sharing = await first.execute('artifact_share', { artifactId: artifact.id, action: 'start', access: 'local' });
    const token = new URL(sharing.links.editor, 'http://local').searchParams.get('share')!, file = first.store.file(artifact.id), fixed = new Date('2020-01-02T03:04:05.000Z');
    await utimes(file, fixed, fixed); const before = await stat(file, { bigint: true });
    expect(await first.shareRole(artifact.id, token)).toBe('editor');
    const replacement = (token[0] === 'A' ? 'B' : 'A') + token.slice(1), next = await second.store.read(artifact.id);
    next.sharing.tokens.editor = replacement; await second.store.write(next); await utimes(file, fixed, fixed);
    const after = await stat(file, { bigint: true }); expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(await first.shareRole(artifact.id, token)).toBeUndefined(); expect(await first.shareRole(artifact.id, replacement)).toBe('editor');
  });
  it('observes other-instance revocation instead of reviving a cached role token', async () => {
    const first = new StudioService({ dataRoot: folder }), second = new StudioService({ dataRoot: folder }); services.push(first, second);
    const { artifact } = await first.execute('artifact_manage', { action: 'create' });
    const sharing = await first.execute('artifact_share', { artifactId: artifact.id, action: 'start', access: 'local' });
    const token = new URL(sharing.links.editor, 'http://local').searchParams.get('share')!;
    expect(await first.shareRole(artifact.id, token)).toBe('editor'); expect(await first.shareRole(artifact.id, token)).toBe('editor');
    await second.execute('artifact_share', { artifactId: artifact.id, action: 'reset', role: 'editor' });
    expect(await first.shareRole(artifact.id, token)).toBeUndefined();
  });
  it('checks latest object CAS inside the lock after another cached instance commits', async () => {
    const first = new StudioService({ dataRoot: folder }), second = new StudioService({ dataRoot: folder }); services.push(first, second);
    const { artifact } = await first.execute('artifact_manage', { action: 'create', elements: [{ id: 'a', type: 'text', text: 'old' }] });
    await first.execute('artifact_read', { artifactId: artifact.id }); await second.execute('artifact_read', { artifactId: artifact.id });
    await second.execute('artifact_apply', { artifactId: artifact.id, expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { text: 'remote' } }] });
    await expect(first.execute('artifact_apply', { artifactId: artifact.id, expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { text: 'stale' } }] })).rejects.toMatchObject({ code: 'CONFLICT' });
    const result = await first.execute('artifact_apply', { artifactId: artifact.id, merge: 'safe', expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { x: 42 } }] });
    expect(result.board.elements[0]).toMatchObject({ text: 'remote', x: 42, version: 3 });
  });
});
