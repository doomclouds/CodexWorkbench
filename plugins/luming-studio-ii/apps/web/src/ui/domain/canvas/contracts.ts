import type { ReactNode, Ref } from 'react';

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
}

type CanvasBox =
  | { readonly kind: 'shape'; readonly shape?: CanvasShape }
  | { readonly kind: 'section'; readonly transparent?: boolean }
  | { readonly kind: CanvasContentKind | 'text' | 'note' | 'sticker' };

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
  readonly pendingEdits?: readonly CanvasEditIntent[];
  readonly contentById?: ReadonlyMap<string, ReactNode>;
  readonly onSelectionChange: (selection: readonly string[]) => void;
  readonly onToolChange?: (tool: CanvasTool) => void;
  readonly onEditIntent: (intent: CanvasEditIntent) => void;
  readonly onViewportChange?: (viewport: CanvasViewport) => void;
  readonly onVisibleObjectsChange?: (ids: readonly string[]) => void;
  readonly ref?: Ref<CanvasHandle>;
}
