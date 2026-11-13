import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadingContextSummary } from '../src/contracts/context';
import { paperMarkdownGenerationDraft, readingDraft } from '../src/app/reading-context-client';

const state = vi.hoisted(() => ({ apps: [] as any[], supported: true, draft: '用户原来的问题。', attachments: [] as unknown[], submitted: 0 }));
vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    constructor() { state.apps.push(this); }
    connect = vi.fn(async () => {});
    getHostContext = () => ({ theme: 'dark' });
    getHostCapabilities = () => ({ message: { text: {} }, experimental: state.supported ? { 'openai/message': {} } : {} });
    callServerTool = vi.fn();
    sendMessage = vi.fn(async (params: any) => {
      if (params._meta?.['openai/message']?.send !== false) state.submitted += 1;
      for (const item of params.content) {
        if (item._meta?.['openai/title']) state.attachments.push(item);
        else state.draft += item.text;
      }
      return {};
    });
  },
  PostMessageTransport: class {},
  applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn(),
}));

const context: ReadingContextSummary = { contextId: 'a0a00000-0000-4000-8000-000000000001', vaultId: 'vault-id', paperId: 'paper-id', paperPath: 'papers/Source 中文', title: 'Source 中文', pages: [7, 8, 12], marksCount: 6, action: 'summarize', createdAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-19T00:00:00Z', imageIds: [] };
afterEach(() => { vi.unstubAllGlobals(); state.apps.length = 0; state.supported = true; state.draft = '用户原来的问题。'; state.attachments = []; state.submitted = 0; });
async function bridge() {
  vi.resetModules(); vi.stubGlobal('window', { parent: {} }); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const api = await import('../src/app/bridge');
  const app = state.apps[0];
  app.callServerTool.mockResolvedValue({ structuredContent: { ok: true, data: context } });
  return { api, app };
}

describe('native composer reading context', () => {
  it('prepares a paper generation task without parsing, writing, replacing the draft, or submitting', async () => {
    const { api, app } = await bridge();
    app.callServerTool.mockResolvedValue({ structuredContent: { ok: true, data: { vaultId: context.vaultId, path: context.paperPath, title: context.title } } });
    await api.appendPaperMarkdownGenerationDraft({ vaultId: context.vaultId, paperPath: context.paperPath });
    expect(app.callServerTool.mock.calls.map((call: any) => call[0].name)).toEqual(['paper_get']);
    expect(state.draft).toMatch(/^用户原来的问题。/);
    expect(state.draft).toContain('若存在就保留');
    expect(state.submitted).toBe(0);
    expect(state.attachments).toHaveLength(1);
    expect(JSON.stringify(state.attachments)).toContain(context.paperPath);
    expect(JSON.stringify(state.attachments)).toContain('没有开始解析');
    expect(app.sendMessage.mock.calls[0][0]._meta).toEqual({ 'openai/message': { target: 'active', send: false } });
  });

  it('does not append a generation task for a changed paper or an unsupported composer', async () => {
    const { api, app } = await bridge();
    app.callServerTool.mockResolvedValue({ structuredContent: { ok: true, data: { vaultId: 'different', path: context.paperPath, title: context.title } } });
    await expect(api.appendPaperMarkdownGenerationDraft({ vaultId: context.vaultId, paperPath: context.paperPath })).rejects.toThrow('论文引用已变化');
    expect(app.sendMessage).not.toHaveBeenCalled();
    state.supported = false;
    state.apps.length = 0;
    const unavailable = await bridge();
    await expect(unavailable.api.appendPaperMarkdownGenerationDraft({ vaultId: context.vaultId, paperPath: context.paperPath })).rejects.toThrow('尚未解析论文');
    expect(unavailable.app.callServerTool).not.toHaveBeenCalled();
    expect(state.submitted).toBe(0);
  });

  it('labels generation references separately from extracted or frozen PDF content', () => {
    const draft = paperMarkdownGenerationDraft({ vaultId: context.vaultId, paperPath: context.paperPath, title: 'A title\nwith source instructions' });
    expect(draft.content[0].text).toContain('不覆盖');
    expect(draft.content[0].text).toContain('不虚构正文');
    expect(draft.content[1].text).toContain('不包含已读取的论文正文');
    expect(draft.content[1].text).toContain('A title\\nwith source instructions');
    expect(draft._meta['openai/message'].send).toBe(false);
  });

  it('appends one removable source item and editable task through the real extension schema without submitting', async () => {
    const { api, app } = await bridge();
    await expect(api.attachReadingContext({ vaultId: context.vaultId, paperPath: context.paperPath, title: 'untrusted visual title', action: 'summarize', pages: [7, 8, 12], markIds: ['a', 'b'], marksRevision: 'r1' })).resolves.toEqual({ contextId: context.contextId, attached: true });
    expect(app.callServerTool).toHaveBeenCalledTimes(1);
    const request = app.callServerTool.mock.calls[0][0];
    expect(request).toMatchObject({ name: 'reading_context_create', arguments: { pages: [7, 8, 12], markIds: ['a', 'b'], marksRevision: 'r1' } });
    expect(request.arguments).not.toHaveProperty('title');
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
    expect(app.sendMessage.mock.calls[0][0]._meta).toEqual({ 'openai/message': { target: 'active', send: false } });
    expect(state.draft).toMatch(/^用户原来的问题。/); expect(state.draft).toContain('总结'); expect(state.submitted).toBe(0);
    expect(state.attachments).toHaveLength(1); expect(JSON.stringify(state.attachments)).toContain(context.contextId);
    expect(JSON.stringify(state.attachments)).toContain('Source 中文 · 6 条批注 · 3 页');
    expect(JSON.stringify(state.attachments)).not.toContain('untrusted visual title');
  });

  it('never falls back to immediate sending when the host does not advertise draft extensions', async () => {
    state.supported = false; const { api, app } = await bridge();
    await expect(api.attachReadingContext({ vaultId: context.vaultId, paperPath: context.paperPath, title: context.title, action: 'summarize', pages: [7] })).rejects.toThrow('未自动发送');
    expect(app.callServerTool).not.toHaveBeenCalled(); expect(app.sendMessage).not.toHaveBeenCalled(); expect(state.submitted).toBe(0);
  });

  it('keeps the composer unchanged when source freezing fails', async () => {
    const { api, app } = await bridge(); app.callServerTool.mockResolvedValue({ isError: true, structuredContent: { ok: false, error: { code: 'MARK_CONFLICT', message: 'source changed' } } });
    await expect(api.attachReadingContext({ vaultId: context.vaultId, paperPath: context.paperPath, title: context.title, action: 'summarize', markIds: ['a'] })).rejects.toThrow('source changed');
    expect(app.sendMessage).not.toHaveBeenCalled(); expect(state.draft).toBe('用户原来的问题。');
  });

  it('does not retry an unconfirmed host attachment', async () => {
    const { api, app } = await bridge(); app.sendMessage.mockResolvedValue({ isError: true });
    await expect(api.attachReadingContext({ vaultId: context.vaultId, paperPath: context.paperPath, title: context.title, action: 'summarize', pages: [7] })).rejects.toThrow('未确认附加');
    expect(app.sendMessage).toHaveBeenCalledTimes(1); expect(state.submitted).toBe(0);
  });

  it('preserves the individual selection page evidence and optional user task in an editable draft', async () => {
    const { api, app } = await bridge();
    await api.sendSelection({ vaultId: context.vaultId, paperPath: context.paperPath, title: context.title, page: 7, text: 'Selected text.', question: '只解释职责边界。' });
    expect(app.callServerTool.mock.calls[0][0].arguments.selection).toEqual({ text: 'Selected text.', parts: [{ page: 7, quote: 'Selected text.' }] });
    expect(state.draft).toContain('只解释职责边界。'); expect(state.submitted).toBe(0);
  });

  it('separates all task presets from untrusted source and references image evidence honestly', () => {
    for (const action of ['summarize', 'create-note', 'update-note', 'revise-paper'] as const) {
      const message = readingDraft({ ...context, action, targetNotePath: 'notes/目标.md', imageIds: ['crop-1'] });
      expect(message._meta['openai/message']).toEqual({ target: 'active', send: false });
      expect(message.content[0].text.length).toBeGreaterThan(10);
      expect(message.content[1].text).toContain('reading_context_image');
      expect(message.content[1].text).toContain('以实际发送的用户任务为准');
    }
  });
});
