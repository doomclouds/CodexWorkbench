import type { ConnectorHead, MoveDelta, MoveTarget } from './model.js';

export type BoardArrange = 'tidy' | 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface GeometryGroupOperation {
  readonly kind: 'group';
  readonly targets: readonly MoveTarget[];
  readonly groupId: string;
}

export interface GeometryUngroupOperation {
  readonly kind: 'ungroup';
  readonly targets: readonly MoveTarget[];
}

export interface GeometrySectionOperation {
  readonly kind: 'createSection';
  readonly targets: readonly MoveTarget[];
  readonly sectionId: string;
  readonly title?: string;
}

export interface GeometryArrangeOperation {
  readonly kind: 'arrange';
  readonly targets: readonly MoveTarget[];
  readonly preset: BoardArrange;
}

export interface BoardObjectStylePatch {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dashed?: boolean;
  readonly hollow?: boolean;
  readonly textColor?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly textAlign?: string;
  readonly shapeForm?: string;
  readonly startHead?: ConnectorHead;
  readonly endHead?: ConnectorHead;
  readonly label?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

export interface BoardObjectStyleTarget {
  readonly target: MoveTarget;
  readonly expectedPayloadVersion?: bigint;
}

export interface GeometryStyleOperation {
  readonly kind: 'style';
  readonly targets: readonly BoardObjectStyleTarget[];
  readonly patch: BoardObjectStylePatch;
  readonly rememberColor?: string;
}

interface GeometryRemoveCustomColorOperation {
  readonly kind: 'removeCustomColor';
  readonly color: string;
}

export interface BoardPasteTarget {
  readonly sourceObjectId: string;
  readonly objectId: string;
}

export interface GeometryPasteOperation {
  readonly kind: 'paste';
  readonly sourceBoardId: string;
  readonly sourceRevision: bigint;
  readonly targets: readonly BoardPasteTarget[];
  readonly delta: MoveDelta;
}

export type GeometryParityOperation =
  | GeometryGroupOperation
  | GeometryUngroupOperation
  | GeometrySectionOperation
  | GeometryArrangeOperation
  | GeometryStyleOperation
  | GeometryRemoveCustomColorOperation
  | GeometryPasteOperation;
