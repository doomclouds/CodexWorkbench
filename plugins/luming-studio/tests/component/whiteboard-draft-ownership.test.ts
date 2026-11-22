import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createDraftWorkspace } from '../../src/app/features/whiteboard/draft-workspace.js';

const localService = { embedded: true, baseUrl: 'http://127.0.0.1:4321' };
const identity = 'owner';
const artifact = 'board-one';
const areas = [
  { kind: 'canvas', regionId: undefined },
  { kind: 'source', regionId: undefined },
  { kind: 'document', regionId: 'document-one' },
] as const;

let browser: JSDOM;
beforeEach(() => {
  browser = new JSDOM('', { url: 'http://studio.test' });
  vi.stubGlobal('localStorage', browser.window.localStorage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  browser.window.close();
});

it.each(areas)(
  'isolates parallel $kind records and only clears the confirmed generation',
  ({ kind, regionId }) => {
    const first = createDraftWorkspace(localService, identity, artifact, 'a').open(kind, regionId);
    const second = createDraftWorkspace(localService, identity, artifact, 'b').open(kind, regionId);
    const submitted = first.write('first-before-ack');
    second.write('second-before-ack');
    const newer = first.write('first-after-ack');
    expect(first.clear(submitted)).toBe(false);
    expect(first.current()).toBe(newer);
    expect(first.clear(newer)).toBe(true);

    const restarted = { ...localService, baseUrl: 'http://127.0.0.1:8765' };
    const remount = createDraftWorkspace(restarted, identity, artifact, 'b-new', 'b').open(
      kind,
      regionId,
    );
    const candidates = remount.list();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ raw: 'second-before-ack', source: 'panel' });
    expect(remount.current()).toBeUndefined();
    remount.write(candidates[0]!.raw);
    expect(remount.clear()).toBe(true);
    expect(remount.matches(candidates[0]!)).toBe(true);

    second.write('changed-by-original-view');
    expect(remount.matches(candidates[0]!)).toBe(false);
  },
);

it('leaves a legacy record intact and never lists records from a different service or identity', () => {
  const oldKey = `studio-draft:${localService.baseUrl}:${identity}:${artifact}`;
  localStorage.setItem(oldKey, 'invalid legacy JSON');
  const actor = createDraftWorkspace(localService, identity, artifact).open('canvas');
  expect(actor.list()[0]).toMatchObject({ source: 'legacy', raw: 'invalid legacy JSON' });
  actor.write('valid active draft');
  expect(actor.clear()).toBe(true);
  expect(localStorage.getItem(oldKey)).toBe('invalid legacy JSON');

  const browser = createDraftWorkspace({ ...localService, embedded: false }, identity, artifact);
  browser.open('document', 'document-two').write('browser draft');
  expect(
    createDraftWorkspace(localService, identity, artifact).open('document', 'document-two').list(),
  ).toEqual([]);
  expect(
    createDraftWorkspace({ ...localService, embedded: false }, 'visitor', artifact)
      .open('document', 'document-two')
      .list(),
  ).toEqual([]);
});

it('finds older loopback-port drafts as unclaimed legacy candidates only', () => {
  const oldKey = `studio-source-draft:http://127.0.0.1:10101:${identity}:${artifact}`;
  localStorage.setItem(oldKey, 'old-loopback');
  localStorage.setItem(
    `studio-source-draft:http://remote.example:${identity}:${artifact}`,
    'other-service',
  );
  const slot = createDraftWorkspace(localService, identity, artifact, 'view-new', 'view-old').open(
    'source',
  );
  expect(slot.list()).toMatchObject([{ key: oldKey, raw: 'old-loopback', source: 'legacy' }]);
  expect(slot.current()).toBeUndefined();
  expect(localStorage.getItem(oldKey)).toBe('old-loopback');
});
