import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    cssCodeSplit: true,
    lib: {
      entry: {
        'base-ui': fileURLToPath(new URL('./src/ui/base/index.ts', import.meta.url)),
        'canvas-ui': fileURLToPath(new URL('./src/ui/domain/canvas/index.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
