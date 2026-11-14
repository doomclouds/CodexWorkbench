import { useId, useState, type ReactNode } from 'react';
import { Archive, Bot, Copy, Download, Eye, Globe2, LockKeyhole, MessageSquare, MoreHorizontal, Pencil, RefreshCw, User, X } from 'lucide-react';
import type { Actor, Presence } from '../../../contracts/studio';
import './editor-panels.css';

export type ShareRole = 'editor' | 'commenter' | 'viewer';
export type EditorExportFormat = 'png' | 'svg' | 'html' | 'json' | 'zip';
export interface EditorShareState { enabled: boolean; links?: Partial<Record<ShareRole, string>> }
export interface SharePanelProps {
  title: string;
  actor: Actor;
  owner?: Actor;
  peers: Presence[];
  selfPeerId?: string;
  share: EditorShareState | null;
  busy?: boolean;
  exportFormats: readonly { format: Exclude<EditorExportFormat, 'zip'>; label: string }[];
  canBackup: boolean;
  onStart: () => void;
  onReset: (role: ShareRole) => void;
  onStop: () => void;
  onCopy: (link: string) => void;
  onExport: (format: EditorExportFormat) => void;
  initialTab?: 'share' | 'export';
  extraContent?: ReactNode;
}

const roles = [
  { role: 'editor', label: '可编辑', description: '编辑和评论', Icon: Pencil },
  { role: 'commenter', label: '可评论', description: '评论，不能编辑', Icon: MessageSquare },
  { role: 'viewer', label: '仅查看', description: '只能查看', Icon: Eye },
] as const;
const roleLabel = { owner: '所有者', editor: '可编辑', commenter: '可评论', viewer: '仅查看' };
export function joinedActors(peers: Presence[], owner?: Actor): Presence[] {
  const seen = new Set(owner ? [`${owner.kind}:${owner.id}`] : []);
  return peers.filter(peer => { const key = `${peer.actor.kind}:${peer.actor.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function Avatar({ actor }: { actor?: Actor }) { return <span className={`studio-editor-avatar${actor?.kind === 'agent' ? ' is-agent' : ''}`} aria-hidden="true">{actor?.kind === 'agent' ? <Bot size={17} /> : actor ? (actor.name || '协').slice(0, 1) : <User size={17} />}</span>; }

export function SharePanel({ title, actor, owner, peers, selfPeerId, share, busy = false, exportFormats, canBackup, onStart, onReset, onStop, onCopy, onExport, initialTab = 'share', extraContent }: SharePanelProps) {
  const [tab, setTab] = useState(initialTab);
  const [more, setMore] = useState<ShareRole | 'access' | null>(null);
  const prefix = useId(), canManage = actor.role === 'owner', resolvedOwner = owner || (canManage ? actor : undefined);
  const joined = joinedActors(peers, resolvedOwner);
  const isSelf = (person: Actor) => person.id === actor.id && person.kind === actor.kind;
  return <div className="studio-share-panel">
    <div className="studio-editor-tabs" role="tablist" aria-label={`${title}分享与导出`}>
      {(['share', 'export'] as const).map(value => <button type="button" role="tab" id={`${prefix}-${value}-tab`} aria-selected={tab === value} aria-controls={`${prefix}-${value}`} tabIndex={tab === value ? 0 : -1} key={value} onClick={() => { setTab(value); setMore(null); }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); const next = event.key === 'Home' ? 'share' : event.key === 'End' ? 'export' : value === 'share' ? 'export' : 'share'; setTab(next); setMore(null); document.getElementById(`${prefix}-${next}-tab`)?.focus(); } }}>{value === 'share' ? '分享' : '导出'}</button>)}
    </div>
    {tab === 'share' ? <div role="tabpanel" id={`${prefix}-share`} aria-labelledby={`${prefix}-share-tab`} className="studio-editor-tab-content">
      <section className="studio-share-section"><h3>有权访问的人</h3><div className="studio-share-person"><Avatar actor={resolvedOwner} /><span><strong>{resolvedOwner?.name || '作品所有者'}{resolvedOwner && isSelf(resolvedOwner) ? '（你）' : ''}</strong><small>{resolvedOwner && isSelf(resolvedOwner) ? '这台电脑' : '作品管理者'}</small></span><span className="studio-share-person-role">所有者</span></div></section>
      <section className="studio-share-section"><h3>加入的人</h3>{joined.length ? joined.map(peer => <div className="studio-share-person" key={peer.peerId}><Avatar actor={peer.actor} /><span><strong>{peer.actor.name || '协作者'}{peer.peerId === selfPeerId || isSelf(peer.actor) ? '（你）' : ''}</strong><small>{peer.actor.kind === 'agent' ? 'Agent' : '在线协作者'}</small></span><span className="studio-share-person-role">{roleLabel[peer.actor.role]}</span></div>) : <p className="studio-editor-panel-note">还没有人加入。把下面的链接发给对方。</p>}</section>
      <section className="studio-share-section"><div className="studio-share-section-heading"><h3>一般访问权限</h3>{canManage && share?.enabled && <div className="studio-editor-more-anchor"><button type="button" className="studio-icon-button" aria-label="更多共享设置" aria-expanded={more === 'access'} onClick={() => setMore(more === 'access' ? null : 'access')}><MoreHorizontal size={17} /></button>{more === 'access' && <div className="studio-editor-more-menu" role="menu"><button type="button" role="menuitem" className="studio-danger-text" disabled={busy} onClick={() => { setMore(null); onStop(); }}><X size={14} />停止局域网分享</button></div>}</div>}</div>
        <div className="studio-share-access"><span className="studio-share-role-icon">{share?.enabled ? <Globe2 size={20} /> : <LockKeyhole size={20} />}</span><span><strong>{!share ? '正在读取访问权限…' : share.enabled ? '局域网可访问' : '仅这台电脑'}</strong><small>{share?.enabled ? '同一局域网中的人可使用邀请链接访问。' : '启用后，再将邀请链接发送给协作者。'}</small></span></div>
        {canManage && share && !share.enabled && <button type="button" className="studio-button studio-full-width studio-share-start" disabled={busy} onClick={onStart}><Globe2 size={15} />启用局域网分享</button>}
      </section>
      {canManage ? <section className="studio-share-section"><h3>邀请链接</h3><div className="studio-share-invitations">{roles.map(({ role, label, description, Icon }) => {
        const link = share?.enabled ? share.links?.[role] : undefined;
        return <div className="studio-share-invitation" key={role}><span className="studio-share-role-icon"><Icon size={18} /></span><span className="studio-share-role-description"><strong>{label}</strong><small>{description}</small></span><button type="button" className="studio-button studio-compact" aria-label={`复制${label}链接`} disabled={busy || !link} onClick={() => { if (link) onCopy(link); }}><Copy size={14} /><span>复制链接</span></button><div className="studio-editor-more-anchor"><button type="button" className="studio-icon-button" aria-label={`${label}链接更多操作`} aria-expanded={more === role} disabled={busy || !link} onClick={() => setMore(more === role ? null : role)}><MoreHorizontal size={17} /></button>{more === role && <div className="studio-editor-more-menu" role="menu"><button type="button" role="menuitem" disabled={busy} onClick={() => { setMore(null); onReset(role); }}><RefreshCw size={14} />重置此链接</button></div>}</div></div>;
      })}</div>{!share?.enabled && <p className="studio-editor-panel-note">先启用局域网分享，即可复制邀请链接。</p>}</section> : <p className="studio-editor-panel-note">你当前的权限为“{roleLabel[actor.role]}”。邀请链接由所有者管理。</p>}
    </div> : <div role="tabpanel" id={`${prefix}-export`} aria-labelledby={`${prefix}-export-tab`} className="studio-editor-tab-content">
      <p className="studio-editor-panel-note">选择导出格式</p><div className="studio-editor-export-formats">{exportFormats.map(({ format, label }) => <button type="button" className="studio-editor-export-option" key={format} disabled={busy} onClick={() => onExport(format)}><Download size={18} /><span>{label}</span><small>{format.toUpperCase()}</small></button>)}</div>
      {canBackup && <button type="button" className="studio-editor-export-option studio-editor-backup" disabled={busy} onClick={() => onExport('zip')}><Archive size={18} /><span><strong>完整作品备份</strong><small>包含历史记录与资源</small></span><small>ZIP</small></button>}
    </div>}
    {extraContent && <div className="studio-editor-panel-extra">{extraContent}</div>}
  </div>;
}
