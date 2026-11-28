import { Bot } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { WhiteboardHistorySurfaceProps } from './contracts.js';

export const HistoryAuthorColor =
  createContext<WhiteboardHistorySurfaceProps['colorForAuthor']>(undefined);

export function HistoryAgentAvatar({
  actorId,
  compact = false,
}: {
  readonly actorId: string | undefined;
  readonly compact?: boolean;
}) {
  const colorFor = useContext(HistoryAuthorColor);
  const backgroundColor = actorId ? colorFor?.(actorId) : undefined;
  const style = backgroundColor
    ? { backgroundColor, color: backgroundColor === '#fbb315' ? '#201b0c' : '#fff' }
    : undefined;

  return (
    <span className="whiteboard-history__avatar" data-agent="true" style={style} aria-hidden="true">
      <Bot size={compact ? 13 : 17} />
    </span>
  );
}
