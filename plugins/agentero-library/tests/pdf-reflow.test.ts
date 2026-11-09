import { expect, test } from 'vitest';
import { layoutReflowDocument, type ReflowFonts } from '../src/app/pdf/translation/layout';
import { paragraphFromCharacters } from '../src/app/pdf/translation/paragraph';
import { translateProtected } from '../src/app/pdf/translation/translate-protected';
import { type Character, type Paragraph, validReflowTranslation } from '../src/app/pdf/translation/types';

const baseStyle = { font: 'Serif', size: 12, bold: false, italic: false, color: { r: 0, g: 0, b: 0 } };
function paragraph(): Paragraph {
  return { id: 'p0', pageIndex: 0, box: { x: 20, y: 30, w: 220, h: 70 }, characters: [], formulas: [{ id: '0', text: 'x + y', box: { x: 80, y: 30, w: 30, h: 12 }, characterIndexes: [5, 6, 7], baselineOffset: 0 }], styles: { '0': { ...baseStyle, bold: true } }, source: 'The value x + y is important.', protectedText: 'The value ⟪F0⟫ is ⟪S0⟫important⟪/S0⟫.', style: baseStyle, firstLineIndent: 0, heading: false };
}
const font = { encodeText: (text: string) => text, widthOfTextAtSize: (text: string, size: number) => Array.from(text).length * size * .5, heightAtSize: (size: number) => size };
const fonts = Object.fromEntries(['regular', 'bold', 'italic', 'boldItalic', 'cjk', 'cjkBold'].map(key => [key, font])) as ReflowFonts;

test('formula/style contract rejects missing, duplicated and mismatched placeholders', () => {
  const p = paragraph();
  expect(validReflowTranslation(p, '数值 ⟪F0⟫ 很⟪S0⟫重要⟪/S0⟫。')).toBe(true);
  for (const value of ['数值很重要。', '⟪F0⟫ ⟪F0⟫ ⟪S0⟫important⟪/S0⟫', '⟪F0⟫ ⟪S0⟫important⟪/S1⟫']) expect(validReflowTranslation(p, value)).toBe(false);
});

test('provider placeholder damage retries prose while retaining protected formula/style tokens', async () => {
  let calls = 0; const p = paragraph();
  const result = await translateProtected(p, async text => ++calls === 1 ? 'damaged response' : `译${text}`, new AbortController().signal);
  expect(calls).toBeGreaterThan(1);
  expect(validReflowTranslation(p, result)).toBe(true);
  expect(result.match(/⟪F0⟫/g)).toHaveLength(1);
  expect(result).toContain('⟪S0⟫'); expect(result).toContain('⟪/S0⟫');
});

test('cancelled translation does not call the configured provider', async () => {
  const controller = new AbortController(); controller.abort(); let called = false;
  await expect(translateProtected(paragraph(), async () => { called = true; return ''; }, controller.signal)).rejects.toThrow();
  expect(called).toBe(false);
});

test('reflow retains formula units and stays within the page', () => {
  const p = paragraph(); const page = { index: 0, width: 600, height: 800, paragraphs: [p], obstacles: [] };
  const [result] = layoutReflowDocument({ version: 1, pages: [page] }, new Map([['p0', '数值 ⟪F0⟫ 非常⟪S0⟫重要⟪/S0⟫。']]), fonts);
  expect(result.paragraphs[0].fits).toBe(true);
  expect(result.paragraphs[0].units.filter(unit => unit.formula?.id === '0')).toHaveLength(1);
  for (const unit of result.paragraphs[0].units) { expect(unit.x).toBeGreaterThanOrEqual(0); expect(unit.x + unit.width).toBeLessThanOrEqual(page.width); }
});

test('an overflowing fixed region is reported as not fitting instead of painting over neighboring content', () => {
  const p = { ...paragraph(), box: { x: 20, y: 30, w: 3, h: 3 }, fixedBox: true };
  const [result] = layoutReflowDocument({ version: 1, pages: [{ index: 0, width: 600, height: 800, paragraphs: [p], obstacles: [] }] }, new Map([['p0', `${'过长译文'.repeat(200)} ⟪F0⟫ ⟪S0⟫重要⟪/S0⟫`]]), fonts);
  expect(result.paragraphs[0].fits).toBe(false);
});

test('character-based extraction protects a formula island without looking up a guessed quote', () => {
  const chars: Character[] = Array.from('The sum x+y is useful.').map((text, index) => ({ index, text, box: { x: 10 + index * 6, y: 20, w: 6, h: 12 }, visualBox: { x: 10 + index * 6, y: 20, w: 6, h: 12 }, style: baseStyle }));
  const p = paragraphFromCharacters('p0', 0, { x: 10, y: 20, w: 200, h: 15 }, chars, [{ x: 58, y: 20, w: 18, h: 12 }], false);
  expect(p.formulas.length).toBeGreaterThan(0);
  expect(p.protectedText).toContain('⟪F0⟫');
  expect(p.source).toContain('x+y');
});
