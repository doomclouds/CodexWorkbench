import { StatusText } from '../../../base/index.js';
import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import type {
  DocumentActivity,
  DocumentBlock,
  DocumentCommit,
  DocumentCommitResult,
  DocumentDraft,
  DocumentNoteSource,
  DocumentValue,
} from './contracts.js';
import { exportDocumentFile, resolveDocumentAsset } from './document-export.js';
import { canvasDocumentPaper, defaultDocumentPaper } from './document-paper.js';
import { DocumentObject } from './DocumentObject.js';
import { documentTreeDepth, isRecord } from './model.js';

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
  const value = readDocument(payload?.value);
  if (!value) {
    return <StatusText message="暂未取得文档正文" announcement="polite" />;
  }

  const paper = canvasDocumentPaper(object.fill);
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
  }

  async function handleExport(format: 'html' | 'json', draft: DocumentDraft, signal: AbortSignal) {
    const file = await exportDocumentFile(format, draft, {
      paper,
      readAsset: readDocumentAsset,
      signal,
    });

    if (!signal.aborted) {
      downloadFile?.(file);
    }
  }

  function handleAnnotate({ blockIds, u, v }: DocumentNoteSource) {
    onAnnotateContent?.({ target: { kind: 'document', blockIds }, u, v });
  }

  function resolveImage(source: string, signal: AbortSignal) {
    return resolveDocumentAsset(source, signal, readDocumentAsset);
  }

  return (
    <DocumentObject
      value={value}
      paper={paper}
      canvas={{ width: geometry.width, height: geometry.height, zoom }}
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
  capabilities: { content: 'native', move: true, resize: true, rotate: false, connect: true },
  placement: {
    kind: 'document',
    label: '文档',
    width: 680,
    height: 560,
    fill: defaultDocumentPaper,
  },
  View: DocumentCanvasView,
} satisfies CanvasObjectExtension;
