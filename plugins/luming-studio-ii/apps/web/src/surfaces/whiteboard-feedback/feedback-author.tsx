import { Bot, User } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { FeedbackMessage } from '../../data/feedback/index.js';

type FeedbackAuthor = Pick<FeedbackMessage, 'authorId' | 'authorName' | 'authoredByViewer'>;

type AuthorColor = (actorId: string) => string;

const defaultColor = '#257de0';
export const FeedbackAuthorColor = createContext<AuthorColor | undefined>(undefined);
const contrastPivot = 0.179;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function isAgentAuthor({ authorId }: FeedbackAuthor) {
  return authorId.startsWith('agent-');
}

export function feedbackAuthorName(author: FeedbackAuthor) {
  return author.authoredByViewer
    ? '我'
    : author.authorName?.trim() || (isAgentAuthor(author) ? 'Agent' : '协作者');
}

function colorChannel(hex: string) {
  const channel = parseInt(hex, 16) / 255;

  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function feedbackAuthorColors(colorFor: AuthorColor | undefined, actorId?: string) {
  const backgroundColor = (actorId && colorFor?.(actorId)) || defaultColor;
  const red = colorChannel(backgroundColor.slice(1, 3));
  const green = colorChannel(backgroundColor.slice(3, 5));
  const blue = colorChannel(backgroundColor.slice(5, 7));
  const light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return { color: light >= contrastPivot ? '#000' : '#fff', backgroundColor };
}

export function FeedbackAuthorGlyph({ author }: { readonly author?: FeedbackAuthor }) {
  if (author && isAgentAuthor(author)) {
    return <Bot size={15} aria-hidden="true" />;
  }
  if (!author || author.authoredByViewer) {
    return <span aria-hidden="true">我</span>;
  }
  if (/^\p{N}+(?:\s+\p{N}+)*$/u.test(author.authorId)) {
    return <User size={15} aria-hidden="true" />;
  }

  const name = feedbackAuthorName(author);
  const words = name.split(/\s+/u);
  const first = graphemes.segment(words[0] ?? '').containing(0)?.segment ?? '';
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(first)) {
    return <span aria-hidden="true">{first}</span>;
  }

  const initials = words
    .slice(0, 2)
    .map((word) => graphemes.segment(word.toUpperCase()).containing(0)?.segment ?? '')
    .join('');

  return <span aria-hidden="true">{initials}</span>;
}

export function FeedbackAvatar({ author }: { readonly author: FeedbackAuthor }) {
  const colorFor = useContext(FeedbackAuthorColor);
  return (
    <span
      className="whiteboard-feedback__avatar"
      data-agent={isAgentAuthor(author) || undefined}
      style={feedbackAuthorColors(colorFor, author.authorId)}
      aria-hidden="true"
    >
      <FeedbackAuthorGlyph author={author} />
    </span>
  );
}
