import { useRef, useState } from 'react';
import type {
  CanvasObject,
  CanvasObjectIntent,
  CanvasObjectKind,
  CanvasObjectPayload,
  CanvasObjectReceipt,
} from '../../../src/ui/domain/canvas/index.js';
import {
  applyTodoObjectEdit,
  type TodoObjectEdit,
  type TodoObjectSnapshot,
} from '../../../src/ui/domain/objects/todo/index.js';
import { galleryObjects } from './placements.js';
import { initialReceiptState, reduceReceipts } from './receipts.js';
import type { ReceiptFixtureAction, ReceiptFixtureState } from './receipts.js';
import { samplePayload } from './samples.js';

interface FixtureModel extends ReceiptFixtureState {
  payloads: ReadonlyMap<string, CanvasObjectPayload>;
}

type BodyRecord = Record<string, unknown>;

const operations = new Map<string, readonly CanvasObjectKind[]>([
  ['document.commit', ['document']],
  ['todo.edit', ['todo']],
  ['table.save', ['table']],
  ['embed.save-source', ['html', 'diagram', 'chart']],
  ['embed.save-state', ['html', 'diagram', 'chart']],
  ['media.crop', ['image']],
  ['sticker.select', ['sticker']],
  ['text.commit', ['shape', 'section', 'connector', 'text', 'note']],
]);

function record(value: unknown): BodyRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as BodyRecord)
    : undefined;
}

function initialModel(): FixtureModel {
  const scene = {
    ...initialReceiptState.scene,
    objects: [...initialReceiptState.scene.objects, ...galleryObjects],
  };
  const payloads = new Map<string, CanvasObjectPayload>();
  for (const object of scene.objects) {
    const payload = samplePayload(object);
    if (payload) {
      payloads.set(object.id, payload);
    }
  }

  return { ...initialReceiptState, scene, payloads };
}

function duplicatePayload(object: CanvasObject, payload: CanvasObjectPayload) {
  const value = structuredClone(payload.value);
  const state = record(value);
  if (!state) {
    return { version: 1, value };
  }
  if (object.kind === 'todo') {
    return { version: 1, value: { ...state, id: object.id, revision: 1 } };
  }

  if (object.kind !== 'sticker' && typeof state.id === 'string') {
    state.id = object.id;
  }
  if (typeof state.version === 'number') {
    state.version = 1;
  }

  return { version: 1, value: state };
}

function applyGeometry(model: FixtureModel, action: ReceiptFixtureAction): FixtureModel {
  const updated = reduceReceipts(model, action);
  if (updated.scene.objects === model.scene.objects) {
    return { ...model, ...updated };
  }

  const payloads = new Map(model.payloads);
  const pending =
    action.type === 'receipt'
      ? model.pending.find(({ interactionId }) => interactionId === action.interactionId)
      : undefined;
  const prefix = pending?.kind === 'duplicate' ? pending.interactionId + ':' : undefined;

  for (const object of updated.scene.objects.slice(model.scene.objects.length)) {
    const copied =
      prefix && object.id.startsWith(prefix)
        ? payloads.get(object.id.slice(prefix.length))
        : undefined;
    const payload = copied ? duplicatePayload(object, copied) : samplePayload(object);
    if (payload) {
      payloads.set(object.id, payload);
    }
  }

  return { ...updated, payloads };
}

