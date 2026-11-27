export const maximumBoardCustomColors = 64;

export function normalizeBoardCustomColor(value: string): string | undefined {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value.toUpperCase() : undefined;
}
