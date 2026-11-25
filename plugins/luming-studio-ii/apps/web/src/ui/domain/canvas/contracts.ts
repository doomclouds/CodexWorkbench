import type { ComponentType, ReactNode, Ref } from 'react';

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasRect extends CanvasPoint {
  readonly width: number;
  readonly height: number;
}

export interface CanvasGeometry extends CanvasRect {
  readonly rotation: number;
}

export interface CanvasViewport extends CanvasPoint {
  readonly zoom: number;
}

export interface CanvasViewportRequest {
  readonly requestId: string;
  readonly viewport: CanvasViewport;
}

export interface CanvasObjectActivation {
  readonly id: string;
  readonly point: CanvasPoint;
}

export type CanvasShape =
  | 'rounded'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'pill'
  | 'hexagon'
  | 'parallelogram'
  | 'database'
  | 'queue'
  | 'document'
  | 'cloud'
  | 'person';

export type CanvasContentKind =
  | 'native'
  | 'html'
  | 'document'
  | 'todo'
  | 'table'
  | 'image'
  | 'video'
  | 'link'
  | 'diagram'
  | 'chart';

export type CanvasCustomObjectKind = `${string}:${string}`;

export type CanvasPort = 'top' | 'bottom' | 'left' | 'right';
export type CanvasConnectorHead = 'none' | 'arrow' | 'circle';

export interface CanvasConnectionEndpoint {
  readonly point: CanvasPoint;
  readonly attachment?: { readonly objectId: string; readonly port?: CanvasPort };
}

export interface CanvasRelativeBends {
  readonly firstAxis: 'horizontal' | 'vertical';
  readonly offsets: readonly number[];
}

export interface CanvasConnection {
  readonly start: CanvasConnectionEndpoint;
  readonly end: CanvasConnectionEndpoint;
  readonly bends?: readonly CanvasPoint[];
  readonly relativeBends?: CanvasRelativeBends;
  readonly labelOffset?: CanvasPoint;
  readonly startHead?: CanvasConnectorHead;
  readonly endHead?: CanvasConnectorHead;
}

export interface CanvasInk {
  readonly points: readonly CanvasPoint[];
  readonly width: number;
}

export interface CanvasPenStyle {
  readonly width?: number;
  readonly stroke?: string;
}

