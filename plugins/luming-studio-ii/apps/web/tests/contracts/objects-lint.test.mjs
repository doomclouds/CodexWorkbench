import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
const boundary = 'objects/contract-boundary';
const browser = 'base/no-browser-io';
const source = 'src/ui/domain/objects/';
const fixture = 'tests/fixtures/canvas/contents.tsx';
const consumer = 'src/surfaces/board/editor.ts';
const testDocument = 'tests/component/objects/DocumentObject.test.tsx';
const documentSpecifier = '@codexworkbench/luming-studio-ii-web/ui/domain/objects/document';
const editsProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
const stickerArtwork = '@codexworkbench/luming-studio-ii-whiteboard-shared/stickers';
const richTextFormat = '@codexworkbench/luming-studio-ii-whiteboard-shared/rich-text';
const editingFamilies = ['table', 'embed', 'sticker', 'media'];

const rejected = [
  ...editingFamilies.map((family) => [
    family + ' registration importing the generated edit protocol',
    source + family + '/canvas-extension.tsx',
    `import type { EditObjectContentRequest } from '${editsProtocol}';`,
  ]),
  [
    'sticker registration importing a Node file API',
    source + 'sticker/canvas-extension.tsx',
    "import { readFile } from 'node:fs/promises';",
  ],
  [
    'an unrelated object importing sticker artwork',
    source + 'document/model.ts',
    `import { stickerDefinition } from '${stickerArtwork}';`,
  ],
  [
    'table registration importing an unrelated UI runtime',
    source + 'table/canvas-extension.tsx',
    "import { ref } from 'vue';",
  ],
  [
    'media registration making its own network request',
    source + 'media/canvas-extension.tsx',
    'window.fetch(path);',
    browser,
  ],
  [
    'Surface deep import',
    consumer,
    "import { normalize } from '../../ui/domain/objects/document/model.js';",
  ],
  [
    'private package import',
    consumer,
    `import { DocumentObject } from '${documentSpecifier}/index.js';`,
  ],
  [
    'fixture private import',
    fixture,
    "import { form } from '../../../src/ui/domain/objects/todo/form.js';",
  ],
  [
    'fixture external object implementation',
    fixture,
    "import { form } from '../../../src/surfaces/board/todo-form.js';",
    'canvas/contract-boundary',
  ],
  [
    'object uses a Surface service',
    source + 'todo/TodoObject.tsx',
    "import { save } from '../../../../surfaces/board/save.js';",
  ],
  [
    'object imports another family internals',
    source + 'table/TableObject.tsx',
    "import { parse } from '../text/model.js';",
  ],
  [
    'table uses the text object instead of its shared editor controls',
    source + 'table/TableObject.tsx',
    "import { textExtension } from '../text/index.js';",
  ],
  [
    'assembly imports object implementation internals',
    source + 'index.ts',
    "import { TodoObject } from './todo/TodoObject.js';",
  ],
  [
    'object imports Canvas internals',
    source + 'todo/TodoObject.tsx',
    "import { projectObject } from '../../canvas/scene/index.js';",
  ],
  [
    'implementation consumes the extension boundary directly',
    source + 'todo/TodoObject.tsx',
    "import type { CanvasObjectExtension } from '../../canvas/index.js';",
  ],
  [
    'registration imports the Canvas runtime',
    source + 'todo/canvas-extension.tsx',
    "import { Canvas } from '../../canvas/index.js';",
  ],
  [
    'registration imports the Canvas handle',
    source + 'todo/canvas-extension.tsx',
    "import type { CanvasHandle } from '../../canvas/index.js';",
  ],
  [
    'Canvas imports a body component',
    'src/ui/domain/canvas/Canvas.tsx',
    "import { DocumentObject } from '../objects/document/index.js';",
    'canvas/contract-boundary',
  ],
  [
    'object imports an unapproved library',
    source + 'document/DocumentObject.tsx',
    "import { createClient } from '@modelcontextprotocol/sdk';",
  ],
  [
    'object bypasses the rich text format bridge',
    source + 'document/DocumentObject.tsx',
    "import { parseRichText } from '" + richTextFormat + "';",
  ],
  [
    'object test imports internals',
    testDocument,
    "import { create } from '../../../src/ui/domain/objects/document/editor.js';",
  ],
  [
    'embed unit imports the component',
    'tests/unit/objects/embed.test.ts',
    "import { EmbedObject } from '../../../src/ui/domain/objects/embed/EmbedObject.js';",
  ],
  [
    'replacing the real document in a contract test',
    testDocument,
    `import { vi as runner } from 'vitest';\nrunner.mock('${documentSpecifier}', factory);`,
    'canvas/no-test-replacement',
  ],
  ['network from an object', source + 'todo/model.ts', 'window.fetch(path);', browser],
  ['network from the embed adapter', source + 'embed/host.ts', 'window.fetch(path);', browser],
  [
    'injecting HTML into the object tree',
    source + 'embed/EmbedObject.tsx',
    '<div dangerouslySetInnerHTML={{ __html: source }} />;',
  ],
  [
    'writing overview HTML into the document',
    source + 'embed/overview-preview.ts',
    'document.body.innerHTML = source;',
  ],
  [
    'disguising the live document as the preview template',
    source + 'embed/overview-preview.ts',
    'const template = document.body;\ntemplate.innerHTML = source;',
  ],
  [
    'creating a live preview document',
    source + 'embed/overview-preview.ts',
    'frame.srcdoc = source;',
  ],
  [
    'storage from the embed adapter',
    source + 'embed/host.ts',
    'window.localStorage.getItem(key);',
    browser,
  ],
  [
    'postMessage outside the embed adapter',
    source + 'todo/model.ts',
    'window.postMessage(msg);',
    browser,
  ],
];

