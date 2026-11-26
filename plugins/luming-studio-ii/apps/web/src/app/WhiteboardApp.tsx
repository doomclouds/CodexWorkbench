import { WhiteboardPage, type WhiteboardPageProps } from '../pages/whiteboard/index.js';
import './app.css';

export function WhiteboardApp({ boardId, service, createCommandId }: WhiteboardPageProps) {
  return (
    <div className="studio-whiteboard-app">
      <WhiteboardPage boardId={boardId} service={service} createCommandId={createCommandId} />
    </div>
  );
}
