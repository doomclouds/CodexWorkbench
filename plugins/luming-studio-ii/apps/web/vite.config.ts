import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const editorPackages = [
  '@blocknote/core',
  '@blocknote/core/locales',
  '@blocknote/react',
  '@blocknote/ariakit',
];

function entry(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  optimizeDeps: {
    include: editorPackages,
  },
  build: {
    cssCodeSplit: true,
    lib: {
      entry: {
        'base-ui': entry('./src/ui/base/index.ts'),
        'canvas-ui': entry('./src/ui/domain/canvas/index.ts'),
        'studio-objects': entry('./src/ui/domain/objects/index.ts'),
        'document-object': entry('./src/ui/domain/objects/document/index.ts'),
        'embed-object': entry('./src/ui/domain/objects/embed/index.ts'),
        'media-object': entry('./src/ui/domain/objects/media/index.ts'),
        'sticker-object': entry('./src/ui/domain/objects/sticker/index.ts'),
        'table-object': entry('./src/ui/domain/objects/table/index.ts'),
        'text-object': entry('./src/ui/domain/objects/text/index.ts'),
        'todo-object': entry('./src/ui/domain/objects/todo/index.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', ...editorPackages],
    },
  },
});
