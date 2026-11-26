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

function mergeObject(object: WhiteboardObject, update?: WhiteboardObject): WhiteboardObject {
  if (!update) {
    return object;
  }

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
): WhiteboardScene {
  if (receipt.kind !== 'applied' || receipt.revision < scene.revision) {
    return scene;
  }

  const updates = new Map(receipt.objects.map((object) => [object.id, object]));
  const objects = scene.objects.map((object) => mergeObject(object, updates.get(object.id)));

  return { ...scene, revision: receipt.revision, objects };
}
