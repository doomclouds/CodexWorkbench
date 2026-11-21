import type { BoardElement, StyleProfile } from '../../contracts/studio.js';
import {
  contrastRatio,
  LIGHT_THEME,
  parseColor,
  readableText,
  semanticColor,
  tryParseColor,
} from '../theme.js';

export const DEFAULT_REGION_FILL = '#EFEFEF';

export interface DocumentSurface {
  backdrop: string;
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  code: string;
  link: string;
  scheme: 'light' | 'dark';
}

const inlinePalette: Record<string, [string, string, string, string]> = {
  gray: ['#9b9a97', '#ebeced', '#bebdb8', '#9b9a97'],
  brown: ['#64473a', '#e9e5e3', '#8e6552', '#64473a'],
  red: ['#e03e3e', '#fbe4e4', '#ec4040', '#be3434'],
  orange: ['#d9730d', '#f6e9d9', '#e3790d', '#b7600a'],
  yellow: ['#dfab01', '#fbf3db', '#dfab01', '#b58b00'],
  green: ['#4d6461', '#ddedea', '#6b8b87', '#4d6461'],
  blue: ['#0b6e99', '#ddebf1', '#0e87bc', '#0b6e99'],
  purple: ['#6940a5', '#eae4f2', '#8552d7', '#6940a5'],
  pink: ['#ad1a72', '#f4dfeb', '#da208f', '#ad1a72'],
};

export function documentInlineColor(
  value: unknown,
  kind: 'text' | 'background',
  scheme: 'light' | 'dark' = 'light',
): string | undefined {
  if (typeof value !== 'string' || value === 'default') {
    return undefined;
  }

  const preset = inlinePalette[value];
  if (preset) {
    return preset[(scheme === 'dark' ? 2 : 0) + (kind === 'background' ? 1 : 0)];
  }
  if (!tryParseColor(value)) {
    return undefined;
  }

  return paint(value, LIGHT_THEME, '') || undefined;
}

function paint(value: unknown, style: StyleProfile, fallback: string): string {
  const color = semanticColor(value, style, fallback);
  const parsed = tryParseColor(color === 'none' ? 'transparent' : color);
  if (!parsed || !parsed.every(Number.isFinite)) {
    return fallback;
  }

  const [r, g, b, a] = parsed;

  return a === 1
    ? '#' +
        [r, g, b]
          .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
    : `rgba(${r},${g},${b},${a})`;
}

export function documentSurface(
  element: Pick<BoardElement, 'fill' | 'color'>,
  style: StyleProfile = LIGHT_THEME,
): DocumentSurface {
  const [r, g, b, alpha] = parseColor(paint(style.paper, LIGHT_THEME, DEFAULT_REGION_FILL));
  const fallback = parseColor(DEFAULT_REGION_FILL);
  const backdrop =
    '#' +
    [r, g, b]
      .map((channel, index) =>
        Math.round(channel * alpha + fallback[index] * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase();
  const paper = paint(element.fill, style, DEFAULT_REGION_FILL);
  const automaticInk = readableText(paper, backdrop);
  const scheme = automaticInk === '#111111' ? 'light' : 'dark';
  const ink = element.color === 'ink' ? automaticInk : paint(element.color, style, automaticInk);
  const readable = (color: string) =>
    contrastRatio(color, paper, backdrop) >= 4.5 ? color : automaticInk;

  return {
    backdrop,
    paper,
    ink,
    scheme,
    muted: readable(scheme === 'light' ? '#4F5D75' : '#C3CAD6'),
    rule: scheme === 'light' ? '#A8B0BD' : '#667285',
    code: scheme === 'light' ? '#E1E3E7' : '#242B38',
    link: readable(scheme === 'light' ? '#245AA9' : '#A8C8FF'),
  };
}
