import type { BoardEditReceipt } from '../whiteboard/index.js';

export type SuggestionPost = (
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export type ReviewSourceOrigin =
  | { readonly kind: 'selection'; readonly objectIds: readonly string[] }
  | { readonly kind: 'feedback'; readonly threadId: string };

export interface ReviewSourceCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly expectedBoardRevision?: bigint;
  readonly origin: ReviewSourceOrigin;
}

export interface ReviewSourceTarget {
  readonly objectId: string;
  readonly kind: string;
  readonly geometryVersion: bigint;
  readonly payloadVersion?: bigint;
  readonly geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  };
}

export interface AttachedReviewSource {
  readonly sourceId: string;
  readonly capturedBoardRevision: bigint;
  readonly targetsBoardRevision: bigint;
  readonly targets: readonly ReviewSourceTarget[];
}

export interface BoardReviewSource extends AttachedReviewSource {
  readonly boardId: string;
  readonly objectIds: readonly string[];
  readonly feedbackThreadId?: string;
}

export interface BoardSuggestionOption {
  readonly optionId: string;
  readonly label: string;
  readonly description?: string;
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
  readonly activeOptionIds: readonly string[];
  readonly rejected: boolean;
}

export interface SuggestionListRequest {
  readonly boardId: string;
  readonly limit?: number;
  readonly beforeProposalId?: string;
}

export interface BoardSuggestionPage {
  readonly proposals: readonly BoardSuggestion[];
  readonly nextBeforeProposalId?: string;
}

interface SuggestionTarget {
  readonly boardId: string;
  readonly proposalId: string;
  readonly expectedProposalVersion: bigint;
}

export interface PreviewSuggestionRequest extends SuggestionTarget {
  readonly optionId: string;
}

export interface RejectSuggestionCommand extends SuggestionTarget {
  readonly commandId: string;
}

export interface AcceptSuggestionCommand extends PreviewSuggestionRequest {
  readonly commandId: string;
}

export type SuggestionReviewReceipt = BoardEditReceipt;
export type SuggestionAppliedReceipt = Extract<SuggestionReviewReceipt, { kind: 'applied' }>;
export type SuggestionBoardChanges = Omit<
  SuggestionAppliedReceipt,
  'boardId' | 'commandId' | 'kind'
>;

export interface SuggestionPreviewFrame {
  readonly boardId: string;
  readonly proposalId: string;
  readonly optionId: string;
  readonly changes: SuggestionBoardChanges;
}

type RejectedReview = Extract<SuggestionReviewReceipt, { kind: 'rejected' }>;

export type SuggestionPreviewResult =
  | { readonly kind: 'preview'; readonly frame: SuggestionPreviewFrame }
  | { readonly kind: 'conflict'; readonly revision?: bigint }
  | { readonly kind: 'rejected'; readonly reason: RejectedReview['reason'] };

export interface SuggestionService {
  createReviewSource(
    command: ReviewSourceCommand,
    signal?: AbortSignal,
  ): Promise<BoardReviewSource>;
  listSuggestions(query: SuggestionListRequest, signal?: AbortSignal): Promise<BoardSuggestionPage>;
  previewSuggestion(
    query: PreviewSuggestionRequest,
    signal?: AbortSignal,
  ): Promise<SuggestionPreviewResult>;
  acceptSuggestion(
    command: AcceptSuggestionCommand,
    signal?: AbortSignal,
  ): Promise<SuggestionReviewReceipt>;
  rejectSuggestion(
    command: RejectSuggestionCommand,
    signal?: AbortSignal,
  ): Promise<BoardSuggestion>;
  getAcceptReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<SuggestionReviewReceipt | undefined>;
}
