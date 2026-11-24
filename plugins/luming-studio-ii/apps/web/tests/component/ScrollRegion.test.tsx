import { act, createRef, type ReactNode, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ScrollRegion,
  type ScrollRegionHandle,
  type ScrollRegionPosition,
  type ScrollRegionProps,
} from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

function getRegion(): HTMLDivElement {
  const region = fixture.host.firstElementChild;
  if (!(region instanceof HTMLDivElement)) {
    throw new Error('Expected the mounted native scroll region.');
  }

  return region;
}

describe('ScrollRegion', () => {
  it('provides a named region and a native keyboard focus target', () => {
    fixture.render(
      <ScrollRegion axis="vertical" label="对象列表" contain>
        <p>白板对象</p>
      </ScrollRegion>,
    );

    const region = getRegion();
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('对象列表');
    expect(region.textContent).toBe('白板对象');
    expect(region.tabIndex).toBe(0);
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it('supports keyboard focus with an optional accessible name', () => {
    fixture.render(<ScrollRegion axis="both">白板对象</ScrollRegion>);

    const region = getRegion();
    expect(region.hasAttribute('role')).toBe(false);
    expect(region.hasAttribute('aria-label')).toBe(false);
    expect(region.tabIndex).toBe(0);
  });

  it('reports the native scroll position as two coordinates', () => {
    const onScroll = vi.fn();
    fixture.render(
      <ScrollRegion axis="both" onScroll={onScroll}>
        白板对象
      </ScrollRegion>,
    );
    const region = getRegion();
    region.scrollTop = 28;
    region.scrollLeft = -12;

    act(() => {
      region.dispatchEvent(new Event('scroll'));
    });

    expect(onScroll).toHaveBeenCalledExactlyOnceWith({ top: 28, left: -12 });
  });

  it('forwards each native scroll operation and exposes only those operations', () => {
    const ref = createRef<ScrollRegionHandle>();
    fixture.render(
      <ScrollRegion axis="horizontal" ref={ref}>
        白板对象
      </ScrollRegion>,
    );
    const region = getRegion();
    const scrollTo = vi.fn();
    const scrollBy = vi.fn();
    Object.defineProperties(region, {
      scrollTo: { value: scrollTo },
      scrollBy: { value: scrollBy },
    });

    expect(Object.keys(ref.current ?? {}).sort()).toEqual(['scrollBy', 'scrollTo']);
    ref.current?.scrollTo({ left: 120, behavior: 'smooth' });
    ref.current?.scrollBy({ left: -32, top: 16 });
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 120, behavior: 'smooth' });
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ left: -32, top: 16 });

    fixture.render(null);
    expect(ref.current).toBeNull();
  });

  it('exposes only its public props, position and scroll handle', () => {
    expectTypeOf<ScrollRegionPosition>().toEqualTypeOf<{ top: number; left: number }>();
    expectTypeOf<ScrollRegionHandle>().toEqualTypeOf<{
      scrollTo(options: ScrollToOptions): void;
      scrollBy(options: ScrollToOptions): void;
    }>();
    expectTypeOf<ScrollRegionProps>().toEqualTypeOf<{
      axis: 'vertical' | 'horizontal' | 'both';
      label?: string;
      contain?: boolean;
      children: ReactNode;
      onScroll?: (position: ScrollRegionPosition) => void;
      ref?: Ref<ScrollRegionHandle>;
    }>();
  });
});
