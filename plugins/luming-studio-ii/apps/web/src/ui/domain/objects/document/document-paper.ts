import type { DocumentPaper } from './contracts.js';

export const defaultDocumentPaper = '#EFEFEF';
const paperChannel = 239;
const blackInk = '#111111';
const whiteInk = '#F5F5F5';
const balance = [0.2126, 0.7152, 0.0722] as const;

interface Paint {
  readonly color: string;
  readonly channels: readonly number[];
  readonly alpha: number;
}

function hexPaint(value: string): Paint | undefined {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value)?.[1];
  if (!hex) {
    return undefined;
  }

  const expanded = hex.length <= 4 ? hex.replace(/./gu, '$&$&') : hex;
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16),
  );
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;

  return { color: value, channels, alpha };
}

function rgbPaint(value: string): Paint | undefined {
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/iu.exec(
      value,
    );

  if (!rgb) {
    return undefined;
  }

  const channels = [1, 2, 3].map((index) => Math.min(255, Number(rgb[index])));
  const alpha = Math.min(1, Number(rgb[4] ?? 1));
  if (!channels.every(Number.isFinite) || !Number.isFinite(alpha)) {
    return undefined;
  }

  return { color: 'rgba(' + channels.join(',') + ',' + alpha + ')', channels, alpha };
}

function paint(value: string | undefined) {
  const state = value?.trim().toLowerCase();
  if (state === 'transparent' || state === 'none') {
    return { color: 'transparent', channels: [0, 0, 0], alpha: 0 };
  }

  if (state === 'black' || state === 'white') {
    const channel = state === 'black' ? 0 : 255;

    return {
      color: state === 'black' ? '#000000' : '#FFFFFF',
      channels: [channel, channel, channel],
      alpha: 1,
    };
  }

  return state ? (hexPaint(state) ?? rgbPaint(state)) : undefined;
}

function linearChannel(channel: number) {
  const ratio = channel / 255;

  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance({ channels, alpha }: Paint) {
  return channels.reduce((sum, channel, index) => {
    const composited = channel * alpha + paperChannel * (1 - alpha);

    return sum + linearChannel(composited) * (balance[index] ?? 0);
  }, 0);
}

export function canvasDocumentPaper(fill: string | undefined): DocumentPaper {
  const surface = paint(fill) ?? {
    color: defaultDocumentPaper,
    channels: [paperChannel, paperChannel, paperChannel],
    alpha: 1,
  };
  const paper = luminance(surface);
  const contrastAt = (channel: number) => {
    const ink = linearChannel(channel);

    return (Math.max(paper, ink) + 0.05) / (Math.min(paper, ink) + 0.05);
  };
  const light = contrastAt(17) >= contrastAt(245);

  return {
    fill: surface.color,
    backdrop: defaultDocumentPaper,
    ink: light ? blackInk : whiteInk,
    scheme: light ? 'light' : 'dark',
  };
}
