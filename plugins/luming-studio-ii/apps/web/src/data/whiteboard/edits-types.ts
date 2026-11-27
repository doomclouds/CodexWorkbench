import type {
  WhiteboardConnection,
  WhiteboardConnectorHead,
  WhiteboardGeometry,
  WhiteboardMoveTarget,
  WhiteboardObject,
  WhiteboardPayloadResult,
  WhiteboardPoint,
  WhiteboardPort,
} from './contracts.js';

export type WhiteboardJson =
  | null
  | boolean
  | number
  | string
  | readonly WhiteboardJson[]
  | { readonly [key: string]: WhiteboardJson };

export interface WhiteboardDocumentBlock {
  readonly id: string;
  readonly type: string;
  readonly props: Readonly<Record<string, WhiteboardJson>>;
  readonly content?: WhiteboardJson;
  readonly children?: readonly WhiteboardDocumentBlock[];
}

interface WhiteboardDocument {
  readonly schemaVersion: number;
  readonly blocks: readonly WhiteboardDocumentBlock[];
}

export interface WhiteboardDocumentContent {
  readonly title: string;
  readonly ['document']: WhiteboardDocument;
}

export interface WhiteboardTextContent {
  readonly text: string;
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly align?: 'left' | 'center' | 'right';
}

export interface WhiteboardTodoSource {
  readonly artifactId?: string;
  readonly elementId: string;
  readonly blockId?: string;
  readonly itemId?: string;
  readonly version?: number | bigint;
}

export interface WhiteboardTodoItem {
  readonly id: string;
  readonly text: string;
  readonly checked: boolean;
  readonly sourceRef?: WhiteboardTodoSource;
}

interface WhiteboardTodoItemChanges {
  readonly text?: string;
  readonly checked?: boolean;
  readonly sourceRef?: WhiteboardTodoSource | null;
}

export type WhiteboardTodoChange =
  | { readonly op: 'rename'; readonly title: string }
  | { readonly op: 'insert'; readonly item: WhiteboardTodoItem; readonly afterId?: string | null }
  | { readonly op: 'update'; readonly id: string; readonly changes: WhiteboardTodoItemChanges }
  | { readonly op: 'delete'; readonly id: string }
  | { readonly op: 'move'; readonly id: string; readonly afterId: string | null };

interface WhiteboardTodoContent {
  readonly title: string;
  readonly items: readonly WhiteboardTodoItem[];
}

interface WhiteboardStickerContent {
  readonly id?: string;
  readonly fallback?: string;
}

export interface WhiteboardLinkContent {
  readonly title: string;
  readonly href: string;
}

export type WhiteboardInitialPayload =
  | { readonly kind: 'text'; readonly value: WhiteboardTextContent }
  | { readonly kind: 'document'; readonly value: WhiteboardDocumentContent }
  | { readonly kind: 'todo'; readonly value: WhiteboardTodoContent }
  | { readonly kind: 'sticker'; readonly value: WhiteboardStickerContent }
  | { readonly kind: 'link'; readonly value: Pick<WhiteboardLinkContent, 'href'> }
  | { readonly kind: 'embed'; readonly value: { readonly title: string; readonly html: string } }
  | { readonly kind: 'ink'; readonly points: readonly WhiteboardPoint[] };

export type WhiteboardObjectDraft = Omit<
  WhiteboardObject,
  'geometryVersion' | 'payloadVersion' | 'locked'
> & { readonly locked?: boolean };

export type WhiteboardTransformKind = 'resize' | 'rotate' | 'connect';
export type WhiteboardLayerDirection = 'forward' | 'backward' | 'front' | 'back';
export type WhiteboardArrangePreset =
  | 'tidy'
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom';

export interface WhiteboardStyleTarget {
  readonly target: WhiteboardMoveTarget;
  readonly expectedPayloadVersion?: bigint;
}

export interface WhiteboardStylePatch {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dashed?: boolean;
  readonly hollow?: boolean;
  readonly textColor?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly textAlign?: WhiteboardTextContent['align'];
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly shapeForm?: string;
  readonly startHead?: WhiteboardConnectorHead;
  readonly endHead?: WhiteboardConnectorHead;
}

