import type { ReactNode } from 'react';

import './Glyph.css';

export interface GlyphProps {
  size?: number;
  color?: string;
  children: ReactNode;
}

export function Glyph({ size, color, children }: GlyphProps) {
  return (
    <span
      className="studio-ui-glyph"
      style={{ inlineSize: size, blockSize: size, color }}
      aria-hidden="true"
      inert
    >
      {children}
    </span>
  );
}
