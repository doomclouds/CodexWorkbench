// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Actor, type Board, type Feedback, type StudioClient, type ToolName } from '../src/contracts/studio';
import { StudioService } from '../src/core/service';

vi.mock('../src/app/canvas/WhiteboardCanvas', () => ({
  default: ({ board, onChanged, onAnnotate, onSelectionChange, readOnly }: { board: Board; onChanged: (board: Board) => void; onAnnotate: (selection: unknown) => void; onSelectionChange?: (ids: string[]) => void; readOnly?: boolean }) => <section aria-label="白板画布" data-revision={board.artifact.revision} data-read-only={String(!!readOnly)}>
    <button onClick={() => onAnnotate({ regionId: 'region-one', sourceRevision: 1, targetIds: ['node-input'], quote: '输入节点', excerpt: '输入节点 → 输出节点', selector: '[data-node="input"]', rect: { x: 10, y: 20, w: 80, h: 30 } })}>标注 HTML 内部</button>
    <button onClick={() => onSelectionChange?.(['region-one'])}>选择 HTML 区域</button>
    <button onClick={() => onChanged({ ...board, artifact: { ...board.artifact, revision: board.artifact.revision + 5 } })}>模拟较新画布版本</button>
  </section>,
}));
import StudioApp from '../src/app/StudioApp';

let folder = '';
let service: StudioService;
let container: HTMLDivElement;
let root: Root;
let client: StudioClient;
let call: Mock<(name: ToolName, args: Record<string, any>) => Promise<any>>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  folder = await mkdtemp(join(tmpdir(), 'agentero-studio-app-'));
  service = new StudioService({ dataRoot: folder });
  service.configureSharing(async () => 'http://127.0.0.1:49177');
  call = vi.fn((name: ToolName, args: Record<string, unknown> = {}) => service.execute(name, args, LOCAL_ACTOR));
  client = { embedded: true, async call<T>(name: ToolName, args?: Record<string, unknown>) { return await call(name, args || {}) as T; } };
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  await service?.close();
  const parent = resolve(tmpdir()); const target = resolve(folder);
  if (target.startsWith(`${parent}\\agentero-studio-app-`) || target.startsWith(`${parent}/agentero-studio-app-`)) await rm(target, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function mount(options: { artifactId?: string; actor?: Actor; attach?: (feedback: Feedback, board: Pick<Board, 'artifact'>) => Promise<void> } = {}) {
  await act(async () => root.render(<StudioApp client={client} actor={options.actor || LOCAL_ACTOR} initialArtifactId={options.artifactId} attachContext={options.attach} />));
}
async function waitUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (check()) return;
  }
  throw new Error(`UI did not reach expected state. ${container.textContent?.slice(0, 1500)}`);
}
function button(label: string, partial = false): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(element => element.getAttribute('aria-label') === label || (partial ? element.textContent?.includes(label) : element.textContent?.trim() === label));
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function createFixture(elements: Board['elements'] = []) {
  return await service.execute('artifact_manage', { action: 'create', title: '架构讨论', elements }, LOCAL_ACTOR) as { board: Board };
}
function region(html = '<h1 data-node="input">输入节点</h1>'): Board['elements'][number] {
  return { id: 'region-one', type: 'html', x: 0, y: 0, w: 700, h: 500, version: 1, sourceRevision: 1, html, text: '系统架构' };
}
async function apply(board: Board, operations: unknown[]) {
  return await service.execute('artifact_apply', { artifactId: board.artifact.id, operationId: crypto.randomUUID(), expectedRevision: board.artifact.revision, operations }, LOCAL_ACTOR) as { board: Board };
}

