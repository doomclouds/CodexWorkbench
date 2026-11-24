import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Disclosure } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

describe('Disclosure', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it('requests toggles and keeps the controlled content association stable', () => {
    const onOpenChange = vi.fn();
    fixture.render(
      <Disclosure label="备注" open={false} onOpenChange={onOpenChange}>
        批注正文
      </Disclosure>,
    );

    const trigger = fixture.host.querySelector('button');
    const id = trigger?.getAttribute('aria-controls');
    const content = document.getElementById(id ?? '');
    expect(trigger?.type).toBe('button');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(content?.hidden).toBe(true);

    act(() => trigger?.click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(content?.hidden).toBe(true);

    fixture.render(
      <Disclosure label="备注" open onOpenChange={onOpenChange}>
        批注正文
      </Disclosure>,
    );

    expect(trigger?.getAttribute('aria-controls')).toBe(id);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(content?.hidden).toBe(false);
    expect(content?.textContent).toBe('批注正文');

    act(() => trigger?.click());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('allows an open disabled disclosure to keep displaying its contents', () => {
    const onOpenChange = vi.fn();
    fixture.render(
      <Disclosure label="备注" open disabled onOpenChange={onOpenChange}>
        批注正文
      </Disclosure>,
    );

    const trigger = fixture.host.querySelector('button');
    const content = document.getElementById(trigger?.getAttribute('aria-controls') ?? '');
    expect(trigger?.disabled).toBe(true);
    expect(content?.hidden).toBe(false);

    act(() => trigger?.click());
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
