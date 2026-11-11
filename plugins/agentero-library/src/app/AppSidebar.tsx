import { BookOpen, FileText, Layers, NotebookPen, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings, Trash2 } from 'lucide-react';
import './app-sidebar.css';

export type WorkspaceTab = 'library' | 'reading' | 'notes' | 'trash';
export const READER_TOOLS_SLOT_ID = 'agentero-reader-tools';
interface Props {
  tab: WorkspaceTab;
  collapsed: boolean;
  vaultName: string;
  connectionLabel: string;
  connected: boolean;
  settingsDisabled: boolean;
  refreshDisabled: boolean;
  refreshing: boolean;
  readerToolsVisible: boolean;
  onSelect(tab: WorkspaceTab): void;
  onToggle(): void;
  onSettings(): void;
  onRefresh(): void;
  onReaderToolsHost(node: HTMLDivElement | null): void;
}

export function AppSidebar({ tab, collapsed, vaultName, connectionLabel, connected, settingsDisabled, refreshDisabled, refreshing, readerToolsVisible, onSelect, onToggle, onSettings, onRefresh, onReaderToolsHost }: Props) {
  const settingsTitle = settingsDisabled ? '处理草稿并重新载入知识库后再修改设置' : '配置与诊断';
  return <aside id="agentero-sidebar" className="app-sidebar" data-collapsed={collapsed} aria-label="文献库侧栏">
    <header className="app-sidebar__heading">
      <div className="app-sidebar__brand" title="文献库"><BookOpen size={20} aria-hidden="true" /><h1 className="app-sidebar__label">文献库</h1></div>
      <button className="app-sidebar__fold" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} aria-controls="agentero-sidebar" onClick={onToggle}>{collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}</button>
    </header>
    <div className="app-sidebar__main">
      <nav className="app-sidebar__navigation" aria-label="文献库页面">
        {([{ id: 'library', text: '文献', Icon: FileText }, { id: 'reading', text: '阅读', Icon: BookOpen }, { id: 'notes', text: '笔记', Icon: NotebookPen }] as const).map(({ id, text, Icon }) => <button key={id} className={`app-sidebar__item ${tab === id ? 'selected' : ''}`} aria-label={text} title={text} aria-current={tab === id ? 'page' : undefined} onClick={() => onSelect(id)}><Icon size={18} aria-hidden="true" /><span className="app-sidebar__label">{text}</span></button>)}
      </nav>
      <div id={READER_TOOLS_SLOT_ID} className="app-sidebar__tools" data-reader-tools-host="true" hidden={!readerToolsVisible} aria-label="阅读工具" ref={onReaderToolsHost} />
    </div>
    <footer className="app-sidebar__footer">
      <button className="app-sidebar__item app-sidebar__vault" aria-label="选择文献库" title={settingsDisabled ? settingsTitle : `${vaultName || '选择知识库'} · ${connectionLabel}`} disabled={settingsDisabled} onClick={onSettings}><Layers size={17} aria-hidden="true" /><span className="app-sidebar__label app-sidebar__vault-text"><span>{vaultName || '选择知识库'}</span><small>{connectionLabel}</small></span><span className={`app-sidebar__connection ${connected ? 'is-connected' : ''}`} aria-hidden="true" /></button>
      <button className={`app-sidebar__item ${tab === 'trash' ? 'selected' : ''}`} aria-label="回收站" title="回收站" aria-current={tab === 'trash' ? 'page' : undefined} onClick={() => onSelect('trash')}><Trash2 size={17} aria-hidden="true" /><span className="app-sidebar__label">回收站</span></button>
      <button className="app-sidebar__item" aria-label="打开文献库设置" title={settingsTitle} disabled={settingsDisabled} onClick={onSettings}><Settings size={17} aria-hidden="true" /><span className="app-sidebar__label">设置</span></button>
      <button className="app-sidebar__item" aria-label="刷新连接状态" title="刷新连接状态" disabled={refreshDisabled} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'spin' : undefined} aria-hidden="true" /><span className="app-sidebar__label">刷新</span></button>
    </footer>
  </aside>;
}
