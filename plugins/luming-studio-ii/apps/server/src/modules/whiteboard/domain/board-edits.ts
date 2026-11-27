import type { BoardObject, PayloadRecord } from './model.js';

export type BoardEditRejection =
  | 'forbidden'
  | 'invalidEdit'
  | 'objectNotFound'
  | 'geometryLocked'
  | 'commandIdReuse'
  | 'unsupportedKind'
  | 'versionUnavailable'
  | 'tooLarge'
  | 'invalidImage'
  | 'invalidVideo';

export interface BoardEditIdentity {
  readonly boardId: string;
  readonly commandId: string;
}

export interface BoardEditAsset {
  readonly assetId: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface BoardLayerPlacement {
  readonly position: 'front' | 'back';
  readonly objectIds: readonly string[];
}

export interface BoardChanges {
  readonly kind: 'changes';
  readonly objects?: readonly BoardObject[];
  readonly removedObjectIds?: readonly string[];
  readonly payloads?: readonly PayloadRecord[];
  readonly removedPayloadObjectIds?: readonly string[];
  readonly order?: readonly string[];
  readonly layerPlacement?: BoardLayerPlacement;
  readonly assets?: readonly BoardEditAsset[];
}

export interface BoardEditApplied {
  readonly kind: 'applied';
  readonly boardRevision: bigint;
  readonly objects: readonly BoardObject[];
  readonly removedObjectIds: readonly string[];
  readonly payloads: readonly PayloadRecord[];
  readonly removedPayloadObjectIds?: readonly string[];
  readonly order?: readonly string[];
  readonly detailsExpired?: boolean;
  readonly layerChangedObjectIds?: readonly string[];
}

export const boardWritePayloadLimit = 32n * 1024n * 1024n;

export interface BoardEditConflict {
  readonly kind: 'conflict';
  readonly boardRevision: bigint;
  readonly objects?: readonly BoardObject[];
  readonly payloads?: readonly PayloadRecord[];
}

export interface BoardEditRejected {
  readonly kind: 'rejected';
  readonly reason: BoardEditRejection;
}

export type BoardEditDecision = BoardChanges | BoardEditConflict | BoardEditRejected;

export interface BoardEditReceipt extends BoardEditIdentity {
  readonly outcome: BoardEditApplied | BoardEditConflict | BoardEditRejected;
}

export interface StoredBoardEditReceipt {
  readonly signature: string;
  readonly receipt: BoardEditReceipt;
  readonly advancedRevision?: boolean;
}

export type BoardVersionKind = 'geometry' | 'content' | 'image' | 'restore';

export interface BoardVersionCommit {
  readonly actorId: string;
  readonly kind: BoardVersionKind;
  readonly savedAtMillis: number;
  readonly sourceRevision?: bigint;
  readonly changedObjectCount: number;
}

export interface BoardVersionSummary {
  readonly revision: bigint;
  readonly title: string;
  readonly kind: BoardVersionKind | 'baseline';
  readonly actorId?: string;
  readonly savedAtMillis?: number;
  readonly sourceRevision?: bigint;
  readonly changedObjectCount: number;
}
