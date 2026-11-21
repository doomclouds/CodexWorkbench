import type { StyleProfile } from '../contracts/studio.js';

export const LIGHT_THEME: StyleProfile = {
  name: 'Diagram · 明亮',
  paper: '#f5f5f5',
  ink: '#2d3142',
  muted: '#4f5d75',
  accent: '#eb6c36',
  link: '#2e5aa8',
  'paper-2': '#ececec',
  soft: '#68738a',
  rule: '#bfc0c0',
  'ink-strong': '#111111',
  fontFamily: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
  titleFont: 'Georgia, "Songti SC", serif',
  monoFont: 'Consolas, monospace',
};
export const DARK_THEME: StyleProfile = {
  ...LIGHT_THEME,
  name: 'Diagram · 暗色',
  paper: '#2d3142',
  'paper-2': '#393e53',
  ink: '#f5f5f5',
  muted: '#bfc0c0',
  soft: '#a4aec2',
  rule: '#68738a',
  accent: '#f08a59',
  link: '#6a95d8',
};

export type Rgba = [number, number, number, number];

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  transparent: '#00000000',
  yellow: '#f6e39c',
  peach: '#f4c3a4',
  pink: '#edbdd5',
  green: '#bcd6be',
  blue: '#b8d2ed',
  purple: '#d0c0e5',
  ink: '#2d3142',
  terracotta: '#b64e2a',
};

export function parseColor(input: string): Rgba {
  const color = tryParseColor(input);
  if (!color) {
    throw new Error(`不支持的颜色：${input}`);
  }

  return color;
}

export function tryParseColor(input: unknown): Rgba | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }

  const name = input.toLowerCase();
  const value = (Object.hasOwn(NAMED, name) ? NAMED[name]! : input).trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;

    return [
      parseInt(expanded.slice(0, 2), 16),
      parseInt(expanded.slice(2, 4), 16),
      parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    ];
  }

  const rgb =
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
      value,
    );

  if (rgb) {
    return [0, 1, 2]
      .map((i) => Math.min(255, Math.max(0, Number(rgb[i + 1]))))
      .concat(Math.min(1, Math.max(0, Number(rgb[4] ?? 1)))) as Rgba;
  }

  return undefined;
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (!alpha) {
    return [0, 0, 0, 0];
  }

  return [0, 1, 2]
    .map(
      (i) =>
        (foreground[i] * foreground[3] + background[i] * background[3] * (1 - foreground[3])) /
        alpha,
    )
    .concat(alpha) as Rgba;
}

function luminance(color: Rgba): number {
  return color
    .slice(0, 3)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrastRatio(
  foreground: string,
  background: string,
  underneath = '#ffffff',
): number {
  return colorContrast(parseColor(background), parseColor(underneath), parseColor(foreground));
}

export function tryContrastRatio(
  foreground: string,
  background: string,
  underneath = '#ffffff',
): number | undefined {
  const back = tryParseColor(background);
  const under = tryParseColor(underneath);
  const front = tryParseColor(foreground);
  if (!back || !under || !front) {
    return undefined;
  }

  return colorContrast(back, under, front);
}

function colorContrast(background: Rgba, underneath: Rgba, foreground: Rgba): number {
  const back = composite(background, underneath);
  const front = composite(foreground, back);
  const a = luminance(front);
  const b = luminance(back);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableText(fill: string, underneath = '#ffffff'): string {
  return contrastRatio('#111111', fill, underneath) >= contrastRatio('#f5f5f5', fill, underneath)
    ? '#111111'
    : '#f5f5f5';
}

export function withTheme(
  theme: 'light' | 'dark',
  overrides: Partial<StyleProfile> = {},
): StyleProfile {
  return { ...(theme === 'dark' ? DARK_THEME : LIGHT_THEME), ...overrides } as StyleProfile;
}

export function semanticColor(value: unknown, style: StyleProfile, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  if (value === 'none') {
    return 'none';
  }

  return (
    style[value] ??
    NAMED[value.toLowerCase()] ??
    (/^(?:#[\da-f]{3,8}|rgba?\([\d., /]+\))$/i.test(value) ? value : fallback)
  );
}
