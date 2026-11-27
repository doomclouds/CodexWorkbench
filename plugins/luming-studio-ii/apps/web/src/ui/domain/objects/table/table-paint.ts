import type { TableObjectPaint } from './contracts.js';

type RGB = readonly [red: number, green: number, blue: number];
type RGBA = readonly [red: number, green: number, blue: number, alpha: number];

interface ThemeColor {
  readonly light: string;
  readonly dark: string;
  readonly css: string;
}

const paper = { light: '#f5f5f5', dark: '#2d3142', css: 'var(--studio-ui-canvas, Canvas)' };
const ink = { light: '#2d3142', dark: '#f5f5f5', css: 'var(--studio-ui-canvas-ink, CanvasText)' };
const secondary = {
  light: '#ececec',
  dark: '#393e53',
  css: 'var(--studio-ui-canvas-paper-secondary, light-dark(#ececec, #393e53))',
};

const semanticColors = new Map<string, ThemeColor>([
  ['paper', paper],
  ['paper-2', secondary],
  ['ink', ink],
  [
    'muted',
    {
      light: '#4f5d75',
      dark: '#bfc0c0',
      css: 'var(--studio-ui-canvas-muted, light-dark(#4f5d75, #bfc0c0))',
    },
  ],
  [
    'accent',
    {
      light: '#eb6c36',
      dark: '#f08a59',
      css: 'var(--studio-ui-accent, light-dark(#eb6c36, #f08a59))',
    },
  ],
  [
    'link',
    {
      light: '#2e5aa8',
      dark: '#6a95d8',
      css: 'var(--studio-ui-canvas-link, light-dark(#2e5aa8, #6a95d8))',
    },
  ],
  [
    'soft',
    {
      light: '#68738a',
      dark: '#a4aec2',
      css: 'var(--studio-ui-canvas-soft, light-dark(#68738a, #a4aec2))',
    },
  ],
  [
    'rule',
    {
      light: '#bfc0c0',
      dark: '#68738a',
      css: 'var(--studio-ui-canvas-rule, light-dark(#bfc0c0, #68738a))',
    },
  ],
]);

const namedColors = new Map([
  ['ink-strong', '#111111'],
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['transparent', '#00000000'],
  ['none', '#00000000'],
  ['yellow', '#f6e39c'],
  ['peach', '#f4c3a4'],
  ['pink', '#edbdd5'],
  ['green', '#bcd6be'],
  ['blue', '#b8d2ed'],
  ['purple', '#d0c0e5'],
  ['terracotta', '#b64e2a'],
]);

const fallbackLight = '#111111';
const fallbackDark = '#f5f5f5';
const minimumContrast = 4.5;

function readHex(input: string): RGBA | undefined {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu.exec(input)?.[1];
  if (!hex) {
    return undefined;
  }

  const expanded =
    hex.length <= 4
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  const channel = (offset: number) => Number.parseInt(expanded.slice(offset, offset + 2), 16);

  return [channel(0), channel(2), channel(4), expanded.length === 8 ? channel(6) / 255 : 1];
}

function readColor(input: string): RGBA | undefined {
  const hex = readHex(input);
  if (hex) {
    return hex;
  }

  const match =
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/iu.exec(
      input,
    );

  if (!match) {
    return undefined;
  }

  const channel = (text: string | undefined, max: number) => Math.min(max, Number(text));
  const rgba: RGBA = [
    channel(match[1], 255),
    channel(match[2], 255),
    channel(match[3], 255),
    channel(match[4] ?? '1', 1),
  ];

  return rgba.every(Number.isFinite) ? rgba : undefined;
}

function composite([red, green, blue, alpha]: RGBA, backdrop: RGB): RGB {
  const blend = (channel: number, base: number) => channel * alpha + base * (1 - alpha);

  return [blend(red, backdrop[0]), blend(green, backdrop[1]), blend(blue, backdrop[2])];
}

function luminance([red, green, blue]: RGB) {
  const linear = (channel: number) => {
    const level = channel / 255;

    return level <= 0.04045 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(inkLevel: number, surfaceLevel: number) {
  return (Math.max(inkLevel, surfaceLevel) + 0.05) / (Math.min(inkLevel, surfaceLevel) + 0.05);
}

function paintedInk(fill: string, currentInk: string, base: string) {
  const surface = readColor(fill);
  const backdrop = readColor(base);
  const foreground = readColor(currentInk);
  if (!surface || !backdrop || !foreground) {
    return currentInk;
  }

  const light = luminance(composite(surface, [backdrop[0], backdrop[1], backdrop[2]]));
  const foregroundLight = luminance([foreground[0], foreground[1], foreground[2]]);
  if (contrast(foregroundLight, light) >= minimumContrast) {
    return currentInk;
  }

  const lightInk = luminance([17, 17, 17]);
  const darkInk = luminance([245, 245, 245]);

  return contrast(lightInk, light) >= contrast(darkInk, light) ? fallbackLight : fallbackDark;
}

function fixedPaint(value: string): ThemeColor {
  return { css: value, light: value, dark: value };
}

function headerSurface(fill: string | undefined) {
  const requested = fill?.trim() ?? '';
  const key = requested.toLowerCase();
  const semantic = semanticColors.get(key);
  if (semantic) {
    return semantic;
  }

  const literal = namedColors.get(key) ?? requested;

  return readColor(literal) ? fixedPaint(literal) : secondary;
}

export const tableBodyPaint: TableObjectPaint = { background: paper.css, color: ink.css };

export function tableHeaderPaint(fill: string | undefined): TableObjectPaint {
  const surface = headerSurface(fill);
  const light = paintedInk(surface.light, ink.light, paper.light);
  const dark = paintedInk(surface.dark, ink.dark, paper.dark);
  const keepsInk = light === ink.light && dark === ink.dark;
  if (keepsInk) {
    return { background: surface.css, color: ink.css };
  }

  const color = light === dark ? light : 'light-dark(' + light + ', ' + dark + ')';

  return { background: surface.css, color };
}
