import { Bot } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { WhiteboardHistorySurfaceProps } from './contracts.js';

export const HistoryAuthorColor =
  createContext<WhiteboardHistorySurfaceProps['colorForAuthor']>(undefined);

export function HistoryAuthorAvatar({
  actorId,
  name,
  agent,
  compact = false,
}: {
  readonly actorId: string | undefined;
  readonly name: string;
  readonly agent: boolean;
  readonly compact?: boolean;
}) {
  const colorFor = useContext(HistoryAuthorColor);
  const backgroundColor = actorId ? colorFor?.(actorId) : undefined;
  const style = backgroundColor
    ? { backgroundColor, color: backgroundColor === '#fbb315' ? '#201b0c' : '#fff' }
    : undefined;

  return (
    <span
      className="whiteboard-history__avatar"
      data-agent={agent || undefined}
      style={style}
      aria-hidden="true"
    >
      {agent ? <Bot size={compact ? 13 : 17} /> : (Array.from(name)[0] ?? '协')}
    </span>
  );
}
