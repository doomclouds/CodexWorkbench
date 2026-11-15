import { useId, useRef, useState, type ReactNode } from 'react';
import { Archive, Bot, Check, ChevronDown, Copy, Download, Eye, Globe2, LockKeyhole, MessageSquare, MoreHorizontal, Pencil, RefreshCw, Trash2, User } from 'lucide-react';
import type { Actor, ShareMember } from '../../../contracts/studio';
import { LibraryMenu } from '../../LibraryArtifactMenu';
import { StudioDialog } from '../../products/dialog';
import './editor-panels.css';

export type ShareRole = 'editor' | 'commenter' | 'viewer';
export type EditorExportFormat = 'png' | 'svg' | 'html' | 'json' | 'zip';
export interface EditorShareState { enabled: boolean; access?: 'local' | 'lan'; role?: ShareRole; roles?: ShareRole[]; canonicalPath?: string; links?: Partial<Record<ShareRole, string>>; roleEnabled?: Partial<Record<ShareRole, boolean>>; members?: ShareMember[]; removedMembers?: ShareMember[]; owner?: Actor }
export interface SharePanelProps {
  title: string; actor: Actor; share: EditorShareState | null; busy?: boolean;
  exportFormats: readonly { format: Exclude<EditorExportFormat, 'zip'>; label: string }[];
  canBackup: boolean;
  onStart: (access: 'local' | 'lan') => Promise<boolean>;
  onReset: (role: ShareRole) => Promise<boolean>;
  onToggleRole: (role: ShareRole, on: boolean) => Promise<boolean>;
  onMemberRole: (memberId: string, role: ShareRole) => Promise<boolean>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
  onRestoreMember: (memberId: string, role: ShareRole) => Promise<boolean>;
  onForgetMember: (memberId: string) => Promise<boolean>;
  onCopy: (link: string | undefined, role?: ShareRole) => void;
  canonicalLink?: string;
  onExport: (format: EditorExportFormat) => void;
  initialTab?: 'share' | 'export'; extraContent?: ReactNode;
}
const roles = [
  { role: 'editor', label: '可编辑', description: '编辑和评论', Icon: Pencil },
  { role: 'commenter', label: '可评论', description: '评论，不能编辑', Icon: MessageSquare },
  { role: 'viewer', label: '仅查看', description: '只能查看', Icon: Eye },
] as const;
const roleLabel = { owner: '所有者', editor: '可编辑', commenter: '可评论', viewer: '仅查看' };
function Avatar({ actor, online = false }: { actor?: Pick<Actor, 'name' | 'kind'>; online?: boolean }) { return <span className={`studio-editor-avatar${actor?.kind === 'agent' ? ' is-agent' : ''}`} aria-hidden="true">{actor?.kind === 'agent' ? <Bot size={17} /> : actor ? (actor.name || '协').slice(0, 1) : <User size={17} />}{online && <span className="studio-share-status-dot" aria-hidden="true" />}</span>; }

function lastVisit(value: string): string {
  const elapsed = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
  if (!Number.isFinite(elapsed)) return '';
  if (elapsed < 60) return '刚刚来过';
  const relative = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  return `${elapsed < 3600 ? relative.format(-Math.floor(elapsed / 60), 'minute') : elapsed < 86400 ? relative.format(-Math.floor(elapsed / 3600), 'hour') : relative.format(-Math.floor(elapsed / 86400), 'day')}来过`;
}