interface CanvasObjectAppearance {
  readonly label: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dashed?: boolean;
  readonly hollow?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

type CanvasBox =
  | { readonly kind: 'shape'; readonly shape?: CanvasShape }
  | { readonly kind: 'section'; readonly transparent?: boolean }
  | { readonly kind: CanvasContentKind | CanvasCustomObjectKind | 'text' | 'note' | 'sticker' };

export type CanvasObjectDraft = CanvasObjectAppearance & { readonly geometry: CanvasGeometry } & (
    | CanvasBox
    | { readonly kind: 'ink'; readonly ink: CanvasInk }
    | { readonly kind: 'connector'; readonly connection: CanvasConnection }
  );

export type CanvasObjectKind = CanvasObjectDraft['kind'];

export type CanvasObject = CanvasObjectDraft & {
  readonly id: string;
  readonly version: number;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly locked?: boolean;
};

export interface CanvasObjectCapabilities {
  readonly move: boolean;
  readonly resize: boolean;
  readonly rotate: boolean;
  readonly connect: boolean;
  readonly content: 'passive' | 'native' | 'embedded';
}

export interface CanvasObjectGeometryContext {
  readonly object: CanvasObjectDraft;
  readonly geometry: CanvasGeometry;
}

export interface CanvasObjectHitContext extends CanvasObjectGeometryContext {
  readonly point: CanvasPoint;
  readonly zoom: number;
}

export interface CanvasObjectPayload {
  readonly version: number;
  readonly value: unknown;
}

export interface CanvasObjectOperation {
  readonly name: string;
  readonly expectedVersion: number;
  readonly value: unknown;
}

export interface CanvasObjectIntent extends CanvasObjectOperation {
  readonly objectId: string;
  readonly kind: CanvasObjectKind;
}

export type CanvasObjectReceipt =
  | { readonly ok: true; readonly payload: CanvasObjectPayload }
  | { readonly ok: false; readonly message: string; readonly current?: CanvasObjectPayload };

export type CanvasObjectNavigation =
  | { readonly kind: 'space'; readonly held: boolean }
  | {
      readonly kind: 'pan';
      readonly phase: 'start' | 'move' | 'end' | 'cancel';
      readonly pointerId: number;
      readonly screenX: number;
      readonly screenY: number;
    }
  | {
      readonly kind: 'zoom';
      readonly x: number;
      readonly y: number;
      readonly deltaY: number;
      readonly deltaMode: number;
    };

export interface CanvasObjectViewProps extends CanvasObjectGeometryContext {
  readonly id?: string;
  readonly payload?: CanvasObjectPayload;
  readonly content?: ReactNode;
  readonly zoom: number;
  readonly selected: boolean;
  readonly interactive: boolean;
  readonly readOnly: boolean;
  readonly locked?: boolean;
  readonly editRequest?: number;
  readonly request: (operation: CanvasObjectOperation) => Promise<CanvasObjectReceipt>;
  readonly onNavigation?: (event: CanvasObjectNavigation) => void;
  readonly onRetentionChange?: (retain: boolean) => void;
}

export interface CanvasObjectExtension {
  readonly kind: CanvasObjectKind;
  readonly capabilities: CanvasObjectCapabilities;
  readonly placement?: CanvasPlacement;
  readonly portClick?: 'place' | 'connect';
  readonly blocksPlacement?: boolean;
  readonly bounds?: (context: CanvasObjectGeometryContext) => CanvasRect;
  readonly hitTest?: (context: CanvasObjectHitContext) => boolean;
  readonly View?: ComponentType<CanvasObjectViewProps>;
}

export interface CanvasObjectRegistry {
  get(kind: CanvasObjectKind): CanvasObjectExtension | undefined;
}

export type CanvasPlacement = CanvasObjectAppearance &
  CanvasBox & {
    readonly width: number;
    readonly height: number;
  };

export interface CanvasPlacementTool {
  readonly kind: 'place';
  readonly requestId: string;
  readonly object: CanvasPlacement;
}

export interface CanvasScene {
  readonly boardId: string;
  readonly revision: number;
  readonly objects: readonly CanvasObject[];
}

export interface CanvasObjectChange {
  readonly id: string;
  readonly expectedVersion: number;
  readonly geometry: CanvasGeometry;
  readonly connection?: CanvasConnection;
  readonly ink?: CanvasInk;
}

export interface CanvasCreateIntent {
  readonly kind: 'create';
  readonly interactionId: string;
  readonly object: CanvasObjectDraft;
  readonly link?: CanvasCreateLink;
}

export interface CanvasCreateLink {
  readonly source: {
    readonly objectId: string;
    readonly port: CanvasPort;
    readonly expectedVersion: number;
    readonly point: CanvasPoint;
  };
  readonly target: { readonly port: CanvasPort; readonly point: CanvasPoint };
}

export interface CanvasDuplicateIntent {
  readonly kind: 'duplicate';
  readonly interactionId: string;
  readonly delta: CanvasPoint;
  readonly sources: readonly CanvasObjectChange[];
}

interface CanvasEdit {
  readonly interactionId: string;
  readonly changes: readonly CanvasObjectChange[];
}

export interface CanvasMoveIntent extends CanvasEdit {
  readonly kind: 'move';
  readonly delta: CanvasPoint;
}

export interface CanvasTransformIntent extends CanvasEdit {
  readonly kind: 'resize' | 'rotate';
}

export interface CanvasConnectIntent extends CanvasEdit {
  readonly kind: 'connect';
}

export type CanvasEditIntent =
  | CanvasMoveIntent
  | CanvasTransformIntent
  | CanvasConnectIntent
  | CanvasCreateIntent
  | CanvasDuplicateIntent;

export type CanvasTool = 'select' | 'pan' | 'pen' | 'connector' | CanvasPlacementTool;

export interface CanvasHandle {
  focus(): void;
  fitToObjects(ids: readonly string[]): void;
}

export interface CanvasProps {
  readonly viewId: string;
  readonly label: string;
  readonly scene: CanvasScene;
  readonly selection: readonly string[];
  readonly tool: CanvasTool;
  readonly penStyle?: CanvasPenStyle;
  readonly canEdit: boolean;
  readonly initialViewport?: CanvasViewport;
  readonly viewportRequest?: CanvasViewportRequest;
  readonly pendingEdits?: readonly CanvasEditIntent[];
  readonly objectExtensions?: readonly CanvasObjectExtension[];
  readonly payloadById?: ReadonlyMap<string, CanvasObjectPayload>;
  readonly contentById?: ReadonlyMap<string, ReactNode>;
  readonly onSelectionChange: (selection: readonly string[]) => void;
  readonly onObjectActivate?: (activation: CanvasObjectActivation) => void;
  readonly onObjectIntent?: (
    intent: CanvasObjectIntent,
  ) => CanvasObjectReceipt | Promise<CanvasObjectReceipt>;
  readonly onToolChange?: (tool: CanvasTool) => void;
  readonly onEditIntent: (intent: CanvasEditIntent) => void;
  readonly onViewportChange?: (viewport: CanvasViewport) => void;
  readonly onVisibleObjectsChange?: (ids: readonly string[]) => void;
  readonly ref?: Ref<CanvasHandle>;
}
