export interface FeedbackPoint {
  readonly x: number;
  readonly y: number;
}

interface FeedbackObjectPosition {
  readonly objectId: string;
  readonly u: number;
  readonly v: number;
  readonly geometryVersion: bigint;
}

export interface FeedbackObjectTarget extends FeedbackObjectPosition {
  readonly kind: 'object';
}

export type FeedbackContentUnit =
  | { readonly kind: 'document'; readonly blockIds: readonly string[] }
  | { readonly kind: 'todo'; readonly itemId: string }
  | {
      readonly kind: 'html';
      readonly nodeIds: readonly string[];
      readonly sourceRevision: bigint;
    };

export interface FeedbackContentTarget extends FeedbackObjectPosition {
  readonly kind: 'content';
  readonly payloadVersion: bigint;
  readonly content: FeedbackContentUnit;
}

export type FeedbackTarget =
  | { readonly kind: 'board'; readonly point: FeedbackPoint }
  | FeedbackObjectTarget
  | FeedbackContentTarget;

export interface FrozenFeedbackObject extends FeedbackPoint {
  readonly kind: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface FeedbackAnchor {
  readonly target: FeedbackTarget;
  readonly sourceRevision: bigint;
  readonly frozenPoint: FeedbackPoint;
  readonly frozenObject?: FrozenFeedbackObject;
  readonly frozenExcerpt?: string;
  readonly targetMissing: boolean;
}

export interface FeedbackMessage {
  readonly id: string;
  readonly authorId: string;
  readonly authoredByViewer: boolean;
  readonly text: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly version: bigint;
  readonly canEdit: boolean;
}

export type FeedbackStatus = 'open' | 'resolved';

export interface FeedbackThread {
  readonly id: string;
  readonly status: FeedbackStatus;
  readonly anchor: FeedbackAnchor;
  readonly first: FeedbackMessage;
  readonly version: bigint;
  readonly updatedAt: number;
  readonly replyCount: number;
  readonly canResolve: boolean;
  readonly canDelete: boolean;
}

export interface FeedbackPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly canWrite: boolean;
}

export interface FeedbackThreadPage extends FeedbackPage<FeedbackMessage> {
  readonly thread: FeedbackThread;
}

interface FeedbackPageRequest {
  readonly boardId: string;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface FeedbackListRequest extends FeedbackPageRequest {
  readonly status?: FeedbackStatus;
  readonly authorId?: string;
}

export interface FeedbackThreadRequest extends FeedbackPageRequest {
  readonly threadId: string;
}

export type FeedbackOperation =
  | { readonly kind: 'create'; readonly anchor: FeedbackTarget; readonly text: string }
  | { readonly kind: 'reply'; readonly threadId: string; readonly text: string }
  | {
      readonly kind: 'edit';
      readonly threadId: string;
      readonly messageId: string;
      readonly expectedVersion: bigint;
      readonly text: string;
    }
  | {
      readonly kind: 'resolve' | 'reopen' | 'delete';
      readonly threadId: string;
      readonly expectedVersion: bigint;
    };

export interface FeedbackCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly operation: FeedbackOperation;
}

export type FeedbackRejection =
  | 'invalidText'
  | 'invalidAnchor'
  | 'targetChanged'
  | 'notFound'
  | 'forbidden'
  | 'versionChanged'
  | 'commandIdReuse';

export type FeedbackReceipt =
  | {
      readonly kind: 'applied';
      readonly threadId: string;
      readonly threadVersion: bigint;
      readonly messageId?: string;
      readonly messageVersion?: bigint;
      readonly deleted: boolean;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: FeedbackRejection;
      readonly currentVersion?: bigint;
    };

export interface BoardFeedbackService {
  listThreads(
    request: FeedbackListRequest,
    signal?: AbortSignal,
  ): Promise<FeedbackPage<FeedbackThread>>;
  getThread(request: FeedbackThreadRequest, signal?: AbortSignal): Promise<FeedbackThreadPage>;
  apply(command: FeedbackCommand, signal?: AbortSignal): Promise<FeedbackReceipt>;
  getReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<FeedbackReceipt | undefined>;
}

export type FeedbackPost = (
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;
