import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewFrame } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findFrame(host: HTMLElement): HTMLElement {
  const frame = host.querySelector('figure');
  if (!frame) {
    throw new Error('Preview figure is missing.');
  }

  return frame;
}

describe('PreviewFrame', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('keeps caller content mounted while loading and leaves state controlled when it loads', () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    const content = <img alt="白板缩略图" />;
    fixture.render(
      <PreviewFrame
        aspectRatio={1.5}
        state="loading"
        content={content}
        alt="白板预览"
        onLoad={onLoad}
        onError={onError}
      />,
    );

    const frame = findFrame(fixture.host);
    const image = frame.querySelector('img');
    expect(image).not.toBeNull();
    expect(frame.getAttribute('aria-label')).toBe('白板预览');
    expect(frame.getAttribute('aria-busy')).toBe('true');
    expect(frame.dataset.state).toBe('loading');
    expect(frame.style.aspectRatio).toBe('1.5 / 1');

    act(() => {
      image?.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledExactlyOnceWith();
    expect(onError).not.toHaveBeenCalled();
    expect(frame.dataset.state).toBe('loading');

    fixture.render(
      <PreviewFrame
        aspectRatio={2}
        state="ready"
        content={content}
        alt="白板预览"
        onLoad={onLoad}
        onError={onError}
      />,
    );
    expect(frame.querySelector('img')).toBe(image);
    expect(frame.dataset.state).toBe('ready');
    expect(frame.hasAttribute('aria-busy')).toBe(false);
    expect(frame.style.aspectRatio).toBe('2 / 1');
  });

  it('forwards a native resource error and renders the caller-provided failure content', () => {
    const onError = vi.fn();
    fixture.render(
      <PreviewFrame
        aspectRatio={4 / 3}
        state="loading"
        content={<img alt="归档缩略图" />}
        alt="归档预览"
        onError={onError}
      />,
    );

    const frame = findFrame(fixture.host);
    const image = frame.querySelector('img');
    expect(image).not.toBeNull();

    act(() => {
      image?.dispatchEvent(new Event('error'));
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith();
    expect(frame.dataset.state).toBe('loading');

    fixture.render(
      <PreviewFrame
        aspectRatio={4 / 3}
        state="error"
        content={<p>预览暂不可用</p>}
        alt="归档预览"
        onError={onError}
      />,
    );
    expect(frame.dataset.state).toBe('error');
    expect(frame.textContent).toBe('预览暂不可用');
    expect(frame.querySelector('img')).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps an empty error frame named and uses a valid ratio fallback', () => {
    fixture.render(<PreviewFrame aspectRatio={Number.NaN} state="error" alt="文件预览" />);

    const frame = findFrame(fixture.host);
    expect(frame.dataset.state).toBe('error');
    expect(frame.getAttribute('aria-label')).toBe('文件预览');
    expect(frame.hasAttribute('aria-busy')).toBe(false);
    expect(frame.textContent).toBe('');
    expect(frame.style.aspectRatio).toBe('1 / 1');
  });
});
