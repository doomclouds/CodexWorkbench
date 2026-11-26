import type { ComponentProps } from 'react';
import './app.css';
import { studioPages } from './routes.js';

const { whiteboard: WhiteboardPage } = studioPages;

type WhiteboardPageProps = ComponentProps<typeof WhiteboardPage>;

export function WhiteboardApp({ boardId, service, createCommandId }: WhiteboardPageProps) {
  return (
    <div className="studio-whiteboard-app">
      <WhiteboardPage boardId={boardId} service={service} createCommandId={createCommandId} />
    </div>
  );
}
