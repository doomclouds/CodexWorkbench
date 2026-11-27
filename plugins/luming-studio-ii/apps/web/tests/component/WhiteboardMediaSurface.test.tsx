import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AttachBoardImageCommand,
  AttachBoardVideoCommand,
  BoardEditReceipt,
} from '../../src/data/whiteboard/index.js';
import {
  WhiteboardMediaSurface,
  type PreparedBoardImage,
  type PreparedBoardVideo,
  type UploadBoardMedia,
  type WhiteboardMediaSurfaceProps,
} from '../../src/surfaces/whiteboard-media/index.js';
import { createControlFixture } from '../support/render-control.js';

type AppliedReceipt = Extract<BoardEditReceipt, { kind: 'applied' }>;

function appliedImage(
  command: AttachBoardImageCommand,
  kind: 'image' | 'video' = 'image',
): AppliedReceipt {
  return {
    boardId: command.boardId,
    commandId: command.commandId,
    kind: 'applied',
    revision: 1n,
    objects: [
      {
        id: command.objectId,
        kind,
        label: command.displayName,
        geometry: command.geometry,
        geometryVersion: 1n,
        payloadVersion: 1n,
        locked: false,
      },
    ],
    removedIds: [],
    order: [],
    payloads: [],
  };
}

function preparedImage(): PreparedBoardImage {
  return {
    displayName: '流程图.png',
    width: 1_200,
    height: 600,
    content: new Uint8Array([1, 2, 3]),
    previewUrl: 'blob:preview',
    dispose: vi.fn(),
  };
}

function required<T extends Element>(element: T | null | undefined): T {
  if (!element) {
    throw new Error('Expected board media control.');
  }

  return element;
}

function deferred<T>() {
  let finish: (value: T) => void = () => {
    throw new Error('Expected promise resolver.');
  };
  const promise = new Promise<T>((resolve) => {
    finish = resolve;
  });

  return { promise, finish };
}

