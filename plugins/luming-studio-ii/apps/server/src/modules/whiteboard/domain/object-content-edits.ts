import type { JsonObject, JsonValue } from './model.js';

interface ContentTarget {
  readonly objectId: string;
  readonly expectedPayloadVersion: bigint;
}

interface ContentReplacement extends ContentTarget {
  readonly kind: 'document';
  readonly data: JsonObject;
}

interface TextReplacement extends ContentTarget {
  readonly kind: 'text';
  readonly data: JsonObject;
  readonly deleteEmpty?: boolean;
}

interface TodoContentOperation extends ContentTarget {
  readonly kind: 'todo';
  readonly edits: readonly TodoContentEdit[];
}

interface TableContentOperation extends ContentTarget {
  readonly kind: 'table';
  readonly data: JsonObject;
  readonly widthChange?: TableWidthEdit;
}

interface EmbedSourceOperation extends ContentTarget {
  readonly kind: 'embedSource';
  readonly title: string;
  readonly html: string;
  readonly expectedSourceRevision: bigint;
}

interface EmbedStateOperation extends ContentTarget {
  readonly kind: 'embedState';
  readonly state: JsonValue;
}

interface StickerContentOperation extends ContentTarget {
  readonly kind: 'sticker';
  readonly selection:
    | { readonly kind: 'icon'; readonly id: string }
    | { readonly kind: 'legacy'; readonly fallback: string };
}

interface ImageCropOperation extends ContentTarget {
  readonly kind: 'crop';
  readonly crop: ImageCropEdit;
  readonly naturalSize: ImageNaturalSize;
}

interface LinkContentOperation extends ContentTarget {
  readonly kind: 'link';
  readonly title: string;
  readonly href: string;
}

export type ContentOperation =
  | ContentReplacement
  | TextReplacement
  | TodoContentOperation
  | TableContentOperation
  | EmbedSourceOperation
  | EmbedStateOperation
  | StickerContentOperation
  | ImageCropOperation
  | LinkContentOperation;

export interface TableWidthEdit {
  readonly expectedWidth: number;
  readonly width: number;
}

interface ImageCropEdit {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

interface ImageNaturalSize {
  readonly width: number;
  readonly height: number;
}

export type TodoContentPlacement =
  | { readonly kind: 'first' }
  | { readonly kind: 'append' }
  | { readonly kind: 'after'; readonly itemId: string };

export interface TodoContentSource {
  readonly boardId?: string;
  readonly objectId: string;
  readonly blockId?: string;
  readonly itemId?: string;
  readonly version?: string;
}

export interface TodoContentItem {
  readonly itemId: string;
  readonly text: string;
  readonly checked: boolean;
  readonly sourceRef?: TodoContentSource;
}

export type TodoContentEdit =
  | { readonly kind: 'rename'; readonly title: string }
  | {
      readonly kind: 'insert';
      readonly item: TodoContentItem;
      readonly placement: TodoContentPlacement;
    }
  | {
      readonly kind: 'update';
      readonly itemId: string;
      readonly text?: string;
      readonly checked?: boolean;
      readonly sourceRef?: TodoContentSource | null;
    }
  | { readonly kind: 'delete'; readonly itemId: string }
  | {
      readonly kind: 'move';
      readonly itemId: string;
      readonly placement: TodoContentPlacement;
    };

export type ContentEditRejection =
  | 'invalidEdit'
  | 'tooLarge'
  | 'versionUnavailable'
  | 'inlineHtmlResource';

export type ContentPayloadPlan =
  | {
      readonly kind: 'updated';
      readonly label: string;
      readonly data: JsonObject;
      readonly geometryWidth?: number;
      readonly geometryHeight?: number;
      readonly requiresGeometryUnlock?: boolean;
    }
  | { readonly kind: 'rejected'; readonly reason: ContentEditRejection };

export type ContentPayloadDecision = ContentPayloadPlan | { readonly kind: 'conflict' };

export const contentTitleLimit = 200;
export const contentIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const maximumContentBytes = 1024 * 1024;
const encoder = new TextEncoder();

export function contentRecord(value: JsonValue | undefined): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function contentFits(data: JsonObject): boolean {
  const json = JSON.stringify(data);

  return (
    json.length <= maximumContentBytes && encoder.encode(json).byteLength <= maximumContentBytes
  );
}
