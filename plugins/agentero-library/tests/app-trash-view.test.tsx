import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrashEntry, TrashList } from '../src/contracts/trash';

const harness = vi.hoisted(() => ({
  rpc: vi.fn(), stateIndex: 0, states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[],
  effects: [] as (() => (() => void) | void)[],
}));
// A handler/effect harness, not a browser renderer. Root owns isolated browser QA.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.stateIndex++;
    const value = index in harness.states ? harness.states[index] : typeof initial === 'function' ? (initial as () => unknown)() : initial;
    const setter = vi.fn(); harness.setters[index] = setter;
    return [value, setter];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: (run: () => (() => void) | void) => { harness.effects.push(run); },
}));
vi.mock('../src/app/api', () => ({ callTool: harness.rpc }));
import { filterTrashPage, TrashPageContents, TrashView } from '../src/app/TrashView';

afterEach(() => {
  harness.rpc.mockReset(); harness.states = []; harness.setters = []; harness.stateIndex = 0; harness.effects = [];
});
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function item(overrides: Partial<TrashEntry> = {}): TrashEntry {
  return { id: 'entry-one', batchId: 'batch-one', storedId: 'stored-one', title: '一篇合成论文', kind: 'paper', originalPath: 'papers/中文 synthetic paper', deletedAt: '2026-11-10T08:00:00Z', itemsCount: 1, pdfAvailable: true, folderAvailable: true, ...overrides };
}
function page(overrides: Partial<TrashList> = {}): TrashList {
  return { vaultId: 'synthetic-vault', items: [item()], total: 1, nextCursor: null, complete: true, truncated: false, diagnostics: { scannedBatches: 1, skippedBatches: 0, skippedItems: 0, warnings: [] }, restoreSupported: false, restoreReason: '当前版本暂不支持恢复。', ...overrides };
}
function find(node: ReactNode, predicate: (node: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element) ? element : find(element.props.children, predicate);
}
function seed(current: TrashList | null, options: { loading?: boolean; error?: string; query?: string; cursor?: string; history?: (string | undefined)[] } = {}) {
  harness.states = [current, options.loading ?? false, options.error ?? '', '', options.query ?? '', { vaultId: 'synthetic-vault', cursor: options.cursor, history: options.history ?? [] }];
}
function contents(current: TrashList | null, options: { loading?: boolean; query?: string; preview?: boolean } = {}) {
  return renderToStaticMarkup(<TrashPageContents page={current} items={filterTrashPage(current?.items ?? [], options.query ?? '')} loading={options.loading ?? false} query={options.query ?? ''} preview={options.preview ?? false} opening="" onOpen={() => {}} />);
}

