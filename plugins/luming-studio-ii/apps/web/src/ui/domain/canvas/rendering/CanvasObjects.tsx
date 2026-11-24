import { memo } from 'react';
import type { ReactNode } from 'react';

import { CanvasObjectContent } from '../adapters/index.js';
import type { CanvasGeometry, CanvasObjectKind } from '../contracts.js';
import type { ProjectedCanvasObject } from '../scene/index.js';
import './CanvasObjects.css';

interface CanvasObjectsProps {
  objects: readonly ProjectedCanvasObject[];
  contentById?: ReadonlyMap<string, ReactNode>;
}

interface CanvasObjectViewProps extends CanvasGeometry {
  id: string;
  kind: CanvasObjectKind;
  label: string;
  content: ReactNode;
}

const CanvasObjectView = memo(
  ({ id, kind, label, content, x, y, width, height, rotation }: CanvasObjectViewProps) => (
    <div
      className={'studio-ui-canvas-object studio-ui-canvas-object--' + kind}
      data-canvas-object={id}
      style={{ left: x, top: y, width, height, transform: 'rotate(' + rotation + 'deg)' }}
    >
      <CanvasObjectContent kind={kind} label={label} content={content} />
    </div>
  ),
);

export function CanvasObjects({ objects, contentById }: CanvasObjectsProps) {
  return (
    <>
      {objects.map(({ object, geometry }) => (
        <CanvasObjectView
          key={object.id}
          id={object.id}
          kind={object.kind}
          label={object.label}
          content={contentById?.get(object.id)}
          {...geometry}
        />
      ))}
    </>
  );
}
