import type { SqliteConnection } from '../platform/index.js';
import { decodeJson, storedArray, storedText } from './stored-values.js';

const storedColor = /^#[0-9A-F]{6}$/u;

function validateBoardCustomColors(colors: readonly string[]) {
  const bounded = colors.length <= 64;
  const canonical = colors.every((color) => storedColor.test(color));
  if (!bounded || !canonical || new Set(colors).size !== colors.length) {
    throw new Error('Invalid board custom colors.');
  }
}

export function decodeBoardCustomColors(raw: unknown) {
  const colors = storedArray(raw, 'custom colors').map((value) => storedText(value, 'color'));
  validateBoardCustomColors(colors);

  return colors;
}

export function readBoardCustomColors(connection: SqliteConnection, boardId: string) {
  const row = connection
    .prepare('SELECT colors_json FROM board_custom_colors WHERE board_id = ?')
    .get(boardId);

  return row ? decodeBoardCustomColors(decodeJson(row.colors_json, 'colors_json')) : [];
}

export function writeBoardCustomColors(
  connection: SqliteConnection,
  boardId: string,
  colors: readonly string[],
) {
  validateBoardCustomColors(colors);
  if (colors.length === 0) {
    connection.prepare('DELETE FROM board_custom_colors WHERE board_id = ?').run(boardId);
    return;
  }

  connection
    .prepare(`
      INSERT INTO board_custom_colors (board_id, colors_json) VALUES (?, ?)
      ON CONFLICT (board_id) DO UPDATE SET colors_json = excluded.colors_json
    `)
    .run(boardId, JSON.stringify(colors));
}
