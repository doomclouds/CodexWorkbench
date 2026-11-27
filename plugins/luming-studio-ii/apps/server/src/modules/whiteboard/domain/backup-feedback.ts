import type { BoardBackupActor, BoardBackupDetails } from './export-types.js';

type BackupRow = BoardBackupDetails['feedback']['threads'][number];
type Element = Readonly<Record<string, unknown>>;
type ActorFor = (id: string, name?: string) => BoardBackupActor;

function anchor(thread: BackupRow, content?: BackupRow, elementVersion?: number) {
  const { object_id: objectId, object_u: u, object_v: v, frozen_x: x, frozen_y: y } = thread;
  const pin = { coordinateSpace: 'board', x, y };
  const validPin = Math.abs(Number(x)) <= 10_000_000 && Math.abs(Number(y)) <= 10_000_000;
  const boardPin = validPin ? pin : undefined;
  if (typeof objectId !== 'string') {
    return { coordinateSpace: 'board' as const, x, y, pin: boardPin };
  }

  const element = {
    coordinateSpace: 'element' as const,
    elementIds: [objectId],
    x: u,
    y: v,
    pin: boardPin,
  };

  if (typeof content?.unit_json !== 'string') {
    return element;
  }

  const unit = JSON.parse(content.unit_json) as Record<string, unknown>;
  const excerpt = content.frozen_excerpt ?? undefined;
  const sourceVersion = elementVersion ?? Math.max(1, Number(content.payload_version) + 1);
  if (unit.kind === 'document') {
    return {
      ...element,
      coordinateSpace: 'document' as const,
      blockIds: unit.blockIds,
      sourceVersion,
      excerpt,
    };
  }
  if (unit.kind === 'todo') {
    return {
      ...element,
      coordinateSpace: 'todo' as const,
      itemId: unit.itemId,
      sourceVersion,
      excerpt,
    };
  }
  if (unit.kind === 'html') {
    return {
      ...element,
      coordinateSpace: 'html' as const,
      regionId: objectId,
      targetIds: unit.nodeIds,
      sourceRevision: Math.max(1, Number(unit.sourceRevision)),
      excerpt,
    };
  }

  return element;
}

function frozenElement(thread: BackupRow): Element {
  const {
    object_id: id,
    object_label: text,
    object_x: x,
    object_y: y,
    object_width: w,
    object_height: h,
    object_rotation: rotation,
    object_geometry_version: version,
  } = thread;

  return { id, type: 'shape', text, x, y, w, h, rotation, version: Number(version) + 1 };
}

export function legacyBackupFeedback(
  boardId: string,
  { threads, messages, contentAnchors }: BoardBackupDetails['feedback'],
  actorFor: ActorFor,
  formatTime: (value: number) => string,
  findTarget: (revision: string, objectId: string) => Element | undefined,
) {
  const messagesByThread = new Map<string, BackupRow[]>();
  for (const message of messages) {
    const id = String(message.thread_id);
    const list = messagesByThread.get(id) ?? [];
    list.push(message);
    messagesByThread.set(id, list);
  }
  const anchors = new Map(contentAnchors.map((item) => [item.thread_id, item]));
  const sources: Record<string, readonly unknown[]> = {};
  const feedback = threads.flatMap((thread) => {
    const id = String(thread.thread_id);
    const [first, ...replies] = messagesByThread.get(id) ?? [];
    if (!first) {
      return [];
    }

    function portableMessage(message: BackupRow) {
      const authorName = typeof message.author_name === 'string' ? message.author_name : undefined;
      return {
        id: message.message_id,
        author: actorFor(String(message.author_actor_id), authorName),
        text: message.text,
        createdAt: formatTime(Number(message.created_at_millis)),
      };
    }

    const objectId = thread.object_id;
    const revision = String(thread.source_board_revision);
    const element = typeof objectId === 'string' ? findTarget(revision, objectId) : undefined;
    const elementVersion = typeof element?.version === 'number' ? element.version : undefined;
    const target = anchor(thread, anchors.get(id), elementVersion);
    if (typeof objectId === 'string') {
      const snapshot = element ?? frozenElement(thread);
      const source = {
        version: snapshot.version,
        artifactId: boardId,
        feedbackId: id,
        element: snapshot,
      };
      sources[id] = [
        target.coordinateSpace === 'html' && typeof snapshot.html === 'string'
          ? {
              ...source,
              html: snapshot.html,
              regionId: objectId,
              sourceRevision: target.sourceRevision,
            }
          : { ...source, elementId: objectId },
      ];
    }

    return [
      {
        ...portableMessage(first),
        id,
        artifactId: boardId,
        type: 'comment',
        status: thread.status,
        anchor: target,
        updatedAt: formatTime(Number(thread.updated_at_millis)),
        replies: replies.map(portableMessage),
      },
    ];
  });

  return { feedback, sources };
}
