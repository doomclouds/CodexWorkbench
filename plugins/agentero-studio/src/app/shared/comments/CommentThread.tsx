import { useEffect, useRef, useState, type FormEvent, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Check, MoreHorizontal, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Actor, Feedback } from '../../../contracts/studio';

export type CommentAction = 'reply' | 'edit' | 'delete' | 'resolve' | 'reopen' | 'send';
export interface CommentActionArguments { text?: string; replyId?: string }
export type RunCommentAction = (action: CommentAction, item: Feedback, args?: CommentActionArguments) => Promise<Feedback | null>;
interface MenuItem { label: string; icon: ReactNode; danger?: boolean; checked?: boolean; run: () => void }

export function CommentMenu({ label, items, disabled, icon }: { label: string; items: MenuItem[]; disabled: boolean; icon?: ReactNode }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role^=menuitem]')?.focus();
    const place = () => { const anchor = button.current?.getBoundingClientRect(), popup = menu.current?.getBoundingClientRect(); if (anchor && popup) setPosition({ left: Math.max(8, Math.min(anchor.right - (popup.width || 150), window.innerWidth - (popup.width || 150) - 8)), top: anchor.bottom + 4 + popup.height > window.innerHeight - 8 ? Math.max(8, anchor.top - popup.height - 4) : anchor.bottom + 4 }); };
    place();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  if (!items.length) return null;
  return <div ref={root} className="studio-comment-menu-anchor">
    <button ref={button} type="button" className="studio-icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(previous => !previous)}>{icon || <MoreHorizontal size={16} />}</button>
    {open && createPortal(<div ref={menu} className="studio-comment-menu" data-studio-comment-menu="" role="menu" style={position} onKeyDown={event => {
      const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]')], index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus(); }
    }}>{items.map(item => <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} key={item.label} className={item.danger ? 'is-danger' : ''} onClick={() => { setOpen(false); button.current?.focus(); item.run(); }}>{item.icon}<span>{item.label}</span>{item.checked && <Check size={14} />}</button>)}</div>, root.current?.closest('.studio') || document.body)}
  </div>;
}

function stamp(value: string, expanded: boolean) { return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(expanded ? { year: 'numeric' } : {}) }); }
function own(author: Actor, actor: Actor) { return author.kind === 'human' && author.kind === actor.kind && author.id === actor.id; }
function MessageHeader({ author, date, expanded, children }: { author: Actor; date: string; expanded: boolean; children?: ReactNode }) {
  return <div className="studio-comment-message-header"><span className={`studio-comment-avatar${author.kind === 'agent' ? ' is-agent' : ''}`} aria-hidden="true">{(author.name || (author.kind === 'agent' ? 'Codex' : '协作者')).slice(0, 1)}</span><div className="studio-comment-author"><strong>{author.name || (author.kind === 'agent' ? 'Codex' : '协作者')}</strong><time dateTime={date}>{stamp(date, expanded)}</time></div><div className="studio-comment-message-actions">{children}</div></div>;
}

interface Props {
  feedback: Feedback; actor: Actor; busy: boolean; compact?: boolean; onOpen?: () => void; onClose?: () => void;
  onAction: RunCommentAction; onAttach: (feedback: Feedback) => Promise<void>;
  replyText?: string; onReplyTextChange?: (value: string) => void;
}

