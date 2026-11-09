import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CircleHelp, FileText, LoaderCircle, RefreshCw, Settings } from 'lucide-react';
import type { LibraryOperation, LibrarySettings, LibraryStatus, Paper } from '../contracts/types';
import { callTool, VAULT_CHANGED_EVENT } from './api';
import { getHostState, subscribeHost } from './bridge';
import { LibraryView } from './LibraryView';
import { NotesView, type NoteTarget } from './NotesView';
import { PdfReader } from './PdfReader';
import { SettingsPanel } from './SettingsPanel';
import { messageOf } from './model';
import { previewSettings, previewStatus } from './preview';
import { createRefreshQueue, readSettingsStatus, sameLibrarySettings as sameSettings, useAppActivity, type RefreshRequest } from './activity';

type Tab = 'library' | 'reading' | 'notes';
const sameStatus = (left: LibraryStatus | null, right: LibraryStatus) => left === right || left !== null && JSON.stringify(left) === JSON.stringify(right);

export function App() {
  const root = useRef<HTMLDivElement>(null);
  const visible = useAppActivity(root);
  const [host, setHost] = useState(getHostState);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [pendingBinding, setPendingBinding] = useState<{ settings: LibrarySettings; status: LibraryStatus } | null>(null);
  const binding = useRef<LibrarySettings | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('library'); const [paper, setPaper] = useState<Paper | null>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [notesDirty, setNotesDirty] = useState(false); const [readerDirty, setReaderDirty] = useState(false);
  const readerSession = useRef({ path: paper?.path, dirty: readerDirty });
  readerSession.current = { path: paper?.path, dirty: readerDirty };
  const dirty = notesDirty || readerDirty; const [settingsOpen, setSettingsOpen] = useState(false);
  const navigation = useRef(0);
  function clearDirty() { setNotesDirty(false); setReaderDirty(false); }
  function selectTab(next: Tab) { ++navigation.current; setTab(next); }
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [operation, setOperation] = useState<LibraryOperation | null>(null);
  const alive = useRef(true); const refreshGeneration = useRef(0);
  const observed = useRef<{ settings: LibrarySettings; status: LibraryStatus } | null>(null);
  const refreshTask = useRef<(request: RefreshRequest) => Promise<void>>(async () => {});
  const refreshQueue = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  if (!refreshQueue.current) refreshQueue.current = createRefreshQueue(request => refreshTask.current(request));

  const canReplacePaper = useCallback((path: string) => {
    if (readerSession.current.dirty && readerSession.current.path !== path) {
      setTab('reading');
      setError('当前论文的侧栏笔记尚未保存，请先保存或处理冲突后再打开其他 PDF。');
      return false;
    }
    return true;
  }, []);

  useEffect(() => subscribeHost(setHost), []);
  useEffect(() => { document.documentElement.dataset.theme = host.theme; }, [host.theme]);
  useEffect(() => { if (host.error && !host.connected) setLoading(false); }, [host.error, host.connected]);

  refreshTask.current = async ({ explicit, forceStatus }) => {
    const generation = refreshGeneration.current;
    if (host.preview) {
      binding.current = previewSettings; setSettings(previewSettings); setStatus(previewStatus); setLoading(false); return;
    }
    if (!host.connected) return;
    if (explicit || forceStatus) setLoading(true);
    try {
      const snapshot = await readSettingsStatus(observed.current, forceStatus, () => callTool<LibrarySettings>('settings_read'), () => callTool<LibraryStatus>('library_status'), () => alive.current && generation === refreshGeneration.current);
      if (!snapshot) return;
      const { settings: next, status: diagnosed, changed } = snapshot;
      observed.current = { settings: next, status: diagnosed };
      if (binding.current && !explicit && binding.current.vaultId !== next.vaultId) {
        setPendingBinding(previous => previous && sameSettings(previous.settings, next) && sameStatus(previous.status, diagnosed) ? previous : { settings: next, status: diagnosed }); return;
      }
      binding.current = next;
      setSettings(previous => sameSettings(previous, next) ? previous : next);
      setStatus(previous => sameStatus(previous, diagnosed) ? previous : diagnosed);
      setPendingBinding(null);
      if (changed || forceStatus || explicit) setError('');
      if (explicit) { setConfirmSwitch(false); setPaper(null); setNoteTarget(null); clearDirty(); selectTab('library'); setRefreshToken(value => value + 1); }
    } catch (reason) { if (alive.current && generation === refreshGeneration.current) setError(messageOf(reason)); }
    finally { if (alive.current && generation === refreshGeneration.current) setLoading(false); }
  };
  const refresh = useCallback((explicit = false, forceStatus = false) => refreshQueue.current!.request({ explicit, forceStatus }), []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; refreshGeneration.current += 1; refreshQueue.current?.clearPending(); };
  }, []);

  useEffect(() => { if (visible && (host.connected || host.preview)) void refresh(false, !observed.current); }, [visible, host.connected, host.preview, refresh]);
  useEffect(() => {
    if (!host.connected || !visible) return;
    const check = () => { void refresh(); };
    const timer = setInterval(check, 20_000);
    window.addEventListener(VAULT_CHANGED_EVENT, check);
    return () => { clearInterval(timer); window.removeEventListener(VAULT_CHANGED_EVENT, check); };
  }, [host.connected, visible, refresh]);

  useEffect(() => {
    if (!host.connected || !settings) return;
    let cancelled = false;
    const view = host.view ?? (host.paperPath ? 'reading' : undefined);
    if (!view) return;
    const ticket = ++navigation.current;
    if (!['library', 'reading', 'notes', 'settings'].includes(view)) {
      setError('宿主请求的文献库页面无效。');
      return;
    }
    const boundVaultId = settings.vaultId;
    if (host.vaultId && host.vaultId !== boundVaultId) {
      setError('打开目标属于另一个知识库。本页仍保留原知识库与草稿，请刷新连接状态并明确重新载入后再打开。');
      return;
    }
    if (view === 'settings') { setSettingsOpen(true); return; }
    if (!host.paperPath || view === 'library') {
      setSettingsOpen(false); setTab(view as Tab);
      return;
    }
    if (!boundVaultId) {
      setError('请先连接知识库，再打开论文或论文笔记。');
      return;
    }
    const targetView = view;
    if (!canReplacePaper(host.paperPath)) return;
    void callTool<Paper & { vaultId: string }>('paper_get', { vaultId: boundVaultId, paperPath: host.paperPath })
      .then(value => {
        if (cancelled || ticket !== navigation.current) return;
        if (binding.current?.vaultId !== boundVaultId || value.vaultId !== boundVaultId) {
          setError('读取目标期间知识库发生变化，已保留当前视图与草稿。');
          return;
        }
        if (!value.title?.trim() || !value.path) {
          setError('论文元数据不完整，无法确定打开目标。');
          return;
        }
        if (!canReplacePaper(value.path)) return;
        setPaper(value); setSettingsOpen(false); setError('');
        if (targetView === 'notes') {
          // NotesView flushes the old target first and retains its draft on failure.
          setNoteTarget({ paperPath: value.path }); setTab('notes');
        } else setTab('reading');
      }).catch(reason => { if (!cancelled) setError(messageOf(reason)); });
    return () => { cancelled = true; };
  }, [host.connected, host.view, host.paperPath, host.vaultId, host.routeRevision, settings?.vaultId, Boolean(settings)]);

  useEffect(() => {
    if (!operation || !visible) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const reference = { operationId: operation.operationId, instanceId: operation.instanceId, vaultId: operation.vaultId };
    const poll = async () => {
      try {
        const next = await callTool<LibraryOperation>('operation_get', reference);
        if (cancelled) return;
        setOperation(next);
        if (['succeeded', 'failed', 'cancelled'].includes(next.status)) { setRefreshToken(value => value + 1); void refresh(); }
        else timer = setTimeout(() => { void poll(); }, 900);
      } catch (reason) { if (!cancelled) setError(messageOf(reason)); }
    };
    if (!['succeeded', 'failed', 'cancelled'].includes(operation.status)) void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [operation?.operationId, refresh, visible]);

  async function saved(next: LibrarySettings) {
    refreshGeneration.current += 1;
    const wasDifferent = binding.current?.vaultId !== next.vaultId;
    binding.current = next; setSettings(next); setPendingBinding(null);
    if (wasDifferent) { setPaper(null); setNoteTarget(null); clearDirty(); setTab('library'); }
    setRefreshToken(value => value + 1);
    await refresh(false, true);
  }

  function openPaper(value: Paper) { ++navigation.current; if (canReplacePaper(value.path)) { setPaper(value); setTab('reading'); setError(''); } }
  const openPaperPath = useCallback(async (path: string) => {
    const vaultId = binding.current?.vaultId; const ticket = ++navigation.current;
    if (!vaultId) { setError('请先连接文献库。'); return; }
    if (!canReplacePaper(path)) return;
    try {
      const target = await callTool<Paper & { vaultId: string }>('paper_get', { vaultId, paperPath: path });
      if (ticket !== navigation.current || binding.current?.vaultId !== vaultId || target.vaultId !== vaultId) return;
      if (!canReplacePaper(target.path)) return;
      setPaper(target); setTab('reading'); setError('');
    } catch (reason) { if (ticket === navigation.current) setError(messageOf(reason)); }
  }, [canReplacePaper]);
  function openNote(path: string) { ++navigation.current; setNoteTarget(path.endsWith('/NOTES.md') ? { paperPath: path.slice(0, -'/NOTES.md'.length) } : { path }); setTab('notes'); }
  const usable = host.preview || Boolean(settings?.vaultId && status?.capabilities.metadata);
  const vaultId = settings?.vaultId ?? '';
  const tabLabels: { id: Tab; text: string }[] = [{ id: 'library', text: '文献' }, { id: 'reading', text: '阅读' }, { id: 'notes', text: '笔记' }];

  return <div ref={root} className="library-app">
    {host.preview && <div className="preview-banner" role="status">本地界面预览 · 以下为演示数据，不连接或修改真实知识库</div>}
    <header className="app-heading"><div className="app-brand"><BookOpen size={22} strokeWidth={1.7} /><h1>文献库</h1></div><div className="button-row"><span className="connection-status">{host.preview ? '预览' : status?.vault.valid ? status.vault.name : host.connected ? '待配置' : '正在连接'}</span><button className="icon-button" aria-label="刷新连接状态" title="刷新连接状态" onClick={() => void refresh(false, true)} disabled={loading || host.preview}><RefreshCw size={16} /></button><button className="icon-button" aria-label="打开文献库设置" title={pendingBinding ? '处理草稿并重新载入知识库后再修改设置' : '配置与诊断'} disabled={Boolean(pendingBinding)} onClick={() => setSettingsOpen(true)}><Settings size={18} /></button></div></header>
    <nav className="app-tabs" aria-label="文献库页面">{tabLabels.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'selected' : ''} onClick={() => selectTab(item.id)}>{item.text}</button>)}</nav>
    {host.error && <p className="callout error" role="alert">连接宿主失败：{host.error}</p>}
    {pendingBinding && <div className="callout warning" role="alert"><strong>知识库已在其他位置切换。</strong><p>本页仍绑定原知识库；请先处理草稿，再明确载入新配置。</p><button disabled={dirty} onClick={() => void refresh(true)}>载入新知识库</button>{dirty && <><span className="field-help">当前草稿尚未保存，请先在笔记页复制草稿。</span>{confirmSwitch ? <div className="button-row"><span>确认放弃本页尚未保存的内容？</span><button onClick={() => setConfirmSwitch(false)}>保留草稿</button><button className="danger" onClick={() => { clearDirty(); void refresh(true); }}>放弃草稿并载入</button></div> : <button onClick={() => setConfirmSwitch(true)}>放弃草稿并切换…</button>}</>}</div>}
    {error && <p className="callout error" role="alert">{error}</p>}
    <main className="app-content">
      {loading && !settings ? <div className="empty-state"><LoaderCircle className="spin" />正在连接文献库…</div> : usable ? <>
        <div className={`tab-content ${tab !== 'library' ? 'is-hidden' : ''}`}><LibraryView key={vaultId} active={visible && tab === 'library'} vaultId={vaultId} vaultName={status?.vault.name ?? ''} preview={host.preview} refreshToken={refreshToken} pdfParseAvailable={Boolean(status?.capabilities.pdfParse)} onOpen={openPaper} onOpenNote={openNote} onOperation={setOperation} /></div>
        <div className={`tab-content ${tab !== 'reading' ? 'is-hidden' : ''}`}><PdfReader key={vaultId} active={visible && tab === 'reading'} vaultId={vaultId} paper={paper} preview={host.preview} canSend={host.canSendSelection} canParse={Boolean(status?.capabilities.pdfParse)} onNotes={value => { ++navigation.current; setNoteTarget({ paperPath: value.path }); setTab('notes'); }} onOperation={setOperation} onDirtyChange={setReaderDirty} onBack={() => selectTab('library')} /></div>
        <div className={`tab-content ${tab !== 'notes' ? 'is-hidden' : ''}`}><NotesView key={vaultId} active={visible && tab === 'notes'} vaultId={vaultId} preview={host.preview} requestedTarget={noteTarget} onDirtyChange={setNotesDirty} onOpenPaper={openPaperPath} /></div>
      </> : <div className="empty-state onboarding"><FileText size={36} /><h2>连接你的本地文献库</h2><p>设置 Agentero CLI，并选择已有 Vault 或创建默认知识库。</p><button className="primary" onClick={() => setSettingsOpen(true)}><Settings size={16} />配置与诊断</button><a href="https://github.com/poco-ai/Agentero/blob/v0.15.2/docs/backend/cli.md" target="_blank" rel="noreferrer"><CircleHelp size={14} />CLI 安装说明</a></div>}
    </main>
    {operation && <OperationBar operation={operation} onUpdate={setOperation} />}
    {settingsOpen && <SettingsPanel settings={settings} status={status} preview={host.preview} dirty={dirty} standalone={host.view === 'settings'} onClose={() => setSettingsOpen(false)} onSaved={saved} onDiagnosed={() => refresh(false, true)} />}
  </div>;
}

