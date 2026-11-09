import type { ReflowFonts } from './layout';
import type { FontKey } from './types';

export const translationFontFamily = '"Noto Serif CJK SC", "Songti SC", "SimSun", serif';
export function browserFonts(): ReflowFonts {
  const context = window.document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('当前浏览器无法测量翻译文字。');
  const font = (key: FontKey, size: number) => `${key.toLowerCase().includes('italic') ? 'italic' : 'normal'} ${key.toLowerCase().includes('bold') ? 700 : 400} ${size}px ${translationFontFamily}`;
  return Object.fromEntries((['regular', 'bold', 'italic', 'boldItalic', 'cjk', 'cjkBold'] as const).map(key => [key, {
    encodeText: (text: string) => text,
    widthOfTextAtSize(text: string, size: number) { context.font = font(key, size); return context.measureText(text).width; },
    heightAtSize(size: number, options?: { descender: boolean }) { context.font = font(key, size); const metrics = context.measureText('Mg国'); return Math.max(size * .8, metrics.actualBoundingBoxAscent) + (options?.descender === false ? 0 : Math.max(size * .2, metrics.actualBoundingBoxDescent)); },
  }])) as ReflowFonts;
}
