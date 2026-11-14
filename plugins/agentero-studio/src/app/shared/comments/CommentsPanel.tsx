import type { ReactNode } from 'react';
import { Filter, MessageSquare } from 'lucide-react';
import type { Actor, Feedback } from '../../../contracts/studio';
import { CommentMenu, CommentThread, type RunCommentAction } from './CommentThread';
import './comments.css';

interface Props {
  feedback: Feedback[]; actor: Actor; busy: boolean; showResolved: boolean; onShowResolved: (value: boolean) => void;
  onOpen: (feedback: Feedback) => void; onAction: RunCommentAction; onAttach: (feedback: Feedback) => Promise<void>;
  renderSuggestion: (feedback: Feedback) => ReactNode;
}
export function CommentsPanel({ feedback, actor, busy, showResolved, onShowResolved, onOpen, onAction, onAttach, renderSuggestion }: Props) {
  const visible = feedback.filter(item => showResolved || item.status !== 'resolved').sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return <div className="studio-comment-list" aria-label="备注列表面板">
    <div className="studio-comment-filter"><CommentMenu label="筛选备注" disabled={false} icon={<Filter size={16} />} items={[{ label: '显示已解决', icon: null, checked: showResolved, run: () => onShowResolved(!showResolved) }]} /></div>
    {!visible.length && <div className="studio-panel-empty"><MessageSquare size={24} /><p>{feedback.length ? '没有未解决的备注' : '还没有备注'}</p><small>点击顶部备注图标，再选择要讨论的目标。</small>{feedback.length > 0 && !showResolved && <button type="button" className="studio-link-button" onClick={() => onShowResolved(true)}>显示已解决的备注</button>}</div>}
    {visible.map(item => item.proposal ? <div key={item.id}>{renderSuggestion(item)}</div> : <CommentThread key={item.id} compact feedback={item} actor={actor} busy={busy} onOpen={() => onOpen(item)} onAction={onAction} onAttach={onAttach} />)}
  </div>;
}
