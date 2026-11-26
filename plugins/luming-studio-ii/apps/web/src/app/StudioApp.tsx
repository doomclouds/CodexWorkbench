import { useEffect, useRef, useState } from 'react';
import type { ArchiveImportService } from '../data/archive-import/index.js';
import type { BoardCatalogService } from '../data/catalog/index.js';
import type { WhiteboardService } from '../data/whiteboard/index.js';
import './app.css';
import { studioPages } from './routes.js';
import { AppShell } from './shell/index.js';
import { useArchiveImport } from './workflows/archive-import/useArchiveImport.js';

type StudioLayout = 'list' | 'grid';
type StudioTheme = 'light' | 'dark';

interface StudioNavigation {
  readonly read: () => string | undefined;
  readonly write: (boardId?: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

interface StudioPreferences {
  readonly layout: StudioLayout;
  readonly resolvedTheme: StudioTheme;
  readonly rememberLayout: (layout: StudioLayout) => void;
  readonly rememberTheme: (theme: StudioTheme) => void;
}

export interface StudioAppProps {
  readonly catalog: BoardCatalogService;
  readonly service: WhiteboardService;
  readonly navigation: StudioNavigation;
  readonly preferences: StudioPreferences;
  readonly createCommandId: () => string;
  readonly archiveImport?: ArchiveImportService;
}

const { whiteboard: WhiteboardPage, workbench: WorkbenchPage } = studioPages;

export function StudioApp({
  catalog,
  service,
  navigation,
  preferences,
  createCommandId,
  archiveImport,
}: StudioAppProps) {
  const [boardId, setBoardId] = useState(navigation.read);
  const [layout, setLayout] = useState(preferences.layout);
  const [resolvedTheme, setTheme] = useState(preferences.resolvedTheme);
  const routeGeneration = useRef(0);
  const importFlow = useArchiveImport({
    service: archiveImport,
    createCommandId,
    readRouteGeneration: () => routeGeneration.current,
    onOpenBoard: handleOpenBoard,
  });

  useEffect(
    () =>
      navigation.subscribe(() => {
        routeGeneration.current += 1;
        setBoardId(navigation.read());
      }),
    [navigation],
  );

  function handleOpenBoard(id?: string) {
    navigation.write(id);
    routeGeneration.current += 1;
    setBoardId(id);
  }

  function changeLayout(next: StudioLayout) {
    preferences.rememberLayout(next);
    setLayout(next);
  }

  function changeTheme(next: StudioTheme) {
    preferences.rememberTheme(next);
    setTheme(next);
  }

  return (
    <AppShell
      resolvedTheme={resolvedTheme}
      notice={importFlow.feedback}
      onDismissNotice={importFlow.dismissFeedback}
    >
      {boardId ? (
        <WhiteboardPage
          boardId={boardId}
          service={service}
          createCommandId={createCommandId}
          onBack={() => handleOpenBoard()}
        />
      ) : (
        <WorkbenchPage
          catalog={catalog}
          createCommandId={createCommandId}
          onOpenBoard={handleOpenBoard}
          archiveImport={importFlow.workbench}
          preferences={{
            layout,
            resolvedTheme,
            onLayoutChange: changeLayout,
            onThemeChange: changeTheme,
          }}
        />
      )}
    </AppShell>
  );
}
