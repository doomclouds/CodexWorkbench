import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import type { ImageCrop, ImageCropPatch, MediaObjectStatus, MediaSize } from './contracts.js';
import { LinkObject } from './LinkObject.js';
import { validMediaSize } from './media-geometry.js';
import { MediaObject } from './MediaObject.js';

export interface ImageCanvasValue {
  readonly src?: string;
  readonly href?: string;
  readonly crop?: ImageCrop;
  readonly naturalSize?: MediaSize;
  readonly status?: MediaObjectStatus;
}

export interface VideoCanvasValue {
  readonly src?: string;
  readonly poster?: string;
  readonly status?: MediaObjectStatus;
}

export interface LinkCanvasValue {
  readonly href?: string;
}

const mediaCapabilities = {
  move: true,
  resize: true,
  rotate: true,
  connect: true,
  content: 'native',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function mediaStatus(value: unknown): MediaObjectStatus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.status === 'error') {
    return { status: 'error', message: text(value.message) };
  }
  if (value.status === 'ready' || value.status === 'loading') {
    return { status: value.status };
  }
}

function mediaSize(value: unknown): MediaSize | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { width, height } = value;
  if (typeof width === 'number' && typeof height === 'number') {
    const size = { width, height };
    return validMediaSize(size) ? size : undefined;
  }
}

function imageCrop(value: unknown): ImageCrop | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { zoom, x, y } = value;
  if (typeof zoom === 'number' && typeof x === 'number' && typeof y === 'number') {
    return { zoom, x, y };
  }
}

function imageValue(input: unknown): ImageCanvasValue {
  const value = isRecord(input) ? input : {};

  return {
    src: text(value.src),
    href: text(value.href),
    crop: imageCrop(value.crop),
    naturalSize: mediaSize(value.naturalSize),
    status: mediaStatus(value.status),
  };
}

function ImageView({
  object,
  geometry,
  payload,
  interactive,
  readOnly,
  locked,
  editRequest,
  request,
  onRetentionChange,
}: CanvasObjectViewProps) {
  const { src, href, crop, naturalSize, status } = imageValue(payload?.value);

  async function saveCrop(patch: ImageCropPatch) {
    if (!payload) {
      return false;
    }

    const receipt = await request({
      name: 'media.crop',
      expectedVersion: payload.version,
      value: patch,
    });

    if (!receipt.ok) {
      throw new Error(receipt.message);
    }
  }

  return (
    <MediaObject
      kind="image"
      label={object.label}
      width={geometry.width}
      height={geometry.height}
      src={src}
      href={href}
      crop={crop}
      naturalSize={naturalSize}
      status={status}
      interactive={interactive}
      readOnly={readOnly}
      locked={locked}
      editRequest={editRequest}
      onCropActivityChange={onRetentionChange}
      onSaveCrop={payload ? saveCrop : undefined}
    />
  );
}

function VideoView({ object, payload, interactive }: CanvasObjectViewProps) {
  const value = isRecord(payload?.value) ? payload.value : {};

  return (
    <MediaObject
      kind="video"
      label={object.label}
      src={text(value.src)}
      poster={text(value.poster)}
      status={mediaStatus(value.status)}
      interactive={interactive}
    />
  );
}

function LinkView({ object, payload, interactive }: CanvasObjectViewProps) {
  const value = isRecord(payload?.value) ? payload.value : {};

  return <LinkObject label={object.label} href={text(value.href)} interactive={interactive} />;
}

export const imageExtension = {
  kind: 'image',
  capabilities: mediaCapabilities,
  placement: { kind: 'image', label: '图片', width: 360, height: 240 },
  View: ImageView,
} satisfies CanvasObjectExtension;

export const videoExtension = {
  kind: 'video',
  capabilities: mediaCapabilities,
  placement: { kind: 'video', label: '视频', width: 360, height: 240 },
  View: VideoView,
} satisfies CanvasObjectExtension;

export const linkExtension = {
  kind: 'link',
  capabilities: mediaCapabilities,
  placement: { kind: 'link', label: '链接', width: 320, height: 94 },
  View: LinkView,
} satisfies CanvasObjectExtension;
