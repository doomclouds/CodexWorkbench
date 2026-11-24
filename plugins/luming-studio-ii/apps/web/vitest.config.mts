import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    allowOnly: false,
    environment: 'jsdom',
    include: ['tests/component/**/*.test.tsx'],
    setupFiles: ['tests/support/setup.ts'],
  },
});
