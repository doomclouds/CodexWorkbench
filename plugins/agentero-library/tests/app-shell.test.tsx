import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('../src/app/bridge', () => ({ getHostState: () => ({ connected: false, preview: true, theme: 'dark', canSendSelection: false }), subscribeHost: vi.fn() }));
vi.mock('../src/app/api', () => ({ callTool: vi.fn(), VAULT_CHANGED_EVENT: 'test:vault-changed' }));
vi.mock('../src/app/LibraryView', () => ({ LibraryView: () => null }));
vi.mock('../src/app/PdfReader', () => ({ PdfReader: () => null }));
vi.mock('../src/app/NotesView', () => ({ NotesView: () => null }));
vi.mock('../src/app/PaperMarkdownView', () => ({ PaperMarkdownView: () => null }));
vi.mock('../src/app/TrashView', () => ({ TrashView: () => null }));
vi.mock('../src/app/SettingsPanel', () => ({ SettingsPanel: () => null }));
import { App, OperationBar, workspaceAccess } from '../src/app/App';
import { previewSettings, previewStatus } from '../src/app/preview';
import type { LibraryOperation } from '../src/contracts/types';

it('places sidebar and workspace in one row and removes the duplicate top brand/tabs', () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('class="library-app sidebar-layout"');
  expect(html).toContain('aria-label="文献库侧栏"');
  expect(html.indexOf('id="agentero-sidebar"')).toBeLessThan(html.indexOf('class="workspace-column"'));
  expect(html.indexOf('class="workspace-column"')).toBeLessThan(html.indexOf('<main class="app-content"'));
  expect(html).not.toContain('class="app-heading"');
  expect(html).not.toContain('class="app-tabs"');
  expect(html.match(/data-reader-tools-host="true"/g)).toHaveLength(1);
});

it('keeps a configured valid Vault bound for Trash without enabling CLI-dependent views', () => {
  const status = { ...previewStatus, cli: { ...previewStatus.cli, available: false, supported: false }, vault: { ...previewStatus.vault, valid: true }, capabilities: { ...previewStatus.capabilities, metadata: false } };
  const settings = { ...previewSettings, vaultId: 'owned-vault' };
  expect(workspaceAccess(settings, status, false)).toEqual({ business: false, vaultBound: true });
  expect(workspaceAccess(settings, { ...status, vault: { ...status.vault, valid: false } }, false)).toEqual({ business: false, vaultBound: false });
  expect(workspaceAccess(null, status, false)).toEqual({ business: false, vaultBound: false });
});

const operation = (status: LibraryOperation['status']): LibraryOperation => ({ operationId: 'owned-op', instanceId: 'owned-instance', vaultId: 'owned-vault', type: 'import', status, stage: 'import', createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z' });
it('offers cancellation while work is running and an explicit dismiss action only after completion', () => {
  const running = renderToStaticMarkup(<OperationBar operation={operation('running')} onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  expect(running).toContain('app-operation-toast'); expect(running).toContain('>取消</button>'); expect(running).not.toContain('aria-label="关闭最近操作"');
  const completed = renderToStaticMarkup(<OperationBar operation={operation('succeeded')} onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  expect(completed).toContain('aria-label="关闭最近操作"'); expect(completed).not.toContain('>取消</button>');
});
it('retains failure and partial-import details in the dismissible task card', () => {
  const failed = { ...operation('failed'), error: { code: 'UPSTREAM_FAILED', message: 'Owned failure remains visible', retryable: true } };
  expect(renderToStaticMarkup(<OperationBar operation={failed} onUpdate={vi.fn()} onDismiss={vi.fn()} />)).toContain('Owned failure remains visible');
  const partial = { ...operation('succeeded'), result: { data: { papers: [{ path: 'papers/owned' }], errors: ['owned-second.pdf: invalid PDF'] } } };
  const html = renderToStaticMarkup(<OperationBar operation={partial} onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  expect(html).toContain('1 个成功，1 个失败'); expect(html).toContain('<details>'); expect(html).toContain('查看未导入项目'); expect(html).toContain('owned-second.pdf: invalid PDF'); expect(html).toContain('aria-label="关闭最近操作"');
});