export interface WhiteboardPasteTarget {
  readonly sourceObjectId: string;
  readonly newObjectId: string;
}

interface WhiteboardTransformTarget {
  readonly target: WhiteboardMoveTarget;
  readonly geometry: WhiteboardGeometry;
  readonly connection?: WhiteboardConnection;
  readonly ink?: readonly WhiteboardPoint[];
}

interface WhiteboardDuplicateTarget {
  readonly source: WhiteboardMoveTarget;
  readonly newObjectId: string;
}

interface WhiteboardCreationAttachment {
  readonly source: WhiteboardMoveTarget;
  readonly sourcePort: WhiteboardPort;
  readonly targetPort: WhiteboardPort;
  readonly connectorId: string;
}

export type EditBoardGeometryOperation =
  | {
      readonly kind: 'create';
      readonly object: WhiteboardObjectDraft;
      readonly initialPayload?: WhiteboardInitialPayload;
      readonly attachment?: WhiteboardCreationAttachment;
    }
  | {
      readonly kind: 'transform';
      readonly transform: WhiteboardTransformKind;
      readonly objects: readonly WhiteboardTransformTarget[];
    }
  | {
      readonly kind: 'changeLock';
      readonly targets: readonly WhiteboardMoveTarget[];
      readonly locked: boolean;
    }
  | { readonly kind: 'delete'; readonly targets: readonly WhiteboardMoveTarget[] }
  | {
      readonly kind: 'reorder';
      readonly targets: readonly WhiteboardMoveTarget[];
      readonly direction: WhiteboardLayerDirection;
      readonly expectedBoardRevision: bigint;
    }
  | {
      readonly kind: 'duplicate';
      readonly targets: readonly WhiteboardDuplicateTarget[];
      readonly delta: WhiteboardPoint;
    }
  | {
      readonly kind: 'group';
      readonly targets: readonly WhiteboardMoveTarget[];
      readonly groupId: string;
    }
  | { readonly kind: 'ungroup'; readonly targets: readonly WhiteboardMoveTarget[] }
  | {
      readonly kind: 'createSection';
      readonly targets: readonly WhiteboardMoveTarget[];
      readonly sectionId: string;
      readonly title?: string;
    }
  | {
      readonly kind: 'arrange';
      readonly targets: readonly WhiteboardMoveTarget[];
      readonly preset: WhiteboardArrangePreset;
    }
  | {
      readonly kind: 'style';
      readonly targets: readonly WhiteboardStyleTarget[];
      readonly patch: WhiteboardStylePatch;
    }
  | {
      readonly kind: 'paste';
      readonly sourceBoardId: string;
      readonly sourceRevision: bigint;
      readonly targets: readonly WhiteboardPasteTarget[];
      readonly delta: WhiteboardPoint;
    };

interface BoardEditIdentity {
  readonly boardId: string;
  readonly commandId: string;
}

export interface EditBoardGeometryCommand extends BoardEditIdentity {
  readonly operation: EditBoardGeometryOperation;
}

export type WhiteboardTableCell = string | number | boolean | null;

export interface WhiteboardTableContent {
  readonly text?: string;
  readonly rows: readonly (readonly WhiteboardTableCell[])[];
  readonly rowIds: readonly string[];
  readonly columnIds: readonly string[];
  readonly columnWidths?: readonly number[];
  readonly head?: boolean;
}

interface WhiteboardTableWidthChange {
  readonly expectedWidth: number;
  readonly width: number;
}

interface WhiteboardEmbedSourceEdit {
  readonly title: string;
  readonly html: string;
  readonly expectedSourceRevision: bigint;
}

type WhiteboardStickerSelection =
  | { readonly id: string; readonly fallback?: never }
  | { readonly id?: never; readonly fallback: string };

interface WhiteboardImageCrop extends WhiteboardPoint {
  readonly zoom: number;
}

