import type { BoardElement } from '../contracts/studio.js';

export function tableValues(e: BoardElement): unknown[][] {
  const storedRows = e.data?.rows;
  if (Array.isArray(storedRows) && storedRows.every(Array.isArray) && storedRows.length) {
    return storedRows;
  }
  if (typeof e.text === 'string' && e.text.length) {
    return e.text
      .replace(/\r\n?/g, '\n')
      .replace(/\n$/, '')
      .split('\n')
      .map((row) => row.split('\t'));
  }

  return [['']];
}

export function tableRows(element: BoardElement): string[][] {
  return tableValues(element).map((row) => row.map((cell) => String(cell ?? '')));
}
