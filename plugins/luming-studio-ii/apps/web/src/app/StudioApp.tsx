import { useEffect, useState } from 'react';
import type { BoardCatalogService } from '../data/catalog/index.js';
import type { WhiteboardService } from '../data/whiteboard/index.js';
import { WhiteboardPage } from '../pages/whiteboard/index.js';
import { WorkbenchPage } from '../pages/workbench/index.js';
import './app.css';

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
}

export function StudioApp({
  catalog,
  service,
  navigation,
  preferences,
  createCommandId,
}: StudioAppProps) {
  const [boardId, setBoardId] = useState(navigation.read);
  const [layout, setLayout] = useState(preferences.layout);
  const [resolvedTheme, setTheme] = useState(preferences.resolvedTheme);

  useEffect(() => navigation.subscribe(() => setBoardId(navigation.read())), [navigation]);

  function handleOpenBoard(id?: string) {
    navigation.write(id);
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
    <div className="studio-whiteboard-app" data-theme={resolvedTheme}>
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
          preferences={{
            layout,
            resolvedTheme,
            onLayoutChange: changeLayout,
            onThemeChange: changeTheme,
          }}
        />
      )}
    </div>
  );
}