interface WhiteboardImageSize {
  readonly width: number;
  readonly height: number;
}

interface WhiteboardImageCropEdit {
  readonly crop: WhiteboardImageCrop;
  readonly naturalSize?: WhiteboardImageSize;
}

export type EditObjectContentOperation =
  | { readonly kind: 'document'; readonly value: WhiteboardDocumentContent }
  | { readonly kind: 'todo'; readonly value: readonly WhiteboardTodoChange[] }
  | { readonly kind: 'text'; readonly value: WhiteboardTextContent; readonly deleteEmpty?: boolean }
  | {
      readonly kind: 'table';
      readonly value: WhiteboardTableContent;
      readonly widthChange?: WhiteboardTableWidthChange;
    }
  | { readonly kind: 'embedSource'; readonly value: WhiteboardEmbedSourceEdit }
  | { readonly kind: 'embedState'; readonly value: WhiteboardJson }
  | { readonly kind: 'sticker'; readonly value: WhiteboardStickerSelection }
  | { readonly kind: 'link'; readonly value: WhiteboardLinkContent }
  | { readonly kind: 'crop'; readonly value: WhiteboardImageCropEdit };

export interface EditObjectContentCommand extends BoardEditIdentity {
  readonly objectId: string;
  readonly expectedPayloadVersion: bigint;
  readonly edit: EditObjectContentOperation;
}

export interface AttachBoardImageCommand extends BoardEditIdentity {
  readonly objectId: string;
  readonly displayName: string;
  readonly geometry: WhiteboardGeometry;
  readonly content: Uint8Array;
}

export type BoardVideoType = 'video/mp4' | 'video/webm' | 'video/quicktime';

export interface AttachBoardVideoCommand extends AttachBoardImageCommand {
  readonly mediaType: BoardVideoType;
}

export interface UploadBoardDocumentImageCommand extends BoardEditIdentity {
  readonly objectId: string;
  readonly content: Uint8Array;
}

export interface UploadBoardDocumentImageResult {
  readonly receipt: BoardEditReceipt;
  readonly assetUrl?: string;
}

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
  | 'invalidVideo'
  | 'unknown';

interface BoardEditApplied extends BoardEditIdentity {
  readonly kind: 'applied';
  readonly revision: bigint;
  readonly objects: readonly WhiteboardObject[];
  readonly removedIds: readonly string[];
  readonly order: readonly string[];
  readonly payloads: readonly WhiteboardPayloadResult[];
  readonly detailsExpired?: boolean;
}

interface BoardEditConflict extends BoardEditIdentity {
  readonly kind: 'conflict';
  readonly revision?: bigint;
  readonly objects: readonly WhiteboardObject[];
  readonly payloads: readonly WhiteboardPayloadResult[];
}

interface BoardEditRejected extends BoardEditIdentity {
  readonly kind: 'rejected';
  readonly reason: BoardEditRejection;
}

export type BoardEditReceipt = BoardEditApplied | BoardEditConflict | BoardEditRejected;

export interface ReverseBoardEditCommand extends BoardEditIdentity {
  readonly source: { readonly kind: 'edit' | 'move'; readonly commandId: string };
}

export interface WhiteboardEditService {
  editGeometry(command: EditBoardGeometryCommand, signal?: AbortSignal): Promise<BoardEditReceipt>;
  editContent(command: EditObjectContentCommand, signal?: AbortSignal): Promise<BoardEditReceipt>;
  attachImage(command: AttachBoardImageCommand, signal?: AbortSignal): Promise<BoardEditReceipt>;
  attachVideo?(command: AttachBoardVideoCommand, signal?: AbortSignal): Promise<BoardEditReceipt>;
  uploadDocumentImage?(
    command: UploadBoardDocumentImageCommand,
    signal?: AbortSignal,
  ): Promise<UploadBoardDocumentImageResult>;
  reverseEdit?(command: ReverseBoardEditCommand, signal?: AbortSignal): Promise<BoardEditReceipt>;
  getReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<BoardEditReceipt | undefined>;
}