for (const [name, filePath, text, rule = boundary] of rejected) {
  test('rejects ' + name, async () => {
    const [result] = await eslint.lintText(text, { filePath });

    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === rule),
      JSON.stringify(result.messages),
    );
  });
}

const accepted = [
  [source + 'sticker/sticker-catalog.ts', `export { stickerDefinition } from '${stickerArtwork}';`],
  [source + 'text/rich-text.ts', `export { parseRichText } from '${richTextFormat}';`],
  ...editingFamilies.map((family) => [
    source + family + '/canvas-extension.tsx',
    [
      "import type { CanvasObjectOperation, CanvasObjectViewProps } from '../../canvas/index.js';",
      '',
      'export function saveObject(view: CanvasObjectViewProps, operation: CanvasObjectOperation) {',
      '  if (view.readOnly) {',
      '    return;',
      '  }',
      '',
      '  return view.request(operation);',
      '}',
    ].join('\n'),
  ]),
  [consumer, `import { DocumentObject } from '${documentSpecifier}';`],
  [source + 'index.ts', "import { todoExtension } from './todo/index.js';"],
  [fixture, "import { TodoObject } from '../../../src/ui/domain/objects/todo/index.js';"],
  [source + 'table/TableObject.tsx', "import { RichText } from '../text/index.js';"],
  [source + 'table/TableObject.tsx', "import { InlineTextLinkEditor } from '../text/index.js';"],
  [
    source + 'table/contracts.ts',
    "import type { InlineTextFormatRequest } from '../text/index.js';",
  ],
  [
    source + 'todo/canvas-extension.tsx',
    "import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';",
  ],
  [source + 'document/editor.tsx', "import { BlockNoteEditor } from '@blocknote/core';"],
  [source + 'todo/TodoObject.tsx', "import { Button } from '../../../base/index.js';"],
  [source + 'embed/host.ts', 'window.parent.postMessage(message, targetOrigin);'],
  [
    source + 'embed/overview-preview.ts',
    "const template = document.createElement('template');\ntemplate.innerHTML = source;",
  ],
  [
    testDocument,
    "import { DocumentObject } from '../../../src/ui/domain/objects/document/index.js';",
  ],
  [
    'tests/unit/objects/embed.test.ts',
    "import { frameDocument } from '../../../src/ui/domain/objects/embed/runtime.js';",
  ],
];

for (const [filePath, text] of accepted) {
  test('accepts approved object references in ' + filePath, async () => {
    const [result] = await eslint.lintText(text, { filePath });

    assert.deepEqual(result.messages, []);
  });
}
