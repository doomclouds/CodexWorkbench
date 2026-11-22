import type { Artifact, Board, BoardElement, StyleProfile } from './studio.js';

export const BOARD_OPEN_CHECK = 'board';
export const BOARD_OPEN_FORMAT = 'board-open-v1';
export const BOARD_SCENE_CHECK = 'scene';
export const BOARD_SCENE_FORMAT = 'board-scene-v1';

export interface BoardOpenKnown {
  revision: number;
  epoch: string;
}

interface BoardOpenIdentity extends BoardOpenKnown {
  artifactId: string;
}

export type BoardOpenResponse = BoardOpenIdentity & {
  format: typeof BOARD_OPEN_FORMAT;
} & ({ unchanged: true; artifact: Artifact } | { unchanged: false; board: Board });

export const BOARD_SCENE_GEOMETRY = [
  'id',
  'type',
  'version',
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'parentId',
  'groupId',
  'locked',
  'kind',
  'fill',
  'stroke',
  'color',
  'strokeWidth',
  'from',
  'to',
  'fromSide',
  'toSide',
] as const satisfies readonly (keyof BoardElement)[];

export type BoardSceneGeometry = Pick<BoardElement, (typeof BOARD_SCENE_GEOMETRY)[number]>;

export type BoardSceneUnit =
  | { state: 'complete'; element: BoardElement }
  | { state: 'unloaded'; geometry: BoardSceneGeometry };

export interface BoardOpenScene {
  artifact: Artifact;
  style: StyleProfile;
  orderVersion?: number;
  units: BoardSceneUnit[];
}

export interface BoardSceneResponse extends BoardOpenIdentity {
  format: typeof BOARD_SCENE_FORMAT;
  scene: BoardOpenScene;
}

export function parseBoardOpenKnown(
  revision: string | null,
  epoch: string | null,
): BoardOpenKnown | null | undefined {
  if (revision === null && epoch === null) {
    return;
  }

  const value = Number(revision);
  const validRevision =
    revision !== null && /^(?:0|[1-9]\d*)$/.test(revision) && Number.isSafeInteger(value);

  if (!validRevision || epoch === null || !/^[A-Za-z0-9_-]{1,120}$/.test(epoch)) {
    return null;
  }

  return { revision: value, epoch };
}
