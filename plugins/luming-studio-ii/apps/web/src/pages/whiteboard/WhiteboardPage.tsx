import type { WhiteboardService } from '../../data/whiteboard/index.js';
import { WhiteboardEditorSurface } from '../../surfaces/whiteboard-editor/index.js';
import { StatePanel } from '../../ui/base/index.js';

export interface WhiteboardPageProps {
  readonly boardId?: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
}

export function WhiteboardPage({ boardId, service, createCommandId }: WhiteboardPageProps) {
  if (!boardId) {
    return (
      <StatePanel kind="empty" title="请选择白板" detail="在地址中用 ?board= 指定要打开的白板。" />
    );
  }

  return (
    <WhiteboardEditorSurface
      key={boardId}
      boardId={boardId}
      service={service}
      createCommandId={createCommandId}
    />
  );
}
