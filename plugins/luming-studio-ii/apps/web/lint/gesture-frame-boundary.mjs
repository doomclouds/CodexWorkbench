import { dirname, resolve } from 'node:path';
import { sourceRoot } from './project-paths.mjs';

const canvasRoot = resolve(sourceRoot, 'ui/domain/canvas');
const gestureFrame = resolve(canvasRoot, 'canvas-gesture-frame.ts');
const scene = resolve(canvasRoot, 'scene/index');

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      sceneQuery: 'Prepare and reuse scene-wide alignment candidates outside gesture frames.',
    },
  },

  create(context) {
    if (context.physicalFilename !== gestureFrame) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const target = resolve(dirname(gestureFrame), node.source.value).replace(/\.[jt]s$/u, '');
        if (target !== scene) {
          return;
        }

        for (const specifier of node.specifiers) {
          const importsQuery = specifier.imported?.name === 'queryScene';
          if (importsQuery || specifier.type === 'ImportNamespaceSpecifier') {
            context.report({ node: specifier, messageId: 'sceneQuery' });
          }
        }
      },
    };
  },
};
