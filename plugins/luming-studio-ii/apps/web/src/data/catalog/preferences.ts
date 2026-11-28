import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type { CatalogPost } from './contracts.js';
import { request } from './protocol.js';

interface WorkbenchPreferences {
  readonly layout?: 'grid' | 'list';
  readonly theme?: 'light' | 'dark';
  readonly pinnedOnly?: boolean;
}

export function createWorkbenchPreferencesService(post: CatalogPost) {
  const { getWorkbenchPreferences, updateWorkbenchPreferences } = BoardCatalogService.method;

  return {
    async read(signal?: AbortSignal): Promise<WorkbenchPreferences> {
      const result = await request(post, getWorkbenchPreferences, {}, signal);
      const { layout, theme, pinnedOnly } = result.preferences ?? {};

      return {
        layout: layout === 'grid' || layout === 'list' ? layout : undefined,
        theme: theme === 'light' || theme === 'dark' ? theme : undefined,
        pinnedOnly,
      };
    },
    async update(changes: WorkbenchPreferences, signal?: AbortSignal) {
      await request(post, updateWorkbenchPreferences, { changes }, signal);
    },
  };
}
