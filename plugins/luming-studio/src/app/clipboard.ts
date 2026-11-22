export async function copyPlainText(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) {
    throw new Error('当前页面无法使用系统剪贴板，请手动复制。');
  }

  try {
    await clipboard.writeText(text);
  } catch (error) {
    throw new Error('未能复制到系统剪贴板，请手动复制或重试。', { cause: error });
  }
}
