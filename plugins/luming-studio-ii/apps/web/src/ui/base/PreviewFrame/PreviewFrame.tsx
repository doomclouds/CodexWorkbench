import type { ReactNode } from 'react';

import './PreviewFrame.css';

export type PreviewFrameState = 'loading' | 'ready' | 'error';

export interface PreviewFrameProps {
  aspectRatio: number;
  state: PreviewFrameState;
  content?: ReactNode;
  alt: string;
  onLoad?: () => void;
  onError?: () => void;
}

export function PreviewFrame({
  aspectRatio,
  state,
  content,
  alt,
  onLoad,
  onError,
}: PreviewFrameProps) {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;

  return (
    <figure
      className="studio-ui-preview-frame"
      data-state={state}
      aria-label={alt}
      aria-busy={state === 'loading' || undefined}
      style={{ aspectRatio: ratio + ' / 1' }}
      onLoadCapture={() => onLoad?.()}
      onErrorCapture={() => onError?.()}
    >
      <div className="studio-ui-preview-frame__body">{content}</div>
    </figure>
  );
}
