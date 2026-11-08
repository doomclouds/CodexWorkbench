import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, X } from 'lucide-react';
import type { LibrarySettings, LibraryStatus } from '../contracts/types';
import { callTool } from './api';
import { messageOf } from './model';

interface Props {
  settings: LibrarySettings | null;
  status: LibraryStatus | null;
  preview: boolean;
  dirty: boolean;
  standalone?: boolean;
  onClose(): void;
  onSaved(settings: LibrarySettings): Promise<void>;
}

export function SettingsPanel({ settings, status, preview, dirty, standalone = false, onClose, onSaved }: Props) {
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

  useEffect(() => {
    if (standalone) return;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); };
  }, [standalone]);

  async function save() {
    if (preview || busy) return;
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
    if (preview || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      // Validate the submitted paths rather than reporting readiness for old values.
      if (dirty && draft.vaultPath !== settings?.vaultPath) throw new Error('请先保存笔记，再检测另一个知识库。');
      const next = await callTool<LibrarySettings>('settings_update', { set: draft });
      await onSaved(next);
      setDiagnosis(await callTool<LibraryStatus>('library_status'));
      setNotice('检测完成，结果对应已保存的配置。');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function createVault() {
    if (preview || busy || dirty) return;
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
      {!standalone && <button className="icon-button" aria-label="关闭设置" disabled={busy} onClick={onClose}><X size={18} /></button>}
    </header>
    <div className="settings-body">
      {preview && <p className="callout">界面预览不会检测或修改本机配置。请在 Codex 插件中完成设置。</p>}
      <section className="settings-section">
        <div className="section-heading"><h3>Agentero CLI</h3><a href="https://github.com/poco-ai/Agentero/blob/v0.15.2/docs/backend/cli.md" target="_blank" rel="noreferrer">安装说明 <ExternalLink size={12} /></a></div>
        <label htmlFor="cli-path">可执行文件路径</label>
        <input id="cli-path" value={draft.cliPath} onChange={e => setDraft({ ...draft, cliPath: e.target.value })} placeholder="agentero 或完整可执行文件路径" spellCheck={false} disabled={busy} />
        <p className="field-help">CLI 由你自行安装。桌面应用的 PATH 可能与终端不同，可填写完整路径。</p>
      </section>
      <section className="settings-section">
        <h3>知识库</h3>
        <label htmlFor="vault-path">已有知识库或新建位置</label>
        <input id="vault-path" value={draft.vaultPath} onChange={e => { setDraft({ ...draft, vaultPath: e.target.value }); setConfirmCreate(false); }} placeholder={diagnosis?.defaultVaultPath ?? '知识库完整路径'} spellCheck={false} disabled={busy || dirty} />
        <div className="button-row compact">
          <button disabled={busy || dirty || !diagnosis?.defaultVaultPath} onClick={() => setDraft({ ...draft, vaultPath: diagnosis!.defaultVaultPath })}>使用默认目录</button>
          <button disabled={busy || preview || dirty} onClick={() => setConfirmCreate(true)}>创建知识库…</button>
        </div>
        {dirty && <p className="field-help warning-text">请先保存或处理笔记草稿，再切换知识库。</p>}
        {confirmCreate && <div className="callout warning"><strong>确认创建知识库？</strong><p className="path-text">{draft.vaultPath || diagnosis?.defaultVaultPath}</p><p>仅在此位置创建，不自动搬移已有文献。</p><div className="button-row"><button onClick={() => setConfirmCreate(false)} disabled={busy}>取消</button><button className="primary" onClick={() => void createVault()} disabled={busy}>确认创建</button></div></div>}
        <div className="data-root"><span>插件数据目录</span><code>{diagnosis?.dataRoot ?? '~/.codexworkbench/agentero-library/'}</code></div>
      </section>
      <section className="settings-section">
        <h3>PDF 与正文访问</h3>
        <label htmlFor="pdfium-path">PDFium 路径（可选）</label>
        <input id="pdfium-path" value={draft.pdfiumPath} onChange={e => setDraft({ ...draft, pdfiumPath: e.target.value })} placeholder="已安装 PDFium 的目录" spellCheck={false} disabled={busy} />
        <p className="field-help">原生解析依赖 PDFium；浏览器基础阅读使用独立的阅读器，不依赖此原生库。</p>
        <label className="checkbox-row"><input type="checkbox" checked={draft.allowAgentPdfText} disabled={busy} onChange={e => setDraft({ ...draft, allowAgentPdfText: e.target.checked })} /><span>允许 Agent 读取 PDF 正文</span></label>
        <p className="field-help">开启后可按需读取与搜索正文。你主动发送的选区由当次操作决定。</p>
      </section>
      <section className="settings-section diagnostics">
        <div className="section-heading"><h3>能力检查</h3><button onClick={() => void diagnose()} disabled={busy || preview}>{busy ? <LoaderCircle className="spin" size={14} /> : null}保存并检测</button></div>
        <Capability label="CLI" available={Boolean(diagnosis?.cli.available && diagnosis.cli.supported)} detail={diagnosis?.cli.version ? `v${diagnosis.cli.version}` : diagnosis?.cli.error ?? '尚未检测'} />
        <Capability label="文献库" available={Boolean(diagnosis?.vault.valid)} detail={diagnosis?.vault.valid ? '可用' : diagnosis?.vault.error ?? '尚未连接'} />
        <Capability label="笔记读写" available={Boolean(diagnosis?.capabilities.notes)} detail={diagnosis?.capabilities.notes ? '可用' : '需要可用的 CLI 与知识库'} />
        <Capability label="PDF 解析" available={Boolean(diagnosis?.capabilities.pdfParse)} detail={diagnosis?.pdfium.diagnostic ?? '尚未检测'} />
        {Boolean(diagnosis?.recoveryDrafts) && <p className="field-help warning-text">有 {diagnosis?.recoveryDrafts} 份恢复草稿，请保留插件数据目录以便恢复。</p>}
      </section>
      {error && <p className="callout error" role="alert">{error}</p>}
      {notice && <p className="success-text" role="status">{notice}</p>}
    </div>
    <footer className="modal-footer">{!standalone && <button onClick={onClose} disabled={busy}>关闭</button>}<button className="primary" onClick={() => void save()} disabled={busy || preview}>{busy && <LoaderCircle className="spin" size={15} />}保存配置</button></footer>
  </>;

  return standalone ? <section className="settings-page">{content}</section> : <dialog className="settings-modal" ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>{content}</dialog>;
}

function Capability({ label, available, detail }: { label: string; available: boolean; detail: string }) {
  return <div className="capability-row"><span>{label}</span><span className={available ? 'success-text' : 'muted'}>{available ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{detail}</span></div>;
}
