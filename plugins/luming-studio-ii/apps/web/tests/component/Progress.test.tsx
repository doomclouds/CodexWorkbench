import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Progress } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findProgress(host: HTMLElement): HTMLProgressElement {
  const progress = host.querySelector('progress');
  if (!progress) {
    throw new Error('Progress element is missing.');
  }

  return progress;
}

describe('Progress', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('uses native progress with an accessible label and caller-provided values', () => {
    fixture.render(<Progress label="上传进度" value={25} max={100} />);

    const progress = findProgress(fixture.host);
    expect(progress.getAttribute('aria-label')).toBe('上传进度');
    expect(progress.value).toBe(25);
    expect(progress.max).toBe(100);
    expect(progress.position).toBe(0.25);

    fixture.render(<Progress label="上传进度" value={4} max={8} />);
    expect(progress.value).toBe(4);
    expect(progress.max).toBe(8);
    expect(progress.position).toBe(0.5);
  });

  it('removes the value attribute for unknown progress, distinct from zero', () => {
    fixture.render(<Progress label="整理附件" value={0} max={4} />);

    const progress = findProgress(fixture.host);
    expect(progress.getAttribute('value')).toBe('0');
    expect(progress.position).toBe(0);

    fixture.render(<Progress label="整理附件" max={4} />);
    expect(progress.hasAttribute('value')).toBe(false);
    expect(progress.position).toBe(-1);
  });

  it('keeps the native attributes within the supported numeric domain', () => {
    fixture.render(<Progress label="生成预览" value={Number.POSITIVE_INFINITY} max={Number.NaN} />);

    const progress = findProgress(fixture.host);
    expect(progress.hasAttribute('max')).toBe(false);
    expect(progress.max).toBe(1);
    expect(progress.hasAttribute('value')).toBe(false);

    fixture.render(<Progress label="生成预览" value={-2} max={-1} />);
    expect(progress.hasAttribute('max')).toBe(false);
    expect(progress.getAttribute('value')).toBe('0');

    fixture.render(<Progress label="生成预览" value={12} max={8} />);
    expect(progress.getAttribute('value')).toBe('8');
    expect(progress.position).toBe(1);
  });
});
