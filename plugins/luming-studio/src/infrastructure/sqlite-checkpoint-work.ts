import { isRecord } from '../shared/is-record.js';
import { StudioError } from '../shared/studio-error.js';

export const CHECKPOINT_WORK_KEY = 'history_checkpoint_work';

export type CheckpointWork =
  | { phase: 'copy'; revision: number; anchor: number; afterId?: string }
  | { phase: 'replay'; revision: number; anchor: number; after?: ChangePosition }
  | { phase: 'retire'; revision: number; anchor: number };

interface ChangePosition {
  revision: number;
  id: string;
}

export function corruptCheckpoint(cause?: unknown) {
  return new StudioError(
    'CORRUPT_ARTIFACT',
    '作品增量历史缺少可用的检查点或顺序信息。',
    undefined,
    {
      cause,
    },
  );
}

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function changePosition(value: unknown, anchor: number, target: number): ChangePosition {
  if (!isRecord(value) || !isRevision(value.revision) || typeof value.id !== 'string') {
    throw corruptCheckpoint();
  }
  if (value.revision <= anchor || value.revision > target) {
    throw corruptCheckpoint();
  }

  return { revision: value.revision, id: value.id };
}

export function readCheckpointWork(value: unknown): CheckpointWork {
  if (typeof value !== 'string') {
    throw corruptCheckpoint();
  }

  let record: unknown;
  try {
    record = JSON.parse(value);
  } catch (error) {
    throw corruptCheckpoint(error);
  }
  if (!isRecord(record) || !isRevision(record.revision) || !isRevision(record.anchor)) {
    throw corruptCheckpoint();
  }

  const { phase, revision, anchor } = record;
  if (phase === 'retire' && revision < anchor) {
    return { phase, revision, anchor };
  }
  if (anchor >= revision) {
    throw corruptCheckpoint();
  }
  if (phase === 'copy' && (record.afterId === undefined || typeof record.afterId === 'string')) {
    return { phase, revision, anchor, afterId: record.afterId };
  }
  if (phase === 'replay') {
    return {
      phase,
      revision,
      anchor,
      ...(record.after === undefined
        ? {}
        : { after: changePosition(record.after, anchor, revision) }),
    };
  }

  throw corruptCheckpoint();
}
