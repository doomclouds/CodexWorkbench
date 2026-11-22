import { isBoardElementProjection, studioArtifactSchema } from '../../../contracts/board-shape.js';
import {
  STUDIO_TOOLS,
  type Board,
  type BoardElement,
  type StudioClient,
  type UnitSaveReceipt,
} from '../../../contracts/studio.js';
import { isRecord } from '../../../shared/is-record.js';
import { jsonEqual } from '../../../shared/safe-merge.js';
import { canvasDraftReceiptRequest } from './canvas/sync/canvas-drafts.js';
import type { ContentReceipt } from './canvas/sync/content-queue.js';
import { applyWhiteboardRemoteEvent } from './unit-projection.js';

const receiptFormat = 'units-v1';
const scopedOperations = new Set(['update', 'document', 'todo']);

function unresolvedReceipt(cause?: unknown) {
  return Object.assign(
    new Error('无法核对该次保存的准确版本，请保留草稿并核对原回执。', { cause }),
    {
      code: 'COMMIT_RESULT_UNKNOWN',
    },
  );
}

function couldLoseReceipt(error: unknown) {
  if (!isRecord(error)) {
    return false;
  }

  const { code, status, name, message } = error;
  const invalidResult =
    code === 'INVALID_RESPONSE' && (status === undefined || Number(status) < 400);
  const drop =
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT' ||
    name === 'TimeoutError' ||
    name === 'AbortError';
  const failedFetch =
    typeof message === 'string' &&
    /^(Failed to fetch|Load failed|fetch failed|NetworkError when attempting to fetch resource\.)$/i.test(
      message,
    );

  return invalidResult || drop || failedFetch;
}

function optedIn(args: Record<string, unknown>) {
  const { operations } = args;
  return (
    Array.isArray(operations) &&
    operations.length > 0 &&
    operations.every(
      (operation) => isRecord(operation) && scopedOperations.has(String(operation.op)),
    )
  );
}

function verifyUnitReceipt(raw: Record<string, unknown>, request: Record<string, unknown>) {
  const { artifact, baseRevision, historyEntry, operationId, units } = raw;
  const parsed = studioArtifactSchema.safeParse(artifact);

  const validBase =
    typeof baseRevision === 'number' && Number.isSafeInteger(baseRevision) && baseRevision >= 0;
  const matchingOperation = typeof operationId === 'string' && operationId === request.operationId;
  if (!parsed.success || !validBase || !matchingOperation) {
    throw unresolvedReceipt();
  }

  const { id, revision } = parsed.data;
  if (id !== request.artifactId || revision !== baseRevision + 1) {
    throw unresolvedReceipt();
  }

  const validHistory =
    isRecord(historyEntry) && typeof historyEntry.id === 'string' && historyEntry.id.length > 0;

  if (!validHistory || historyEntry.revision !== revision || !Array.isArray(units)) {
    throw unresolvedReceipt();
  }

  return raw as unknown as UnitSaveReceipt;
}

function changedElements(receipt: UnitSaveReceipt) {
  const ids = receipt.historyEntry.changedIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return;
  }

  const elements = new Map<string, BoardElement>();
  for (const raw of receipt.units) {
    if (!isRecord(raw) || !isBoardElementProjection(raw.after)) {
      return;
    }

    const { id, after } = raw;
    if (typeof id !== 'string' || id.startsWith('$') || after.id !== id) {
      return;
    }
    if ('patch' in raw || elements.has(id) || after.version < 1) {
      return;
    }

    elements.set(id, after);
  }

  const unique = new Set(ids);
  if (unique.size !== ids.length || unique.size !== elements.size) {
    return;
  }

  return ids.every((id) => elements.has(id)) ? elements : undefined;
}

function receiptBoard(current: Board, receipt: UnitSaveReceipt): Board | undefined {
  const { artifact, baseRevision } = receipt;
  if (current.artifact.id !== artifact.id) {
    return;
  }

  const changes = changedElements(receipt);
  if (!changes) {
    return;
  }

  const before = new Map(current.elements.map((element) => [element.id, element]));
  if (current.artifact.revision === artifact.revision) {
    const sameElements = [...changes].every(([id, element]) => jsonEqual(before.get(id), element));

    return sameElements && jsonEqual(current.artifact, artifact) ? current : undefined;
  }
  if (current.artifact.revision !== baseRevision) {
    return;
  }

  const sameSlots = [...changes].every(([id, element]) => {
    const previous = before.get(id);
    return previous && previous.version < element.version;
  });

  if (!sameSlots) {
    return;
  }
  if (!changes.size) {
    return { ...current, artifact };
  }

  return applyWhiteboardRemoteEvent(current, {
    type: 'board',
    artifactId: artifact.id,
    revision: artifact.revision,
    artifact,
    units: receipt.units,
  });
}

function legacyReceipt(value: unknown, artifactId: unknown): ContentReceipt {
  if (!isRecord(value) || !isRecord(value.board)) {
    throw unresolvedReceipt();
  }

  const { board } = value;
  if (!isRecord(board.artifact) || board.artifact.id !== artifactId) {
    throw unresolvedReceipt();
  }
  if (!Array.isArray(board.elements) || board.elements.some((element) => !isRecord(element))) {
    throw unresolvedReceipt();
  }

  return value as unknown as ContentReceipt;
}

async function resolveReceipt(
  client: StudioClient,
  getBoard: () => Board,
  request: Record<string, unknown>,
  raw: unknown,
): Promise<ContentReceipt> {
  if (!isRecord(raw) || raw.receiptFormat !== receiptFormat) {
    return legacyReceipt(raw, request.artifactId);
  }

  const receipt = verifyUnitReceipt(raw, request);
  const local = receiptBoard(getBoard(), receipt);
  if (local) {
    return { board: local, historyEntry: receipt.historyEntry };
  }

  try {
    const { board } = await client.call(STUDIO_TOOLS.read, {
      mode: 'version',
      artifactId: receipt.artifact.id,
      versionId: receipt.historyEntry.id,
    });

    if (
      board.artifact.id !== receipt.artifact.id ||
      board.artifact.revision !== receipt.artifact.revision
    ) {
      throw new Error('作品服务返回的版本与原保存回执不匹配。');
    }

    return { board, historyEntry: receipt.historyEntry };
  } catch (error) {
    throw unresolvedReceipt(error);
  }
}

export async function sendCanvasSave(
  client: StudioClient,
  getBoard: () => Board,
  args: Record<string, unknown>,
) {
  let result: unknown;
  try {
    result = await client.call(STUDIO_TOOLS.apply, { ...args, receiptFormat });
  } catch (error) {
    if (optedIn(args) && couldLoseReceipt(error)) {
      throw unresolvedReceipt(error);
    }

    throw error;
  }

  return resolveReceipt(client, getBoard, args, result);
}

export async function verifyCanvasSave(
  client: StudioClient,
  getBoard: () => Board,
  args: Record<string, unknown>,
) {
  const request = { ...canvasDraftReceiptRequest(args), receiptFormat };
  const result: unknown = await client.call(STUDIO_TOOLS.read, request);

  return resolveReceipt(client, getBoard, request, result);
}
