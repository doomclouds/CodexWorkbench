import type { AttachBoardImageRequest } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { ImageOperation } from '../../modules/whiteboard/application/index.js';
import { HttpRequestError } from './request.js';

export function readImageOperation({
  objectId,
  displayName,
  content,
  geometry,
}: AttachBoardImageRequest): ImageOperation {
  if (!geometry) {
    throw new HttpRequestError(400, 'Image geometry is required.');
  }

  const { x, y, width, height, rotation } = geometry;

  return { objectId, displayName, content, geometry: { x, y, width, height, rotation } };
}
