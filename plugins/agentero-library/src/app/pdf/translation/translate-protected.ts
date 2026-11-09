import { type Paragraph, validReflowTranslation } from './types';

/** Retry only prose fragments when a provider changes protected formula/style tokens. */
export async function translateProtected(paragraph: Paragraph, translate: (text: string) => Promise<string>, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const result = await translate(paragraph.protectedText); signal.throwIfAborted();
  if (result.trim() && validReflowTranslation(paragraph, result)) return result;
  const parts = paragraph.protectedText.split(/(⟪(?:F|\/?S)\d+⟫)/u);
  for (let i = 0; i < parts.length; i++) {
    signal.throwIfAborted();
    const part = parts[i];
    if (!/\p{L}/u.test(part) || /^⟪(?:F|\/?S)\d+⟫$/u.test(part)) continue;
    const leading = part.match(/^\s*/u)?.[0] ?? ''; const trailing = part.match(/\s*$/u)?.[0] ?? '';
    const source = part.slice(leading.length, part.length - trailing.length);
    if (!source) continue;
    const translated = (await translate(source)).trim(); signal.throwIfAborted();
    if (!translated || /⟪(?:F|\/?S)\d+⟫/u.test(translated)) throw new Error('翻译返回了无效的公式或样式标记。');
    parts[i] = leading + translated + trailing;
  }
  const restored = parts.join('');
  if (!validReflowTranslation(paragraph, restored)) throw new Error('无法恢复公式与样式，已保留原段落。');
  return restored;
}
