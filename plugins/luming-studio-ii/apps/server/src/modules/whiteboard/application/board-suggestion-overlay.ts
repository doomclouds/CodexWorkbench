import {
  connectorAttachmentIds,
  type BoardChanges,
  type BoardObject,
  type PayloadRecord,
} from '../domain/index.js';
import type { BoardEditPlanningReader } from '../ports/index.js';

interface SuggestionOverlay {
  readonly reader: BoardEditPlanningReader;
  stage(changes: BoardChanges): void;
  changes(): BoardChanges;
}

type ObjectFilter = (object: BoardObject) => boolean;

export function createSuggestionOverlay(
  base: BoardEditPlanningReader,
  boardId: string,
  pinClocks: boolean,
): SuggestionOverlay {
  const objects = new Map<string, BoardObject | null>();
  const payloads = new Map<string, PayloadRecord | null>();
  let order: readonly string[] | undefined;
  let placement: BoardChanges['layerPlacement'];
  let structuralEdits = 0;

  function overlayMetadata(next: BoardObject, original: BoardObject | undefined): BoardObject {
    const staged = payloads.get(next.objectId);
    const payloadVersion = staged === undefined ? next.payloadVersion : staged?.payloadVersion;
    if (pinClocks && original) {
      return {
        ...next,
        geometryVersion: original.geometryVersion,
        payloadVersion: original.payloadVersion,
      };
    }

    return { ...next, payloadVersion };
  }

  function orderObjects(result: BoardObject[]): BoardObject[] {
    if (!order) {
      return result;
    }

    const ranks = new Map(order.map((id, index) => [id, index]));

    return result.sort(
      (left, right) =>
        (ranks.get(left.objectId) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(right.objectId) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  function projectedObjects(
    originals: readonly BoardObject[],
    filter: ObjectFilter,
    include: readonly string[] = Array.from(objects.keys()),
  ): readonly BoardObject[] {
    const result: BoardObject[] = [];
    const visited = new Set<string>();
    for (const original of originals) {
      const { objectId } = original;
      visited.add(objectId);
      const replacement = objects.get(objectId);
      const next = replacement === undefined ? original : replacement;
      if (next && filter(next)) {
        result.push(overlayMetadata(next, original));
      }
    }
    for (const id of include) {
      const next = objects.get(id);
      if (next && !visited.has(id) && filter(next)) {
        const original = pinClocks ? base.getObjects(boardId, [id])[0] : undefined;
        result.push(overlayMetadata(next, original));
      }
    }

    return orderObjects(result);
  }

  function projectedPayloads(current: string, ids: readonly string[]): readonly PayloadRecord[] {
    const originals = base.getPayloads(current, ids);
    if (current !== boardId) {
      return originals;
    }

    const byId = new Map(originals.map((payload) => [payload.objectId, payload]));
    const result: PayloadRecord[] = [];
    for (const id of ids) {
      const saved = byId.get(id);
      const pending = payloads.get(id);
      const next = pending === undefined ? saved : pending;
      if (next) {
        result.push(pinClocks && saved ? { ...next, payloadVersion: saved.payloadVersion } : next);
      }
    }

    return result;
  }

  const measurePayloads = base.payloadByteSize;
  function projectedPayloadSize(
    current: string,
    ids: readonly string[],
    revision?: bigint,
  ): bigint {
    const pointInTime = current !== boardId || revision !== undefined;
    if (pointInTime) {
      return measurePayloads?.(current, ids, revision) ?? 0n;
    }

    const unchanged = ids.filter((id) => !payloads.has(id));
    const bytes = ids.reduce((sum, id) => {
      const pending = payloads.get(id);
      if (!pending) {
        return sum;
      }

      return sum + new TextEncoder().encode(JSON.stringify(pending.data)).byteLength;
    }, 0);

    return (measurePayloads?.(current, unchanged) ?? 0n) + BigInt(bytes);
  }

  const reader: BoardEditPlanningReader = {
    ...base,
    getObjects: (current, ids) =>
      current === boardId
        ? projectedObjects(base.getObjects(current, ids), () => true, ids)
        : base.getObjects(current, ids),
    listObjects: (current, limit) =>
      current === boardId
        ? projectedObjects(base.listObjects(current), () => true).slice(0, limit)
        : base.listObjects(current, limit),
    listGroupObjects: (current, id) =>
      current === boardId
        ? projectedObjects(base.listGroupObjects(current, id), (object) => object.groupId === id)
        : base.listGroupObjects(current, id),
    listChildObjects: (current, id) =>
      current === boardId
        ? projectedObjects(base.listChildObjects(current, id), (object) => object.parentId === id)
        : base.listChildObjects(current, id),
    listRelatedConnectors: (current, ids) => {
      const originals = base.listRelatedConnectors(current, ids);
      if (current !== boardId) {
        return originals;
      }

      const targets = new Set(ids);

      return projectedObjects(
        originals,
        ({ detail }) =>
          detail?.kind === 'connector' &&
          connectorAttachmentIds(detail).some((id) => targets.has(id)),
      );
    },
    getPayloads: projectedPayloads,
    payloadByteSize: measurePayloads ? projectedPayloadSize : undefined,
    hasUsedObjectId: (current, id) =>
      (current === boardId && objects.has(id)) || base.hasUsedObjectId(current, id),
  };

  return {
    reader,
    stage(changes) {
      for (const object of changes.objects ?? []) {
        objects.set(object.objectId, object);
      }
      for (const id of changes.removedObjectIds ?? []) {
        objects.set(id, null);
        payloads.set(id, null);
      }
      for (const payload of changes.payloads ?? []) {
        payloads.set(payload.objectId, payload);
      }
      for (const id of changes.removedPayloadObjectIds ?? []) {
        payloads.set(id, null);
      }
      if (changes.order) {
        order = changes.order;
        placement = changes.layerPlacement;
        structuralEdits += 1;
      }
      if (order && changes.removedObjectIds?.length) {
        order = order.filter((id) => !changes.removedObjectIds?.includes(id));
      }
    },
    changes() {
      return {
        kind: 'changes',
        objects: [...objects.values()].filter((object): object is BoardObject => object !== null),
        removedObjectIds: [...objects].filter(([, object]) => object === null).map(([id]) => id),
        payloads: [...payloads.values()].filter(
          (payload): payload is PayloadRecord => payload !== null,
        ),
        removedPayloadObjectIds: [...payloads]
          .filter(([id, payload]) => payload === null && objects.get(id) !== null)
          .map(([id]) => id),
        order,
        layerPlacement: structuralEdits === 1 ? placement : undefined,
      };
    },
  };
}
