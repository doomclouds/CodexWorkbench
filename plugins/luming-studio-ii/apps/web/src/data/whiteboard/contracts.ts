export interface WhiteboardPoint {
  readonly x: number;
  readonly y: number;
}

export interface WhiteboardGeometry extends WhiteboardPoint {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface WhiteboardAppearance {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dashed: boolean;
  readonly hollow: boolean;
}

export type WhiteboardPort = 'top' | 'bottom' | 'left' | 'right';
export type WhiteboardConnectorHead = 'none' | 'arrow' | 'circle';

export interface WhiteboardAttachment {
  readonly objectId: string;
  readonly port?: WhiteboardPort;
}

export interface WhiteboardConnectionEndpoint {
  readonly point: WhiteboardPoint;
  readonly attachment?: WhiteboardAttachment;
}

export interface WhiteboardRelativeBends {
  readonly firstAxis: 'horizontal' | 'vertical';
  readonly offsets: readonly number[];
}

export interface WhiteboardConnection {
  readonly start: WhiteboardConnectionEndpoint;
  readonly end: WhiteboardConnectionEndpoint;
  readonly bends?: readonly WhiteboardPoint[];
  readonly relativeBends?: WhiteboardRelativeBends;
  readonly labelOffset?: WhiteboardPoint;
  readonly startHead?: WhiteboardConnectorHead;
  readonly endHead?: WhiteboardConnectorHead;
}

export type WhiteboardObjectDetail =
  | { readonly kind: 'shape'; readonly outline: string }
  | { readonly kind: 'section'; readonly transparent: boolean }
  | { readonly kind: 'ink'; readonly width: number }
  | { readonly kind: 'connector'; readonly connection: WhiteboardConnection };

export interface WhiteboardObject {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly geometry: WhiteboardGeometry;
  readonly geometryVersion: bigint;
  readonly payloadVersion?: bigint;
  readonly locked: boolean;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly appearance?: WhiteboardAppearance;
  readonly detail?: WhiteboardObjectDetail;
}

export interface WhiteboardScene {
  readonly boardId: string;
  readonly title: string;
  readonly revision: bigint;
  readonly canEdit: boolean;
  readonly trashed?: boolean;
  readonly customColors?: readonly string[];
  readonly objects: readonly WhiteboardObject[];
}

export type WhiteboardContentKind =
  | 'text'
  | 'document'
  | 'embed'
  | 'todo'
  | 'table'
  | 'image'
  | 'video'
  | 'link'
  | 'sticker'
  | 'extension';

type WhiteboardContentValue = Readonly<Record<string, unknown>>;

export type WhiteboardPayloadBody =
  | { readonly kind: 'ink'; readonly points: readonly WhiteboardPoint[] }
  | { readonly kind: WhiteboardContentKind; readonly value: WhiteboardContentValue };

export interface WhiteboardPayload {
  readonly id: string;
  readonly version: bigint;
  readonly body: WhiteboardPayloadBody;
}

export type WhiteboardPayloadResult =
  | { readonly kind: 'loaded'; readonly payload: WhiteboardPayload }
  | { readonly kind: 'unavailable'; readonly id: string; readonly reason: string };

export interface WhiteboardMoveTarget {
  readonly id: string;
  readonly expectedGeometryVersion: bigint;
}

export interface WhiteboardMoveCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly delta: WhiteboardPoint;
  readonly targets: readonly WhiteboardMoveTarget[];
}

interface WhiteboardReceiptIdentity {
  readonly boardId: string;
  readonly commandId: string;
}

interface WhiteboardMoveApplied extends WhiteboardReceiptIdentity {
  readonly kind: 'applied';
  readonly revision: bigint;
  readonly objects: readonly WhiteboardObject[];
}

interface WhiteboardMoveConflict extends WhiteboardReceiptIdentity {
  readonly kind: 'conflict';
  readonly revision?: bigint;
  readonly objects: readonly WhiteboardObject[];
  readonly missingIds: readonly string[];
  readonly reason: string;
}

interface WhiteboardMoveRejected extends WhiteboardReceiptIdentity {
  readonly kind: 'rejected';
  readonly reason: string;
}

export type WhiteboardMoveReceipt =
  | WhiteboardMoveApplied
  | WhiteboardMoveConflict
  | WhiteboardMoveRejected;

export type WhiteboardPost = (
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export interface WhiteboardService {
  getScene(boardId: string, signal?: AbortSignal): Promise<WhiteboardScene>;
  getPayloads(
    boardId: string,
    ids: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly WhiteboardPayloadResult[]>;
  moveObjects(command: WhiteboardMoveCommand, signal?: AbortSignal): Promise<WhiteboardMoveReceipt>;
  getReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<WhiteboardMoveReceipt | undefined>;
}