describe('Studio real management workflows', () => {
  it('keeps search, filters, views, import and icon theme switching usable in the compact library header', async () => {
    await createFixture();
    await service.execute('artifact_manage', { action: 'create', title: '系统规划' }, LOCAL_ACTOR);
    const items = await service.execute('artifact_list', {}, LOCAL_ACTOR);
    const pinned = items.artifacts.find((item: { id: string; title: string }) => item.title === '系统规划')!;
    await service.execute('artifact_manage', { action: 'pin', artifactId: pinned.id, pinned: true }, LOCAL_ACTOR);
    await mount();
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 2);

    expect(container.querySelector('select[aria-label="主题"]')).toBeNull();

    await click(button('切换为列表视图'));
    expect(container.querySelector('.studio-artifacts-list')).not.toBeNull();
    expect(localStorage.getItem('agentero-studio-view')).toBe('list');
    expect(button('切换为卡片视图').title).toBe('切换为卡片视图');
    await click(button('切换为卡片视图'));
    expect(container.querySelector('.studio-artifacts-grid')).not.toBeNull();
    expect(localStorage.getItem('agentero-studio-view')).toBe('grid');
    await click(button('切换为列表视图'));
    await click(button('搜索作品'));
    const search = container.querySelector<HTMLInputElement>('[aria-label="搜索作品名称"]')!;
    expect(document.activeElement).toBe(search);
    await change(search, '架构');
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1);
    expect(container.querySelector('.studio-artifact h3')?.textContent).toBe('架构讨论');
    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 2);
    expect(container.querySelector('[aria-label="搜索作品名称"]')).toBeNull();
    expect(document.activeElement).toBe(button('搜索作品'));

    await click(button('筛选作品'));
    expect(document.activeElement).toBe(button('最近作品'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(button('已固定'));
    await click(button('已固定'));
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1);
    expect(container.querySelector('.studio-artifact h3')?.textContent).toBe('系统规划');
    expect(button('筛选作品').getAttribute('aria-expanded')).toBe('false');
    await click(button('筛选作品'));
    expect(document.activeElement).toBe(button('已固定'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(button('筛选作品'));
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await click(button('切换为暗色主题'));
    expect(container.querySelector('.studio')?.getAttribute('data-studio-theme')).toBe('dark');
    expect(button('切换为明亮主题').textContent).toBe('');
    await click(button('切换为明亮主题'));
    expect(container.querySelector('.studio')?.getAttribute('data-studio-theme')).toBe('light');
    const archive = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const chooseArchive = vi.spyOn(archive, 'click').mockImplementation(() => {});
    await click(button('新建作品'));
    expect(document.activeElement).toBe(button('白板'));
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await click(button('新建作品'));
    await click(button('导入作品'));
    expect(chooseArchive).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('creates from the new menu, renames, pins, trashes and restores the same persisted artifact', async () => {
    await mount();
    await waitUntil(() => call.mock.calls.some(([name]) => name === 'artifact_list'));
    await click(button('新建作品'));
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_manage' && args.action === 'create')).toBe(false);
    expect(container.querySelector('[aria-label="白板画布"]')).toBeNull();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(button('导入作品'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button('新建作品'));
    await act(async () => button('新建作品').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await click(button('白板'));
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    expect(container.querySelector('select[aria-label="主题"]')).toBeNull();
    await click(button('切换为暗色主题'));
    expect(container.querySelector('.studio')?.getAttribute('data-studio-theme')).toBe('dark');
    await click(button('切换为明亮主题'));
    let items = await service.execute('artifact_list', {}, LOCAL_ACTOR);
    expect(items.artifacts).toHaveLength(1);
    const artifactId = items.artifacts[0].id;

    const title = container.querySelector<HTMLInputElement>('[aria-label="白板名称"]')!;
    await act(async () => title.focus());
    await change(title, '硬件系统架构');
    await act(async () => title.blur());
    await waitUntil(() => call.mock.calls.some(([name, args]) => name === 'artifact_manage' && args.action === 'rename'));
    await click(button('返回作品中心'));
    await waitUntil(() => !!container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    await click(button('管理作品：硬件系统架构'));
    await click(button('固定'));
    await waitUntil(() => !!container.querySelector('.studio-pin-mark'));
    items = await service.execute('artifact_list', { pinned: true }, LOCAL_ACTOR);
    expect(items.artifacts.map((item: { id: string }) => item.id)).toEqual([artifactId]);

    await click(button('管理作品：硬件系统架构'));
    await click(button('移入回收站'));
    await waitUntil(() => !container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    expect((await service.execute('artifact_list', {}, LOCAL_ACTOR)).artifacts).toHaveLength(0);
    await click(button('筛选作品'));
    await click(button('回收站'));
    await waitUntil(() => !!container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    await click(button('恢复'));
    await waitUntil(() => !container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    items = await service.execute('artifact_list', {}, LOCAL_ACTOR);
    expect(items.artifacts[0]).toMatchObject({ id: artifactId, title: '硬件系统架构', pinned: true });
    expect(items.artifacts[0].trashedAt).toBeUndefined();
  });

  it('imports HTML as a real persisted region with a checked board revision', async () => {
    const fixture = await createFixture();
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('导入 HTML'));
    const html = '<!doctype html><html><body><svg><rect data-node="input" width="80" height="40"/></svg></body></html>';
    await change(container.querySelector<HTMLTextAreaElement>('#studio-html-source')!, html);
    await submit(container.querySelector<HTMLFormElement>('[role="dialog"] form')!);
    await waitUntil(() => !container.querySelector('[role="dialog"]'));
    let saved = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id });
    expect(saved.elements).toHaveLength(1);
    expect(saved.elements[0]).toMatchObject({ type: 'html', html, sourceRevision: 1 });
    const request = call.mock.calls.find(([name]) => name === 'artifact_apply');
    expect(request?.[1].operationId).toBeTruthy();
    expect(request?.[1].expectedRevision).toBe(fixture.board.artifact.revision);
  });

  it('freezes internal HTML selection and original source even when the region changed before commenting', async () => {
    const original = '<h1 data-node="input">输入节点</h1>';
    const fixture = await createFixture([region(original)]);
    const attach = vi.fn(async (_feedback: Feedback, _board: Pick<Board, 'artifact'>) => {});
    await mount({ artifactId: fixture.board.artifact.id, attach });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('标注 HTML 内部'));
    await apply(fixture.board, [{ op: 'update', id: 'region-one', changes: { html: '<h1>已被他人修改的新内容</h1>' } }]);
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '把输入节点改成强调色');
    await submit(container.querySelector<HTMLFormElement>('.studio-feedback-compose')!);
    await waitUntil(() => !!container.querySelector('[data-feedback-id]'));
    const result = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0].anchor).toMatchObject({ regionId: 'region-one', sourceRevision: 1, targetIds: ['node-input'], quote: '输入节点' });
    const source = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id, mode: 'source', feedbackId: result.feedback[0].id });
    expect(source.html).toBe(original);
    await click(button('附加到对话'));
    await waitUntil(() => attach.mock.calls.length === 1);
    expect(attach.mock.calls[0]?.[0]).toMatchObject({ id: result.feedback[0].id, anchor: result.feedback[0].anchor });
  });

  it('keeps a Web guest request pending for the owner instead of pretending to send a Codex message', async () => {
    const fixture = await createFixture([region()]);
    const guest: Actor = { id: 'guest-one', name: '同事', kind: 'human', role: 'commenter' };
    client.embedded = false;
    call.mockImplementation((name: ToolName, args: Record<string, unknown> = {}) => service.execute(name, args, guest));
    await mount({ artifactId: fixture.board.artifact.id, actor: guest });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('批注与请求'));
    await change(container.querySelector<HTMLSelectElement>('[aria-label="反馈类型"]')!, 'request');
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '请补充状态机');
    await submit(container.querySelector<HTMLFormElement>('.studio-feedback-compose')!);
    await waitUntil(() => !!container.querySelector('[data-feedback-id]'));
    const { feedback } = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(feedback[0]).toMatchObject({ type: 'request', status: 'pending', author: { id: guest.id }, text: '请补充状态机' });
    expect(call.mock.calls.find(([name, args]) => name === 'artifact_feedback' && args.action === 'send')?.[1]).toMatchObject({ artifactId: fixture.board.artifact.id, feedbackId: feedback[0].id });
    expect(container.querySelector('[aria-label="返回作品中心"]')).toBeNull();
  });

  it('previews history without mutating the live board, then restores while retaining subsequent history', async () => {
    const fixture = await createFixture();
    const changed = await apply(fixture.board, [{ op: 'add', element: { id: 'shape-one', type: 'shape', x: 20, y: 20, w: 100, h: 80, text: '新内容' } }]);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('版本历史'));
    await waitUntil(() => container.querySelectorAll('.studio-history-item').length === 2);
    await click(button('版本 0', true));
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'true');
    expect((await service.execute('artifact_read', { artifactId: fixture.board.artifact.id })).elements).toHaveLength(1);
    await click(button('恢复此版本'));
    await waitUntil(() => call.mock.calls.some(([name, args]) => name === 'artifact_apply' && args.operations?.[0]?.op === 'restore'));
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'false');
    const current = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id });
    const { history } = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id, mode: 'history' });
    expect(current.elements).toHaveLength(0);
    expect(current.artifact.revision).toBeGreaterThan(changed.board.artifact.revision);
    expect(history).toHaveLength(3);
    expect(history.at(-1).restoredFrom).toBe(history[0].id);
  });

  it('rejects restoring a stale preview rather than overwriting another collaborator’s later change', async () => {
    const fixture = await createFixture();
    const first = await apply(fixture.board, [{ op: 'add', element: { id: 'shape-one', type: 'shape', x: 0, y: 0, w: 120, h: 80, text: '原内容' } }]);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('版本历史'));
    await waitUntil(() => container.querySelectorAll('.studio-history-item').length === 2);
    await click(button('版本 0', true));
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'true');
    const second = await apply(first.board, [{ op: 'update', id: 'shape-one', changes: { text: '他人刚刚修改' } }]);
    await click(button('恢复此版本'));
    await waitUntil(() => !!container.querySelector('[role="alert"]'));
    const saved = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id });
    expect(saved.artifact.revision).toBe(second.board.artifact.revision);
    expect(saved.elements[0].text).toBe('他人刚刚修改');
  });

  it('offers a work link without silently enabling LAN access or copying an owner token', async () => {
    const fixture = await createFixture();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount();
    await waitUntil(() => !!container.querySelector(`[aria-label="管理作品：${fixture.board.artifact.title}"]`));
    await click(button(`管理作品：${fixture.board.artifact.title}`));
    await click(button('复制链接'));
    await waitUntil(() => !!container.querySelector('[aria-label="分享面板"]'));
    expect((await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id })).enabled).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    await click(button('开启局域网分享'));
    await waitUntil(() => !!container.querySelector('[aria-label="可编辑分享链接"]'));
    const sharing = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    await click(button('返回作品中心'));
    await waitUntil(() => !!container.querySelector(`[aria-label="管理作品：${fixture.board.artifact.title}"]`));
    await click(button(`管理作品：${fixture.board.artifact.title}`));
    await click(button('复制链接'));
    await waitUntil(() => writeText.mock.calls.length === 1);
    expect(writeText).toHaveBeenCalledWith(sharing.links.viewer);
  });
  it('starts role-based LAN sharing, rotates one role link and revokes sharing', async () => {
    const fixture = await createFixture();
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('分享'));
    await waitUntil(() => !!container.querySelector('[aria-label="分享面板"] .studio-full-width'));
    await click(button('开启局域网分享'));
    await waitUntil(() => !!container.querySelector('[aria-label="可编辑分享链接"]'));
    const previous = container.querySelector<HTMLInputElement>('[aria-label="可编辑分享链接"]')!.value;
    const before = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(before.enabled).toBe(true); expect(previous).toBe(before.links.editor);
    await click(button('重置此链接'));
    await waitUntil(() => container.querySelector<HTMLInputElement>('[aria-label="可编辑分享链接"]')?.value !== previous);
    const after = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(after.links.editor).not.toBe(before.links.editor);
    expect(after.links.viewer).toBe(before.links.viewer);
    await click(button('关闭分享'));
    await waitUntil(() => !!container.querySelector('[aria-label="分享面板"] .studio-primary'));
    expect((await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id })).enabled).toBe(false);
  });
});

describe('Studio stale response protection', () => {
  it('ignores an older read result after a newer canvas commit', async () => {
    let resolveRead!: (board: Board) => void;
    const baseline: Board = { artifact: { id: 'synthetic-board', type: 'whiteboard', title: '并发白板', revision: 0, pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, elements: [], style: DEFAULT_STYLE };
    call.mockImplementation((name: ToolName) => {
      if (name === 'artifact_list') return Promise.resolve({ artifacts: [] });
      if (name === 'artifact_manage') return Promise.resolve({ artifact: baseline.artifact, board: baseline });
      if (name === 'artifact_feedback') return Promise.resolve({ feedback: [] });
      if (name === 'artifact_read') return new Promise<Board>(resolve => { resolveRead = resolve; });
      throw new Error(`Unexpected ${name}`);
    });
    await mount();
    await click(button('新建白板'));
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]') && !!resolveRead);
    await click(button('模拟较新画布版本'));
    expect(container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-revision')).toBe('5');
    await act(async () => { resolveRead(baseline); });
    expect(container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-revision')).toBe('5');
  });
});
