import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperMarkdownWriteResult } from '../src/contracts/documents';

const harness = vi.hoisted(() => ({ rpc: vi.fn(), teardown: vi.fn(), stateIndex: 0, states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[], effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => { const index = harness.stateIndex++; const setter = vi.fn(); harness.setters[index] = setter; return [index in harness.states ? harness.states[index] : initial, setter]; },
  useRef: (current: unknown) => ({ current }),
  useEffect: (run: () => (() => void) | void) => { harness.effects.push(run); },
}));
vi.mock('../src/app/api', () => ({ callTool: harness.rpc }));
vi.mock('../src/app/bridge', () => ({ registerBeforeTeardown: harness.teardown }));
vi.mock('../src/app/notes/MarkdownEditor', () => ({ MarkdownEditor: () => null }));
import { MarkdownEditor } from '../src/app/notes/MarkdownEditor';
import { PaperMarkdownComparison, PaperMarkdownView } from '../src/app/PaperMarkdownView';

const props = { active: true, vaultId: 'synthetic-vault', paperPath: 'papers/a', preview: false, onDirtyChange() {}, onBack() {} };
const before = { path: 'papers/a/PAPER.md', content: 'Original body.', revision: 'revision-before', exists: true };
afterEach(() => { harness.rpc.mockReset(); harness.teardown.mockReset(); harness.states = []; harness.setters = []; harness.stateIndex = 0; harness.effects = []; vi.unstubAllGlobals(); });
function seed(content = 'Proposed body.', options: { document?: typeof before | null; preview?: boolean; unconfirmed?: boolean } = {}) {
  harness.states = [{ key: 'synthetic-vault:papers/a', document: options.document === undefined ? before : options.document, content }, false, false, '', '', false, [], null, null, null, false, options.unconfirmed ?? false];
}
function find(node: ReactNode, predicate: (node: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element) ? element : find(element.props.children, predicate);
}
function result(): PaperMarkdownWriteResult { return { vaultId: 'synthetic-vault', paperPath: 'papers/a', path: before.path, content: 'Proposed body.', revision: 'revision-saved', exists: true, offset: 0, nextOffset: null, totalChars: 14, truncated: false, saved: true, dryRun: false, previousRevision: before.revision, recoveryId: null, changes: [{ kind: 'removed', text: before.content }, { kind: 'added', text: 'Proposed body.' }], changesTruncated: false }; }

