// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import SelectionLayoutDialog, { FlowLayoutDrawing, layoutPreviewStale } from '../src/app/canvas/SelectionLayoutDialog.js';
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';
import { StudioService } from '../src/core/service.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement, type StudioClient, type ToolName } from '../src/contracts/studio.js';
import type { FlowLayoutPreview } from '../src/contracts/layout.js';
const node = (id: string, x = 0): BoardElement => ({ id, type: 'shape', x, y: 0, w: 140, h: 80, version: 1, text: id });
const makeBoard = (elements = [node('a'), node('b', 30)]): Board => ({ artifact: { id: 'board', type: 'whiteboard', title: 'Layout', revision: 1, createdAt: '', updatedAt: '', pinned: false }, elements, style: DEFAULT_STYLE, orderVersion: 0 });
let host: HTMLDivElement, root: Root, service: StudioService | undefined, directory = '';
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)!;
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function waitFor(check: () => boolean) {
  for (let index = 0; index < 180; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (check()) return; }
  throw new Error(`Layout UI did not settle: ${host.textContent?.slice(0, 1600)}`);
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); await service?.close(); service = undefined;
  if (directory) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected layout UI directory'); await rm(directory, { recursive: true, force: true }); directory = ''; }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('applies a geometric command with complete read versions and leaves source content intact', async () => {
  const source = makeBoard([node('a'), { ...node('b', 300), w: 220, h: 150 }]);
  const apply = vi.fn().mockResolvedValue(undefined), call = vi.fn();
  await act(async () => root.render(<SelectionLayoutDialog board={source} ids={['a', 'b']} client={{ embedded: true, call }} initialMode="geometry" labelSizes={() => ({})} canEdit onApply={apply} onDiscardPreview={() => {}} onClose={() => {}} onError={() => {}} />));
  await click('同尺寸');
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0]).toEqual([{ op: 'update', id: 'a', changes: { x: 0, y: 0, w: 220, h: 150 } }]);
  expect(apply.mock.calls[0][3]).toEqual({ a: 1, b: 1, $order: 0 });
  expect(call).not.toHaveBeenCalled(); expect(host.textContent).toContain('同尺寸已应用');
  expect(source.elements[0].text).toBe('a');
});