describe('WhiteboardMediaSurface', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  function setup(overrides: Partial<WhiteboardMediaSurfaceProps> = {}) {
    const image = preparedImage();
    const onApplied = vi.fn();
    const onExitPlacement = vi.fn();
    const onChooserOpened = vi.fn();
    const attachImage = vi.fn((command: AttachBoardImageCommand) =>
      Promise.resolve(appliedImage(command)),
    );
    const getReceipt = vi.fn().mockResolvedValue(undefined);
    let commands = 0;
    const props: WhiteboardMediaSurfaceProps = {
      boardId: 'board-1',
      canEdit: true,
      viewport: { x: 50, y: 75, zoom: 2 },
      createCommandId: () => `media-${++commands}`,
      service: { attachImage, getReceipt },
      prepareImage: () => Promise.resolve(image),
      onApplied,
      onExitPlacement,
      renderTools: (action) => action(onChooserOpened),
      ...overrides,
    };

    function render(next: Partial<WhiteboardMediaSurfaceProps> = {}) {
      fixture.render(<WhiteboardMediaSurface {...props} {...next} />);
    }

    render();

    return { image, onApplied, onExitPlacement, onChooserOpened, attachImage, getReceipt, render };
  }

  function button(label: string) {
    return required(
      [...fixture.host.querySelectorAll('button')].find(
        (node) => node.getAttribute('aria-label') === label || node.textContent?.trim() === label,
      ),
    );
  }

  async function pickImage(file = new File(['fake image'], '流程图.png', { type: 'image/png' })) {
    act(() => button('上传图片').click());
    const input = required(fixture.host.querySelector<HTMLInputElement>('input[type=file]'));
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function dispatchPlacement(target: HTMLButtonElement) {
    return target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 400, clientY: 200 }),
    );
  }

  it('offers GIF and SVG and places an SVG without displaying its source', async () => {
    const file = new File(['<svg width="32" height="18"/>'], '流程图.svg', {
      type: 'image/svg+xml',
    });
    const prepared = {
      ...preparedImage(),
      displayName: file.name,
      content: new Uint8Array(await file.arrayBuffer()),
      previewUrl: undefined,
    };
    const prepareImage = vi.fn().mockResolvedValue(prepared);
    const board = setup({ prepareImage });
    const picker = required(fixture.host.querySelector<HTMLInputElement>('input[type=file]'));
    expect(picker.accept.split(',')).toEqual(
      expect.arrayContaining(['image/gif', 'image/svg+xml']),
    );

    await pickImage(file);
    expect(prepareImage).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(fixture.host.querySelector('.whiteboard-media__preview')).toBeNull();

    await act(async () => {
      dispatchPlacement(button('将图片放到白板'));
    });

    expect(board.attachImage).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: file.name, content: prepared.content }),
      expect.any(AbortSignal),
    );
  });

  it('shows a proportional preview and confirms placement once at the selected world point', async () => {
    const test = setup();
    await pickImage();
    const placement = button('将图片放到白板');

    expect(test.onChooserOpened).toHaveBeenCalledTimes(1);
    expect(test.attachImage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(placement);

    await act(async () => {
      dispatchPlacement(placement);
      dispatchPlacement(placement);
    });

    expect(test.attachImage).toHaveBeenCalledTimes(1);
    expect(test.attachImage.mock.calls[0]?.[0]).toEqual({
      boardId: 'board-1',
      commandId: 'media-1',
      objectId: 'media-2',
      displayName: '流程图.png',
      geometry: { x: -65, y: -57.5, width: 480, height: 240, rotation: 0 },
      content: test.image.content,
    });
    expect(test.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ objects: [expect.objectContaining({ id: 'media-2' })] }),
    );
    expect(test.image.dispose).toHaveBeenCalledTimes(1);
  });

  it('cancels placement with Escape and releases the object URL before writing', async () => {
    const test = setup();
    await pickImage();
    const placement = button('将图片放到白板');

    act(() => {
      placement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(placement.isConnected).toBe(false);
    expect(test.attachImage).not.toHaveBeenCalled();
    expect(test.image.dispose).toHaveBeenCalledTimes(1);
    expect(test.onExitPlacement).toHaveBeenCalledTimes(1);
  });

  it('uploads mixed media from one selection at the supplied board point without a placement click', async () => {
    const commands: AttachBoardImageCommand[] = [];
    const video: PreparedBoardVideo = {
      ...preparedImage(),
      displayName: '演示.webm',
      width: 480,
      height: 270,
      mediaType: 'video/webm',
      previewUrl: 'blob:video-preview',
    };
    const attachVideo = vi.fn(async (command: AttachBoardVideoCommand) => {
      commands.push(command);
      return appliedImage(command, 'video');
    });
    const attachImage = vi.fn(async (command: AttachBoardImageCommand) => {
      commands.push(command);
      return appliedImage(command);
    });
    let upload: UploadBoardMedia | undefined;
    const board = setup({
      prepareVideo: async () => video,
      onUploadReady: (next) => {
        upload = next;
      },
      service: { attachImage, attachVideo, getReceipt: async () => undefined },
    });
    expect(button('上传图片或视频').disabled).toBe(false);
    expect(
      required(fixture.host.querySelector<HTMLInputElement>('input[type=file]')).multiple,
    ).toBe(true);

    const files = [
      new File(['video'], '演示.webm', { type: 'video/webm' }),
      new File(['image'], '流程图.png', { type: 'image/png' }),
    ];
    await act(async () => upload?.(files, { x: 400, y: 200 }));

    expect(commands).toEqual([
      expect.objectContaining({
        mediaType: 'video/webm',
        geometry: { x: -65, y: -72.5, width: 480, height: 270, rotation: 0 },
      }),
      expect.objectContaining({
        displayName: '流程图.png',
        geometry: { x: -41, y: -33.5, width: 480, height: 240, rotation: 0 },
      }),
    ]);
    expect(board.onApplied).toHaveBeenCalledTimes(2);
    expect(video.dispose).toHaveBeenCalledTimes(1);
    expect(fixture.host.querySelector('[aria-label="将视频放到白板"]')).toBeNull();
  });

  it('looks up an uncertain receipt and retries the exact command if still unrecorded', async () => {
    const test = setup();
    test.attachImage.mockRejectedValueOnce(new Error('连接断开'));
    await pickImage();

    await act(async () => {
      dispatchPlacement(button('将图片放到白板'));
    });

    expect(fixture.host.textContent).toContain('连接断开');
    expect(test.image.dispose).not.toHaveBeenCalled();

    await act(async () => button('核对保存结果').click());
    expect(test.getReceipt).toHaveBeenCalledWith('board-1', 'media-1', expect.any(AbortSignal));
    expect(test.attachImage).toHaveBeenCalledTimes(1);

    await act(async () => button('重试').click());
    expect(test.attachImage).toHaveBeenCalledTimes(2);
    expect(test.attachImage.mock.calls[1]?.[0]).toBe(test.attachImage.mock.calls[0]?.[0]);
    expect(test.onApplied).toHaveBeenCalledTimes(1);
    expect(test.image.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases a late file preview after the user opens another board', async () => {
    const prepared = deferred<PreparedBoardImage>();
    const lateImage = preparedImage();
    const choose = vi.fn(() => prepared.promise);
    const test = setup({ prepareImage: choose });
    await pickImage();
    test.render({ boardId: 'board-2' });

    await act(async () => prepared.finish(lateImage));
    expect(choose.mock.calls).toHaveLength(1);
    expect(lateImage.dispose).toHaveBeenCalledTimes(1);
    expect(test.attachImage).not.toHaveBeenCalled();

    test.render({ canEdit: false });
    expect(button('上传图片').disabled).toBe(true);
  });

  it('stops waiting without discarding the command, then confirms a later saved receipt', async () => {
    const test = setup();
    const pending = deferred<AppliedReceipt>();
    test.attachImage.mockReturnValueOnce(pending.promise);
    await pickImage();

    await act(async () => {
      dispatchPlacement(button('将图片放到白板'));
    });

    const command = test.attachImage.mock.calls[0]?.[0];
    if (!command) {
      throw new Error('Expected submitted image.');
    }

    act(() => button('停止等待').click());
    test.render({ paused: true });
    await act(async () => pending.finish(appliedImage(command)));
    expect(test.onApplied).not.toHaveBeenCalled();
    expect(test.image.dispose).not.toHaveBeenCalled();

    test.render();
    test.getReceipt.mockResolvedValueOnce(appliedImage(command));
    await act(async () => button('核对保存结果').click());
    expect(test.onApplied).toHaveBeenCalledTimes(1);
    expect(test.attachImage).toHaveBeenCalledTimes(1);
    expect(test.image.dispose).toHaveBeenCalledTimes(1);
  });

  it('pauses placement and restores the same file when the editor returns', async () => {
    const test = setup();
    await pickImage();

    test.render({ paused: true });
    expect(fixture.host.querySelector('img')).toBeNull();
    expect(test.image.dispose).not.toHaveBeenCalled();

    test.render({ canEdit: false });
    expect(button('上传图片').disabled).toBe(true);
    expect(test.image.dispose).not.toHaveBeenCalled();

    test.render();
    const placement = button('将图片放到白板');
    expect(document.activeElement).toBe(placement);
    act(() => button('取消放置').click());
    expect(test.image.dispose).toHaveBeenCalledTimes(1);
    expect(test.attachImage).not.toHaveBeenCalled();
  });

  it('keeps the original save running while the editor is paused', async () => {
    const test = setup();
    const pending = deferred<AppliedReceipt>();
    test.attachImage.mockReturnValueOnce(pending.promise);
    await pickImage();

    await act(async () => {
      dispatchPlacement(button('将图片放到白板'));
    });

    const command = test.attachImage.mock.calls[0]?.[0];
    if (!command) {
      throw new Error('Expected submitted image.');
    }

    test.render({ paused: true });
    expect(fixture.host.textContent).toBe('');
    expect(test.image.dispose).not.toHaveBeenCalled();

    await act(async () => pending.finish(appliedImage(command)));
    expect(test.onApplied).toHaveBeenCalledWith(appliedImage(command));
    expect(test.image.dispose).toHaveBeenCalledTimes(1);

    test.render();
    expect(button('上传图片').disabled).toBe(false);
    expect(test.attachImage).toHaveBeenCalledTimes(1);
  });

  it('restores an uncertain save and verifies the original command after preview', async () => {
    const test = setup();
    test.attachImage.mockRejectedValueOnce(new Error('连接断开'));
    await pickImage();

    await act(async () => {
      dispatchPlacement(button('将图片放到白板'));
    });

    const command = test.attachImage.mock.calls[0]?.[0];
    if (!command) {
      throw new Error('Expected submitted image.');
    }

    test.render({ paused: true });
    expect(fixture.host.textContent).toBe('');
    expect(test.image.dispose).not.toHaveBeenCalled();

    test.render();
    test.getReceipt.mockResolvedValueOnce(appliedImage(command));
    await act(async () => button('核对保存结果').click());

    expect(test.getReceipt).toHaveBeenCalledWith(
      'board-1',
      command.commandId,
      expect.any(AbortSignal),
    );
    expect(test.onApplied).toHaveBeenCalledWith(appliedImage(command));
    expect(test.image.dispose).toHaveBeenCalledTimes(1);
    expect(test.attachImage).toHaveBeenCalledTimes(1);
  });

  it('aborts a submitted request and ignores its receipt after the user opens another board', async () => {
    const test = setup();
    const pending = deferred<AppliedReceipt>();
    test.attachImage.mockReturnValueOnce(pending.promise);
    await pickImage();

    await act(async () => {
      dispatchPlacement(button('将图片放到白板'));
    });

    const command = test.attachImage.mock.calls[0]?.[0];
    if (!command) {
      throw new Error('Expected submitted image.');
    }

    test.render({ paused: true });
    expect(test.image.dispose).not.toHaveBeenCalled();
    test.render({ boardId: 'board-2', paused: true });
    await act(async () => pending.finish(appliedImage(command)));

    expect(test.image.dispose).toHaveBeenCalledTimes(1);
    expect(test.onApplied).not.toHaveBeenCalled();
  });
});
