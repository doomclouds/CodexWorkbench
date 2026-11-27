import type { BoardEditDecision, BoardEditIdentity } from './board-edits.js';
import type { GeometryOperation } from './geometry-edits.js';
import type { Geometry } from './model.js';
import type { ContentOperation } from './object-content-edits.js';

export interface BoardReviewActor {
  readonly id: string;
  readonly kind: 'human' | 'agent';
}

export type BoardReviewOrigin =
  | { readonly kind: 'selection'; readonly objectIds: readonly string[] }
  | { readonly kind: 'feedback'; readonly threadId: string };

export interface BoardReviewSource {
  readonly boardId: string;
  readonly sourceId: string;
  readonly ownerActorId: string;
  readonly capturedBoardRevision: bigint;
  readonly objectIds: readonly string[];
  readonly feedbackThreadId?: string;
  readonly targets: readonly BoardReviewTarget[];
  readonly targetsBoardRevision?: bigint;
}

export interface BoardReviewTarget {
  readonly objectId: string;
  readonly kind: string;
  readonly geometryVersion: bigint;
  readonly payloadVersion?: bigint;
  readonly geometry: Geometry;
}

export interface CreateBoardReviewSource extends BoardEditIdentity {
  readonly signature: string;
  readonly origin: BoardReviewOrigin;
  readonly expectedBoardRevision?: bigint;
}

export interface BoardSuggestionOption {
  readonly optionId: string;
  readonly label: string;
  readonly description?: string;
}

export interface BoardSuggestionEdit {
  readonly kind: 'geometry' | 'content';
  readonly bytes: Uint8Array;
}

export type BoardSuggestionOperation =
  | { readonly kind: 'geometry'; readonly operation: GeometryOperation }
  | { readonly kind: 'content'; readonly operation: ContentOperation };

export type DecodeBoardSuggestionEdit = (edit: BoardSuggestionEdit) => BoardSuggestionOperation;

export interface BoardSuggestionOptionDraft extends BoardSuggestionOption {
  readonly edit: BoardSuggestionEdit;
  readonly editFingerprint: string;
}

export interface BoardSuggestionOptionRecord extends BoardSuggestionOptionDraft {
  readonly plannedFingerprint: string;
}

export interface BoardSuggestion {
  readonly proposalId: string;
  readonly sourceId: string;
  readonly observation: string;
  readonly proposalVersion: bigint;
  readonly expiresAtMillis: bigint;
  readonly options: readonly BoardSuggestionOption[];
  readonly acceptedOptionId?: string;
  readonly acceptedBoardRevision?: bigint;
  readonly rejected: boolean;
}

export interface StoredBoardSuggestion extends BoardSuggestion {
  readonly boardId: string;
  readonly ownerActorId: string;
  readonly createdAtMillis: bigint;
  readonly options: readonly BoardSuggestionOptionRecord[];
}

export interface SubmitBoardSuggestion extends BoardEditIdentity {
  readonly signature: string;
  readonly sourceId: string;
  readonly observation: string;
  readonly options: readonly BoardSuggestionOptionDraft[];
}

export interface BoardSuggestionChoice {
  readonly boardId: string;
  readonly proposalId: string;
  readonly optionId: string;
  readonly expectedProposalVersion: bigint;
}

export interface AcceptBoardSuggestion extends BoardSuggestionChoice {
  readonly commandId: string;
  readonly signature: string;
}

export interface RejectBoardSuggestion extends BoardEditIdentity {
  readonly proposalId: string;
  readonly signature: string;
  readonly expectedProposalVersion: bigint;
}

export interface BoardSuggestionList {
  readonly proposals: readonly BoardSuggestion[];
  readonly nextBeforeProposalId?: string;
}

export interface BoardSuggestionPreview {
  readonly boardRevision: bigint;
  readonly decision: BoardEditDecision;
}

export interface BoardSuggestionCommandReceipt {
  readonly kind: 'source' | 'submit' | 'reject';
  readonly signature: string;
  readonly targetId: string;
}
