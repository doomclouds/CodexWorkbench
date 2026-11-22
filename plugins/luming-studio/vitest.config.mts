import { configDefaults, defineConfig } from 'vitest/config';

const jsdomSuites = {
  component: [
    'canvas-content-ownership.test.tsx',
    'canvas-format-toolbar.test.tsx',
    'canvas-native.test.tsx',
    'canvas-navigation.test.tsx',
    'canvas-reading-tools.test.tsx',
    'canvas-reading.test.tsx',
    'client-id.test.tsx',
    'color-palette.test.tsx',
    'comment-author.test.tsx',
    'comment-clusters.test.tsx',
    'comments-ui.test.tsx',
    'document-canvas-controls.test.tsx',
    'document-canvas-movement.test.tsx',
    'document-canvas-surface.test.tsx',
    'document-editor.test.tsx',
    'editor-panels.test.tsx',
    'escape-scope.test.tsx',
    'inline-text-editor.test.tsx',
    'legacy-storage-ui.test.tsx',
    'library-menu.test.tsx',
    'library-preview-cache.test.tsx',
    'main-web-navigation.test.tsx',
    'native-component-matrix.test.tsx',
    'operation-notice.test.tsx',
    'participants-ui.test.tsx',
    'peer-presence-overlay.test.tsx',
    'reading-controls.test.tsx',
    'reading-marker.test.tsx',
    'saved-layout-drafts.test.tsx',
    'session-ui.test.tsx',
    'source-content-queue.test.tsx',
    'timer-clock.test.tsx',
    'todo-region.test.tsx',
    'view-state-ui.test.tsx',
  ],
  integration: [
    'app-studio-workflows.test.tsx',
    'canvas-interaction.test.tsx',
    'collaboration-client-http.test.tsx',
    'collaboration-client.test.ts',
    'comments-collaboration.test.tsx',
    'document-region.test.tsx',
    'export-offline-browser.test.ts',
    'global-annotation-shortcuts.test.tsx',
    'history-panel-workflow.test.tsx',
    'native-causal-input.test.tsx',
    'native-gesture-protocol.test.ts',
    'native-table.test.tsx',
  ],
};

const jsdomTests = Object.entries(jsdomSuites).flatMap(([category, files]) =>
  files.map((file) => `tests/${category}/${file}`),
);
const studioTests = ['tests/{unit,component,contracts,integration}/**/*.test.{ts,tsx}'];

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'jsdom', environment: 'jsdom', include: jsdomTests } },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: studioTests,
          exclude: [...configDefaults.exclude, ...jsdomTests],
        },
      },
    ],
  },
});
