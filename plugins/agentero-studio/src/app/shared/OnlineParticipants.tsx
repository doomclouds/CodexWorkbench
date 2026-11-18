import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import type { Actor, AgentTask, AgentTaskReleaseTarget, Presence } from '../../contracts/studio';
import { EditorPopover } from './editor-panels/EditorPopover';
import { ParticipantActivity, participantIdentity, type PresenceMember } from './presence-members';
import type { StudioDocument } from '../products';
import { activeAgentTasks, agentPeerBounds, agentTaskDeadline, agentTaskStale, agentWorkStatus, documentElements, visibleAgentTasks } from './agent-activity';
import './participants.css';

function memberTasks(member: PresenceMember, now: number) {
  const tasks = new Map<string, { peer: Presence; task: AgentTask }>();
  for (const peer of [...member.peers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) for (const task of visibleAgentTasks(peer, now)) {
    const key = `${peer.actor.id}\0${task.taskId}\0${task.generation}`;
    if (!tasks.has(key)) tasks.set(key, { peer, task });
  }
  return [...tasks.values()];
}
function status(member: PresenceMember, now: number) {
  const context = member.peer.context;
  const tasks = memberTasks(member, now), active = tasks.filter(({ peer, task }) => activeAgentTasks(peer, now).includes(task));
  if (active.length) return agentWorkStatus((active.find(({ task }) => !agentTaskStale(task, now)) ?? active[0])!.task, now) + (active.length > 1 ? ` · 另 ${active.length - 1} 项` : '');
  if (tasks.length) return agentWorkStatus(tasks[0]!.task, now);
  if (member.actor.kind === 'agent' && context?.activity === 'reading') return '正在读取';
  if (member.actor.kind === 'agent' && context?.activity === 'writing') return '正在修改';
  const pages = member.peers.filter(peer => peer.visible !== false);
  if (pages.some(peer => peer.context?.editingIds?.length || Array.isArray(peer.context?.movingIds) && peer.context.movingIds.length)) return '正在编辑';
  if (pages.some(peer => peer.context?.savingIds?.length)) return '正在保存';
  if (member.peer.visible === false) return '暂时离开此页';
  if (member.actor.kind === 'agent' && ['idle', 'working'].includes(String(context?.activity))) return '刚刚活动';
  return now - member.activeAt > 300000 ? '一会儿没动了' : '在画布上';
}
function Avatar({ member, now, followed }: { member: PresenceMember; now: number; followed?: boolean }) {
  const tasks = memberTasks(member, now);
  const busy = tasks.length ? tasks.some(({ peer, task }) => activeAgentTasks(peer, now).includes(task) && !agentTaskStale(task, now)) : ['正在读取', '正在修改', '正在编辑', '正在保存'].includes(status(member, now));
  return <span className={`studio-online-avatar${now - member.activeAt > 300000 ? ' is-idle' : ''}${busy ? ' is-busy' : ''}${followed ? ' is-followed' : ''}`} style={{ background: member.color, color: member.color === '#fbb315' ? '#201b0c' : '#fff', '--participant-color': member.color } as React.CSSProperties} aria-hidden="true">{member.actor.kind === 'agent' ? <Bot size={14} /> : (member.actor.name || '协').slice(0, 1)}</span>;
}
export function OnlineParticipants({ peers, actor, following, onFollow, document, clockOffsetMs = 0, preview = false, onReleaseAgentTask }: { peers: Presence[]; actor: Actor; following: string; onFollow: (actorId: string) => void; document?: StudioDocument | null; clockOffsetMs?: number; preview?: boolean; onReleaseAgentTask?: (target: AgentTaskReleaseTarget) => Promise<void> }) {
  const tracker = useRef(new ParticipantActivity()), anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [, tick] = useState(0);
  const pending = useRef(new Set<string>()), [releasing, setReleasing] = useState(new Set<string>()), [releaseError, setReleaseError] = useState('');
  const now = Date.now() + clockOffsetMs, elements = documentElements(document);
  const members = tracker.current.read(peers, actor.id, now);
  const nextTaskDeadline = Math.min(...peers.flatMap(peer => visibleAgentTasks(peer, now).map(task => agentTaskDeadline(task, now))));
  useEffect(() => { const timer = setTimeout(() => tick(value => value + 1), Math.min(5000, Math.max(1, nextTaskDeadline - (Date.now() + clockOffsetMs)))); return () => clearTimeout(timer); });
  const release = async (target: AgentTaskReleaseTarget) => {
    if (!onReleaseAgentTask || preview) return;
    const key = `${target.targetActorId}\0${target.taskId}\0${target.generation}`;
    if (pending.current.has(key)) return;
    pending.current.add(key); setReleasing(new Set(pending.current)); setReleaseError('');
    try { await onReleaseAgentTask(target); }
    catch (error) { setReleaseError(`结束工作区失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { pending.current.delete(key); setReleasing(new Set(pending.current)); }
  };
  if (!members.length) return null;
  return <div className="studio-online-participants"><button ref={anchor} type="button" className="studio-online-trigger" aria-label="此刻在这里" title={members.map(member => member.actor.name).join('、')} aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="studio-online-stack">{members.slice(0, 3).map(member => <Avatar member={member} now={now} followed={following === participantIdentity(member.actor)} key={participantIdentity(member.actor)} />)}</span>{members.length > 3 && <span className="studio-online-more">+{members.length - 3}</span>}</button>{open && <EditorPopover title="此刻在这里" className="studio-online-popover" anchorRef={anchor} onClose={() => setOpen(false)}><div className="studio-online-list">{members.map(member => {
    const identity = participantIdentity(member.actor);
    const canFollow = member.peers.some(peer => peer.visible !== false && (peer.actor.kind === 'agent' ? !!agentPeerBounds(peer, elements, now) : !!peer.context?.viewport));
    const tasks = memberTasks(member, now).filter(({ peer, task }) => activeAgentTasks(peer, now).includes(task));
    const showTaskRows = !preview && !!onReleaseAgentTask && tasks.length > 0;
    const summary = showTaskRows ? `${tasks.length}个工作区` : status(member, now);
    return <div className="studio-online-row" key={identity}><Avatar member={member} now={now} followed={following === identity} /><div><strong>{member.actor.name}{member.actor.kind === 'agent' && <small>Agent</small>}</strong>{(!showTaskRows || tasks.length > 1) && <p title={summary}>{summary}{member.actor.kind === 'human' && <> · {({ owner: '所有者', editor: '可编辑', commenter: '可评论', viewer: '仅查看' })[member.actor.role]}</>}</p>}{showTaskRows && tasks.map(({ peer, task }) => {
      const key = `${peer.actor.id}\0${task.taskId}\0${task.generation}`;
      return <div className={`studio-online-workspace${agentTaskStale(task, now) ? ' is-stale' : ''}`} key={key}><span>{agentWorkStatus(task, now)}</span><button type="button" data-agent-task-release={task.taskId} aria-label={`结束此工作区：${task.label || task.taskId}`} title="结束此工作区并撤销后续写入，不会停止模型运行" disabled={releasing.has(key)} onClick={() => void release({ artifactId: peer.context!.artifactId, targetActorId: peer.actor.id, taskId: task.taskId, generation: task.generation })}>{releasing.has(key) ? '正在结束…' : '结束此工作区'}</button></div>;
    })}</div><button className="studio-link-button studio-online-follow" disabled={preview || !canFollow && following !== identity} title={preview ? '预览期间不能跟随，请先退出预览' : !canFollow ? '当前没有可跟随的工作区域或视口' : undefined} onClick={() => { onFollow(following === identity ? '' : identity); setOpen(false); }}>{following === identity ? '停止跟随' : '跟随'}</button></div>;
  })}</div>{releaseError && <p className="studio-agent-release-error" role="alert">{releaseError}</p>}</EditorPopover>}</div>;
}
