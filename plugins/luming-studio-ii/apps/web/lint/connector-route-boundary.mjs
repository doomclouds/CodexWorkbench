import { resolve } from 'node:path';
import { sourceRoot } from './project-paths.mjs';

export const connectorRoute = '@codexworkbench/luming-studio-ii-whiteboard-shared/connector-route';
const connectorFiles = new Set([
  resolve(sourceRoot, 'ui/domain/canvas/connectors/geometry.ts'),
  resolve(sourceRoot, 'ui/domain/canvas/connectors/path.ts'),
]);

export function allowsConnectorRoute(file, node) {
  const namedImport =
    node.type === 'ImportDeclaration' &&
    node.specifiers.length > 0 &&
    node.specifiers.every(({ type }) => type === 'ImportSpecifier');

  return connectorFiles.has(file) && namedImport;
}
