import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import scriptPlugin from '../../../tooling/studio-lint/script-plugin.mjs';
import { STUDIO_TOOLS } from '../src/contracts/studio.ts';
import { APP_TOOL_NAME } from '../src/contracts/transport.ts';

const studioRoot = fileURLToPath(new URL('../', import.meta.url));
const toolReferences = new Map(
  Object.entries(STUDIO_TOOLS).map(([key, name]) => [name, `STUDIO_TOOLS.${key}`]),
);
toolReferences.set(APP_TOOL_NAME, 'APP_TOOL_NAME');

const managedToolNames = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      useContract: 'Reference {{reference}} from the Studio contracts for this tool name.',
    },
  },
  create(context) {
    const file = relative(studioRoot, context.physicalFilename).replaceAll('\\', '/');

    return {
      Literal(node) {
        const reference = toolReferences.get(node.value);
        if (!reference) {
          return;
        }
        const canonical =
          reference === 'APP_TOOL_NAME' ? 'src/contracts/transport.ts' : 'src/contracts/studio.ts';
        const declaration = reference === 'APP_TOOL_NAME' ? 'APP_TOOL_NAME' : 'STUDIO_TOOLS';
        if (
          file === canonical &&
          context.sourceCode
            .getAncestors(node)
            .some(
              (ancestor) =>
                ancestor.type === 'VariableDeclarator' && ancestor.id.name === declaration,
            )
        ) {
          return;
        }
        context.report({ node, messageId: 'useContract', data: { reference } });
      },
    };
  },
};

export default {
  meta: { name: 'luming-studio' },
  rules: {
    ...scriptPlugin.rules,
    'managed-tool-names': managedToolNames,
  },
};
