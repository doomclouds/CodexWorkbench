import type { CSSProperties, MouseEvent } from 'react';
import { Check } from 'lucide-react';
import type { Feedback } from '../../../contracts/studio.js';
import { CommentAuthorGlyph, commentAuthorName, commentAuthorStyle } from './comment-author.js';
import type { CommentPoint } from './comment-target.js';

interface Props {
  feedback: Feedback;
  left: CSSProperties['left'];
  top: CSSProperties['top'];
  zoom: number;
  onSelect?: (feedback: Feedback, tip: CommentPoint) => void;
}

export function CommentPin({ feedback, left, top, zoom, onSelect }: Props) {
  const author = commentAuthorName(feedback.author);
  const resolved = feedback.status === 'resolved';
  const label = `${author}${resolved ? '（已解决）' : ''}：${feedback.text.slice(0, 80)}`;
  function handleSelect(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onSelect?.(feedback, { x: rect.left, y: rect.bottom });
  }

  return (
    <button
      type="button"
      className={`studio-comment-pin studio-feedback-pin${resolved ? ' is-resolved' : ''}`}
      data-feedback-pin={feedback.id}
      data-native-interactive="true"
      data-comment-author={author}
      aria-label={`备注 ${label}`}
      title={label}
      style={{
        ...commentAuthorStyle(feedback.author),
        left,
        top,
        transform: `scale(${1 / zoom}) translateY(-100%)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={handleSelect}
    >
      <CommentAuthorGlyph author={feedback.author} />
      {resolved && (
        <span className="studio-comment-pin-check" aria-hidden="true">
          <Check size={9} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
