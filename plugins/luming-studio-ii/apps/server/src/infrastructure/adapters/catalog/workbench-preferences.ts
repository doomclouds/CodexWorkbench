import type { WorkbenchPreferences } from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection } from '../../platform/index.js';

export function readWorkbenchPreferences(connection: SqliteConnection, actorId: string) {
  const row = connection
    .prepare('SELECT layout, theme, pinned_only FROM workbench_preferences WHERE actor_id = ?')
    .get(actorId);
  const { layout, theme, pinned_only: pinned } = row ?? {};

  return {
    layout: layout === 'grid' || layout === 'list' ? layout : undefined,
    theme: theme === 'light' || theme === 'dark' ? theme : undefined,
    pinnedOnly: pinned === 0 || pinned === 1 ? pinned === 1 : undefined,
  } satisfies WorkbenchPreferences;
}

export function updateWorkbenchPreferences(
  connection: SqliteConnection,
  actorId: string,
  { layout, theme, pinnedOnly }: WorkbenchPreferences,
) {
  connection
    .prepare(`
    INSERT INTO workbench_preferences (actor_id, layout, theme, pinned_only)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (actor_id) DO UPDATE SET
      layout = COALESCE(excluded.layout, workbench_preferences.layout),
      theme = COALESCE(excluded.theme, workbench_preferences.theme),
      pinned_only = COALESCE(excluded.pinned_only, workbench_preferences.pinned_only)
  `)
    .run(
      actorId,
      layout ?? null,
      theme ?? null,
      pinnedOnly === undefined ? null : Number(pinnedOnly),
    );
}
