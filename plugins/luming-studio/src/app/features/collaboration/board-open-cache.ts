import type { BoardOpenResponse } from '../../../contracts/board-open.js';
import type { Board, StudioClient } from '../../../contracts/studio.js';
import { jsonEqual } from '../../../shared/safe-merge.js';
import type { StudioDocument } from '../../product-contract.js';

export interface OpenBoardScope {
  client: StudioClient;
  authorityKey?: string;
  artifactId: string;
}

interface CachedBoard extends OpenBoardScope {
  epoch: string;
  board: Board;
}

export class BoardOpenCache {
  private cached?: CachedBoard;

  get(scope: OpenBoardScope) {
    const entry = this.cached;
    if (!entry) {
      return;
    }

    if (entry.client !== scope.client || entry.authorityKey !== scope.authorityKey) {
      this.cached = undefined;
      return;
    }

    return scope.authorityKey && entry.artifactId === scope.artifactId ? entry : undefined;
  }

  remember(scope: OpenBoardScope, epoch: string, document: StudioDocument | null) {
    const board = document as Board | null;
    const matching =
      board?.artifact.id === scope.artifactId && board.artifact.type === 'whiteboard';

    if (!scope.authorityKey || !matching || !Array.isArray(board?.elements)) {
      return;
    }

    this.cached = { ...scope, epoch, board };
  }

  forget(scope: OpenBoardScope) {
    if (this.get(scope)) {
      this.cached = undefined;
    }
  }
}

export function materializeBoardOpen(response: BoardOpenResponse, cached: CachedBoard | undefined) {
  if (!response.unchanged) {
    return response.board;
  }

  const previous = cached?.board;
  if (
    !previous ||
    cached.epoch !== response.epoch ||
    previous.artifact.revision !== response.revision
  ) {
    throw new Error('作品服务返回的白板版次与已授权副本不匹配。');
  }

  return jsonEqual(previous.artifact, response.artifact)
    ? previous
    : { ...previous, artifact: response.artifact };
}