export function CommentThread({ feedback, actor, busy, compact = false, onOpen, onClose, onAction, onAttach, replyText = '', onReplyTextChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null), [editText, setEditText] = useState(''), [deleting, setDeleting] = useState(false), [error, setError] = useState(''), [running, setRunning] = useState(false), [attach, setAttach] = useState(false), [pendingReply, setPendingReply] = useState<Feedback | null>(null);
  const [editAttach, setEditAttach] = useState(false), [savedEdit, setSavedEdit] = useState<Feedback | null>(null);
  const input = useRef<HTMLTextAreaElement>(null), submitLock = useRef(false);
  const canComment = actor.role !== 'viewer', canDelete = canComment && (actor.role === 'owner' || own(feedback.author, actor));
  const canResolve = actor.role === 'owner' || actor.role === 'editor' || canComment && own(feedback.author, actor);
  const disabled = busy || running, resolved = feedback.status === 'resolved';
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  async function run(action: CommentAction, args?: CommentActionArguments) {
    if (submitLock.current) return undefined;
    submitLock.current = true; setRunning(true); setError('');
    try { return await onAction(action, feedback, args); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined; }
    finally { submitLock.current = false; setRunning(false); }
  }
  function edit(id: string, text: string) { setDeleting(false); setEditText(text); setEditing(id); setEditAttach(false); setSavedEdit(null); setError(''); }
  async function saveEdit(event: FormEvent) {
    event.preventDefault(); if (!editText.trim()) return;
    const result = savedEdit || await run('edit', { text: editText.trim(), ...(editing !== 'main' ? { replyId: editing! } : {}) });
    if (!result) return;
    if (editAttach) {
      setRunning(true);
      try { await onAttach(result); setSavedEdit(null); }
      catch (cause) { setSavedEdit(result); setError(cause instanceof Error ? cause.message : String(cause)); return; }
      finally { setRunning(false); }
    }
    setEditing(null);
  }
  async function submitReply(event: FormEvent) {
    event.preventDefault();
    let saved = pendingReply;
    if (!saved) { if (!replyText.trim()) return; saved = await run('reply', { text: replyText.trim() }) || null; if (!saved) return; onReplyTextChange?.(''); }
    if (attach) {
      setRunning(true);
      try { await onAttach(saved); setPendingReply(null); }
      catch (cause) { setPendingReply(saved); setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setRunning(false); }
    }
  }
  const editor = <form className="studio-comment-edit" onSubmit={event => void saveEdit(event)}><textarea ref={input} aria-label="编辑备注内容" value={editText} rows={3} maxLength={16000} disabled={disabled || !!savedEdit} onChange={event => setEditText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null); } }} /><label className="studio-comment-edit-attach"><input type="checkbox" checked={editAttach} disabled={disabled || !!savedEdit} onChange={event => setEditAttach(event.target.checked)} />附加到对话</label><div><button type="button" className="studio-button" disabled={disabled} onClick={() => setEditing(null)}>取消</button><button type="submit" className="studio-button studio-primary" disabled={disabled || !editText.trim()}>{savedEdit ? '重试附加' : '保存'}</button></div></form>;
  const mainMenu: MenuItem[] = [
    ...(canComment && own(feedback.author, actor) ? [{ label: '编辑', icon: <Pencil size={14} />, run: () => edit('main', feedback.text) }] : []),
    ...(canResolve && resolved ? [{ label: '重新打开', icon: <RotateCcw size={14} />, run: () => { void run('reopen'); } }] : []),
    ...(canComment ? [{ label: '附加到对话', icon: <Send size={14} />, run: () => { setError(''); void onAttach(feedback).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); } }] : []),
    ...(canDelete ? [{ label: '删除备注线程', icon: <Trash2 size={14} />, danger: true, run: () => { setEditing(null); setDeleting(true); } }] : []),
  ];
  return <article className={`studio-comment-thread${compact ? ' studio-comment-list-item' : ' is-expanded'}`} data-feedback-id={feedback.id} data-status={feedback.status} {...compact ? { role: 'button', tabIndex: 0, onClick: (event: MouseEvent) => { if (!(event.target as Element).closest('button,input,textarea,form,[role=menu]')) onOpen?.(); }, onKeyDown: (event: KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen?.(); } } } : {}}>
    <MessageHeader author={feedback.author} date={feedback.createdAt} expanded={!compact}>
      {canResolve && !resolved && <button type="button" className="studio-icon-button" aria-label="解决" title="解决" disabled={disabled} onClick={() => { void run('resolve'); }}><Check size={16} /></button>}
      <CommentMenu label="备注操作" items={mainMenu} disabled={disabled} />
      {!compact && <button type="button" className="studio-icon-button" aria-label="关闭备注" onClick={onClose}><X size={15} /></button>}
    </MessageHeader>
    {feedback.status !== 'open' && <span className={`studio-feedback-status studio-feedback-status-${feedback.status}`}>{resolved ? '已解决' : feedback.status === 'pending' ? '待房主处理' : '处理中'}</span>}
    {editing === 'main' ? editor : <p className="studio-feedback-message">{feedback.text}</p>}
    {deleting && <div className="studio-comment-delete-confirm" role="group" aria-label="删除备注确认"><p>删除这条备注及其所有回复？</p><div><button type="button" className="studio-button" disabled={disabled} onClick={() => setDeleting(false)}>取消</button><button type="button" className="studio-button is-danger" disabled={disabled} onClick={() => { void run('delete'); }}>删除</button></div></div>}
    {compact ? feedback.replies.length > 0 && <button type="button" className="studio-link-button studio-comment-reply-count" onClick={onOpen}>{feedback.replies.length} 条回复</button> : <>
      <div className="studio-comment-replies">{feedback.replies.map(reply => <div className="studio-feedback-reply" key={reply.id}>
        <MessageHeader author={reply.author} date={reply.createdAt} expanded><CommentMenu label={`回复操作：${reply.author.name}`} disabled={disabled} items={canComment && own(reply.author, actor) ? [{ label: '编辑回复', icon: <Pencil size={14} />, run: () => edit(reply.id, reply.text) }] : []} /></MessageHeader>
        {editing === reply.id ? editor : <p>{reply.text}</p>}
      </div>)}</div>
      {canComment && !editing && !deleting && <form className="studio-reply-form" onSubmit={event => void submitReply(event)}><textarea aria-label={`回复批注：${feedback.text}`} placeholder={resolved ? '回复以重新打开…' : '回复…'} value={replyText} rows={1} maxLength={16000} disabled={disabled || !!pendingReply} onChange={event => onReplyTextChange?.(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div className="studio-comment-compose-footer"><label><input type="checkbox" checked={attach} disabled={disabled || !!pendingReply} onChange={event => setAttach(event.target.checked)} />附加到对话</label><button type="submit" className="studio-comment-submit" aria-label={pendingReply ? '重试附加回复' : '发送回复'} disabled={disabled || !replyText.trim() && !pendingReply}><ArrowUp size={18} /></button></div></form>}
    </>}
    {error && <p className="studio-comment-error" role="alert">{error}</p>}
  </article>;
}
