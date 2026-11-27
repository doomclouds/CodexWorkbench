import type { ReactNode } from 'react';

export interface TodoSourceRef {
  readonly artifactId?: string;
  readonly elementId: string;
  readonly blockId?: string;
  readonly itemId?: string;
  readonly version?: number;
}

export interface TodoSourceRequest {
  readonly sequence: number;
  readonly source: TodoSourceRef;
}

export interface TodoObjectItem {
  readonly id: string;
  readonly text: string;
  readonly checked: boolean;
  readonly sourceRef?: TodoSourceRef;
}

export interface TodoObjectSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly items: readonly TodoObjectItem[];
}

export interface TodoObjectItemChanges {
  readonly text?: string;
  readonly checked?: boolean;
  readonly sourceRef?: TodoSourceRef | null;
}

export type TodoObjectChange =
  | { readonly op: 'rename'; readonly title: string }
  | { readonly op: 'insert'; readonly item: TodoObjectItem; readonly afterId?: string | null }
  | {
      readonly op: 'update';
      readonly id: string;
      readonly changes: TodoObjectItemChanges;
    }
  | { readonly op: 'delete'; readonly id: string }
  | { readonly op: 'move'; readonly id: string; readonly afterId: string | null };

export interface TodoObjectEdit {
  readonly objectId: string;
  readonly expectedRevision: number;
  readonly changes: readonly TodoObjectChange[];
}

export interface TodoPoint {
  readonly x: number;
  readonly y: number;
}

export interface TodoContentAnnotation {
  readonly target: { readonly kind: 'todo'; readonly itemId: string };
  readonly u: number;
  readonly v: number;
}

export interface TodoObjectAppearance {
  readonly paper?: string;
  readonly uiScale?: number;
}

export interface TodoObjectProps {
  readonly value: TodoObjectSnapshot;
  readonly onEdit?: (edit: TodoObjectEdit) => Promise<TodoObjectSnapshot | false>;
  readonly interactive?: boolean;
  readonly readOnly?: boolean;
  readonly expanded?: boolean;
  readonly movable?: boolean;
  readonly locked?: boolean;
  readonly focusedReading?: boolean;
  readonly overview?: boolean;
  readonly editRequest?: number;
  readonly appearance?: TodoObjectAppearance;
  readonly onRequestExpand?: () => void;
  readonly onEditingChange?: (active: boolean) => void;
  readonly onOpenSource?: (source: TodoSourceRef) => void;
  readonly sourceLabel?: (source: TodoSourceRef) => string | undefined;
  readonly sourceRequest?: TodoSourceRequest;
  readonly annotationActive?: boolean;
  readonly onAnnotateContent?: (request: TodoContentAnnotation) => void;
  readonly onAnnotateItem?: (id: string, point?: TodoPoint) => void;
  readonly renderItemAdornment?: (id: string) => ReactNode;
  readonly renderOutsideRows?: (shownIds: readonly string[]) => ReactNode;
}
