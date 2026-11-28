export type EmbedKind = 'html' | 'diagram' | 'chart';

export type EmbedJson =
  | null
  | boolean
  | number
  | string
  | EmbedJson[]
  | { [key: string]: EmbedJson };

export interface EmbedPoint {
  readonly x: number;
  readonly y: number;
}

export interface EmbedObjectValue {
  readonly id: string;
  readonly version: number;
  readonly sourceRevision?: number;
  readonly title?: string;
  readonly html?: string;
  readonly state?: EmbedJson;
}

export interface EmbedStateVersion {
  readonly state: EmbedJson;
  readonly version: number;
}

export interface EmbedSourceDraft {
  readonly title: string;
  readonly html: string;
}

export interface EmbedSelection {
  readonly regionId: string;
  readonly sourceRevision: number;
  readonly targetIds: readonly string[];
  readonly quote: string;
  readonly excerpt: string;
  readonly selector?: string;
  readonly rect?: EmbedPoint & { readonly w: number; readonly h: number };
  readonly screenPoint?: EmbedPoint;
}

interface EmbedAnnotationLocations {
  readonly nodeIds: readonly string[];
  readonly reveal?: { readonly nodeId: string; readonly sequence: number };
  readonly onChange: (points: ReadonlyMap<string, EmbedPoint | null>) => void;
}

export type EmbedNavigationEvent =
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

export interface EmbedObjectProps {
  readonly kind: EmbedKind;
  readonly value: EmbedObjectValue;
  readonly committedState?: EmbedStateVersion;
  readonly annotation?: boolean;
  readonly interactive: boolean;
  readonly editRequest?: number;
  readonly useCanvasTools?: boolean;
  readonly readHtmlSource?: (file: File) => Promise<string>;
  readonly zoom?: number;
  readonly preserveScroll?: boolean;
  readonly initialScroll?: EmbedPoint;
  readonly panMode?: boolean;
  readonly onReadingScroll?: (point: EmbedPoint) => void;
  readonly onSelection?: (selection: EmbedSelection) => void;
  readonly annotationLocations?: EmbedAnnotationLocations;
  readonly onToolShortcut?: (key: string) => void;
  readonly onEscape?: () => void;
  readonly onPointerPosition?: (point: EmbedPoint | null) => void;
  readonly onNavigation?: (event: EmbedNavigationEvent) => void;
  readonly onRetentionChange?: (retain: boolean) => void;
  readonly onSourceEditingChange?: (editing: boolean) => void;
  readonly onSaveState?: (state: EmbedJson, expectedVersion: number) => Promise<EmbedStateVersion>;
  readonly onAdoptSharedState?: () => void;
  readonly onSaveSource?: (
    draft: EmbedSourceDraft,
    expectedSourceRevision: number,
  ) => Promise<void>;
}

export interface EmbedRuntimeOptions {
  readonly channel: string;
  readonly regionId: string;
  readonly sourceRevision: number;
  readonly annotation: boolean;
  preserveScroll?: boolean;
  readonly state?: EmbedJson;
  readonly elementVersion?: number;
  writable?: boolean;
  readonly panMode?: boolean;
}
