import { Children } from 'react';
import type { ReactNode } from 'react';

import './AvatarGlyph.css';

export interface AvatarGlyphProps {
  size?: number;
  color?: string;
  label?: string;
  fallback: string;
  children?: ReactNode;
  badge?: ReactNode;
}

export function AvatarGlyph({ size, color, label, fallback, children, badge }: AvatarGlyphProps) {
  const accessibleLabel = label?.trim();
  const faceContent = Children.toArray(children);
  const badgeContent = Children.toArray(badge);

  return (
    <span
      className="studio-ui-avatar-glyph"
      style={{ inlineSize: size, blockSize: size, backgroundColor: color }}
      role={accessibleLabel ? 'img' : undefined}
      aria-label={accessibleLabel || undefined}
      aria-hidden={accessibleLabel ? undefined : true}
    >
      <span className="studio-ui-avatar-glyph__face" aria-hidden="true" inert>
        {faceContent.length > 0 ? faceContent : fallback}
      </span>
      {badgeContent.length > 0 && (
        <span className="studio-ui-avatar-glyph__badge" aria-hidden="true" inert>
          {badgeContent}
        </span>
      )}
    </span>
  );
}
