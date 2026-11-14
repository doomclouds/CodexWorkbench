import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import type { Actor, Presence } from '../../contracts/studio';
import { EditorPopover } from './editor-panels/EditorPopover';
import { ParticipantActivity, type PresenceMember } from './presence-members';
import './participants.css';

function status(member: PresenceMember, now: number) {
  const context = member.peer.context;
  if (context?.activity === 'reading') return '正在读取';
  if (context?.activity === 'writing') return '正在修改';
  if (member.actor.kind === 'agent' && context?.activity === 'idle') return '刚刚活动';
  if (member.peer.visible === false) return '暂时离开此页';
  if (Array.isArray(context?.editingIds) && context.editingIds.length || Array.isArray(context?.movingIds) && context.movingIds.length) return '正在编辑';
  return now - member.activeAt > 300000 ? '一会儿没动了' : '在画布上';
}
function Avatar({ member, now, followed }: { member: PresenceMember; now: number; followed?: boolean }) {
  const busy = ['正在读取', '正在修改', '正在编辑'].includes(status(member, now));
  return <span className={`studio-online-avatar${now - member.activeAt > 300000 ? ' is-idle' : ''}${busy ? ' is-busy' : ''}${followed ? ' is-followed' : ''}`} style={{ background: member.color, color: member.color === '#fbb315' ? '#201b0c' : '#fff', '--participant-color': member.color } as React.CSSProperties} aria-hidden="true">{member.actor.kind === 'agent' ? <Bot size={14} /> : (member.actor.name || '协').slice(0, 1)}</span>;
}
export function OnlineParticipants({ peers, actor, following, onFollow }: { peers: Presence[]; actor: Actor; following: string; onFollow: (actorId: string) => void }) {
  const tracker = useRef(new ParticipantActivity()), anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now);
  const members = tracker.current.read(peers, actor.id, now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  if (!members.length) return null;
  return <div className="studio-online-participants"><button ref={anchor} type="button" className="studio-online-trigger" aria-label="此刻在这里" title={members.map(member => member.actor.name).join('、')} aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="studio-online-stack">{members.slice(0, 3).map(member => <Avatar member={member} now={now} followed={following === member.actor.id} key={member.actor.id} />)}</span>{members.length > 3 && <span className="studio-online-more">+{members.length - 3}</span>}</button>{open && <EditorPopover title="此刻在这里" className="studio-online-popover" anchorRef={anchor} onClose={() => setOpen(false)}><div className="studio-online-list">{members.map(member => <div className="studio-online-row" key={member.actor.id}><Avatar member={member} now={now} followed={following === member.actor.id} /><div><strong>{member.actor.name}{member.actor.kind === 'agent' && <small>Agent</small>}</strong><p>{status(member, now)}{member.actor.kind === 'human' && <> · {({ owner: '所有者', editor: '可编辑', commenter: '可评论', viewer: '仅查看' })[member.actor.role]}</>}</p></div><button className="studio-link-button" disabled={!member.peers.some(peer => peer.visible !== false && peer.context?.viewport)} onClick={() => { onFollow(following === member.actor.id ? '' : member.actor.id); setOpen(false); }}>{following === member.actor.id ? '停止跟随' : '跟随'}</button></div>)}</div></EditorPopover>}</div>;
}