function OperationBar({ operation, onUpdate }: { operation: LibraryOperation; onUpdate(value: LibraryOperation): void }) {
  const [error, setError] = useState(''); const [cancelling, setCancelling] = useState(false);
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(operation.status);
  const label = { queued: '排队中', running: '进行中', cancel_requested: '已申请取消', succeeded: '已完成', failed: '失败', cancelled: '已取消' }[operation.status];
  const action = ({ import: '导入 PDF', parse: '解析正文', download: '补下载资源', bibliography: '导入 BibTeX' } as Record<string, string>)[operation.type] ?? operation.type;
  const raw = operation.result && typeof operation.result === 'object' ? operation.result as Record<string, unknown> : {};
  const data = raw.data && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : raw;
  const batch = Array.isArray(data.papers) ? `${data.papers.length} 个成功${Array.isArray(data.errors) && data.errors.length ? `，${data.errors.length} 个失败` : ''}` : '';
  async function cancel() {
    setCancelling(true); setError('');
    try { onUpdate(await callTool<LibraryOperation>('operation_cancel', { operationId: operation.operationId, instanceId: operation.instanceId, vaultId: operation.vaultId })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setCancelling(false); }
  }
  return <aside className={`operation-bar ${operation.status === 'failed' ? 'failed' : ''}`} role="status"><div><strong>最近操作：{action} · {label}</strong><span>{operation.error?.message || error || batch || operation.stage}</span>{Array.isArray(data.errors) && data.errors.length > 0 && <details><summary>查看未导入项目</summary><ul>{data.errors.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul></details>}</div>{!terminal && <button disabled={cancelling || operation.status === 'cancel_requested'} onClick={() => void cancel()}>{cancelling ? '申请中…' : '取消'}</button>}</aside>;
}
