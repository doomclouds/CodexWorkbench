// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type Feedback, type RoomTimer, type StudioClient } from '../src/contracts/studio';
import type { ProductActivity } from '../src/app/products';

vi.mock('../src/app/canvas/WhiteboardCanvas', () => ({
  default: ({ board, onActivityChange, onSelectionChange, onEditHtml, activities, documentControls }: { board: Board; onActivityChange?: (state: ProductActivity) => void; onSelectionChange?: (ids: string[]) => void; onEditHtml?: (element?: Board['elements'][number]) => void; activities?: Feedback[]; documentControls?: ReactNode }) => <section aria-label="测试画布" data-artifact={board.artifact.id} data-activities={activities?.map(item => item.id).join(',')}>{documentControls}<button onClick={() => { onSelectionChange?.(['region']); onActivityChange?.({ editingIds: ['region'], movingIds: [], dirty: true, issues: [{ type: 'save', message: '待保存', ids: ['region'] }] }); }}>编辑区域</button><button onClick={() => onEditHtml?.(board.elements.find(element => element.id === 'region'))}>编辑 HTML</button></section>,
}));
import StudioApp from '../src/app/StudioApp';
import { whiteboardProduct } from '../src/app/products/whiteboard';

const makeBoard = (id: string): Board => ({ artifact: { id, type: 'whiteboard', title: id, revision: 0, pinned: false, createdAt: '', updatedAt: '' }, elements: [{ id: 'region', type: 'html', text: '区域', html: '<h1>原文</h1>', version: 1, sourceRevision: 1, x: 0, y: 0, w: 100, h: 100 }], style: DEFAULT_STYLE });
let container: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function button(label: string) { const found = [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label); if (!found) throw new Error(`Missing ${label}`); return found; }
async function click(label: string) { await act(async () => button(label).click()); }
async function change(textarea: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value); textarea.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function waitUntil(check: () => boolean) { for (let i = 0; i < 40; i++) { if (check()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } throw new Error('UI did not settle'); }

it('publishes actual activity for this view, passes only processing feedback and clears it when switching artifacts', async () => {
  const board = makeBoard('first'), onContext = vi.fn();
  const processing: Feedback = { id: 'processing', artifactId: 'first', type: 'request', anchor: { elementIds: ['region'] }, author: LOCAL_ACTOR, status: 'processing', text: '修改区域', createdAt: '', updatedAt: '', replies: [], processingBy: { ...LOCAL_ACTOR, kind: 'agent' } };
  const client: StudioClient = { embedded: true, call: vi.fn(async (name, args) => name === 'artifact_feedback' ? { feedback: [processing, { ...processing, id: 'resolved', status: 'resolved' }] } : name === 'artifact_read' ? makeBoard(String(args?.artifactId)) : { artifacts: [] }) as StudioClient['call'] };
  await act(async () => root.render(<StudioApp client={client} actor={LOCAL_ACTOR} initialArtifactId={board.artifact.id} onViewContext={onContext} />));
  await waitUntil(() => !!container.querySelector('[aria-label="测试画布"]'));
  expect(container.querySelector('[aria-label="测试画布"]')?.getAttribute('data-activities')).toBe('processing');
  await click('编辑区域');
  const context = onContext.mock.calls.at(-1)?.[0];
  expect(context).toMatchObject({ artifactId: 'first', selectedIds: ['region'], editingIds: ['region'], movingIds: [], dirty: true, issues: [{ type: 'save', message: '待保存', ids: ['region'] }] });
  await act(async () => root.render(<StudioApp client={client} actor={LOCAL_ACTOR} initialArtifactId="second" onViewContext={onContext} />));
  await waitUntil(() => container.querySelector('[aria-label="测试画布"]')?.getAttribute('data-artifact') === 'second');
  expect(onContext.mock.calls.at(-1)?.[0]).toMatchObject({ artifactId: 'second', viewId: context.viewId, selectedIds: [], editingIds: [], movingIds: [], dirty: false, issues: [] });
});

it('reports source editing and preserves the dirty draft and failure until a successful retry', async () => {
  const board = makeBoard('source-board'), onActivity = vi.fn(), onChanged = vi.fn(), onError = vi.fn();
  let attempts = 0;
  const client: StudioClient = { embedded: true, call: vi.fn(async (name) => {
    if (name === 'artifact_read') return { html: '<h1>原文</h1>' };
    if (++attempts === 1) throw new Error('连接断开');
    return { board };
  }) as StudioClient['call'] };
  const Editor = whiteboardProduct.Editor;
  await act(async () => root.render(<Editor document={board} actor={LOCAL_ACTOR} client={client} onChanged={onChanged} onError={onError} onNotice={() => {}} onActivityChange={onActivity} onAnnotate={() => {}} onSelectionChange={() => {}} onViewportChange={() => {}} onCursorMove={() => {}} presence={[]} selfPeerId="test" />));
  await click('编辑 HTML');
  expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({ editingIds: ['region'], dirty: false });
  const draft = '<h1>保留我的草稿</h1>';
  await change(container.querySelector('textarea')!, draft);
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector('textarea')?.value).toBe(draft);
  expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({ editingIds: ['region'], dirty: true, issues: [{ type: 'source-save', message: '连接断开', ids: ['region'] }] });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(onChanged).toHaveBeenCalledWith(board); expect(container.querySelector('textarea')).toBeNull();
  expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({ editingIds: [], movingIds: [], dirty: false, issues: [] });
});

it('uses the shared presence channel to start, pause, resume and reset the room timer', async () => {
  let timer: RoomTimer | null = null;
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    const input = JSON.parse(String(options?.body));
    if (input.timer?.action === 'start') timer = { deadline: Date.now() + input.timer.durationSeconds * 1000, remainingMs: input.timer.durationSeconds * 1000, paused: false, source: LOCAL_ACTOR };
    else if (input.timer?.action === 'pause') timer = { ...timer!, deadline: null, paused: true };
    else if (input.timer?.action === 'resume') timer = { ...timer!, deadline: Date.now() + timer!.remainingMs, paused: false };
    else if (input.timer?.action === 'reset') timer = null;
    return new Response(JSON.stringify({ peers: [], timer }), { headers: { 'Content-Type': 'application/json' } });
  });
  const client: StudioClient = { embedded: true, baseUrl: 'http://studio.test', token: 'test-token', call: vi.fn(async name => name === 'artifact_feedback' ? { feedback: [] } : makeBoard('timer-board')) as StudioClient['call'] };
  await act(async () => root.render(<StudioApp client={client} actor={LOCAL_ACTOR} initialArtifactId="timer-board" />));
  await waitUntil(() => !!container.querySelector('[aria-label="测试画布"]'));
  await click('共享计时器');
  await click('开始');
  expect(container.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('05:00');
  await click('暂停'); expect(container.querySelector('.studio-timer-footer')?.textContent).toContain('已暂停');
  await click('继续'); expect(container.querySelector('.studio-timer-footer')?.textContent).toContain('计时中');
  await click('重置'); expect(container.querySelector('[aria-label="剩余时间"]')).toBeNull();
  const actions = request.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).timer).filter(Boolean);
  expect(actions).toEqual([{ action: 'start', durationSeconds: 300 }, { action: 'pause' }, { action: 'resume' }, { action: 'reset' }]);
});
