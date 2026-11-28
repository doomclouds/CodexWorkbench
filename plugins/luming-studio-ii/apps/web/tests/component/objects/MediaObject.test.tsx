import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  imageExtension,
  linkExtension,
  LinkObject,
  MediaObject,
  videoExtension,
} from '../../../src/ui/domain/objects/media/index.js';
import type {
  ImageObjectProps,
  SaveImageCrop,
} from '../../../src/ui/domain/objects/media/index.js';
import { createControlFixture } from '../../support/render-control.js';

const photo = 'data:image/png;base64,AA';
const video = 'https://example.test/demo.mp4';
const imageProps: ImageObjectProps = {
  kind: 'image',
  label: '白板图片',
  src: photo,
  width: 100,
  height: 100,
  crop: { zoom: 2, x: 0.25, y: 1 },
  naturalSize: { width: 400, height: 200 },
};

let fixture: ReturnType<typeof createControlFixture>;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function closeModal(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

function element<T extends HTMLElement>(selector: string): T {
  const node = fixture.host.querySelector<T>(selector);
  if (!node) {
    throw new Error('Expected ' + selector);
  }

  return node;
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(fixture.host.querySelectorAll('button')).find(
    (control) => control.textContent === label,
  );

  if (!match) {
    throw new Error('Expected button ' + label);
  }

  return match;
}

function dispatch(node: HTMLElement, event: Event) {
  act(() => {
    node.dispatchEvent(event);
  });
}

function openCrop() {
  dispatch(element('img'), new MouseEvent('dblclick', { bubbles: true }));
  expect(element<HTMLDialogElement>('dialog').open).toBe(true);
}

function setRange(label: string, value: number) {
  const fieldLabel = Array.from(fixture.host.querySelectorAll('label')).find(
    (labelElement) => labelElement.textContent === label,
  );

  const input = fieldLabel?.control;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Expected range ' + label);
  }

  act(() => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('MediaObject', () => {
  it('preserves the legacy native cover formula and saves crop metadata while retaining the source', async () => {
    const onSaveCrop = vi.fn<SaveImageCrop>().mockResolvedValue(true);
    fixture.render(<MediaObject {...imageProps} onSaveCrop={onSaveCrop} />);
    const image = element<HTMLImageElement>('img');

    expect(image.style.left).toBe('-75%');
    expect(image.style.top).toBe('-100%');
    expect(image.style.width).toBe('400%');
    expect(image.style.height).toBe('200%');
    openCrop();
    setRange('裁剪缩放', 3);
    await act(async () => button('保存裁剪').click());

    expect(onSaveCrop).toHaveBeenCalledExactlyOnceWith({
      crop: { zoom: 3, x: 0.25, y: 1 },
      naturalSize: { width: 400, height: 200 },
    });
    expect(element('img')).toBe(image);
    expect(image.getAttribute('src')).toBe(photo);
    expect(fixture.host.querySelector('dialog')).toBeNull();
  });

  it('accepts decoded natural dimensions and waits for them before saving an uncached source', async () => {
    const onSaveCrop = vi.fn<SaveImageCrop>().mockResolvedValue();
    fixture.render(<MediaObject {...imageProps} naturalSize={undefined} onSaveCrop={onSaveCrop} />);
    openCrop();
    expect(button('保存裁剪').disabled).toBe(true);

    const preview = element<HTMLImageElement>('dialog img');
    Object.defineProperties(preview, {
      naturalWidth: { value: 720, configurable: true },
      naturalHeight: { value: 360, configurable: true },
    });
    dispatch(preview, new Event('load'));
    expect(button('保存裁剪').disabled).toBe(false);
    act(() => button('居中重置').click());
    await act(async () => button('保存裁剪').click());

    expect(onSaveCrop).toHaveBeenCalledExactlyOnceWith({
      crop: { zoom: 1, x: 0.5, y: 0.5 },
      naturalSize: { width: 720, height: 360 },
    });
  });

  it.each(['readOnly', 'locked'] as const)(
    'blocks crop when %s and closes a stale draft',
    async (permission) => {
      const onSaveCrop = vi.fn<SaveImageCrop>().mockResolvedValue(true);
      fixture.render(<MediaObject {...imageProps} onSaveCrop={onSaveCrop} />);
      openCrop();

      fixture.render(
        <MediaObject {...imageProps} {...{ [permission]: true }} onSaveCrop={onSaveCrop} />,
      );
      dispatch(element('img'), new MouseEvent('dblclick', { bubbles: true }));
      expect(fixture.host.querySelector('dialog')).toBeNull();
      expect(fixture.host.textContent).not.toContain('裁剪图片');
      expect(onSaveCrop).not.toHaveBeenCalled();

      fixture.render(<MediaObject {...imageProps} onSaveCrop={onSaveCrop} />);
      expect(fixture.host.querySelector('dialog')).toBeNull();
    },
  );

  it('keeps an edited crop after a rejected save and retries the same values', async () => {
    const onSaveCrop = vi.fn<SaveImageCrop>();
    onSaveCrop.mockRejectedValueOnce(new Error('图片版本已变化')).mockResolvedValueOnce(true);
    fixture.render(<MediaObject {...imageProps} onSaveCrop={onSaveCrop} />);
    openCrop();
    setRange('裁剪水平位置', 75);
    await act(async () => button('保存裁剪').click());

    expect(element('dialog [role="alert"]').textContent).toBe('图片版本已变化');
    expect(element<HTMLDialogElement>('dialog').open).toBe(true);
    await act(async () => button('保存裁剪').click());
    expect(onSaveCrop).toHaveBeenCalledTimes(2);
    expect(onSaveCrop.mock.calls[1]).toEqual(onSaveCrop.mock.calls[0]);
    expect(onSaveCrop.mock.calls[1]?.[0].crop.x).toBe(0.75);
    expect(fixture.host.querySelector('dialog')).toBeNull();
  });

  it('reports injected loading and errors and restores the image after authorized resolution', () => {
    fixture.render(<MediaObject {...imageProps} src={undefined} status={{ status: 'loading' }} />);
    expect(element('[role="status"]').textContent).toContain('正在加载媒体');
    expect(fixture.host.querySelector('img')).toBeNull();

    fixture.render(
      <MediaObject
        {...imageProps}
        src={undefined}
        status={{ status: 'error', message: '图片不可用' }}
      />,
    );
    expect(element('[role="alert"]').textContent).toBe('图片不可用');

    fixture.render(<MediaObject {...imageProps} status={{ status: 'ready' }} />);
    expect(fixture.host.textContent).not.toContain('图片不可用');
    const image = element('img');
    const stage = element('.luming-media-object');
    expect(image.getAttribute('src')).toBe(photo);
    expect(stage.hasAttribute('data-media-loading')).toBe(true);
    Object.defineProperties(image, {
      naturalWidth: { value: 400, configurable: true },
      naturalHeight: { value: 200, configurable: true },
    });
    dispatch(image, new Event('load'));
    expect(stage.hasAttribute('data-media-loading')).toBe(false);
  });

  it('keeps video playback controls independent of the canvas transforms', () => {
    fixture.render(<MediaObject kind="video" src={video} poster={photo} label="演示视频" />);
    const player = element<HTMLVideoElement>('video');

    expect(player.controls).toBe(true);
    expect(player.getAttribute('poster')).toBe(photo);
    expect(player.preload).toBe('metadata');
    expect(player.playsInline).toBe(true);
    expect(player.hasAttribute('data-canvas-native')).toBe(true);

    fixture.render(
      <MediaObject kind="video" src={video} poster={photo} label="演示视频" interactive={false} />,
    );
    expect(element('video')).toBe(player);
    expect(player.controls).toBe(false);
    expect(player.tabIndex).toBe(-1);
    expect(player.hasAttribute('data-canvas-native')).toBe(false);

    dispatch(player, new Event('error'));
    expect(element('[role="alert"]').textContent).toBe('媒体加载失败。');
  });

  it('allows only an HTTP(S) image link and disables it when viewing a passive preview', () => {
    fixture.render(<MediaObject {...imageProps} href="http://example.test/source" />);
    expect(element<HTMLAnchorElement>('a[aria-label="打开图片链接"]').href).toBe(
      'http://example.test/source',
    );

    fixture.render(<MediaObject {...imageProps} href="javascript:alert(1)" />);
    expect(fixture.host.querySelector('a')).toBeNull();

    fixture.render(
      <MediaObject {...imageProps} href="https://example.test/source" interactive={false} />,
    );
    expect(fixture.host.querySelector('a')).toBeNull();
  });
});

describe('LinkObject', () => {
  it('opens an HTTP(S) target with isolation and preserves its visible label', () => {
    fixture.render(<LinkObject label="架构规范" href="https://example.test/guide" />);
    expect(fixture.host.textContent).toContain('架构规范');
    const link = element<HTMLAnchorElement>('a[aria-label="打开链接"]');

    expect(link.href).toBe('https://example.test/guide');
    expect(link.target).toBe('_blank');
    expect(link.relList.contains('noopener')).toBe(true);
    expect(link.relList.contains('noreferrer')).toBe(true);
  });

  it.each(['javascript:alert(1)', 'file:///local.txt', '/relative'] as const)(
    'shows the original text without opening a non-HTTP target %s',
    (href) => {
      fixture.render(<LinkObject href={href} />);

      expect(fixture.host.textContent).toContain(href);
      expect(fixture.host.querySelector('a')).toBeNull();
    },
  );
});

describe('legacy media canvas controls', () => {
  const geometry = { x: 0, y: 0, width: 100, height: 55, rotation: 0 };

  it.each([imageExtension, videoExtension])(
    'distinguishes pending and unavailable $kind data',
    ({ kind, View }) => {
      const props = {
        id: 'media',
        object: { kind, label: '媒体', geometry },
        geometry,
        zoom: 1,
        selected: false,
        interactive: false,
        readOnly: true,
        request: vi.fn<Parameters<typeof View>[0]['request']>(),
      };
      fixture.render(<View {...props} />);
      expect(element('.luming-media-placeholder').textContent).toBe('正在加载媒体…');

      fixture.render(<View {...props} payload={{ version: 1, value: {} }} />);
      expect(element('.luming-media-placeholder').textContent).toBe('无法读取媒体');
    },
  );

  it('hands video clicks to the canvas during annotations and restores the same player', () => {
    const Video = videoExtension.View;
    const props = {
      object: { kind: 'video' as const, label: '播放器', geometry },
      payload: { version: 1, value: { src: video } },
      geometry,
      zoom: 1,
      selected: true,
      interactive: true,
      readOnly: false,
      request: vi.fn<Parameters<typeof Video>[0]['request']>(),
    };

    fixture.render(<Video {...props} />);
    const player = element<HTMLVideoElement>('video');
    expect(player.controls).toBe(true);

    fixture.render(<Video {...props} annotationActive />);
    expect(element('video')).toBe(player);
    expect(player.controls).toBe(false);
    expect(player.tabIndex).toBe(-1);
    expect(player.dataset.interactive).toBe('false');

    fixture.render(<Video {...props} />);
    expect(element('video')).toBe(player);
    expect(player.getAttribute('src')).toBe(video);
    expect(player.controls).toBe(true);
  });

  it('keeps zoomed-out link cards compact and enables media controls when expanded', () => {
    const Link = linkExtension.View;
    const Video = videoExtension.View;
    const request = vi.fn<Parameters<typeof Link>[0]['request']>();
    const common = {
      geometry,
      zoom: 0.1,
      selected: true,
      interactive: false,
      readOnly: true,
      request,
    };
    const link = {
      ...common,
      object: { kind: 'link' as const, label: '架构规范', geometry },
      payload: { version: 1, value: { href: 'https://example.test/guide' } },
    };
    const player = {
      ...common,
      object: { kind: 'video' as const, label: '播放器', geometry },
      payload: { version: 1, value: { src: video } },
    };
    fixture.render(
      <>
        <Link {...link} />
        <Video {...player} />
      </>,
    );
    expect(element('[title="架构规范"]')).toBeTruthy();
    expect(fixture.host.querySelector('strong, a')).toBeNull();
    expect(element<HTMLVideoElement>('video').controls).toBe(false);

    fixture.render(
      <>
        <Link {...link} interactive expanded />
        <Video {...player} expanded />
      </>,
    );
    expect(element('strong').textContent).toBe('架构规范');
    expect(element('a').hasAttribute('data-canvas-native')).toBe(true);
    expect(element<HTMLVideoElement>('video').controls).toBe(true);
  });

  it('edits a link using the original payload version and keeps the draft after a rejected receipt', async () => {
    const View = linkExtension.View;
    const request = vi
      .fn<Parameters<typeof View>[0]['request']>()
      .mockResolvedValueOnce({ ok: false, message: '链接版本变化' })
      .mockResolvedValueOnce({
        ok: true,
        payload: { version: 6, value: { href: 'https://example.test/new' } },
      });
    const onRetentionChange = vi.fn();
    const props = {
      object: { kind: 'link' as const, label: '架构规范', geometry },
      geometry,
      zoom: 1,
      selected: true,
      interactive: true,
      readOnly: false,
      editRequest: 1,
      request,
      onRetentionChange,
    };
    fixture.render(
      <View {...props} payload={{ version: 4, value: { href: 'https://example.test/old' } }} />,
    );
    const address = element<HTMLInputElement>('dialog input[placeholder="https://"]');
    expect(document.activeElement).toBe(address);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    act(() => {
      descriptor?.set?.call(address, 'https://example.test/new');
      address.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fixture.render(
      <View {...props} payload={{ version: 5, value: { href: 'https://example.test/remote' } }} />,
    );
    await act(async () => button('保存到白板').click());

    expect(request).toHaveBeenCalledExactlyOnceWith({
      name: 'link.commit',
      expectedVersion: 4,
      value: { title: '架构规范', href: 'https://example.test/new' },
    });
    expect(element('[role="alert"]').textContent).toBe('链接版本变化');
    expect(address.value).toBe('https://example.test/new');
    await act(async () => button('保存到白板').click());
    expect(fixture.host.querySelector('dialog')).toBeNull();
    expect(onRetentionChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe('imageExtension', () => {
  it('uses the original link icon at readable scale and leaves crop in the Canvas tools', () => {
    const View = imageExtension.View;
    const geometry = { x: 0, y: 0, width: 256, height: 144, rotation: 0 };
    const props = {
      object: { kind: 'image' as const, label: '白板图片', geometry },
      geometry,
      payload: { version: 1, value: { src: photo, href: 'https://example.test/gallery' } },
      selected: true,
      interactive: true,
      readOnly: false,
      request: vi.fn<Parameters<typeof View>[0]['request']>(),
    };
    fixture.render(<View {...props} zoom={0.49} />);
    expect(fixture.host.querySelector('a, button')).toBeNull();

    fixture.render(<View {...props} zoom={0.5} readOnly />);
    const anchor = element<HTMLAnchorElement>('[aria-label="打开图片链接"]');
    expect(anchor.href).toBe('https://example.test/gallery');
    expect(anchor.querySelector('svg')).not.toBeNull();
    expect(fixture.host.querySelector('button')).toBeNull();
  });

  it('opens by edit request and keeps the source version until the user opens a fresh crop', async () => {
    const View = imageExtension.View;
    const geometry = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    const value = { src: photo, crop: imageProps.crop, naturalSize: imageProps.naturalSize };
    const request = vi
      .fn<Parameters<typeof View>[0]['request']>()
      .mockResolvedValueOnce({ ok: false, message: '图片版本已变化' })
      .mockResolvedValueOnce({ ok: true, payload: { version: 3, value } });
    const onRetentionChange = vi.fn<(retained: boolean) => void>();
    const props = {
      object: { kind: 'image' as const, label: '图片', geometry },
      geometry,
      zoom: 1,
      selected: true,
      interactive: true,
      readOnly: false,
      request,
      onRetentionChange,
    };

    fixture.render(<View {...props} payload={{ version: 1, value }} />);
    expect(onRetentionChange).not.toHaveBeenCalled();
    fixture.render(<View {...props} payload={{ version: 1, value }} editRequest={1} />);
    expect(element<HTMLDialogElement>('dialog').open).toBe(true);
    expect(onRetentionChange.mock.calls).toEqual([[true]]);
    setRange('裁剪缩放', 3);
    fixture.render(<View {...props} payload={{ version: 2, value }} editRequest={1} />);
    await act(async () => button('保存裁剪').click());

    expect(request).toHaveBeenNthCalledWith(1, {
      name: 'media.crop',
      expectedVersion: 1,
      value: {
        crop: { zoom: 3, x: 0.25, y: 1 },
        naturalSize: { width: 400, height: 200 },
      },
    });
    expect(element('[role="alert"]').textContent).toBe('图片版本已变化');
    expect(onRetentionChange.mock.calls).toEqual([[true]]);
    act(() => element<HTMLButtonElement>('dialog button[aria-label="关闭裁剪"]').click());
    expect(fixture.host.querySelector('dialog')).toBeNull();
    expect(onRetentionChange.mock.calls).toEqual([[true], [false]]);

    fixture.render(<View {...props} payload={{ version: 2, value }} editRequest={2} />);
    await act(async () => button('保存裁剪').click());
    expect(request).toHaveBeenNthCalledWith(2, {
      name: 'media.crop',
      expectedVersion: 2,
      value: { crop: imageProps.crop, naturalSize: imageProps.naturalSize },
    });
    expect(fixture.host.querySelector('dialog')).toBeNull();
    expect(onRetentionChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
