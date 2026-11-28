import { useCallback } from 'react';
import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import type {
  DocumentActivity,
  DocumentBlock,
  DocumentCommit,
  DocumentCommitResult,
  DocumentDraft,
  DocumentExportFormat,
  DocumentNoteSource,
  DocumentValue,
} from './contracts.js';
import { exportDocumentFile, resolveDocumentAsset } from './document-export.js';
import { canvasDocumentPaper, defaultDocumentPaper } from './document-paper.js';
import { DocumentContentUnavailable, DocumentObject } from './DocumentObject.js';
import { DocumentReadIcon } from './DocumentToolbar.js';
import { documentTreeDepth, isRecord } from './model.js';
import './document-object.css';

const blockTypes = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock',
  'table',
  'image',
  'divider',
]);

function validBlock(block: unknown, depth: number): block is DocumentBlock {
  if (!isRecord(block) || !isRecord(block.props) || depth === documentTreeDepth) {
    return false;
  }

  const metadata = typeof block.id === 'string' && typeof block.type === 'string';
  if (!metadata || !blockTypes.has(String(block.type))) {
    return false;
  }

  return (
    block.children === undefined ||
    (Array.isArray(block.children) && block.children.every((child) => validBlock(child, depth + 1)))
  );
}

function readDocument(value: unknown): DocumentValue | undefined {
  if (!isRecord(value) || !isRecord(value.document)) {
    return undefined;
  }

  const document = value.document;
  const validVersion = typeof value.version === 'number' && Number.isSafeInteger(value.version);
  if (typeof value.title !== 'string' || !validVersion || document.schemaVersion !== 1) {
    return undefined;
  }
  if (Array.isArray(document.blocks) && document.blocks.every((block) => validBlock(block, 0))) {
    return value as unknown as DocumentValue;
  }
}

function DocumentCanvasView({
  id,
  payload,
  interactive,
  readOnly,
  editRequest,
  focusedReading,
  locked,
  onOpenPresentation,
  onClosePresentation,
  onRetentionChange,
  onEditingChange,
  onAnnotateContent,
  annotationActive,
  nativeSourceRequest,
  downloadFile,
  readDocumentAsset,
  uploadDocumentImage,
  request,
  object,
  geometry,
  zoom,
}: CanvasObjectViewProps) {
  const resolveImage = useCallback(
    (source: string, signal: AbortSignal) =>
      resolveDocumentAsset(source, signal, readDocumentAsset),
    [readDocumentAsset],
  );

  if (id === undefined && !payload) {
    return (
      <div
        className="studio-document-placement-preview"
        style={{ fontSize: Math.max(14, 11 / zoom) }}
        aria-hidden="true"
      >
        <DocumentReadIcon />
        {object.label}
      </div>
    );
  }

  const value = readDocument(payload?.value);
  const paper = canvasDocumentPaper(object.fill);
  const canvas = { width: geometry.width, height: geometry.height, zoom };
  if (!value) {
    return (
      <DocumentContentUnavailable
        title={object.label}
        paper={paper}
        canvas={canvas}
        focusedReading={focusedReading}
      />
    );
  }

  const source = nativeSourceRequest?.source;
  const blockId = source?.elementId === id ? source?.blockId : undefined;
  const nativeBlockRequest =
    blockId && nativeSourceRequest
      ? { id: blockId, sequence: nativeSourceRequest.sequence }
      : undefined;

  async function handleCommit(draft: DocumentCommit): Promise<DocumentCommitResult> {
    const receipt = await request({
      name: 'document.commit',
      expectedVersion: draft.expectedVersion,
      value: draft,
    });

    if (!receipt.ok) {
      return { ok: false, message: receipt.message, current: readDocument(receipt.current?.value) };
    }

    const confirmed = readDocument(receipt.payload.value);

    return confirmed
      ? { ok: true, value: confirmed }
      : { ok: false, message: '文档保存回执缺少有效正文。' };
  }

  function handleActivity({ mode, dirty, saving, composing }: DocumentActivity) {
    const busy = dirty || saving || composing;
    onRetentionChange?.(busy || mode !== 'inline');
    onEditingChange?.(mode === 'edit' && !readOnly);
  }

  async function handleExport(
    format: DocumentExportFormat,
    draft: DocumentDraft,
    signal: AbortSignal,
  ) {
    const file = await exportDocumentFile(format, draft, {
      paper,
      readAsset: readDocumentAsset,
      signal,
    });

    if (!signal.aborted) {
      downloadFile?.(file);
    }
  }

  function handleAnnotate({ blockIds, quote, u, v }: DocumentNoteSource) {
    onAnnotateContent?.({ target: { kind: 'document', blockIds }, excerpt: quote, u, v });
  }

  return (
    <DocumentObject
      value={value}
      paper={paper}
      canvas={canvas}
      interactive={interactive}
      readOnly={readOnly}
      editRequest={editRequest}
      focusedReading={focusedReading}
      annotationActive={annotationActive}
      nativeBlockRequest={nativeBlockRequest}
      expandControl={{ label: '展开文档', title: '展开阅读与编辑' }}
      locked={locked}
      onOpenPresentation={onOpenPresentation}
      onClosePresentation={onClosePresentation}
      onCommit={handleCommit}
      onExport={downloadFile ? handleExport : undefined}
      onAnnotate={onAnnotateContent ? handleAnnotate : undefined}
      resolveImage={readDocumentAsset ? resolveImage : undefined}
      uploadImage={readOnly ? undefined : uploadDocumentImage}
      onActivity={handleActivity}
    />
  );
}

export const documentExtension = {
  kind: 'document',
  capabilities: {
    content: 'native',
    move: true,
    resize: true,
    rotate: false,
    connect: true,
    managesAnnotationEditing: true,
  },
  placement: {
    kind: 'document',
    label: '文档',
    width: 680,
    height: 560,
    fill: defaultDocumentPaper,
  },
  View: DocumentCanvasView,
} satisfies CanvasObjectExtension;
