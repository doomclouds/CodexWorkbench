import { useId, type ReactNode } from 'react';
import './ItemFrame.css';

export interface ItemFrameProps {
  kind: 'row' | 'card';
  title: string;
  metadata?: ReactNode;
  primaryAction: ReactNode;
  secondaryActions?: ReactNode;
  children?: ReactNode;
}

export function ItemFrame({
  kind,
  title,
  metadata,
  primaryAction,
  secondaryActions,
  children,
}: ItemFrameProps) {
  const titleId = useId();

  return (
    <article className="studio-ui-item-frame" data-kind={kind} aria-labelledby={titleId}>
      <div className="studio-ui-item-frame__content">
        <h2 id={titleId} className="studio-ui-item-frame__title">
          {title}
        </h2>
        {metadata !== undefined && metadata !== null && (
          <div className="studio-ui-item-frame__metadata">{metadata}</div>
        )}
        {children !== undefined && children !== null && <div>{children}</div>}
      </div>
      <div className="studio-ui-item-frame__actions">
        <div className="studio-ui-item-frame__primary">{primaryAction}</div>
        {secondaryActions !== undefined && secondaryActions !== null && (
          <div className="studio-ui-item-frame__secondary">{secondaryActions}</div>
        )}
      </div>
    </article>
  );
}
