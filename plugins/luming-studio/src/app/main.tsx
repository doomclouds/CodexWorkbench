import { STUDIO_DISPLAY_NAME } from '../contracts/branding.js';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import StudioApp from './shell/StudioApp';
import { createStudioBridge, type StudioBridge } from './transport/bridge';
import { studioRequest } from './transport/client';
import { reportStudioWarning } from './shared/studio-warning';
import { installEscapeBoundary } from './shared/escape';

installEscapeBoundary(window);

function Root() {
  const [bridge, setBridge] = useState<StudioBridge>();
  const [navigation, setNavigation] = useState<{
    artifactId?: string;
    view: string;
    revision: number;
  }>({ view: 'library', revision: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let active: StudioBridge | undefined;
    createStudioBridge((artifactId, view) => {
      if (!disposed) {
        setNavigation((current) => ({
          artifactId,
          view: view || (artifactId ? 'editor' : 'library'),
          revision: current.revision + 1,
        }));
      }
    })
      .then((value) => {
        active = value;
        if (!disposed) {
          setBridge(value);
          setNavigation((current) => ({
            artifactId: value.artifactId,
            view: value.view || (value.artifactId ? 'editor' : 'library'),
            revision: current.revision,
          }));
        } else {
          return value.close();
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : '无法连接作品服务');
        }
      });

    return () => {
      disposed = true;
      active
        ?.close()
        .catch((reason) => reportStudioWarning('Studio bridge cleanup failed.', reason));
    };
  }, []);

  if (error) {
    return (
      <main
        style={{
          padding: 36,
          fontFamily: 'system-ui',
          color: 'var(--color-text-primary, #d9dce5)',
        }}
      >
        <h1>{STUDIO_DISPLAY_NAME}</h1>
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>重新连接</button>
      </main>
    );
  }
  if (!bridge) {
    return <main style={{ padding: 36, fontFamily: 'system-ui' }}>正在连接作品库…</main>;
  }

  return (
    <StudioApp
      client={bridge.client}
      requestStudio={studioRequest}
      actor={bridge.actor}
      initialArtifactId={navigation.artifactId}
      initialView={navigation.view}
      navigationRevision={navigation.revision}
      restoredView={bridge.restoredView}
      attachContext={bridge.attachContext}
      onViewContext={bridge.updateContext}
      onNavigate={bridge.navigate}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