it('calls real service preview without writing, then applies and undoes exactly one layout from the first-level toolbar', async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-layout-ui-')); service = new StudioService({ dataRoot: directory });
  const original = (await service.execute('artifact_manage', { action: 'create', title: 'Layout UI', elements: [node('a'), node('b', 30), { ...node('ab'), type: 'arrow', from: 'a', to: 'b', label: '流程' }] })).board as Board;
  const call = vi.fn((name, args) => service!.execute(name, args));
  const client: StudioClient = { embedded: true, call };
  function Canvas() { const [current, setCurrent] = useState(original); return <WhiteboardCanvas board={current} client={client} actor={LOCAL_ACTOR} onChanged={setCurrent} onAnnotate={() => {}} externalSelectedIds={['a', 'b']} />; }
  await act(async () => root.render(<Canvas />));
  await click('整理选区'); await click('按流程排布'); await click('生成预览');
  await waitFor(() => !!host.querySelector('[aria-label="流程排布预览"]'));
  expect((await service.store.read(original.artifact.id)).artifact.revision).toBe(original.artifact.revision);
  expect(call.mock.calls.some(([name]) => name === 'artifact_apply')).toBe(false);
  await click('应用排布'); await waitFor(() => !host.querySelector('[role="dialog"]'));
  const saved = await service.execute('artifact_read', { artifactId: original.artifact.id });
  expect(saved.artifact.revision).toBe(original.artifact.revision + 1);
  const writes = call.mock.calls.filter(([name]) => name === 'artifact_apply');
  expect(writes).toHaveLength(1); expect(writes[0][1]).not.toHaveProperty('merge');
  expect(writes[0][1].expectedVersions).toMatchObject({ a: 1, b: 1, ab: 1, $order: 0 });
  await act(async () => { host.querySelector('[aria-label="白板画布"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
  await waitFor(() => call.mock.calls.filter(([name]) => name === 'artifact_apply').length === 2);
  await waitFor(() => host.querySelector('[data-element-id="b"]')?.getAttribute('style')?.includes('left: 30px') === true);
  const undone = await service.execute('artifact_read', { artifactId: original.artifact.id });
  expect(undone.elements.find((item: BoardElement) => item.id === 'b')).toMatchObject({ x: 30, y: 0, text: 'b' });
}, 15_000);

it('blocks an outdated preview after a dependency or board order changed', () => {
  const source = makeBoard();
  const preview: FlowLayoutPreview = { requestId: 'preview', artifactId: 'board', revision: 1, direction: 'right', gap: 64, operations: [], expectedVersions: { a: 1, b: 1, $order: 0 }, affectedIds: [], boundaryIds: [], skipped: [], warnings: [] };
  expect(layoutPreviewStale(source, preview)).toBe(false);
  expect(layoutPreviewStale({ ...source, elements: [source.elements[0], { ...source.elements[1], version: 2 }] }, preview)).toBe(true);
  expect(layoutPreviewStale({ ...source, orderVersion: 1 }, preview)).toBe(true);
});

it('keeps an unchanged selected endpoint visible in the preview context', async () => {
  const source = makeBoard([node('a'), node('b', 30), { ...node('ab'), type: 'arrow', from: 'a', to: 'b' }]);
  const result: FlowLayoutPreview = { requestId: 'context', artifactId: 'board', revision: 1, direction: 'right', gap: 64, operations: [{ op: 'update', id: 'b', changes: { x: 400 } }], expectedVersions: { a: 1, b: 1, ab: 1, $order: 0 }, affectedIds: ['b'], boundaryIds: [], skipped: [], warnings: [] };
  await act(async () => root.render(<FlowLayoutDrawing source={source} preview={result} contextIds={['a', 'b']} />));
  expect(host.querySelectorAll('rect')).toHaveLength(2);
  expect(host.querySelectorAll('svg > g > path')).toHaveLength(1);
  expect(host.querySelector('.is-fixed .studio-layout-node-label')?.textContent).toBe('a');
  expect(host.querySelector('.is-affected .studio-layout-node-label')?.textContent).toBe('b');
});

it('routes cancel to the actual request and closes without displaying a successful empty preview', async () => {
  let rejectPreview: (error: Error) => void = () => {};
  const call = vi.fn(async (_name, args) => {
    if (args.mode === 'layout-preview') return await new Promise((_resolve, reject) => { rejectPreview = reject; });
    if (args.mode === 'layout-cancel') { rejectPreview(new Error('已取消布局计算。')); return { cancelled: true }; }
  });
  const close = vi.fn(), apply = vi.fn();
  const transport: StudioClient = { embedded: true, async call<T>(name: ToolName, args: Record<string, unknown> = {}) { return await call(name, args) as T; } };
  await act(async () => root.render(<SelectionLayoutDialog board={makeBoard()} ids={['a', 'b']} client={transport} initialMode="flow" labelSizes={() => ({})} canEdit onApply={apply} onDiscardPreview={() => {}} onClose={close} onError={() => {}} />));
  await click('生成预览'); expect(host.textContent).toContain('正在计算'); await click('取消计算');
  expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
  const first = call.mock.calls.find(([, args]) => args.mode === 'layout-preview')![1];
  expect(call.mock.calls.find(([, args]) => args.mode === 'layout-cancel')![1].requestId).toBe(first.requestId);
  expect(host.querySelector('[aria-label="流程排布预览"]')).toBeNull();
});

it('shows a layout failure and keeps Apply unavailable instead of presenting it as a preview', async () => {
  const call = vi.fn().mockRejectedValue(new Error('布局线程无法运行'));
  await act(async () => root.render(<SelectionLayoutDialog board={makeBoard()} ids={['a', 'b']} client={{ embedded: true, call }} initialMode="flow" labelSizes={() => ({})} canEdit onApply={vi.fn()} onDiscardPreview={() => {}} onClose={() => {}} onError={() => {}} />));
  await click('生成预览'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('布局线程无法运行');
  expect(button('应用排布').disabled).toBe(true); expect(host.querySelector('[aria-label="流程排布预览"]')).toBeNull();
});

it('reads the exact preview basis when the local board lags, including legitimate absent external endpoints', async () => {
  const source = makeBoard([node('a'), node('b', 30), { ...node('edge'), type: 'arrow', from: 'b', to: 'missing' }]);
  const result: FlowLayoutPreview = { requestId: 'exact', artifactId: 'board', revision: 2, direction: 'right', gap: 64, operations: [{ op: 'update', id: 'a', changes: { x: 120 } }], expectedVersions: { a: 2, b: 1, edge: 1, missing: 0, $order: 0 }, affectedIds: ['a'], boundaryIds: ['edge'], skipped: [], warnings: [] };
  const call = vi.fn(async (_name, args) => {
    if (args.mode === 'layout-preview') return result;
    if (args.mode === 'units') return { artifact: { ...source.artifact, revision: 2 }, units: [{ id: 'a', after: { ...source.elements[0], version: 2 } }, { id: 'b', after: source.elements[1] }, { id: 'edge', after: source.elements[2] }, { id: 'missing', after: null }] };
    return { cancelled: false };
  });
  const transport: StudioClient = { embedded: true, async call<T>(name: ToolName, args: Record<string, unknown> = {}) { return await call(name, args) as T; } };
  await act(async () => root.render(<SelectionLayoutDialog board={source} ids={['a', 'b']} client={transport} initialMode="flow" labelSizes={() => ({})} canEdit onApply={vi.fn()} onDiscardPreview={() => {}} onClose={() => {}} onError={() => {}} />));
  await click('生成预览');
  expect(host.querySelector('[aria-label="流程排布预览"]')).not.toBeNull(); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(call.mock.calls.find(([, args]) => args.mode === 'units')![1]).toMatchObject({ atRevision: 2, ids: ['a', 'b', 'edge', 'missing'] });
  expect(button('应用排布').disabled).toBe(true); expect(host.textContent).toContain('布局依据已更新');
});
