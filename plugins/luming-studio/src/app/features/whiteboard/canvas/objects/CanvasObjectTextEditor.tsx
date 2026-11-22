import type { ComponentProps } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import InlineTextEditor from '../controls/InlineTextEditor.js';

interface CanvasObjectTextEditorProps extends Omit<
  ComponentProps<typeof InlineTextEditor>,
  'className' | 'style' | 'ariaLabel' | 'singleLine'
> {
  element: BoardElement;
}

export function CanvasObjectTextEditor({ element, ...editor }: CanvasObjectTextEditorProps) {
  return (
    <InlineTextEditor
      {...editor}
      key={element.id}
      className="studio-inline-editor"
      style={{ fontWeight: 400, fontStyle: 'normal' }}
      singleLine={['container', 'arrow'].includes(element.type)}
      ariaLabel={element.type === 'arrow' ? '连接线文字' : '编辑文字'}
    />
  );
}
