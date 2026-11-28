import type { WhiteboardMoveReceipt, WhiteboardObject, WhiteboardScene } from './contracts.js';

function latestPayload(current?: bigint, next?: bigint): bigint | undefined {
  if (current === undefined) {
    return next;
  }
  if (next === undefined) {
    return current;
  }

  return next > current ? next : current;
}

function mergeObject(object: WhiteboardObject, update: WhiteboardObject): WhiteboardObject {
  const payloadVersion = latestPayload(object.payloadVersion, update.payloadVersion);
  if (update.geometryVersion <= object.geometryVersion) {
    return object.payloadVersion === payloadVersion ? object : { ...object, payloadVersion };
  }

  return {
    ...object,
    geometry: update.geometry,
    detail: update.detail,
    geometryVersion: update.geometryVersion,
    payloadVersion,
  };
}

export function mergeConfirmedScene(
  scene: WhiteboardScene,
  receipt: WhiteboardMoveReceipt,
  positions: ReadonlyMap<string, number>,
): WhiteboardScene {
  if (receipt.kind !== 'applied' || receipt.revision < scene.revision) {
    return scene;
  }

  let objects: WhiteboardObject[] | undefined;
  for (const update of receipt.objects) {
    const position = positions.get(update.id);
    const previous = position === undefined ? undefined : scene.objects[position];
    if (position === undefined || !previous) {
      continue;
    }

    const current = mergeObject(previous, update);
    if (current !== previous) {
      objects ??= scene.objects.slice();
      objects[position] = current;
    }
  }

  return { ...scene, revision: receipt.revision, objects: objects ?? scene.objects };
}
