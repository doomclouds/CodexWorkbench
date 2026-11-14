// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { LOCAL_ACTOR, type Actor, type Board, type StudioClient, type ToolName } from '../src/contracts/studio';
import { StudioService } from '../src/core/service';

vi.mock('../src/app/canvas/WhiteboardCanvas', () => ({ default: ({ board, readOnly }: { board: Board; readOnly: boolean }) => <section aria-label="历史测试画布" data-read-only={readOnly} data-a={board.elements.find(item => item.id === 'a')?.text} data-b={board.elements.find(item => item.id === 'b')?.text} /> }));
import StudioApp from '../src/app/StudioApp';

it('lets an editor inspect the batch before/after in place and restore only that object through the real service', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const folder = await mkdtemp(join(tmpdir(), 'agentero-history-ui-')), service = new StudioService({ dataRoot: folder });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const actor: Actor = { id: 'editor-one', name: '编辑者', role: 'editor', kind: 'human' };
  const call = vi.fn((name: ToolName, args: Record<string, unknown> = {}) => service.execute(name, args, actor));
  const client: StudioClient = { embedded: true, call: async <T,>(name: ToolName, args?: Record<string, unknown>) => await call(name, args) as T };
  const button = (label: string) => { const node = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label); if (!node) throw new Error(`Missing ${label}`); return node; };
  const click = async (label: string) => { await act(async () => { const node = button(label); node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); node.click(); }); };
  const wait = async (predicate: () => boolean) => { for (let index = 0; index < 100; index++) { if (predicate()) return; await act(async () => { await new Promise(done => setTimeout(done, 5)); }); } throw new Error(`UI did not settle: ${host.textContent}`); };
  try {
    const created = await service.execute('artifact_manage', { action: 'create', title: '对象恢复', elements: ['a', 'b'].map(id => ({ id, type: 'shape', x: 0, y: 0, w: 100, h: 50, text: `初始 ${id}` })) }, LOCAL_ACTOR) as { board: Board };
    const first = await service.execute('artifact_apply', { artifactId: created.board.artifact.id, expectedRevision: 0, operationId: 'change-a', operations: [{ op: 'update', id: 'a', changes: { text: '参考文字' } }] }, { ...LOCAL_ACTOR, id: 'agent-one', name: 'Agent', kind: 'agent' }) as { board: Board };
    const head = await service.execute('artifact_apply', { artifactId: created.board.artifact.id, expectedRevision: first.board.artifact.revision, operationId: 'change-head', operations: [{ op: 'update', id: 'a', changes: { text: '后续文字' } }, { op: 'update', id: 'b', changes: { text: '保留其他对象' } }] }, LOCAL_ACTOR) as { board: Board };
    const history = await service.execute('artifact_read', { artifactId: created.board.artifact.id, mode: 'history' }, actor);
    const selected = history.batches.find((entry: { revision: number }) => entry.revision === 1);
    await act(async () => root.render(<StudioApp client={client} actor={actor} initialArtifactId={created.board.artifact.id} />));
    await wait(() => !!host.querySelector('[aria-label="历史测试画布"]'));
    await click('版本历史'); await wait(() => !!host.querySelector('[aria-label="展开版本 1"]'));
    await click('展开版本 1'); await wait(() => [...host.querySelectorAll('button')].some(item => item.textContent === '看改动'));
    await click('看改动');
    expect(host.querySelector('.studio-history-difference h2')?.textContent).toBe('元素 · a');
    expect(host.querySelector('[aria-label="逐行改动"]')?.textContent).toContain('初始 a');
    expect(host.querySelector('[aria-label="逐行改动"]')?.textContent).toContain('参考文字');
    expect(host.querySelector('[aria-label="逐行改动"]')?.textContent).not.toContain('后续文字');
    expect(host.querySelector('[aria-label="历史测试画布"]')?.getAttribute('data-read-only')).toBe('false');
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_read' && args?.mode === 'version')).toBe(false);
    expect(call.mock.calls.find(([name, args]) => name === 'artifact_read' && args?.mode === 'diff')?.[1]).toMatchObject({ fromVersionId: selected.beforeVersionId, toVersionId: selected.id });
    await click('只恢复这一处');
    expect(call.mock.calls.some(([name]) => name === 'artifact_apply')).toBe(false);
    await click('确认恢复');
    await wait(() => host.querySelector('[aria-label="历史测试画布"]')?.getAttribute('data-a') === '参考文字' && !host.querySelector('.studio-modal'));
    const saved = await service.execute('artifact_read', { artifactId: created.board.artifact.id }, actor) as Board;
    expect(saved.elements.find(item => item.id === 'b')).toEqual(head.board.elements.find(item => item.id === 'b'));
    expect(saved.elements.find(item => item.id === 'a')!.version).toBeGreaterThan(head.board.elements.find(item => item.id === 'a')!.version);
    expect(call.mock.calls.find(([name]) => name === 'artifact_apply')?.[1]).toMatchObject({ expectedRevision: head.board.artifact.revision, operations: [{ op: 'restore', versionId: selected.id, id: 'a' }] });
    expect((await service.execute('artifact_read', { artifactId: created.board.artifact.id, mode: 'history' }, actor)).history).toHaveLength(4);
  } finally {
    await act(async () => root.unmount()); host.remove(); await service.close(); vi.unstubAllGlobals();
    const target = resolve(folder), parent = resolve(tmpdir());
    if (target.startsWith(`${parent}\\agentero-history-ui-`) || target.startsWith(`${parent}/agentero-history-ui-`)) await rm(target, { force: true, recursive: true });
  }
});
