import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    allowOnly: false,
    environment: 'jsdom',
    include: ['tests/component/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    setupFiles: ['tests/support/setup.ts'],
  },
});
