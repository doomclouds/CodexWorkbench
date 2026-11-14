import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createStudioBridge } from '../src/app/bridge';
import { LOCAL_ACTOR, DEFAULT_STYLE, type Board, type StudioClient } from '../src/contracts/studio';
import { downloadStudioBlob, downloadStudioFile } from '../src/app/transport';
import { downloadBoard } from '../src/app/export';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { APP_MAX_BYTES } from '../src/contracts/transport';

const mocks = vi.hoisted(() => ({ openLink: vi.fn(), downloadFile: vi.fn(), close: vi.fn(), connect: vi.fn(), capabilities: {} as Record<string, unknown> }));
vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    connect = mocks.connect;
    close = mocks.close;
    openLink = mocks.openLink;
    downloadFile = mocks.downloadFile;
    async callServerTool() { return { _meta: { connection: { baseUrl: 'http://127.0.0.1:5000', token: 'owner-secret', actor: { id: 'local', name: '我', kind: 'human', role: 'owner' } } } }; }
    getHostContext() { return undefined; }
    getHostCapabilities() { return mocks.capabilities; }
  },
  PostMessageTransport: class {}, applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn(),
}));
vi.mock('@openai/mcp-extensions/app', () => ({ OpenAIExtensions: class {} }));
beforeEach(() => { mocks.capabilities = {}; });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('reader link host adaptation', () => {
  it('uses only the public URL openLink request and surfaces a host refusal', async () => {
    const dom = new JSDOM('<div></div>');
    Object.defineProperty(dom.window, 'parent', { value: {} });
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
    mocks.openLink.mockResolvedValueOnce({ isError: true }).mockResolvedValueOnce({});
    const bridge = await createStudioBridge(() => {});
    const url = 'http://127.0.0.1:5000/region/board/region#cap=limited';
    await expect(bridge.client.openLink!(url)).rejects.toThrow('宿主未打开阅读页');
    await bridge.client.openLink!(url);
    expect(mocks.openLink).toHaveBeenLastCalledWith({ url });
    expect(Object.keys(mocks.openLink.mock.calls[0]![0])).toEqual(['url']);
    await bridge.close(); dom.window.close();
  });

  it('uses a normal new browser window and reports a blocked popup for the caller fallback', async () => {
    const dom = new JSDOM('<div></div>', { url: 'http://127.0.0.1:5000/' });
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
    dom.window.__STUDIO_BOOT__ = { baseUrl: 'http://127.0.0.1:5000', token: 'owner-secret', actor: LOCAL_ACTOR };
    const opened = { opener: dom.window };
    const open = vi.spyOn(dom.window, 'open').mockReturnValueOnce(null).mockReturnValueOnce(opened as unknown as Window);
    const bridge = await createStudioBridge(() => {});
    const url = 'http://127.0.0.1:5000/region/board/region#cap=limited';
    await expect(bridge.client.openLink!(url)).rejects.toThrow('浏览器未打开阅读页');
    await bridge.client.openLink!(url);
    expect(open).toHaveBeenLastCalledWith(url, '_blank'); expect(opened.opener).toBeNull();
    await bridge.close(); dom.window.close();
  });
});

