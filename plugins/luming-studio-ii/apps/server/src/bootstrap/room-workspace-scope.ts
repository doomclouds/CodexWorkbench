import type { createWhiteboardRepository } from '../infrastructure/adapters/index.js';
import type {
  AgentActivityBounds,
  AgentActivityOptions,
} from '../modules/rooms/application/index.js';

type WorkspaceRepository = ReturnType<typeof createWhiteboardRepository>;
type WorkspaceGeometry = AgentActivityBounds & { readonly rotation: number };

const radiansPerDegree = Math.PI / 180;

function boundsOf({ x, y, width, height, rotation }: WorkspaceGeometry) {
  const angle = rotation * radiansPerDegree;
  const sine = Math.abs(Math.sin(angle));
  const cosine = Math.abs(Math.cos(angle));
  const wrappedWidth = cosine * width + sine * height;
  const wrappedHeight = sine * width + cosine * height;

  return {
    x: x + (width - wrappedWidth) / 2,
    y: y + (height - wrappedHeight) / 2,
    width: wrappedWidth,
    height: wrappedHeight,
  };
}

export function createRoomWorkspaceScope(
  repository: WorkspaceRepository,
): AgentActivityOptions['resolveScope'] {
  return (boardId, ownerId, scope) =>
    repository.read((reader) => {
      if (!reader.getAccess(boardId, ownerId)?.canEdit) {
        return;
      }
      if (scope.kind === 'area') {
        return [];
      }

      const objects = reader.getObjects(boardId, scope.objectIds);
      if (objects.length === scope.objectIds.length) {
        return objects.map(({ objectId, geometry }) => ({
          id: objectId,
          bounds: boundsOf(geometry),
        }));
      }
    });
}
