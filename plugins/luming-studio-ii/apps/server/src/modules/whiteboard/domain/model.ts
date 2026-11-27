export interface Actor {
  readonly id: string;
}

export interface BoardHeader {
  readonly boardId: string;
  readonly title: string;
  readonly revision: bigint;
}

export interface BoardAccess {
  readonly canEdit: boolean;
  readonly trashed?: boolean;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Geometry extends Point {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface Appearance {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dashed?: boolean;
  readonly hollow?: boolean;
}

export type ConnectorPort = 'top' | 'bottom' | 'left' | 'right';
export type ConnectorHead = 'none' | 'arrow' | 'circle';

export interface ConnectorEndpoint {
  readonly point: Point;
  readonly attachment?: {
    readonly objectId: string;
    readonly port?: ConnectorPort;
  };
}

export interface ConnectorDetail {
  readonly kind: 'connector';
  readonly start: ConnectorEndpoint;
  readonly end: ConnectorEndpoint;
  readonly bends: readonly Point[];
  readonly relativeBends?: {
    readonly firstAxis: 'horizontal' | 'vertical';
    readonly offsets: readonly number[];
  };
  readonly labelOffset?: Point;
  readonly startHead?: ConnectorHead;
  readonly endHead?: ConnectorHead;
}

export type GeometryDetail =
  | { readonly kind: 'shape'; readonly outline: string }
  | { readonly kind: 'section'; readonly transparent: boolean }
  | { readonly kind: 'ink'; readonly width: number }
  | ConnectorDetail;

export interface BoardObject {
  readonly objectId: string;
  readonly kind: string;
  readonly label: string;
  readonly geometry: Geometry;
  readonly geometryVersion: bigint;
  readonly payloadVersion?: bigint;
  readonly locked: boolean;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly appearance?: Appearance;
  readonly detail?: GeometryDetail;
}

export interface BoardScene {
  readonly board: BoardHeader;
  readonly access: BoardAccess;
  readonly objects: readonly BoardObject[];
  readonly customColors?: readonly string[];
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface PayloadRecord {
  readonly objectId: string;
  readonly payloadVersion: bigint;
  readonly bodyKind: string;
  readonly data: JsonObject;
}

export type PayloadResult =
  | { readonly kind: 'payload'; readonly payload: PayloadRecord }
  | {
      readonly kind: 'unavailable';
      readonly objectId: string;
      readonly reason: 'notFound' | 'unsupportedKind';
    };

export interface MoveDelta {
  readonly dx: number;
  readonly dy: number;
}

export interface MoveTarget {
  readonly objectId: string;
  readonly expectedGeometryVersion: bigint;
}

export interface MoveCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly delta: MoveDelta;
  readonly targets: readonly MoveTarget[];
}

export type MoveRejectionReason = 'forbidden' | 'geometryLocked' | 'invalidMove' | 'commandIdReuse';

export interface MoveApplied {
  readonly kind: 'applied';
  readonly boardRevision: bigint;
  readonly objects: readonly BoardObject[];
}

export interface MoveConflict {
  readonly kind: 'conflict';
  readonly reason: 'geometryVersionChanged' | 'targetsChanged';
  readonly boardRevision: bigint;
  readonly currentObjects: readonly BoardObject[];
  readonly missingObjectIds: readonly string[];
}

export interface MoveRejected {
  readonly kind: 'rejected';
  readonly reason: MoveRejectionReason;
}

export type MoveOutcome = MoveApplied | MoveConflict | MoveRejected;

export interface CommandReceipt {
  readonly boardId: string;
  readonly commandId: string;
  readonly outcome: MoveOutcome;
}

export interface StoredReceipt {
  readonly signature: string;
  readonly receipt: CommandReceipt;
}
