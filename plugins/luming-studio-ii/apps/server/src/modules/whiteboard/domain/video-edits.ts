import type { BoardChanges, BoardEditAsset, BoardEditRejected } from './board-edits.js';
import { geometryInWorld } from './geometry-edits.js';
import type { ImageOperation } from './image-edits.js';
import { inspectIsoVideo } from './video-iso.js';
import { isWebmVideo } from './video-webm.js';

export interface VideoOperation extends ImageOperation {
  readonly mediaType: string;
}

interface VideoChanges extends BoardChanges {
  readonly assets: readonly [BoardEditAsset];
}

const archiveAssetPath = '/studio-archive-assets/';
const pathSegment = /^[A-Za-z0-9_-]{1,128}$/u;
const unsafeName = /[/\\]|\p{Cc}|^[A-Za-z]:/u;
const maximumDisplayName = 160;
const maximumVideoBytes = 20 * 1024 * 1024;
const webmSignature = 0x1a45dfa3;

function inspectVideo(content: Uint8Array) {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  if (view.byteLength >= 4 && view.getUint32(0) === webmSignature) {
    return isWebmVideo(content) ? 'video/webm' : undefined;
  }

  return inspectIsoVideo(view);
}

function validPlacement(boardId: string, assetId: string, operation: VideoOperation): boolean {
  const { objectId, displayName, geometry } = operation;
  const idsFitPath = [boardId, objectId, assetId].every((id) => pathSegment.test(id));
  const validName = displayName.length <= maximumDisplayName && !unsafeName.test(displayName);
  const validSize = geometry.width > 0 && geometry.height > 0 && geometryInWorld(geometry);

  return idsFitPath && validName && validSize;
}

export function planVideoChanges(
  boardId: string,
  operation: VideoOperation,
): VideoChanges | BoardEditRejected {
  const { objectId, displayName, geometry, content, mediaType } = operation;
  const assetId = 'video-' + objectId;
  if (content.byteLength > maximumVideoBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }
  if (!validPlacement(boardId, assetId, operation)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const detected = inspectVideo(content);
  if (!detected || detected !== mediaType) {
    return { kind: 'rejected', reason: 'invalidVideo' };
  }

  return {
    kind: 'changes',
    objects: [
      {
        objectId,
        kind: 'video',
        label: displayName.trim() || '视频',
        geometry,
        geometryVersion: 0n,
        payloadVersion: 0n,
        locked: false,
      },
    ],
    payloads: [
      {
        objectId,
        bodyKind: 'video',
        payloadVersion: 0n,
        data: { src: archiveAssetPath + boardId + '/' + assetId },
      },
    ],
    assets: [{ assetId, mimeType: detected, bytes: content }],
  };
}