describe('host file downloads', () => {
  function embedded() {
    const dom = new JSDOM('<div></div>');
    Object.defineProperty(dom.window, 'parent', { value: {} });
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
    return dom;
  }
  it('sends original UTF-8 and binary bytes through a valid SDK embedded-resource request without credentials or a DOM download', async () => {
    const dom = embedded(), click = vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click');
    mocks.capabilities = { downloadFile: {} }; mocks.downloadFile.mockResolvedValue({});
    const bridge = await createStudioBridge(() => {});
    const text = '<!doctype html><meta charset="utf-8"><h1>中文图解 🎨</h1>';
    await downloadStudioBlob(bridge.client, new Blob([text], { type: 'text/html; charset=utf-8' }), '中文图解.html');
    const actualSdk = await vi.importActual<typeof import('@modelcontextprotocol/ext-apps')>('@modelcontextprotocol/ext-apps');
    const params = mocks.downloadFile.mock.calls[0]![0];
    expect(() => actualSdk.McpUiDownloadFileRequestSchema.parse({ method: 'ui/download-file', params })).not.toThrow();
    const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
    let hostRequest: unknown;
    hostTransport.onmessage = async message => {
      if (!('method' in message) || !('id' in message)) return;
      if (message.method === 'ui/initialize') await hostTransport.send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: actualSdk.LATEST_PROTOCOL_VERSION, hostInfo: { name: 'Download test host', version: '1' }, hostCapabilities: { downloadFile: {} }, hostContext: {} } });
      if (message.method === 'ui/download-file') { hostRequest = message.params; await hostTransport.send({ jsonrpc: '2.0', id: message.id, result: {} }); }
    };
    await hostTransport.start();
    const sdkApp = new actualSdk.App({ name: 'Download contract test', version: '1' }, {}, { autoResize: false });
    try { await sdkApp.connect(appTransport); await expect(sdkApp.downloadFile(params)).resolves.toEqual({}); expect(hostRequest).toEqual(params); }
    finally { await sdkApp.close(); await hostTransport.close(); }
    expect(params.contents[0].resource.uri).toBe('file:///%E4%B8%AD%E6%96%87%E5%9B%BE%E8%A7%A3.html');
    expect(Buffer.from(params.contents[0].resource.blob, 'base64').toString('utf8')).toBe(text);
    expect(params.contents[0].resource.mimeType).toBe('text/html; charset=utf-8');
    expect(JSON.stringify(params)).not.toContain('owner-secret'); expect(JSON.stringify(params)).not.toContain('127.0.0.1');
    const bytes = Uint8Array.from([0, 255, 1, 128, 137, 80, 78, 71]);
    await downloadStudioBlob(bridge.client, new Blob([bytes], { type: 'image/png' }), '图解.png');
    expect(Buffer.from(mocks.downloadFile.mock.calls[1]![0].contents[0].resource.blob, 'base64')).toEqual(Buffer.from(bytes));
    expect(click).not.toHaveBeenCalled();
    await bridge.close(); dom.window.close();
  });

  it('reports missing capability, refusal, cancellation and the explicit inline-size limit without a DOM fallback', async () => {
    const dom = embedded(), click = vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click');
    const bridge = await createStudioBridge(() => {}), blob = new Blob(['中文'], { type: 'text/plain; charset=utf-8' });
    await expect(downloadStudioBlob(bridge.client, blob, '原图.txt')).rejects.toThrow('不支持文件下载');
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    mocks.capabilities = { downloadFile: {} };
    mocks.downloadFile.mockResolvedValueOnce({ isError: true });
    await expect(downloadStudioBlob(bridge.client, blob, '原图.txt')).rejects.toThrow('未完成文件下载');
    mocks.downloadFile.mockRejectedValueOnce(new Error('User cancelled download'));
    await expect(downloadStudioBlob(bridge.client, blob, '原图.txt')).rejects.toThrow('User cancelled');
    const atLimit = new Blob(['boundary sample']); Object.defineProperty(atLimit, 'size', { value: APP_MAX_BYTES });
    mocks.downloadFile.mockResolvedValueOnce({});
    await expect(downloadStudioBlob(bridge.client, atLimit, '备份.zip')).resolves.toBeUndefined();
    const huge = new Blob(); Object.defineProperty(huge, 'size', { value: APP_MAX_BYTES + 1 });
    const readHuge = vi.spyOn(huge, 'arrayBuffer');
    await expect(downloadStudioBlob(bridge.client, huge, '大图.zip')).rejects.toThrow('128 MB 预算'); expect(readHuge).not.toHaveBeenCalled();
    await expect(downloadStudioBlob(bridge.client, blob, '../escape.txt')).rejects.toThrow('文件名无效');
    expect(click).not.toHaveBeenCalled();
    await bridge.close(); dom.window.close();
  });

  it('fetches exports over the embedded request transport and waits for host confirmation', async () => {
    const blob = new Blob(['中文下载'], { type: 'text/html; charset=utf-8' });
    const request = vi.fn(async () => new Response(blob));
    let confirm!: () => void;
    const downloadFile = vi.fn((_blob: Blob, _filename: string) => new Promise<void>(resolve => { confirm = resolve; }));
    const client: StudioClient = { embedded: true, baseUrl: 'http://127.0.0.1:5000', token: 'owner-secret', request, downloadFile, call: vi.fn() };
    let saved = false;
    const done = downloadStudioFile(client, '/api/exports/export-one', '图解.html').then(() => { saved = true; });
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
    expect(saved).toBe(false); expect(await downloadFile.mock.calls[0]![0].text()).toBe('中文下载');
    confirm(); await done; expect(saved).toBe(true);
    await expect(downloadStudioBlob({ ...client, downloadFile: undefined }, blob, '图解.html')).rejects.toThrow('未提供文件下载能力');
  });

  it('retains a normal browser Blob download with the original filename and releases its URL', async () => {
    vi.useFakeTimers();
    const dom = new JSDOM('<div></div>'); vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
    let filename = '';
    const click = vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:web-download');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await downloadStudioBlob({ embedded: false, call: vi.fn() }, new Blob(['中文']), '网页图解.html');
    expect(click).toHaveBeenCalledOnce(); expect(filename).toBe('网页图解.html'); expect(dom.window.document.querySelector('a')).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000); expect(revoke).toHaveBeenCalledWith('blob:web-download');
    dom.window.close();
  });

  it.each(['html', 'svg', 'json'])('passes browser-rendered %s export bytes into the supplied host save callback', async format => {
    const dom = new JSDOM('<div></div>', { url: 'http://127.0.0.1:5000' });
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location); vi.stubGlobal('DOMParser', dom.window.DOMParser);
    const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: '中文白板', revision: 1, pinned: false, createdAt: '', updatedAt: '' }, style: DEFAULT_STYLE,
      elements: [{ id: 'region', type: 'html', x: 0, y: 0, w: 200, h: 100, version: 1, text: '中文图解', html: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text>中文内容</text></svg>' }] };
    const save = vi.fn(async (_blob: Blob, _filename: string) => {});
    const click = vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click');
    await downloadBoard(board, format, { regionId: 'region' }, save);
    expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0]![1]).toBe(`中文图解.${format}`);
    expect(await save.mock.calls[0]![0].text()).toContain('中文内容'); expect(save.mock.calls[0]![0].type).toContain('charset=utf-8');
    expect(click).not.toHaveBeenCalled(); dom.window.close();
  });

  it('routes browser-rendered PNG through the same save callback and propagates a failed host acknowledgement', async () => {
    const dom = new JSDOM('<div></div>', { url: 'http://127.0.0.1:5000' });
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location);
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn() } as unknown as CanvasRenderingContext2D);
    const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(png));
    const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: '原生图形', revision: 1, pinned: false, createdAt: '', updatedAt: '' }, style: DEFAULT_STYLE,
      elements: [{ id: 'shape', type: 'shape', x: 0, y: 0, w: 100, h: 100, version: 1 }] };
    const save = vi.fn(async (_blob: Blob, _filename: string) => {}), click = vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click');
    await downloadBoard(board, 'png', {}, save);
    expect(save).toHaveBeenCalledExactlyOnceWith(png, '原生图形.png'); expect(click).not.toHaveBeenCalled();
    save.mockRejectedValueOnce(new Error('Host download refused'));
    await expect(downloadBoard(board, 'png', {}, save)).rejects.toThrow('Host download refused');
    dom.window.close();
  });
});
