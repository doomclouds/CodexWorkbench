import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, LoaderCircle, X } from 'lucide-react';
import type { LibrarySettings, LibraryStatus } from '../contracts/types';
import { callTool } from './api';
import { cancelAppPickers } from './bridge';
import { messageOf } from './model';
import { PathField } from './PathField';
import { TranslationSettings } from './TranslationSettings';

interface Props {
  settings: LibrarySettings | null;
  status: LibraryStatus | null;
  preview: boolean;
  dirty: boolean;
  standalone?: boolean;
  onClose(): void;
  onSaved(settings: LibrarySettings): Promise<void>;
  onDiagnosed?(): Promise<void>;
}

export function SettingsPanel({ settings, status, preview, dirty, standalone = false, onClose, onSaved, onDiagnosed }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState({
    cliPath: settings?.cliPath ?? 'agentero', vaultPath: settings?.vaultPath ?? '',
    pdfiumPath: settings?.pdfiumPath ?? '', allowAgentPdfText: settings?.allowAgentPdfText ?? false,
  });
  const [diagnosis, setDiagnosis] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [picking, setPicking] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const locked = busy || picking || closing;

  useEffect(() => {
    if (standalone) return;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); };
  }, [standalone]);

  async function requestClose() {
    if (busy || closingRef.current) return;
    closingRef.current = true; setClosing(true); setError('');
    try {
      await cancelAppPickers();
      onClose();
    } catch (reason) { setError(`系统选择器尚未确认关闭，设置已保留。${messageOf(reason)} 请重试关闭。`); }
    finally { closingRef.current = false; setClosing(false); }
  }

  async function save() {
    if (preview || locked) return;
    if (dirty && draft.vaultPath !== settings?.vaultPath) {
      setError('当前笔记仍有未保存的草稿，请先处理草稿再切换知识库。');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await callTool<LibrarySettings>('settings_update', { set: draft });
      await onSaved(next);
      setDiagnosis(await callTool<LibraryStatus>('library_status'));
      setNotice('配置已保存。');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function diagnose() {
    if (preview || locked) return;
    setBusy(true); setError(''); setNotice('');
    try {
      // Validate the submitted paths rather than reporting readiness for old values.
      if (dirty && draft.vaultPath !== settings?.vaultPath) throw new Error('请先保存笔记，再检测另一个知识库。');
      const next = await callTool<LibrarySettings>('settings_update', { set: draft });
      await onSaved(next);
      setDiagnosis(await callTool<LibraryStatus>('library_diagnose'));
      await onDiagnosed?.();
      setNotice('检测完成，结果对应已保存的配置。');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function createVault() {
    if (preview || locked || dirty) return;
    const path = draft.vaultPath.trim() || diagnosis?.defaultVaultPath;
    if (!path) { setError('请先填写要创建知识库的完整路径。'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await callTool('settings_update', { set: { cliPath: draft.cliPath, pdfiumPath: draft.pdfiumPath, allowAgentPdfText: draft.allowAgentPdfText } });
      await callTool('vault_create', { path });
      const next = await callTool<LibrarySettings>('settings_read');
      setDraft({ cliPath: next.cliPath, vaultPath: next.vaultPath, pdfiumPath: next.pdfiumPath, allowAgentPdfText: next.allowAgentPdfText });
      await onSaved(next);
      setDiagnosis(await callTool<LibraryStatus>('library_status'));
      setNotice('知识库已创建并连接。'); setConfirmCreate(false);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  const content = <>
    <header className="modal-heading">
      <div><h2>文献库设置</h2><p>连接本机 Agentero，选择你的知识库</p></div>
      {!standalone && <button className="icon-button" aria-label="关闭设置" disabled={busy || closing} onClick={() => void requestClose()}><X size={18} /></button>}
    </header>
    <div className="settings-body">
      {preview && <p className="callout">界面预览不会检测或修改本机配置。请在 Codex 插件中完成设置。</p>}
      <section className="settings-section">
        <div className="section-heading"><h3>Agentero CLI</h3><a href="https://github.com/poco-ai/Agentero/blob/v0.15.2/docs/backend/cli.md" target="_blank" rel="noreferrer">安装说明 <ExternalLink size={12} /></a></div>
        <PathField id="cli-path" label="可执行文件路径" value={draft.cliPath} onChange={value => setDraft(current => ({ ...current, cliPath: value }))} mode="open-file" title="选择已安装的 Agentero CLI" placeholder="agentero 或完整可执行文件路径" disabled={locked} pickerDisabled={preview} onPickingChange={setPicking} />
        <p className="field-help">CLI 由你自行安装。可使用选择器定位可执行文件，也可保留 PATH 中的命令名。</p>
      </section>
      <section className="settings-section">
        <h3>知识库</h3>
        <PathField id="vault-path" label="已有知识库或新建位置" value={draft.vaultPath} onChange={value => { setDraft(current => ({ ...current, vaultPath: value })); setConfirmCreate(false); }} mode="open-directory" title="选择 Agentero 知识库目录" placeholder={diagnosis?.defaultVaultPath ?? '知识库完整路径'} disabled={locked || dirty} pickerDisabled={preview} onPickingChange={setPicking} />
        <div className="button-row compact">
          <button disabled={locked || dirty || !diagnosis?.defaultVaultPath} onClick={() => { setDraft({ ...draft, vaultPath: diagnosis!.defaultVaultPath }); setConfirmCreate(false); }}>使用默认目录</button>
          <button disabled={locked || preview || dirty} onClick={() => setConfirmCreate(true)}>创建知识库…</button>
        </div>
        {dirty && <p className="field-help warning-text">请先保存或处理笔记草稿，再切换知识库。</p>}
        {confirmCreate && <div className="callout warning"><strong>确认创建知识库？</strong><p className="path-text">{draft.vaultPath || diagnosis?.defaultVaultPath}</p><p>仅在此位置创建，不自动搬移已有文献。</p><div className="button-row"><button onClick={() => setConfirmCreate(false)} disabled={busy}>取消</button><button className="primary" onClick={() => void createVault()} disabled={busy}>确认创建</button></div></div>}
        <div className="data-root"><span>插件数据目录</span><code>{diagnosis?.dataRoot ?? '~/.codexworkbench/agentero-library/'}</code></div>
      </section>
      <section className="settings-section">
        <h3>后台 PDF 解析（可选）</h3>
        <PathField id="pdfium-path" label="PDFium 路径（可选）" value={draft.pdfiumPath} onChange={value => setDraft(current => ({ ...current, pdfiumPath: value }))} mode="open-directory" title="选择已安装 PDFium 的目录" placeholder="已安装 PDFium 的目录" disabled={locked} pickerDisabled={preview} onPickingChange={setPicking} />
        <p className="field-help">PDFium 用于后台解析与 Agent 正文提取；基础 PDF 阅读、批注和笔记不受影响。</p>
        <label className="checkbox-row"><input type="checkbox" checked={draft.allowAgentPdfText} disabled={locked} onChange={e => setDraft({ ...draft, allowAgentPdfText: e.target.checked })} /><span>允许 Agent 读取 PDF 正文</span></label>
        <p className="field-help">开启后可按需读取与搜索正文。你主动发送的选区由当次操作决定。</p>
      </section>
      <section className="settings-section diagnostics">
        <div className="section-heading"><h3>能力检查</h3><button onClick={() => void diagnose()} disabled={locked || preview}>{busy ? <LoaderCircle className="spin" size={14} /> : null}保存并检测</button></div>
        <Capability label="CLI" available={Boolean(diagnosis?.cli.available && diagnosis.cli.supported)} detail={diagnosis?.cli.version ? `v${diagnosis.cli.version}` : diagnosis?.cli.error ?? '尚未检测'} />
        <Capability label="文献库" available={Boolean(diagnosis?.vault.valid)} detail={diagnosis?.vault.valid ? '可用' : diagnosis?.vault.error ?? '尚未连接'} />
        <Capability label="笔记读写" available={Boolean(diagnosis?.capabilities.notes)} detail={diagnosis?.capabilities.notes ? '可用' : '需要可用的 CLI 与知识库'} />
        <Capability label="后台 PDF 解析（可选）" available={diagnosis?.pdfium.state === 'unknown' ? null : diagnosis?.pdfium.available ?? null} detail={diagnosis?.pdfium.state === 'unknown' || !diagnosis || diagnosis.pdfium.available === null ? '未检测；可点击“保存并检测”。不影响阅读、批注和笔记。' : diagnosis.pdfium.available ? diagnosis.pdfium.diagnostic : `检测未通过。${diagnosis.pdfium.diagnostic}`} />
        {Boolean(diagnosis?.recoveryDrafts) && <p className="field-help warning-text">有 {diagnosis?.recoveryDrafts} 份恢复草稿，请保留插件数据目录以便恢复。</p>}
      </section>
      <TranslationSettings preview={preview} />
      {error && <p className="callout error" role="alert">{error}</p>}
      {notice && <p className="success-text" role="status">{notice}</p>}
    </div>
    <footer className="modal-footer">{!standalone && <button onClick={() => void requestClose()} disabled={busy || closing}>{closing ? '正在关闭选择器…' : '关闭'}</button>}<button className="primary" onClick={() => void save()} disabled={locked || preview}>{busy && <LoaderCircle className="spin" size={15} />}保存配置</button></footer>
  </>;

  return standalone ? <section className="settings-page">{content}</section> : <dialog className="settings-modal" ref={dialog} onCancel={e => { e.preventDefault(); void requestClose(); }}>{content}</dialog>;
}

function Capability({ label, available, detail }: { label: string; available: boolean | null; detail: string }) {
  return <div className="capability-row"><span>{label}</span><span className={available ? 'success-text' : 'muted'}>{available ? <CheckCircle2 size={15} /> : available === null ? <CircleHelp size={15} /> : <AlertTriangle size={15} />}{detail}</span></div>;
}
