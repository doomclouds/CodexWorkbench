import {
  BOARD_SCENE_GEOMETRY,
  type BoardOpenScene,
  type BoardSceneGeometry,
  type BoardSceneUnit,
} from '../contracts/board-open.js';
import type { Board, BoardElement } from '../contracts/studio.js';

const LARGE_SCENE_VALUE_LENGTH = 2048;
const DEFERRED_ELEMENT_TYPES = new Set(['html', 'document', 'todo']);

function deferred(element: BoardElement): boolean {
  const rich = DEFERRED_ELEMENT_TYPES.has(element.type);
  const body = element.html !== undefined || element.document !== undefined;
  const opaque = element.data !== undefined || element.state !== undefined;
  const largeValue = [element.text, element.src, element.video, element.points].some(
    (value) => (value?.length ?? 0) > LARGE_SCENE_VALUE_LENGTH,
  );

  return rich || body || opaque || largeValue;
}

export function projectBoardSceneUnit(element: BoardElement): BoardSceneUnit {
  if (!deferred(element)) {
    return { state: 'complete', element };
  }

  const geometry = Object.fromEntries(
    BOARD_SCENE_GEOMETRY.map((key) => [key, element[key]]),
  ) as BoardSceneGeometry;

  return { state: 'unloaded', geometry };
}

export function whiteboardScene(board: Board): BoardOpenScene {
  return {
    artifact: board.artifact,
    style: board.style,
    orderVersion: board.orderVersion,
    units: board.elements.map(projectBoardSceneUnit),
  };
}
