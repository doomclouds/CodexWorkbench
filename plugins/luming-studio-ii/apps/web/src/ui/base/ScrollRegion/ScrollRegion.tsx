import { useImperativeHandle, useRef, type ReactNode, type Ref, type UIEvent } from 'react';
import './ScrollRegion.css';

export interface ScrollRegionPosition {
  top: number;
  left: number;
}

export interface ScrollRegionHandle {
  scrollTo(options: ScrollToOptions): void;
  scrollBy(options: ScrollToOptions): void;
}

export interface ScrollRegionProps {
  axis: 'vertical' | 'horizontal' | 'both';
  label?: string;
  contain?: boolean;
  children: ReactNode;
  onScroll?: (position: ScrollRegionPosition) => void;
  ref?: Ref<ScrollRegionHandle>;
}

export function ScrollRegion({ axis, label, contain, children, onScroll, ref }: ScrollRegionProps) {
  const region = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo(options) {
        region.current?.scrollTo(options);
      },
      scrollBy(options) {
        region.current?.scrollBy(options);
      },
    }),
    [],
  );

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    onScroll?.({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
  }

  return (
    <div
      ref={region}
      className="studio-ui-scroll-region"
      data-axis={axis}
      data-contain={contain || undefined}
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll ? handleScroll : undefined}
    >
      {children}
    </div>
  );
}
