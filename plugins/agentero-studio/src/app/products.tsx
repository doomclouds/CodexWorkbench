import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Actor, Anchor, Artifact, Feedback, Presence, StudioClient } from '../contracts/studio';
import { whiteboardProduct } from './products/whiteboard';

/** The shell owns metadata; a product owns every other part of its document. */
export interface StudioDocument { artifact: Artifact }
export interface ProductAnnotation { anchor: Anchor; versions?: Record<string, number>; label: string; sourceLabel?: string; screenPoint?: { x: number; y: number } }
export interface Viewport { x: number; y: number; zoom: number }
export interface ProductActivity { editingIds: string[]; movingIds: string[]; dirty: boolean; issues?: { type: string; message: string; ids: string[] }[] }
export interface ProductEditorProps<Document = StudioDocument> {
  document: Document; client: StudioClient; actor: Actor; readOnly?: boolean;
  onChanged: (document: Document) => void; onAnnotate: (annotation: ProductAnnotation) => void;
  onError?: (error: unknown) => void; onNotice?: (message: string) => void;
  onSelectionChange: (ids: string[]) => void; onViewportChange: (viewport: Viewport) => void;
  onCursorMove: (point: { x: number; y: number }) => void;
  onActivityChange?: (state: ProductActivity) => void; activities?: Feedback[];
  presence: Presence[]; selfPeerId: string; externalViewport?: Viewport; externalSelectedIds?: string[];
  annotationActive?: boolean; onAnnotationModeChange?: (active: boolean) => void;
  onFeedbackSelect?: (feedback: Feedback, screenPoint: { x: number; y: number }) => void;
  onOpenHtml?: (regionId: string) => void; documentControls?: ReactNode;
}
export interface ProductToolbarProps<Document = StudioDocument> {
  document: Document; client: StudioClient; actor: Actor; selectedIds: string[]; disabled: boolean;
  onChanged: (document: Document) => void; onError: (error: unknown) => void; onNotice: (message: string) => void;
  onActivityChange?: (state: ProductActivity) => void;
}
export interface ProductPreviewProps<Document = StudioDocument> { artifact: Artifact; cached?: Document; client: StudioClient }
export interface ProductDifferenceProps<Document = StudioDocument> { current: Document; previous: Document; diff: Record<string, unknown> | null }
export interface ProductDescriptor<Document = StudioDocument> {
  id: string; label: string; defaultTitle: string; Icon: LucideIcon;
  Editor: ComponentType<ProductEditorProps<Document>>;
  Toolbar?: ComponentType<ProductToolbarProps<Document>>;
  Preview: ComponentType<ProductPreviewProps<Document>>;
  Difference?: ComponentType<ProductDifferenceProps<Document>>;
  selectionContext: (document: Document, selectedIds: string[]) => ProductAnnotation;
  locateAnchor?: (document: Document, anchor: Anchor) => { ids: string[]; bounds: { x: number; y: number; w: number; h: number } } | undefined;
  exportFormats: readonly { format: 'png' | 'svg' | 'html' | 'json'; label: string }[];
  exportDocument: (document: Document, format: 'png' | 'svg' | 'html' | 'json', client: StudioClient) => Promise<void>;
}

export const products: readonly ProductDescriptor[] = [whiteboardProduct];
export function getProduct(type: string): ProductDescriptor | undefined { return products.find(product => product.id === type); }
