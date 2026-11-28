import { create } from '@bufbuild/protobuf';
import {
  BoardSceneSchema,
  type BoardScene as WireBoardScene,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { toObjectMetadata } from '../../infrastructure/adapters/scene-codec/index.js';
import type { BoardScene } from '../../modules/whiteboard/application/index.js';

export function toBoardScene(scene: BoardScene): WireBoardScene {
  return create(BoardSceneSchema, {
    boardId: scene.board.boardId,
    title: scene.board.title,
    boardRevision: scene.board.revision,
    access: scene.access,
    objects: scene.objects.map(toObjectMetadata),
    customColors: scene.customColors && { colors: [...scene.customColors] },
  });
}
