import type { CSSProperties } from 'react';
import type { Feedback } from '../../../contracts/studio.js';
import type { CommentPoint } from './comment-target.js';

interface Props {
  feedback: Feedback;
  index: number;
  left: CSSProperties['left'];
  top: CSSProperties['top'];
  zoom: number;
  onSelect?: (feedback: Feedback, tip: CommentPoint) => void;
}

export function CommentPin({ feedback, index, left, top, zoom, onSelect }: Props) {
  return <button type="button"
    className={`studio-comment-pin studio-feedback-pin${feedback.status === 'resolved' ? ' is-resolved' : ''}`}
    data-feedback-pin={feedback.id} data-native-interactive="true"
    aria-label={`备注 ${index + 1}：${feedback.text.slice(0, 80)}`} title={feedback.text}
    style={{ left, top, transform: `scale(${1 / zoom}) translateY(-100%)` }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      onSelect?.(feedback, { x: rect.left, y: rect.bottom });
    }}>{index + 1}</button>;
}
