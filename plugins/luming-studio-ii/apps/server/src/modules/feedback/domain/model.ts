export interface FeedbackActor {
  readonly id: string;
}

export interface FeedbackBoardAccess {
  readonly canEdit: boolean;
  readonly canComment?: boolean;
  readonly isOwner: boolean;
}

export interface FeedbackPoint {
  readonly x: number;
  readonly y: number;
}

export type FeedbackAnchorTarget =
  | { readonly kind: 'board'; readonly point: FeedbackPoint }
  | {
      readonly kind: 'object';
      readonly objectId: string;
      readonly u: number;
      readonly v: number;
      readonly geometryVersion: bigint;
    };

export interface FeedbackFrozenObject extends FeedbackPoint {
  readonly kind: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface FeedbackAnchorObject extends FeedbackFrozenObject {
  readonly objectId: string;
  readonly geometryVersion: bigint;
}

export interface FeedbackAnchor {
  readonly target: FeedbackAnchorTarget;
  readonly sourceBoardRevision: bigint;
  readonly frozenPoint: FeedbackPoint;
  readonly frozenObject?: FeedbackFrozenObject;
  readonly targetMissing: boolean;
}

export type FeedbackThreadStatus = 'open' | 'resolved';

export interface FeedbackMessage {
  readonly messageId: string;
  readonly authorActorId: string;
  readonly text: string;
  readonly createdAtMillis: bigint;
  readonly updatedAtMillis: bigint;
  readonly version: bigint;
}

export interface FeedbackThread {
  readonly threadId: string;
  readonly anchor: FeedbackAnchor;
  readonly status: FeedbackThreadStatus;
  readonly first: FeedbackMessage;
  readonly updatedAtMillis: bigint;
  readonly version: bigint;
  readonly replyCount: number;
}

export interface FeedbackMessageView extends FeedbackMessage {
  readonly authoredByViewer: boolean;
  readonly canEdit: boolean;
}

export interface FeedbackThreadView extends Omit<FeedbackThread, 'first'> {
  readonly first: FeedbackMessageView;
  readonly canResolve: boolean;
  readonly canDelete: boolean;
}

type FeedbackThreadChange = 'resolve' | 'reopen' | 'delete';

export type FeedbackOperation =
  | { readonly kind: 'create'; readonly anchor: FeedbackAnchorTarget; readonly text: string }
  | { readonly kind: 'reply'; readonly threadId: string; readonly text: string }
  | {
      readonly kind: 'edit';
      readonly threadId: string;
      readonly messageId: string;
      readonly expectedMessageVersion: bigint;
      readonly text: string;
    }
  | {
      readonly kind: FeedbackThreadChange;
      readonly threadId: string;
      readonly expectedThreadVersion: bigint;
    };

export type FeedbackRejectionReason =
  | 'invalidText'
  | 'invalidAnchor'
  | 'targetChanged'
  | 'notFound'
  | 'forbidden'
  | 'versionChanged'
  | 'commandIdReuse';

export interface FeedbackRejected {
  readonly kind: 'rejected';
  readonly reason: FeedbackRejectionReason;
  readonly currentVersion?: bigint;
}

export interface FeedbackApplied {
  readonly kind: 'applied';
  readonly threadId: string;
  readonly threadVersion: bigint;
  readonly messageId?: string;
  readonly messageVersion?: bigint;
  readonly deleted: boolean;
}

export type FeedbackOutcome = FeedbackApplied | FeedbackRejected;

export interface FeedbackReceipt {
  readonly boardId: string;
  readonly commandId: string;
  readonly outcome: FeedbackOutcome;
}

export interface FeedbackStoredReceipt {
  readonly signature: string;
  readonly receipt: FeedbackReceipt;
}

export interface FeedbackThreadPosition {
  readonly updatedAtMillis: bigint;
  readonly threadId: string;
}

export interface FeedbackThreadLookup {
  readonly boardId: string;
  readonly limit: number;
  readonly position?: FeedbackThreadPosition;
  readonly status?: FeedbackThreadStatus;
  readonly authorActorId?: string;
}
