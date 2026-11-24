import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/ui/base/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'base-ui',
      cssFileName: 'base-ui',
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
