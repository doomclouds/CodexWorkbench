import type { createWhiteboardRepository } from '../infrastructure/adapters/index.js';
import type { AgentActivityOptions } from '../modules/rooms/application/index.js';
import { agentWriteBounds } from '../modules/whiteboard/application/index.js';

type WorkspaceRepository = ReturnType<typeof createWhiteboardRepository>;

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
          bounds: agentWriteBounds(geometry),
        }));
      }
    });
}
