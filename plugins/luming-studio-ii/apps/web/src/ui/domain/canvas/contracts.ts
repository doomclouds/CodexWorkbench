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

export type CanvasObjectKind = 'shape' | 'native';

export interface CanvasObject {
  readonly id: string;
  readonly kind: CanvasObjectKind;
  readonly label: string;
  readonly geometry: CanvasGeometry;
  readonly version: number;
  readonly locked?: boolean;
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

export type CanvasEditIntent = CanvasMoveIntent | CanvasTransformIntent;

export type CanvasTool = 'select' | 'pan';

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
  readonly canEdit: boolean;
  readonly initialViewport?: CanvasViewport;
  readonly pendingEdits?: readonly CanvasEditIntent[];
  readonly contentById?: ReadonlyMap<string, ReactNode>;
  readonly onSelectionChange: (selection: readonly string[]) => void;
  readonly onEditIntent: (intent: CanvasEditIntent) => void;
  readonly onViewportChange?: (viewport: CanvasViewport) => void;
  readonly onVisibleObjectsChange?: (ids: readonly string[]) => void;
  readonly ref?: Ref<CanvasHandle>;
}