describe('read-only trash presentation', () => {
  it('shows deleted metadata, both explicit actions and no invented recovery or destructive controls', () => {
    seed(page());
    const html = renderToStaticMarkup(TrashView({ active: true, vaultId: 'synthetic-vault', preview: false }));
    expect(html).toContain('一篇合成论文'); expect(html).toContain('papers/中文 synthetic paper');
    expect(html).toContain('当前版本暂不支持恢复');
    expect(html).toContain('打开 PDF'); expect(html).toContain('批次目录');
    expect(html).not.toMatch(/>恢复<|>永久删除<|>清空/);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('distinguishes loading, known empty and unavailable data instead of claiming all errors mean empty', () => {
    expect(contents(null, { loading: true })).toContain('正在读取回收站');
    expect(contents(page({ items: [], total: 0 }))).toContain('回收站为空');
    expect(contents(null)).toContain('回收站尚未读取');
    seed(null, { error: '合成清单读取失败' });
    const html = renderToStaticMarkup(TrashView({ active: true, vaultId: 'synthetic-vault', preview: false }));
    expect(html).toContain('role="alert"'); expect(html).toContain('合成清单读取失败');
    expect(html).toContain('重新加载'); expect(html).not.toContain('回收站为空');
  });

  it('reports incomplete and unknown manifests even when no valid rows remain', () => {
    const html = contents(page({ items: [], total: 0, complete: false, truncated: true, diagnostics: { scannedBatches: 4, skippedBatches: 2, skippedItems: 1, warnings: ['未知 manifest version：synthetic-v9', 'synthetic-invalid.json 无法读取'] } }));
    expect(html).toContain('不是回收站完整总数'); expect(html).toContain('跳过 2 个批次、1 个项目');
    expect(html).toContain('未知 manifest version：synthetic-v9'); expect(html).toContain('本次没有可展示的项目');
    expect(html).not.toContain('<strong>回收站为空</strong>');
  });

  it('filters only supplied page rows, preserves unknown dates and escapes untrusted metadata', () => {
    const rows = [item(), item({ id: 'second', title: '<img src=x onerror=alert(1)>', originalPath: 'notes/DOI-ABC.md', deletedAt: 'not-a-date' })];
    expect(filterTrashPage(rows, 'doi-abc')).toEqual([rows[1]]);
    expect(filterTrashPage(rows, ' 中文 ')).toEqual([rows[0]]);
    const html = contents(page({ items: rows }), { query: 'DOI' });
    expect(html).toContain('删除时间未知'); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
    expect(html).not.toContain('一篇合成论文');
    expect(contents(page({ items: rows }), { query: 'other-page-only' })).toContain('本页没有匹配的项目');
  });

  it('keeps unavailable PDF and preview actions disabled without inventing file paths', () => {
    const row = item({ pdfAvailable: false, folderAvailable: true, itemsCount: 3 });
    const onOpen = vi.fn();
    const tree = TrashPageContents({ page: page({ items: [row] }), items: [row], loading: false, query: '', preview: false, opening: '', onOpen });
    const pdf = find(tree, node => node.props['aria-label'] === `打开 PDF：${row.title}`)!;
    const folder = find(tree, node => node.props['aria-label'] === `打开批次目录：${row.title}`)!;
    expect(pdf.props.disabled).toBe(true); expect(folder.props.disabled).toBe(false);
    folder.props.onClick(); expect(onOpen).toHaveBeenCalledWith(row, 'folder');
    const preview = contents(page({ items: [row] }), { preview: true });
    expect(preview).toContain('同一删除批次含 3 个项目');
    expect(preview.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe('trash requests and navigation', () => {
  it('does not load hidden views or call the real backend in preview', async () => {
    expect(TrashView({ active: false, vaultId: 'synthetic-vault', preview: false })).toBeNull();
    harness.effects[0](); expect(harness.rpc).not.toHaveBeenCalled();
    harness.stateIndex = 0; harness.effects = [];
    TrashView({ active: true, vaultId: 'synthetic-vault', preview: true });
    harness.effects[0]();
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenCalled());
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('aborts on hide/unmount and ignores a late reply even if the host did not cancel its work', async () => {
    const request = deferred<TrashList>(); harness.rpc.mockReturnValue(request.promise);
    TrashView({ active: true, vaultId: 'synthetic-vault', preview: false });
    const cleanup = harness.effects[0]()!;
    const signal = harness.rpc.mock.calls[0][2].signal as AbortSignal;
    expect(harness.rpc.mock.calls[0][0]).toBe('trash_list');
    expect(harness.rpc.mock.calls[0][1]).toEqual({ vaultId: 'synthetic-vault', limit: 50, cursor: undefined, refresh: false });
    cleanup(); expect(signal.aborted).toBe(true);
    request.resolve(page()); await request.promise; await Promise.resolve();
    expect(harness.setters[0].mock.calls).toEqual([[null]]);
  });

  it('rejects replies from another vault instead of displaying or opening old-vault rows', async () => {
    harness.rpc.mockResolvedValue(page({ vaultId: 'another-vault' }));
    TrashView({ active: true, vaultId: 'synthetic-vault', preview: false }); harness.effects[0]();
    await vi.waitFor(() => expect(harness.setters[2]).toHaveBeenCalledWith(expect.stringContaining('其他知识库')));
    expect(harness.setters[0].mock.calls).toEqual([[null]]);
  });

  it('uses backend cursors while local page search itself does not issue a tool request', () => {
    seed(page({ nextCursor: 'synthetic-next' }));
    const tree = TrashView({ active: true, vaultId: 'synthetic-vault', preview: false });
    find(tree, node => node.props['aria-label'] === '搜索本页回收站')!.props.onChange({ target: { value: '中文' } });
    expect(harness.setters[4]).toHaveBeenCalledWith('中文'); expect(harness.rpc).not.toHaveBeenCalled();
    find(tree, node => node.props['aria-label'] === '回收站下一页')!.props.onClick();
    expect(harness.setters[5]).toHaveBeenCalledWith({ vaultId: 'synthetic-vault', cursor: 'synthetic-next', history: [undefined] });
  });

  it('opens only the explicitly selected server IDs and reports a request rather than viewer success', async () => {
    const current = page(); seed(current);
    harness.rpc.mockResolvedValue({ requested: true, target: 'folder' });
    const tree = TrashView({ active: true, vaultId: 'synthetic-vault', preview: false });
    const body = find(tree, node => node.type === TrashPageContents)!;
    body.props.onOpen(current.items[0], 'folder'); body.props.onOpen(current.items[0], 'folder');
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.rpc.mock.calls[0].slice(0, 2)).toEqual(['trash_open', { vaultId: 'synthetic-vault', batchId: 'batch-one', storedId: 'stored-one', target: 'folder' }]);
    await vi.waitFor(() => expect(harness.setters[3]).toHaveBeenCalledWith('已请求系统打开该删除批次的目录。'));
    expect(harness.rpc.mock.calls[0][1]).not.toHaveProperty('path');
  });

  it('does not launch real files in preview even if an action handler is invoked directly', () => {
    const current = page(); seed(current);
    const tree = TrashView({ active: true, vaultId: 'synthetic-vault', preview: true });
    find(tree, node => node.type === TrashPageContents)!.props.onOpen(current.items[0], 'folder');
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('cancels an outstanding open on hide and ignores its late result', async () => {
    const current = page(); seed(current); const request = deferred<unknown>(); harness.rpc.mockReturnValue(request.promise);
    const tree = TrashView({ active: true, vaultId: 'synthetic-vault', preview: false });
    const cleanup = harness.effects[1]()!;
    find(tree, node => node.type === TrashPageContents)!.props.onOpen(current.items[0], 'pdf');
    const signal = harness.rpc.mock.calls[0][2].signal as AbortSignal;
    cleanup(); expect(signal.aborted).toBe(true);
    request.resolve({ requested: true, target: 'pdf' }); await request.promise; await Promise.resolve();
    expect(harness.setters[3].mock.calls).toEqual([['']]);
    expect(harness.setters[7].mock.calls).toContainEqual(['']);
  });
});
