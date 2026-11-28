export interface FeedbackActor {
  readonly id: string;
  readonly kind?: 'human' | 'agent';
  readonly principalId?: string;
}

export interface FeedbackBoardAccess {
  readonly canEdit: boolean;
  readonly canComment?: boolean;
  readonly isOwner: boolean;
  readonly name?: string;
}

export interface FeedbackPoint {
  readonly x: number;
  readonly y: number;
}

export type FeedbackContentUnit =
  | { readonly kind: 'document'; readonly blockIds: readonly string[] }
  | { readonly kind: 'todo'; readonly itemId: string }
  | {
      readonly kind: 'html';
      readonly nodeIds: readonly string[];
      readonly sourceRevision: bigint;
    };

interface FeedbackObjectLocation {
  readonly objectId: string;
  readonly u: number;
  readonly v: number;
  readonly geometryVersion: bigint;
}

export interface FeedbackContentTarget extends FeedbackObjectLocation {
  readonly kind: 'content';
  readonly payloadVersion: bigint;
  readonly content: FeedbackContentUnit;
}

export interface FeedbackSourceObject {
  readonly objectId: string;
  readonly geometryVersion: bigint;
  readonly payloadVersion?: bigint;
}

export interface FeedbackSelectionTarget {
  readonly kind: 'selection';
  readonly point: FeedbackPoint;
  readonly bounds?: FeedbackPoint & { readonly width: number; readonly height: number };
  readonly objects: readonly FeedbackSourceObject[];
  readonly expectedBoardRevision: bigint;
}

export type FeedbackAnchorTarget =
  | { readonly kind: 'board'; readonly point: FeedbackPoint }
  | (FeedbackObjectLocation & { readonly kind: 'object' })
  | FeedbackContentTarget
  | FeedbackSelectionTarget;

export interface FeedbackContentSource {
  readonly kind: string;
  readonly payloadVersion: bigint;
  readonly data: unknown;
  readonly htmlNodeIds?: readonly string[];
}

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
  readonly payloadVersion?: bigint;
}

export interface FeedbackFrozenTarget {
  readonly reference: FeedbackSourceObject;
  readonly object: FeedbackFrozenObject;
}

export interface FeedbackAnchor {
  readonly target: FeedbackAnchorTarget;
  readonly sourceBoardRevision: bigint;
  readonly frozenPoint: FeedbackPoint;
  readonly frozenObject?: FeedbackFrozenObject;
  readonly frozenTargets?: readonly FeedbackFrozenTarget[];
  readonly frozenExcerpt?: string;
  readonly targetMissing: boolean;
}

export type FeedbackThreadStatus = 'open' | 'resolved';

export interface FeedbackAttachment {
  readonly requestId: string;
  readonly state: 'pending' | 'claimed' | 'attached';
  readonly threadVersion: bigint;
  readonly claimId?: string;
  readonly claimedAtMillis?: bigint;
}

export interface FeedbackMessage {
  readonly messageId: string;
  readonly authorActorId: string;
  readonly authorName?: string;
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
  readonly attachment?: FeedbackAttachment;
}

export interface FeedbackMessageView extends FeedbackMessage {
  readonly authoredByViewer: boolean;
  readonly canEdit: boolean;
}

export interface FeedbackThreadView extends Omit<FeedbackThread, 'first' | 'attachment'> {
  readonly first: FeedbackMessageView;
  readonly attachment?: Omit<FeedbackAttachment, 'claimId'>;
  readonly canResolve: boolean;
  readonly canDelete: boolean;
}

type FeedbackThreadChange = 'resolve' | 'reopen' | 'delete';

export type FeedbackAttachmentOperation =
  | {
      readonly kind: 'requestAttachment';
      readonly threadId: string;
      readonly expectedThreadVersion: bigint;
    }
  | {
      readonly kind: 'claimAttachment';
      readonly threadId: string;
      readonly requestId: string;
    }
  | {
      readonly kind: 'resetAttachmentClaim';
      readonly threadId: string;
      readonly requestId: string;
    }
  | {
      readonly kind: 'confirmAttachment';
      readonly threadId: string;
      readonly requestId: string;
      readonly claimId: string;
    };

export type FeedbackOperation =
  | { readonly kind: 'create'; readonly anchor: FeedbackAnchorTarget; readonly text: string }
  | { readonly kind: 'reply'; readonly threadId: string; readonly text: string }
  | FeedbackAttachmentOperation
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
  | 'commandIdReuse'
  | 'attachmentClaimed';

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
  readonly pendingAttachment?: boolean;
}
