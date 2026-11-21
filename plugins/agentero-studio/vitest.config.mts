import { configDefaults, defineConfig } from 'vitest/config';

const jsdomTests = [
  'tests/!(canvas-state|document-anchor-notice).test.tsx',
  'tests/{collaboration-client,export-offline-browser,native-gesture-protocol}.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'jsdom', environment: 'jsdom', include: jsdomTests } },
      { test: { name: 'node', exclude: [...configDefaults.exclude, ...jsdomTests, 'lint/**'] } },
    ],
  },
});
