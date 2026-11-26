import type { ComponentProps } from 'react';
import './app.css';
import { studioPages } from './routes.js';

const { whiteboard: WhiteboardPage } = studioPages;

type WhiteboardPageProps = ComponentProps<typeof WhiteboardPage>;

export function WhiteboardApp(props: WhiteboardPageProps) {
  return (
    <div className="studio-whiteboard-app">
      <WhiteboardPage {...props} />
    </div>
  );
}