function MemberRow({ member, self, canManage, busy, enabled, onRole, onRemove }: { member: ShareMember; self: boolean; canManage: boolean; busy: boolean; enabled: Partial<Record<ShareRole, boolean>>; onRole: (role: ShareRole) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  const seenAt = member.lastSeenAt || member.joinedAt, visit = lastVisit(seenAt);
  return <div className="studio-share-person"><Avatar actor={{ name: member.name, kind: 'human' }} online={member.active && member.online} /><span><strong>{member.name || '协作者'}{self ? '（你）' : ''}</strong><small className={`studio-share-status${member.active && member.online ? ' is-online' : ''}`}>{!member.active ? '链接已停用' : <>{member.online ? '在线' : <>离线{visit && <> · <time dateTime={seenAt} title={new Date(seenAt).toLocaleString('zh-CN')}>{visit}</time></>}</>}</>}</small></span>{canManage ? <><button ref={anchor} type="button" className="studio-share-member-role" aria-label={`管理成员：${member.name}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(previous => !previous)}>{roleLabel[member.role]}<ChevronDown size={13} /></button>{open && <LibraryMenu anchorRef={anchor} label={`管理成员：${member.name}`} className="studio-editor-submenu" initialFocus="first" onClose={() => setOpen(false)}>{roles.map(({ role, label }) => <button type="button" role="menuitemradio" aria-checked={member.role === role} disabled={busy || enabled[role] !== true} key={role} onClick={() => { setOpen(false); if (role !== member.role) onRole(role); }}><span>{label}</span>{member.role === role && <Check size={14} />}</button>)}<div className="studio-menu-rule" role="separator" /><button type="button" role="menuitem" className="studio-danger-text" disabled={busy} onClick={() => { setOpen(false); onRemove(); }}><Trash2 size={14} />移除访问权限</button></LibraryMenu>}</> : <span className="studio-share-person-role">{roleLabel[member.role]}</span>}</div>;
}

function RemovedMemberRow({ member, busy, enabled, onRestore, onForget }: { member: ShareMember; busy: boolean; enabled: Partial<Record<ShareRole, boolean>>; onRestore: (role: ShareRole) => void; onForget: () => void }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  return <div className="studio-share-person"><Avatar actor={{ name: member.name, kind: 'human' }} /><span><strong>{member.name}</strong><small>访问权限已移除</small></span><button ref={anchor} type="button" className="studio-share-member-role" aria-label={`恢复访问：${member.name}`} aria-haspopup="menu" aria-expanded={open} disabled={busy || !roles.some(({ role }) => enabled[role] === true)} onClick={() => setOpen(previous => !previous)}><RefreshCw size={14} />恢复访问<ChevronDown size={13} /></button><button type="button" className="studio-icon-button studio-share-forget" aria-label={`删除成员记录：${member.name}`} title="删除成员记录" disabled={busy} onClick={onForget}><Trash2 size={14} /></button>{open && <LibraryMenu anchorRef={anchor} label={`恢复访问：${member.name}`} className="studio-editor-submenu" initialFocus="first" onClose={() => setOpen(false)}>{roles.map(({ role, label }) => <button type="button" role="menuitem" disabled={busy || enabled[role] !== true} key={role} onClick={() => { setOpen(false); onRestore(role); }}>恢复为{label}</button>)}</LibraryMenu>}</div>;
}

function AccessControl({ share, canManage, busy, onChange }: { share: EditorShareState | null; canManage: boolean; busy: boolean; onChange: (access: 'local' | 'lan') => void }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  const lan = share?.access === 'lan';
  return <div className="studio-share-access"><span className="studio-share-role-icon">{lan ? <Globe2 size={20} /> : <LockKeyhole size={20} />}</span><span><button ref={anchor} type="button" className="studio-share-access-button" aria-label="一般访问权限" aria-haspopup="menu" aria-expanded={open} disabled={!share || busy || !canManage} onClick={() => setOpen(previous => !previous)}>{!share ? '正在读取访问权限…' : lan ? '局域网可访问' : '仅这台电脑'}{canManage && <ChevronDown size={14} />}</button><small>{lan ? '同一局域网中的人可使用邀请链接访问。' : '只有这台电脑能够打开；邀请链接仍可复制。'}</small></span>{open && <LibraryMenu anchorRef={anchor} label="一般访问权限" className="studio-editor-submenu" onClose={() => setOpen(false)}><button type="button" role="menuitemradio" aria-checked={!lan} disabled={busy} onClick={() => { setOpen(false); if (lan) onChange('local'); }}><LockKeyhole size={15} /><span>仅这台电脑</span>{!lan && <Check size={14} />}</button><button type="button" role="menuitemradio" aria-checked={lan} disabled={busy} onClick={() => { setOpen(false); if (!lan) onChange('lan'); }}><Globe2 size={15} /><span>局域网可访问</span>{lan && <Check size={14} />}</button></LibraryMenu>}</div>;
}

function InvitationRow({ role, enabled, link, busy, onToggle, onCopy, onReset }: { role: typeof roles[number]; enabled: boolean; link?: string; busy: boolean; onToggle: (on: boolean) => void; onCopy: SharePanelProps['onCopy']; onReset: () => void }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  const Icon = role.Icon;
  return <div className="studio-share-invitation"><span className="studio-share-role-icon"><Icon size={18} /></span><span className="studio-share-role-description"><strong>{role.label}</strong><small>{enabled ? role.description : '链接已停用'}</small></span>{enabled ? <button type="button" className="studio-button studio-compact" aria-label={`复制${role.label}链接`} disabled={busy} onClick={() => onCopy(link, role.role)}><Copy size={14} /><span>复制链接</span></button> : <button type="button" className="studio-button studio-compact" aria-label={`启用${role.label}链接`} disabled={busy} onClick={() => onToggle(true)}>启用链接</button>}<button ref={anchor} type="button" className="studio-icon-button" aria-label={`${role.label}链接更多操作`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(previous => !previous)}><MoreHorizontal size={17} /></button>{open && <LibraryMenu anchorRef={anchor} label={`${role.label}链接更多操作`} className="studio-editor-submenu" onClose={() => setOpen(false)}><button type="button" role="menuitem" disabled={busy} onClick={() => { setOpen(false); onToggle(!enabled); }}>{enabled ? '停用此链接' : '启用此链接'}</button><button type="button" role="menuitem" disabled={busy} onClick={() => { setOpen(false); onReset(); }}><RefreshCw size={14} />重置此链接</button></LibraryMenu>}</div>;
}

export function SharePanel({ title, actor, share, busy = false, exportFormats, canBackup, onStart, onReset, onToggleRole, onMemberRole, onRemoveMember, onRestoreMember, onForgetMember, onCopy, onExport, canonicalLink, initialTab = 'share', extraContent }: SharePanelProps) {
  const [tab, setTab] = useState(initialTab), [confirmation, setConfirmation] = useState<{ role: ShareRole } | { member: ShareMember } | { forget: ShareMember } | null>(null), [confirming, setConfirming] = useState(false);
  const prefix = useId(), canManage = actor.role === 'owner', owner = share?.owner || (canManage ? actor : undefined), enabled = share?.roleEnabled || {};
  const isSelf = (id: string) => id === actor.id;
  const allowedGuestRoles = roles.slice(Math.max(0, roles.findIndex(item => item.role === actor.role))).map(item => item.role);
  async function confirm() {
    if (!confirmation || busy || confirming) return;
    setConfirming(true);
    try { if (await ('role' in confirmation ? onReset(confirmation.role) : 'forget' in confirmation ? onForgetMember(confirmation.forget.id) : onRemoveMember(confirmation.member.id))) setConfirmation(null); }
    finally { setConfirming(false); }
  }
  if (!canManage) return <div className="studio-share-panel studio-guest-share">
    <section className="studio-share-section"><h3>邀请链接</h3>{!share ? <p className="studio-editor-panel-note">正在读取邀请链接…</p> : roles.filter(({ role }) => allowedGuestRoles.includes(role) && share.roles?.includes(role) && share.links?.[role]).map(({ role, label, description, Icon }) => <div className="studio-share-invitation" key={role}><span className="studio-share-role-icon"><Icon size={18} /></span><span className="studio-share-role-description"><strong>{label}</strong><small>{description}</small></span><button type="button" className="studio-button studio-compact" aria-label={`复制${label}链接`} disabled={busy} onClick={() => onCopy(share.links![role], role)}><Copy size={14} />复制链接</button></div>)}<p className="studio-editor-panel-note">打开邀请链接的人会以对应角色加入。所有者可以更改角色或移除访问权限。</p></section>
    <div className="studio-share-canonical"><p className="studio-editor-panel-note">只有有权访问的人才能打开这个链接</p><button type="button" className="studio-button studio-compact" disabled={busy || !canonicalLink} onClick={() => onCopy(canonicalLink)}><Copy size={14} />复制页面链接</button></div>
    {extraContent && <div className="studio-editor-panel-extra">{extraContent}</div>}
  </div>;
  return <div className="studio-share-panel"><div className="studio-editor-tabs" role="tablist" aria-label={`${title}分享与导出`}>{(['share', 'export'] as const).map(value => <button type="button" role="tab" id={`${prefix}-${value}-tab`} aria-selected={tab === value} aria-controls={`${prefix}-${value}`} tabIndex={tab === value ? 0 : -1} key={value} onClick={() => setTab(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'share' : event.key === 'End' ? 'export' : value === 'share' ? 'export' : 'share'; setTab(next); document.getElementById(`${prefix}-${next}-tab`)?.focus(); } }}>{value === 'share' ? '分享' : '导出'}</button>)}</div>
    {tab === 'share' ? <div role="tabpanel" id={`${prefix}-share`} aria-labelledby={`${prefix}-share-tab`} className="studio-editor-tab-content">
      <section className="studio-share-section"><h3>有权访问的人</h3><div className="studio-share-person"><Avatar actor={owner} /><span><strong>{owner?.name || '作品所有者'}{owner && isSelf(owner.id) ? '（你）' : ''}</strong><small>{owner && isSelf(owner.id) ? '这台电脑' : '作品管理者'}</small></span><span className="studio-share-person-role">所有者</span></div></section>
      <section className="studio-share-section"><h3>加入的人</h3>{share?.members?.length ? share.members.map(member => <MemberRow member={member} self={isSelf(member.id)} canManage={canManage} busy={busy} enabled={enabled} onRole={role => { void onMemberRole(member.id, role); }} onRemove={() => setConfirmation({ member })} key={member.id} />) : <p className="studio-editor-panel-note">{share?.members ? '还没有人加入。把下面的链接发给对方。' : '成员信息由所有者管理。'}</p>}</section>
      {!!share?.removedMembers?.length && <section className="studio-share-section"><h3>已移除的成员</h3>{share.removedMembers.map(member => <RemovedMemberRow key={member.id} member={member} busy={busy} enabled={share.enabled ? enabled : {}} onRestore={role => { void onRestoreMember(member.id, role); }} onForget={() => setConfirmation({ forget: member })} />)}<p className="studio-editor-panel-note">选择角色恢复后，对方可用原浏览器重新打开白板。</p></section>}
      <section className="studio-share-section"><h3>一般访问权限</h3><AccessControl share={share} canManage={canManage} busy={busy} onChange={access => { void onStart(access); }} /></section>
      {canManage ? <section className="studio-share-section"><h3>邀请链接</h3><div className="studio-share-invitations">{roles.map(role => <InvitationRow role={role} enabled={!share?.enabled || enabled[role.role] === true} link={share?.enabled ? share.links?.[role.role] : undefined} busy={busy || !share} onToggle={on => { void onToggleRole(role.role, on); }} onCopy={onCopy} onReset={() => setConfirmation({ role: role.role })} key={role.role} />)}</div>{share && !share.enabled && <p className="studio-editor-panel-note">复制链接仅创建本机邀请，不会自动开启局域网共享。</p>}</section> : <p className="studio-editor-panel-note">你当前的权限为“{roleLabel[actor.role]}”。邀请链接由所有者管理。</p>}
    </div> : <div role="tabpanel" id={`${prefix}-export`} aria-labelledby={`${prefix}-export-tab`} className="studio-editor-tab-content"><p className="studio-editor-panel-note">选择导出格式</p><div className="studio-editor-export-formats">{exportFormats.map(({ format, label }) => <button type="button" className="studio-editor-export-option" key={format} aria-label={format === 'html' ? label : undefined} disabled={busy} onClick={() => onExport(format)}><Download size={18} /><span>{label}{format === 'html' && <small className="studio-editor-export-note">HTML导出整块白板的已保存内容；不含协作评论和历史。导出后的交互状态仅在本页内存保存。</small>}</span><small>{format.toUpperCase()}</small></button>)}</div>{canBackup && <button type="button" className="studio-editor-export-option studio-editor-backup" disabled={busy} onClick={() => onExport('zip')}><Archive size={18} /><span><strong>完整作品备份</strong><small>包含历史记录与资源</small></span><small>ZIP</small></button>}</div>}
    {extraContent && <div className="studio-editor-panel-extra">{extraContent}</div>}
    {confirmation && <StudioDialog title={'role' in confirmation ? '重置邀请链接？' : 'forget' in confirmation ? '删除成员记录？' : '移除成员？'} onClose={() => { if (!busy && !confirming) setConfirmation(null); }}><p>{'role' in confirmation ? '原链接将失效，通过该链接加入的成员需要使用新链接重新加入。' : 'forget' in confirmation ? `删除 ${confirmation.forget.name} 的成员记录并释放此白板中的名字。对方以后使用有效邀请链接需重新填写名字；历史和评论仍保留。` : `移除 ${confirmation.member.name} 后，此人的当前访问权限将被撤销。`}</p><div className="studio-modal-footer"><button type="button" className="studio-button" disabled={busy || confirming} onClick={() => setConfirmation(null)}>取消</button><button type="button" className="studio-button studio-primary" disabled={busy || confirming} onClick={() => void confirm()}>{confirming ? '正在处理…' : 'role' in confirmation ? '确认重置' : 'forget' in confirmation ? '确认删除' : '确认移除'}</button></div></StudioDialog>}
  </div>;
}
