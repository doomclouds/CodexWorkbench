export type WorkbenchLayout = 'grid' | 'list';
export type WorkbenchTheme = 'light' | 'dark';

export interface WorkbenchPreferences {
  readonly layout: WorkbenchLayout;
  readonly resolvedTheme: WorkbenchTheme;
  readonly onLayoutChange: (layout: WorkbenchLayout) => void;
  readonly onPinnedOnlyChange?: (pinnedOnly: boolean) => void;
  readonly onThemeChange: (theme: WorkbenchTheme) => void;
}
