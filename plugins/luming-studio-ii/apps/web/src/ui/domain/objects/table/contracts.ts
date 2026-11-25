import type { Ref } from 'react';

import type { InlineTextFormat, InlineTextFormatState } from '../text/index.js';

export type TableCellValue = string | number | boolean | null;
export type TableSourceRow = readonly TableCellValue[];

export interface TableObjectData {
  readonly [key: string]: unknown;
  readonly rows?: readonly TableSourceRow[];
  readonly rowIds?: readonly string[];
  readonly columnIds?: readonly string[];
  readonly columnWidths?: readonly number[];
  readonly head?: boolean;
}

export interface TableObjectValue {
  readonly id: string;
  readonly version: number;
  readonly width: number;
  readonly text?: string;
  readonly data?: TableObjectData;
}

export interface TableObjectDraft {
  readonly base: TableObjectValue;
  readonly value: TableObjectValue;
}

export interface TableObjectPaint {
  readonly background: string;
  readonly color: string;
}

export interface TableObjectActivity {
  readonly editing: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly resizing: boolean;
}

export interface TableObjectHandle {
  format: (format: InlineTextFormat, url?: string) => boolean;
  focus: () => void;
}

export type TableObjectDetail = 'full' | 'preview' | 'outline';

export interface TableObjectProps {
  readonly value: TableObjectValue;
  readonly selected: boolean;
  readonly canEdit: boolean;
  readonly locked?: boolean;
  readonly detail?: TableObjectDetail;
  readonly zoom?: number;
  readonly fontSize?: number;
  readonly editRequest?: number;
  readonly initialDraft?: TableObjectDraft;
  readonly bodyPaint?: TableObjectPaint;
  readonly headerPaint?: TableObjectPaint;
  readonly onSave: (draft: TableObjectDraft) => Promise<TableObjectValue | false>;
  readonly onDraftChange?: (draft: TableObjectDraft | null) => void;
  readonly onActivityChange?: (activity: TableObjectActivity) => void;
  readonly onRequestLink?: (url: string) => void;
  readonly onFormatStateChange?: (state: InlineTextFormatState) => void;
  readonly ref?: Ref<TableObjectHandle>;
}
