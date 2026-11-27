import type {
  BoardReviewSource,
  BoardSuggestion,
  BoardSuggestionCommandReceipt,
  StoredBoardSuggestion,
} from '../domain/index.js';
import type { BoardEditReader, BoardEditWriter } from './index.js';

export type BoardEditPlanningReader = Pick<
  BoardEditWriter,
  | 'getAccess'
  | 'getBoard'
  | 'getObjects'
  | 'listObjects'
  | 'getPayloads'
  | 'getExportAsset'
  | 'payloadByteSize'
  | 'hasUsedObjectId'
  | 'listRelatedConnectors'
  | 'listGroupObjects'
  | 'listChildObjects'
>;

export interface BoardSuggestionQueries {
  canReviewBoard(boardId: string, actorId: string): boolean;
  getReviewSource(boardId: string, sourceId: string): BoardReviewSource | undefined;
  getSuggestion(boardId: string, proposalId: string): StoredBoardSuggestion | undefined;
  listSuggestions(
    boardId: string,
    nowMillis: bigint,
    limit: number,
    beforeProposalId?: string,
  ): readonly BoardSuggestion[];
  getSuggestionReceipt(
    boardId: string,
    actorId: string,
    commandId: string,
  ): BoardSuggestionCommandReceipt | undefined;
}

export interface BoardSuggestionReader
  extends BoardEditReader, BoardEditPlanningReader, BoardSuggestionQueries {}

export interface BoardSuggestionWriter extends BoardEditWriter, BoardSuggestionQueries {
  createReviewSource(source: BoardReviewSource): void;
  createSuggestion(suggestion: StoredBoardSuggestion): void;
  decideSuggestion(suggestion: StoredBoardSuggestion): void;
  saveSuggestionReceipt(
    boardId: string,
    actorId: string,
    commandId: string,
    receipt: BoardSuggestionCommandReceipt,
  ): void;
}

export interface BoardSuggestionRepository {
  read<T>(work: (reader: BoardSuggestionReader) => T): T;
  write<T>(work: (writer: BoardSuggestionWriter) => T): T;
}
