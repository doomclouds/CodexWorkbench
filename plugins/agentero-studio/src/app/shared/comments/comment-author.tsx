import type { CSSProperties } from 'react';
import { Bot, User } from 'lucide-react';
import type { Actor } from '../../../contracts/studio.js';
import { contrastRatio } from '../../../core/theme.js';
import { participantColor, participantIdentity } from '../presence-members.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const firstGrapheme = (value: string) => graphemes.segment(value).containing(0)?.segment ?? '';

export function commentAuthorKey(author: Actor): string {
  return `${author.kind}:${participantIdentity(author)}`;
}

export function commentAuthorName(author: Actor): string {
  return author.name?.trim() || (author.kind === 'agent' ? 'Codex' : '协作者');
}

export function commentAuthorStyle(author: Actor): CSSProperties {
  const backgroundColor = participantColor(author);
  const color =
    contrastRatio('#000', backgroundColor) >= contrastRatio('#fff', backgroundColor)
      ? '#000'
      : '#fff';

  return { backgroundColor, color };
}

function initials(name: string): string {
  const words = name.split(/\s+/u);
  const first = firstGrapheme(words[0]!);
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(first)) {
    return first;
  }

  return words
    .slice(0, 2)
    .map((word) => firstGrapheme(firstGrapheme(word).toUpperCase()))
    .join('');
}

export function CommentAuthorGlyph({ author }: { author: Actor }) {
  if (author.kind === 'agent') {
    return <Bot size={15} aria-hidden="true" />;
  }

  const name = author.name?.trim();
  if (!name || /^\p{N}+(?:\s+\p{N}+)*$/u.test(name)) {
    return <User size={15} aria-hidden="true" />;
  }

  return <span aria-hidden="true">{initials(name)}</span>;
}

export function CommentAuthorAvatar({
  author,
  className = '',
}: {
  author: Actor;
  className?: string;
}) {
  return (
    <span
      className={`studio-comment-avatar${className ? ` ${className}` : ''}`}
      title={commentAuthorName(author)}
      aria-hidden="true"
      style={commentAuthorStyle(author)}
    >
      <CommentAuthorGlyph author={author} />
    </span>
  );
}