function changeBody(
  intent: CanvasObjectIntent,
  prior: BodyRecord,
  changed: BodyRecord,
  version: number,
): BodyRecord | undefined {
  switch (intent.name) {
    case 'document.commit':
      return { title: changed.title, document: changed.document, version };
    case 'todo.edit': {
      const next = applyTodoObjectEdit(
        prior as unknown as TodoObjectSnapshot,
        changed as unknown as TodoObjectEdit,
      );

      return next ? { ...next } : undefined;
    }
    case 'table.save': {
      const next = record(changed.value);

      return next && { ...next, id: intent.objectId, version };
    }
    case 'embed.save-source': {
      const expected = changed.expectedSourceRevision;

      return typeof expected === 'number' && expected === prior.sourceRevision
        ? {
            ...prior,
            title: changed.title,
            html: changed.html,
            sourceRevision: expected + 1,
            version,
          }
        : undefined;
    }
    case 'embed.save-state':
      return { ...prior, state: changed.state, version };
    case 'media.crop':
      return { ...prior, crop: changed.crop, naturalSize: changed.naturalSize };
    case 'sticker.select':
      return { ...prior, id: changed.id };
    case 'text.commit':
      return { ...prior, text: changed.text };
    default:
      return undefined;
  }
}

function updateObject(object: CanvasObject, input: BodyRecord) {
  const hasWidth = typeof input.width === 'number' && Number.isFinite(input.width);
  const width = object.kind === 'table' && hasWidth ? input.width : object.geometry.width;
  const title = typeof input.title === 'string' ? input.title : object.label;

  return {
    ...object,
    label: title,
    geometry:
      typeof width === 'number' && width !== object.geometry.width
        ? { ...object.geometry, width }
        : object.geometry,
    version: object.version + 1,
  };
}

function geometryLocked(objects: readonly CanvasObject[], object: CanvasObject) {
  const seen = new Set<string>();
  let current: CanvasObject | undefined = object;
  while (current && !seen.has(current.id)) {
    if (current.locked) {
      return true;
    }

    const parentId: string | undefined = current.parentId;
    seen.add(current.id);
    current = parentId ? objects.find(({ id }) => id === parentId) : undefined;
  }

  return false;
}

function applyBody(
  model: FixtureModel,
  intent: CanvasObjectIntent,
): {
  model: FixtureModel;
  receipt: CanvasObjectReceipt;
} {
  const current = model.payloads.get(intent.objectId);
  const prior = record(current?.value);
  const patch = record(intent.value);
  const object = model.scene.objects.find(({ id }) => id === intent.objectId);
  const allowed =
    object?.kind === intent.kind && operations.get(intent.name)?.includes(intent.kind);

  if (!object || !allowed) {
    return { model, receipt: { ok: false, message: '对象无法执行这个操作。' } };
  }
  if (!current || !prior || !patch) {
    return { model, receipt: { ok: false, message: '对象正文不可用。' } };
  }
  if (current.version !== intent.expectedVersion) {
    return { model, receipt: { ok: false, message: '对象正文版次已变化。', current } };
  }

  const version = current.version + 1;
  const value = changeBody(intent, prior, patch, version);
  if (!value) {
    return { model, receipt: { ok: false, message: '对象操作未通过校验。', current } };
  }

  const update = updateObject(object, value);
  const editsGeometry = intent.name === 'media.crop' || update.geometry !== object.geometry;
  if (editsGeometry && geometryLocked(model.scene.objects, object)) {
    return { model, receipt: { ok: false, message: '对象的几何已锁定。', current } };
  }

  const payload = { version, value };
  const payloads = new Map(model.payloads);
  payloads.set(intent.objectId, payload);
  const objects = model.scene.objects.map((item) => (item.id === object.id ? update : item));
  const scene = { ...model.scene, revision: model.scene.revision + 1, objects };

  return { model: { ...model, scene, payloads }, receipt: { ok: true, payload } };
}

export function useFixtureModel() {
  const [model, setModel] = useState(initialModel);
  const committed = useRef(model);

  function setCurrent(next: FixtureModel) {
    committed.current = next;
    setModel(next);
  }

  return {
    model,
    dispatch: (action: ReceiptFixtureAction) =>
      setCurrent(applyGeometry(committed.current, action)),
    onObjectIntent: (intent: CanvasObjectIntent) => {
      const outcome = applyBody(committed.current, intent);
      setCurrent(outcome.model);

      return outcome.receipt;
    },
  };
}
