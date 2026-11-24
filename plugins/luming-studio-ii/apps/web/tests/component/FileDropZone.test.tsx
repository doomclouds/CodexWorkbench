import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropZone, FilePickerTrigger } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

interface Transfer {
  types: string[];
  files: File[];
  dropEffect: string;
}

function findZone(host: HTMLElement): HTMLElement {
  const zone = host.querySelector<HTMLElement>('[role="group"]');
  if (!zone) {
    throw new Error('Expected a named drop area.');
  }

  return zone;
}

function drag(target: EventTarget, type: string, transfer: Transfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);

  return event;
}

function fileTransfer(files: File[] = []): Transfer {
  return { types: ['Files'], files, dropEffect: 'none' };
}

describe('FileDropZone', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('keeps feedback while moving across children and clears it on exit', () => {
    fixture.render(
      <FileDropZone label="拖放文件" onFilesDropped={vi.fn()}>
        <span>第一项</span>
        <span>第二项</span>
      </FileDropZone>,
    );
    const zone = findZone(fixture.host);
    const [first, second] = zone.querySelectorAll('span');
    if (!first || !second) {
      throw new Error('Expected the drop targets.');
    }

    const transfer = fileTransfer();

    act(() => {
      drag(zone, 'dragenter', transfer);
    });
    expect(zone.getAttribute('data-dragging')).toBe('true');

    act(() => {
      drag(first, 'dragenter', transfer);
      drag(zone, 'dragleave', transfer);
      drag(second, 'dragenter', transfer);
      drag(first, 'dragleave', transfer);
    });

    expect(zone.getAttribute('data-dragging')).toBe('true');

    act(() => {
      drag(second, 'dragleave', transfer);
    });
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('accepts files in order and preserves a composed native picker trigger', () => {
    const onFilesDropped = vi.fn<(files: File[]) => void>();
    const onRequestPick = vi.fn();
    fixture.render(
      <FileDropZone label="导入文件" onFilesDropped={onFilesDropped}>
        <FilePickerTrigger label="选择文件" onRequestPick={onRequestPick} />
      </FileDropZone>,
    );

    const zone = findZone(fixture.host);
    const picker = zone.querySelector('button');
    if (!picker) {
      throw new Error('Expected a native picker button.');
    }

    expect(zone.getAttribute('aria-label')).toBe('导入文件');
    expect(picker.type).toBe('button');

    act(() => {
      picker.focus();
      picker.click();
    });

    expect(onRequestPick).toHaveBeenCalledExactlyOnceWith({ multiple: false });

    const first = new File(['a'], 'first.txt');
    const second = new File(['b'], 'second.txt');
    const transfer = fileTransfer();
    act(() => {
      drag(zone, 'dragenter', transfer);
      expect(drag(zone, 'dragover', transfer).defaultPrevented).toBe(true);
    });

    expect(transfer.dropEffect).toBe('copy');
    expect(onFilesDropped).not.toHaveBeenCalled();

    act(() => {
      expect(drag(zone, 'drop', fileTransfer([first, second])).defaultPrevented).toBe(true);
    });

    expect(onFilesDropped).toHaveBeenCalledTimes(1);
    expect(onFilesDropped.mock.calls[0]?.[0][0]).toBe(first);
    expect(onFilesDropped.mock.calls[0]?.[0][1]).toBe(second);
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('restores outer feedback when a file moves back from an inner drop area', () => {
    const onOuterDrop = vi.fn<(files: File[]) => void>();
    const onInnerDrop = vi.fn<(files: File[]) => void>();
    fixture.render(
      <FileDropZone label="外层" onFilesDropped={onOuterDrop}>
        <FileDropZone label="内层" onFilesDropped={onInnerDrop} />
      </FileDropZone>,
    );

    const outer = findZone(fixture.host);
    const inner = findZone(outer);
    const transfer = fileTransfer();
    act(() => {
      drag(outer, 'dragenter', transfer);
    });
    expect(outer.hasAttribute('data-dragging')).toBe(true);

    act(() => {
      drag(inner, 'dragenter', transfer);
      drag(outer, 'dragleave', transfer);
    });
    expect(inner.hasAttribute('data-dragging')).toBe(true);
    expect(outer.hasAttribute('data-dragging')).toBe(false);

    act(() => {
      drag(outer, 'dragenter', transfer);
      drag(inner, 'dragleave', transfer);
    });
    expect(inner.hasAttribute('data-dragging')).toBe(false);
    expect(outer.hasAttribute('data-dragging')).toBe(true);

    const file = new File(['a'], 'outer.txt');
    act(() => {
      drag(outer, 'drop', fileTransfer([file]));
    });
    expect(onOuterDrop).toHaveBeenCalledExactlyOnceWith([file]);
    expect(onInnerDrop).not.toHaveBeenCalled();
    expect(outer.hasAttribute('data-dragging')).toBe(false);
  });

  it('allows only the inner drop area to handle a file dropped inside it', () => {
    const onOuterDrop = vi.fn<(files: File[]) => void>();
    const onInnerDrop = vi.fn<(files: File[]) => void>();
    fixture.render(
      <FileDropZone label="外层" onFilesDropped={onOuterDrop}>
        <FileDropZone label="内层" onFilesDropped={onInnerDrop} />
      </FileDropZone>,
    );

    const outer = findZone(fixture.host);
    const inner = findZone(outer);
    const file = new File(['a'], 'inner.txt');
    act(() => {
      drag(inner, 'dragenter', fileTransfer());
      drag(inner, 'dragover', fileTransfer());
      drag(inner, 'drop', fileTransfer([file]));
    });

    expect(onInnerDrop).toHaveBeenCalledExactlyOnceWith([file]);
    expect(onOuterDrop).not.toHaveBeenCalled();
    expect(inner.hasAttribute('data-dragging')).toBe(false);
    expect(outer.hasAttribute('data-dragging')).toBe(false);
  });

  it('keeps a disabled inner drop area inactive without passing the file to its parent', () => {
    const onOuterDrop = vi.fn();
    const onInnerDrop = vi.fn();
    fixture.render(
      <FileDropZone label="外层" onFilesDropped={onOuterDrop}>
        <FileDropZone label="内层" disabled onFilesDropped={onInnerDrop} />
      </FileDropZone>,
    );

    const outer = findZone(fixture.host);
    const inner = findZone(outer);
    const transfer = fileTransfer([new File(['a'], 'disabled-inner.txt')]);
    act(() => {
      drag(inner, 'dragenter', transfer);
      drag(inner, 'dragover', transfer);
    });

    expect(transfer.dropEffect).toBe('none');
    expect(inner.hasAttribute('data-dragging')).toBe(false);
    expect(outer.hasAttribute('data-dragging')).toBe(false);

    act(() => {
      expect(drag(inner, 'drop', transfer).defaultPrevented).toBe(true);
    });
    expect(onOuterDrop).not.toHaveBeenCalled();
    expect(onInnerDrop).not.toHaveBeenCalled();
  });

  it('leaves text drags alone and blocks file delivery while disabled', () => {
    const onFilesDropped = vi.fn();
    fixture.render(<FileDropZone label="拖放文件" onFilesDropped={onFilesDropped} />);

    const zone = findZone(fixture.host);
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'move' };
    act(() => {
      expect(drag(zone, 'dragenter', textTransfer).defaultPrevented).toBe(false);
      expect(drag(zone, 'dragover', textTransfer).defaultPrevented).toBe(false);
      expect(drag(zone, 'drop', textTransfer).defaultPrevented).toBe(false);
    });

    expect(zone.hasAttribute('data-dragging')).toBe(false);

    act(() => {
      drag(zone, 'dragenter', fileTransfer());
    });
    expect(zone.getAttribute('data-dragging')).toBe('true');

    fixture.render(<FileDropZone label="拖放文件" disabled onFilesDropped={onFilesDropped} />);
    expect(zone.hasAttribute('data-dragging')).toBe(false);

    const file = new File(['a'], 'disabled.txt');
    const transfer = fileTransfer([file]);
    act(() => {
      drag(zone, 'dragenter', transfer);
      drag(zone, 'dragover', transfer);
      drag(zone, 'drop', transfer);
    });

    expect(transfer.dropEffect).toBe('none');
    expect(onFilesDropped).not.toHaveBeenCalled();

    fixture.render(<FileDropZone label="拖放文件" onFilesDropped={onFilesDropped} />);
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('cleans up feedback when a drag ends outside the drop area', () => {
    const onFilesDropped = vi.fn();
    fixture.render(<FileDropZone label="拖放文件" onFilesDropped={onFilesDropped} />);

    const zone = findZone(fixture.host);
    const transfer = fileTransfer();
    act(() => {
      drag(zone, 'dragenter', transfer);
    });
    expect(zone.getAttribute('data-dragging')).toBe('true');

    act(() => {
      drag(document.body, 'dragend', transfer);
    });

    expect(zone.hasAttribute('data-dragging')).toBe(false);
    expect(onFilesDropped).not.toHaveBeenCalled();
  });
});