describe('explicit paper Markdown editing', () => {
  it('keeps loading read-only and uses the App full-document endpoint', async () => {
    seed('', { document: null }); harness.rpc.mockResolvedValue(before);
    PaperMarkdownView(props); harness.effects[1]();
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenCalledWith({ key: 'synthetic-vault:papers/a', document: before, content: before.content }));
    expect(harness.rpc).toHaveBeenCalledTimes(1); expect(harness.rpc.mock.calls[0].slice(0, 2)).toEqual(['paper_markdown', { vaultId: props.vaultId, paperPath: props.paperPath }]);
  });

  it('saves once through the trusted App endpoint and retains edits made while saving', async () => {
    seed(); let complete!: (value: PaperMarkdownWriteResult) => void;
    harness.rpc.mockImplementation(name => name === 'paper_markdown_save' ? new Promise(resolve => { complete = resolve; }) : name === 'paper_markdown' ? Promise.resolve({ ...before, content: 'Proposed body.', revision: 'revision-saved' }) : Promise.resolve({ items: [], truncated: false }));
    const tree = PaperMarkdownView(props), editor = find(tree, node => node.type === MarkdownEditor)!;
    expect(editor.props.imageInsertionDisabled).toBe(true);
    editor.props.onSave(); editor.props.onSave(); expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.rpc.mock.calls[0]).toEqual(['paper_markdown_save', { vaultId: props.vaultId, paperPath: props.paperPath, revision: before.revision, content: 'Proposed body.' }]);
    editor.props.onChange('Newer manual edits.'); complete(result());
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Newer manual edits.', document: expect.objectContaining({ content: 'Proposed body.', revision: 'revision-saved' }) })));
    expect(harness.rpc.mock.calls.map(call => call[0])).toEqual(['paper_markdown_save', 'paper_markdown', 'paper_markdown_history_view']);
  });

  it('does not replay unknown writes and preserves the draft until a read-only verification', async () => {
    seed(); harness.rpc.mockRejectedValue(new Error('synthetic response lost'));
    const tree = PaperMarkdownView(props), editor = find(tree, node => node.type === MarkdownEditor)!;
    editor.props.onSave();
    await vi.waitFor(() => expect(harness.setters[3]).toHaveBeenCalledWith(expect.stringContaining('草稿已保留')));
    editor.props.onSave(); expect(harness.rpc).toHaveBeenCalledTimes(1); expect(harness.setters[0]).not.toHaveBeenCalled();
    harness.rpc.mockResolvedValue({ ...before, content: 'Proposed body.', revision: 'revision-saved' });
    find(tree, node => node.type === 'button' && node.props.children === '核实当前版本')!.props.onClick();
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenCalledWith(expect.objectContaining({ content: 'Proposed body.', document: expect.objectContaining({ revision: 'revision-saved' }) })));
    expect(harness.rpc.mock.calls.at(-1)![0]).toBe('paper_markdown');
  });

  it('compares external changes without replacing the current draft', async () => {
    seed(); const remote = { ...before, content: 'External editor version.', revision: 'external-revision' }; harness.rpc.mockResolvedValue(remote);
    const tree = PaperMarkdownView(props);
    find(tree, node => node.type === 'button' && node.props.children === '核实当前版本')!.props.onClick();
    await vi.waitFor(() => expect(harness.setters[8]).toHaveBeenCalledWith(remote));
    expect(harness.setters[0]).not.toHaveBeenCalled(); expect(harness.rpc).toHaveBeenCalledTimes(1);
  });

  it('protects unsaved drafts on host/browser close without an implicit save', async () => {
    seed(); const addEventListener = vi.fn(), removeEventListener = vi.fn(), unregister = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener }); harness.teardown.mockReturnValue(unregister);
    PaperMarkdownView(props); const cleanup = harness.effects[2]()!;
    await expect(harness.teardown.mock.calls[0][0]()).rejects.toThrow('草稿或保存结果尚未确认');
    const event = { preventDefault: vi.fn() }; addEventListener.mock.calls[0][1](event); expect(event.preventDefault).toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled(); cleanup(); expect(unregister).toHaveBeenCalled(); expect(removeEventListener).toHaveBeenCalled();
  });

  it('disables real saves in preview and does not create a missing PAPER.md', () => {
    seed(); let tree = PaperMarkdownView({ ...props, preview: true });
    const editor = find(tree, node => node.type === MarkdownEditor)!; expect(editor.props.saveDisabled).toBe(true); editor.props.onSave(); expect(harness.rpc).not.toHaveBeenCalled();
    harness.stateIndex = 0; seed('', { document: { ...before, content: '', revision: null as unknown as string, exists: false } });
    tree = PaperMarkdownView(props); expect(find(tree, node => node.type === MarkdownEditor)).toBeUndefined();
    expect(renderToStaticMarkup(tree)).toContain('不会自动解析或创建'); expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('prepares a missing-body task only on request, leaving parsing and sending to Codex', async () => {
    seed('', { document: { ...before, content: '', revision: null as unknown as string, exists: false } });
    let complete!: () => void; const onGenerateBody = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const tree = PaperMarkdownView({ ...props, onGenerateBody });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('只读 · 正文尚未生成'); expect(html).toContain('由你检查并决定发送');
    expect(onGenerateBody).not.toHaveBeenCalled(); expect(harness.rpc).not.toHaveBeenCalled();
    const generate = find(tree, node => node.type === 'button' && node.props.children === '让 Codex 生成论文正文')!;
    generate.props.onClick(); generate.props.onClick(); expect(onGenerateBody).toHaveBeenCalledTimes(1);
    complete(); await vi.waitFor(() => expect(harness.setters[4]).toHaveBeenCalledWith(expect.stringContaining('尚未开始解析')));
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('offers a copyable task when the host cannot attach a draft and blocks preview execution', () => {
    seed('', { document: { ...before, content: '', revision: null as unknown as string, exists: false } });
    let tree = PaperMarkdownView(props);
    const task = find(tree, node => node.type === 'textarea' && node.props['aria-label'] === '生成论文正文任务')!;
    expect(task.props.readOnly).toBe(true); expect(task.props.value).toContain('"synthetic-vault"'); expect(task.props.value).toContain('"papers/a"');
    expect(task.props.value).toContain('仅在缺失时'); expect(task.props.value).toContain('不覆盖正文');
    expect(renderToStaticMarkup(tree)).toContain('粘贴到 Codex 输入框并自行发送');
    const onGenerateBody = vi.fn(); harness.stateIndex = 0; tree = PaperMarkdownView({ ...props, preview: true, onGenerateBody });
    const generate = find(tree, node => node.type === 'button' && node.props.children === '让 Codex 生成论文正文')!;
    expect(generate.props.disabled).toBe(true); generate.props.onClick(); expect(onGenerateBody).not.toHaveBeenCalled(); expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('reports a failed draft attachment without claiming the task was prepared', async () => {
    seed('', { document: { ...before, content: '', revision: null as unknown as string, exists: false } });
    const onGenerateBody = vi.fn().mockRejectedValue(new Error('Synthetic host attachment failure'));
    const tree = PaperMarkdownView({ ...props, onGenerateBody });
    find(tree, node => node.type === 'button' && node.props.children === '让 Codex 生成论文正文')!.props.onClick();
    await vi.waitFor(() => expect(harness.setters[3]).toHaveBeenCalledWith('Synthetic host attachment failure'));
    expect(harness.setters[4]).not.toHaveBeenCalledWith(expect.stringContaining('已附加')); expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('rechecks a missing body and loads the generated document without a write', async () => {
    seed('', { document: { ...before, content: '', revision: null as unknown as string, exists: false } }); harness.rpc.mockResolvedValue(before);
    const tree = PaperMarkdownView(props);
    find(tree, node => node.type === 'button' && node.props.children === '重新检查正文')!.props.onClick();
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenCalledWith({ key: 'synthetic-vault:papers/a', document: before, content: before.content }));
    expect(harness.rpc.mock.calls.map(call => call[0])).toEqual(['paper_markdown']);
  });

  it('unmounts the heavy editor while hidden and retains the unsaved Markdown draft', () => {
    seed('Unsaved body retained across tabs.');
    const hidden = PaperMarkdownView({ ...props, active: false });
    expect(find(hidden, node => node.type === MarkdownEditor)).toBeUndefined();
    harness.effects[1](); expect(harness.rpc).not.toHaveBeenCalled(); expect(harness.setters[0]).not.toHaveBeenCalled();
    harness.stateIndex = 0;
    const visible = PaperMarkdownView(props), editor = find(visible, node => node.type === MarkdownEditor)!;
    expect(editor.props.value).toBe('Unsaved body retained across tabs.'); expect(editor.props.saveDisabled).toBe(false);
  });

  it('opens the saved comparison as the primary body and returns to the retained editing draft', async () => {
    seed(); let complete!: (value: PaperMarkdownWriteResult) => void;
    harness.rpc.mockImplementation(name => name === 'paper_markdown_save' ? new Promise(resolve => { complete = resolve; }) : name === 'paper_markdown' ? Promise.resolve({ ...before, content: 'Proposed body.', revision: 'revision-saved' }) : Promise.resolve({ items: [], truncated: false }));
    const editing = PaperMarkdownView(props), firstEditor = find(editing, node => node.type === MarkdownEditor)!;
    firstEditor.props.onSave(); firstEditor.props.onChange('Keep these newer unsaved edits.'); complete(result());
    await vi.waitFor(() => expect(harness.setters[5]).toHaveBeenCalledWith(true));
    harness.states = harness.states.map((value, index) => harness.setters[index]?.mock.calls.at(-1)?.[0] ?? value); harness.stateIndex = 0;
    const history = PaperMarkdownView(props);
    expect(find(history, node => node.type === MarkdownEditor)).toBeUndefined();
    expect(find(history, node => node.type === 'input' && node.props.type === 'checkbox')).toBeUndefined();
    const comparison = find(history, node => node.type === PaperMarkdownComparison)!;
    expect(comparison.props.before).toBe('Original body.'); expect(comparison.props.proposed).toBe('Proposed body.');
    expect(find(history, node => node.type === 'details' && node.props.className === 'paper-history-policy')!.props.open).not.toBe(true);
    find(history, node => node.type === 'button' && node.props.children === '返回编辑')!.props.onClick();
    harness.states[5] = harness.setters[5].mock.calls.at(-1)![0]; harness.stateIndex = 0;
    const returned = find(PaperMarkdownView(props), node => node.type === MarkdownEditor)!;
    expect(returned.props.value).toBe('Keep these newer unsaved edits.'); expect(returned.props.saveDisabled).toBe(false);
  });

  it('renders actual before/proposed text safely and presents bounded continuation', () => {
    const html = renderToStaticMarkup(<PaperMarkdownComparison before={'<script>before()</script>'} proposed="Updated according to selected remark." offset={20_000} nextOffset={40_000} onNext={() => {}} />);
    expect(html).toContain('&lt;script&gt;before()&lt;/script&gt;'); expect(html).not.toContain('<script>'); expect(html).toContain('Updated according to selected remark.'); expect(html).toContain('<del>'); expect(html).toContain('<ins>'); expect(html).toContain('下一段差异'); expect(html).toContain('20001');
  });
});
