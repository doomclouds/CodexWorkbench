import {
  FeedbackAttachmentState,
  FeedbackRejectionReason,
  FeedbackThreadStatus,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import type {
  FeedbackAnchor as WireAnchor,
  FeedbackAnchorTarget as WireTarget,
  FeedbackAttachment as WireAttachment,
  FeedbackContentPoint as WireContent,
  FeedbackFrozenObject as WireFrozenObject,
  FeedbackMessage as WireMessage,
  FeedbackPoint as WirePoint,
  FeedbackReceipt as WireReceipt,
  FeedbackSourceObject as WireSourceObject,
  FeedbackThread as WireThread,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import type {
  FeedbackAnchor,
  FeedbackContentUnit,
  FeedbackMessage,
  FeedbackPoint,
  FeedbackReceipt,
  FeedbackRejection,
  FeedbackStatus,
  FeedbackTarget,
  FeedbackThread,
  FrozenFeedbackObject,
} from './contracts.js';

const dateLimit = 8_640_000_000_000_000;
const rejections = new Map<FeedbackRejectionReason, FeedbackRejection>([
  [FeedbackRejectionReason.INVALID_TEXT, 'invalidText'],
  [FeedbackRejectionReason.INVALID_ANCHOR, 'invalidAnchor'],
  [FeedbackRejectionReason.TARGET_CHANGED, 'targetChanged'],
  [FeedbackRejectionReason.NOT_FOUND, 'notFound'],
  [FeedbackRejectionReason.FORBIDDEN, 'forbidden'],
  [FeedbackRejectionReason.VERSION_CHANGED, 'versionChanged'],
  [FeedbackRejectionReason.COMMAND_ID_REUSE, 'commandIdReuse'],
  [FeedbackRejectionReason.ATTACHMENT_CLAIMED, 'attachmentClaimed'],
]);

function dateMillis(value: bigint) {
  const millis = Number(value);
  if (!Number.isSafeInteger(millis) || millis < 0 || millis > dateLimit) {
    throw new Error('备注服务返回了无效时间。');
  }

  return millis;
}

function readPoint(value: WirePoint | undefined): FeedbackPoint {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error('备注服务未返回有效的白板坐标。');
  }

  return { x: value.x, y: value.y };
}

function validIds(ids: readonly string[]): boolean {
  return (
    ids.length > 0 && ids.every((id) => Boolean(id.trim())) && new Set(ids).size === ids.length
  );
}

function readContent(content: WireContent['content']): FeedbackContentUnit {
  if (content.case === 'document' && validIds(content.value.blockIds)) {
    return { kind: 'document', blockIds: content.value.blockIds };
  }
  if (content.case === 'todoItemId' && Boolean(content.value.trim())) {
    return { kind: 'todo', itemId: content.value };
  }

  if (content.case === 'html') {
    const { nodeIds, sourceRevision } = content.value;
    if (sourceRevision !== undefined && validIds(nodeIds)) {
      return { kind: 'html', nodeIds, sourceRevision };
    }
  }

  throw new Error('备注服务未返回有效的内容目标。');
}

function targetPoint({
  objectId,
  u,
  v,
  geometryVersion,
}:
  | WireContent
  | {
      readonly objectId: string;
      readonly u: number;
      readonly v: number;
      readonly geometryVersion?: bigint;
    }) {
  const horizontal = u >= 0 && u <= 1;
  const vertical = v >= 0 && v <= 1;
  const positioned = horizontal && vertical;
  if (!objectId || !positioned || geometryVersion === undefined) {
    throw new Error('备注服务未返回有效的对象目标。');
  }

  return { objectId, u, v, geometryVersion };
}

function readTarget({ target }: WireTarget): FeedbackTarget {
  if (target.case === 'boardPoint') {
    return { kind: 'board', point: readPoint(target.value) };
  }
  if (target.case === 'objectPoint') {
    return { kind: 'object', ...targetPoint(target.value) };
  }

  if (target.case === 'selection') {
    const { point, bounds, objects, expectedBoardRevision } = target.value;
    if (expectedBoardRevision === undefined) {
      throw new Error('备注服务缺少选区的白板版次。');
    }

    return {
      kind: 'selection',
      point: readPoint(point),
      bounds,
      objects: objects.map(readSourceObject),
      expectedBoardRevision,
    };
  }

  if (target.case === 'contentPoint') {
    const { payloadVersion, content } = target.value;
    if (payloadVersion === undefined) {
      throw new Error('备注服务缺少内容目标的正文版次。');
    }

    return {
      kind: 'content',
      ...targetPoint(target.value),
      payloadVersion,
      content: readContent(content),
    };
  }

  throw new Error('备注服务未返回有效的目标。');
}

function readSourceObject(reference: WireSourceObject | undefined) {
  if (!reference?.objectId || reference.geometryVersion === undefined) {
    throw new Error('备注服务缺少已冻结目标的标识或版次。');
  }

  return {
    objectId: reference.objectId,
    geometryVersion: reference.geometryVersion,
    payloadVersion: reference.payloadVersion,
  };
}

function readFrozenObject(value: WireFrozenObject): FrozenFeedbackObject {
  const { kind, label, x, y, width, height, rotation } = value;
  if (![x, y, width, height, rotation].every(Number.isFinite) || width < 0 || height < 0) {
    throw new Error('备注服务返回了无效的对象位置。');
  }

  return { kind, label, x, y, width, height, rotation };
}

function readAnchor(anchor: WireAnchor): FeedbackAnchor {
  if (!anchor.target) {
    throw new Error('备注服务缺少目标锚点。');
  }

  return {
    target: readTarget(anchor.target),
    sourceRevision: anchor.sourceBoardRevision,
    frozenPoint: readPoint(anchor.frozenPoint),
    frozenObject: anchor.frozenObject && readFrozenObject(anchor.frozenObject),
    frozenTargets: anchor.frozenTargets.map(({ reference, object }) => {
      if (!object) {
        throw new Error('备注服务缺少冻结对象。');
      }

      return { reference: readSourceObject(reference), object: readFrozenObject(object) };
    }),
    frozenExcerpt: anchor.frozenExcerpt,
    targetMissing: anchor.targetMissing,
  };
}

function readAttachment(value: WireAttachment | undefined): FeedbackThread['attachment'] {
  if (!value) {
    return;
  }

  const states = {
    [FeedbackAttachmentState.PENDING]: 'pending',
    [FeedbackAttachmentState.CLAIMED]: 'claimed',
    [FeedbackAttachmentState.ATTACHED]: 'attached',
  } as const;

  if (
    value.state !== FeedbackAttachmentState.PENDING &&
    value.state !== FeedbackAttachmentState.CLAIMED &&
    value.state !== FeedbackAttachmentState.ATTACHED
  ) {
    throw new Error('备注服务返回了未知的附加状态。');
  }

  return {
    requestId: value.requestId,
    state: states[value.state],
    threadVersion: value.threadVersion,
  };
}

function readStatus(status: FeedbackThreadStatus): FeedbackStatus {
  if (status === FeedbackThreadStatus.OPEN) {
    return 'open';
  }
  if (status === FeedbackThreadStatus.RESOLVED) {
    return 'resolved';
  }

  throw new Error('备注服务返回了未知的讨论状态。');
}

export function readFeedbackMessage(value: WireMessage): FeedbackMessage {
  const {
    messageId,
    authorActorId,
    authorName,
    authoredByViewer,
    text,
    createdAtMillis,
    updatedAtMillis,
    version,
    canEdit,
  } = value;

  if (!messageId || !authorActorId) {
    throw new Error('备注服务缺少消息或作者标识。');
  }

  return {
    id: messageId,
    authorId: authorActorId,
    authorName,
    authoredByViewer,
    text,
    createdAt: dateMillis(createdAtMillis),
    updatedAt: dateMillis(updatedAtMillis),
    version,
    canEdit,
  };
}

export function readFeedbackThread(value: WireThread): FeedbackThread {
  const {
    threadId,
    status,
    anchor,
    first,
    version,
    updatedAtMillis,
    replyCount,
    canResolve,
    canDelete,
    attachment,
  } = value;

  if (!threadId || !anchor || !first) {
    throw new Error('备注服务未返回完整的讨论。');
  }

  return {
    id: threadId,
    status: readStatus(status),
    anchor: readAnchor(anchor),
    first: readFeedbackMessage(first),
    version,
    updatedAt: dateMillis(updatedAtMillis),
    replyCount,
    canResolve,
    canDelete,
    attachment: readAttachment(attachment),
  };
}

export function readFeedbackReceipt(
  receipt: WireReceipt | undefined,
  boardId: string,
  commandId: string,
): FeedbackReceipt {
  if (!receipt || receipt.boardId !== boardId || receipt.commandId !== commandId) {
    throw new Error('备注回执与当前命令不一致。');
  }

  const { outcome } = receipt;
  switch (outcome.case) {
    case 'applied': {
      const { threadId, threadVersion, messageId, messageVersion, deleted } = outcome.value;
      if (!threadId) {
        throw new Error('备注回执缺少讨论标识。');
      }

      return { kind: 'applied', threadId, threadVersion, messageId, messageVersion, deleted };
    }
    case 'rejected': {
      const { reason, currentVersion } = outcome.value;
      const decoded = rejections.get(reason);
      if (!decoded) {
        throw new Error('备注服务返回了未知的拒绝原因。');
      }

      return { kind: 'rejected', reason: decoded, currentVersion };
    }
    case undefined:
      throw new Error('备注服务未返回处理结果。');
  }
}
