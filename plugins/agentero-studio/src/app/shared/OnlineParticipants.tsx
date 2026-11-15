import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import type { Actor, Presence } from '../../contracts/studio';
import { EditorPopover } from './editor-panels/EditorPopover';
import { ParticipantActivity, type PresenceMember } from './presence-members';
import type { StudioDocument } from '../products';
import { activeAgentTasks, agentPeerBounds, documentElements } from './agent-activity';
import { AgentWorkingMark } from './AgentWorkingMark';
import './participants.css';

function status(member: PresenceMember, now: number) {
  const context = member.peer.context;
  const tasks = activeAgentTasks(member.peer, now);
  if (tasks.length) return (tasks[0]!.label || '正在工作') + (tasks.length > 1 ? ` · 另 ${tasks.length - 1} 项` : '');
  if (context?.activity === 'reading') return '正在读取';
  if (context?.activity === 'writing') return '正在修改';
  if (member.actor.kind === 'agent' && ['idle', 'working'].includes(String(context?.activity))) return '刚刚活动';
  if (member.peer.visible === false) return '暂时离开此页';
  if (Array.isArray(context?.editingIds) && context.editingIds.length || Array.isArray(context?.movingIds) && context.movingIds.length) return '正在编辑';
  return now - member.activeAt > 300000 ? '一会儿没动了' : '在画布上';
}
function Avatar({ member, now, followed }: { member: PresenceMember; now: number; followed?: boolean }) {
  const working = activeAgentTasks(member.peer, now).length > 0;
  const busy = working || ['正在读取', '正在修改', '正在编辑'].includes(status(member, now));
  return <span className={`studio-online-avatar${now - member.activeAt > 300000 ? ' is-idle' : ''}${busy ? ' is-busy' : ''}${followed ? ' is-followed' : ''}`} style={{ background: member.color, color: member.color === '#fbb315' ? '#201b0c' : '#fff', '--participant-color': member.color } as React.CSSProperties} aria-hidden="true">{member.actor.kind === 'agent' ? working ? <AgentWorkingMark /> : <Bot size={14} /> : (member.actor.name || '协').slice(0, 1)}</span>;
}
export function OnlineParticipants({ peers, actor, following, onFollow, document, clockOffsetMs = 0, preview = false }: { peers: Presence[]; actor: Actor; following: string; onFollow: (actorId: string) => void; document?: StudioDocument | null; clockOffsetMs?: number; preview?: boolean }) {
  const tracker = useRef(new ParticipantActivity()), anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [, tick] = useState(0);
  const now = Date.now() + clockOffsetMs, elements = documentElements(document);
  const members = tracker.current.read(peers, actor.id, now);
  const nextTaskExpiry = Math.min(...peers.flatMap(peer => activeAgentTasks(peer, now).map(task => task.expiresAt)));
  useEffect(() => { const timer = setTimeout(() => tick(value => value + 1), Math.min(5000, Math.max(1, nextTaskExpiry - (Date.now() + clockOffsetMs)))); return () => clearTimeout(timer); });
  if (!members.length) return null;
  return <div className="studio-online-participants"><button ref={anchor} type="button" className="studio-online-trigger" aria-label="此刻在这里" title={members.map(member => member.actor.name).join('、')} aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="studio-online-stack">{members.slice(0, 3).map(member => <Avatar member={member} now={now} followed={following === member.actor.id} key={member.actor.id} />)}</span>{members.length > 3 && <span className="studio-online-more">+{members.length - 3}</span>}</button>{open && <EditorPopover title="此刻在这里" className="studio-online-popover" anchorRef={anchor} onClose={() => setOpen(false)}><div className="studio-online-list">{members.map(member => {
    const canFollow = member.peers.some(peer => peer.visible !== false && (peer.actor.kind === 'agent' ? !!agentPeerBounds(peer, elements, now) : !!peer.context?.viewport));
    return <div className="studio-online-row" key={member.actor.id}><Avatar member={member} now={now} followed={following === member.actor.id} /><div><strong>{member.actor.name}{member.actor.kind === 'agent' && <small>Agent</small>}</strong><p title={status(member, now)}>{status(member, now)}{member.actor.kind === 'human' && <> · {({ owner: '所有者', editor: '可编辑', commenter: '可评论', viewer: '仅查看' })[member.actor.role]}</>}</p></div><button className="studio-link-button" disabled={preview || !canFollow && following !== member.actor.id} title={preview ? '预览期间不能跟随，请先退出预览' : !canFollow ? '当前没有可跟随的工作区域或视口' : undefined} onClick={() => { onFollow(following === member.actor.id ? '' : member.actor.id); setOpen(false); }}>{following === member.actor.id ? '停止跟随' : '跟随'}</button></div>;
  })}</div></EditorPopover>}</div>;
}
