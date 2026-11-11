import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar, READER_TOOLS_SLOT_ID } from '../src/app/AppSidebar';

function find(node: ReactNode, predicate: (node: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element) ? element : find(element.props.children, predicate);
}
const props = () => ({ tab: 'reading' as const, collapsed: false, vaultName: 'Research Vault', connectionLabel: '已连接', connected: true, settingsDisabled: false, refreshDisabled: false, refreshing: false, readerToolsVisible: true, onSelect: vi.fn(), onToggle: vi.fn(), onSettings: vi.fn(), onRefresh: vi.fn(), onReaderToolsHost: vi.fn() });

describe('workbench sidebar layout', () => {
  it('keeps named navigation and actions accessible in the expanded sidebar and icon rail', () => {
    for (const collapsed of [false, true]) {
      const html = renderToStaticMarkup(<AppSidebar {...props()} collapsed={collapsed} />);
      expect(html).toContain(`data-collapsed="${collapsed}"`);
      expect(html).toContain(`aria-label="${collapsed ? '展开侧栏' : '收起侧栏'}"`);
      expect(html).toContain(`aria-expanded="${!collapsed}"`);
      for (const label of ['文献', '阅读', '笔记', '回收站', '选择文献库', '打开文献库设置', '刷新连接状态']) expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain('title="阅读" aria-current="page"');
      expect(html).toContain('Research Vault');
    }
  });
  it('keeps a single stable reader-tools ref target mounted while it is hidden or collapsed', () => {
    const callbacks = props();
    const visible = AppSidebar(callbacks); const hidden = AppSidebar({ ...callbacks, collapsed: true, readerToolsVisible: false, tab: 'notes' });
    const first = find(visible, node => node.props.id === READER_TOOLS_SLOT_ID)!; const second = find(hidden, node => node.props.id === READER_TOOLS_SLOT_ID)!;
    expect(first.type).toBe('div'); expect(second.type).toBe('div'); expect(first.props.ref).toBe(callbacks.onReaderToolsHost); expect(second.props.ref).toBe(first.props.ref);
    expect(first.props.hidden).toBe(false); expect(second.props.hidden).toBe(true);
    expect(renderToStaticMarkup(hidden).match(new RegExp(`id="${READER_TOOLS_SLOT_ID}"`, 'g'))).toHaveLength(1);
  });
  it('routes sidebar actions without introducing another business or settings controller', () => {
    const callbacks = props(); const tree = AppSidebar(callbacks);
    for (const label of ['文献', '阅读', '笔记', '回收站']) find(tree, node => node.type === 'button' && node.props['aria-label'] === label)!.props.onClick();
    expect(callbacks.onSelect.mock.calls).toEqual([['library'], ['reading'], ['notes'], ['trash']]);
    find(tree, node => node.props['aria-label'] === '收起侧栏')!.props.onClick(); expect(callbacks.onToggle).toHaveBeenCalledOnce();
    find(tree, node => node.props['aria-label'] === '选择文献库')!.props.onClick(); find(tree, node => node.props['aria-label'] === '打开文献库设置')!.props.onClick(); expect(callbacks.onSettings).toHaveBeenCalledTimes(2);
    find(tree, node => node.props['aria-label'] === '刷新连接状态')!.props.onClick(); expect(callbacks.onRefresh).toHaveBeenCalledOnce();
    const locked = AppSidebar({ ...callbacks, settingsDisabled: true, refreshDisabled: true });
    expect(find(locked, node => node.props['aria-label'] === '选择文献库')!.props.disabled).toBe(true);
    expect(find(locked, node => node.props['aria-label'] === '打开文献库设置')!.props.disabled).toBe(true);
    expect(find(locked, node => node.props['aria-label'] === '刷新连接状态')!.props.disabled).toBe(true);
  });
});
