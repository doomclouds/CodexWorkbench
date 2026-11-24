import type { ReactNode } from 'react';

import type { CanvasObjectKind } from '../contracts.js';
import './CanvasObjectContent.css';

interface CanvasObjectContentProps {
  kind: CanvasObjectKind;
  label: string;
  content: ReactNode;
}

export function CanvasObjectContent({ kind, label, content }: CanvasObjectContentProps) {
  if (kind === 'native') {
    return (
      <>
        <div className="studio-ui-canvas-native-title">{label}</div>
        <div className="studio-ui-canvas-native-content" data-canvas-native="">
          {content}
        </div>
      </>
    );
  }

  return <div className="studio-ui-canvas-shape-content">{content ?? label}</div>;
}
