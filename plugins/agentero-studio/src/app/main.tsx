import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import StudioApp from './StudioApp';
import { createStudioBridge, type StudioBridge } from './bridge';
import HtmlReader from './HtmlReader';

function Root() {
  const [bridge, setBridge] = useState<StudioBridge>();
  const [navigation, setNavigation] = useState<{ artifactId?: string; view: string; revision: number }>({ view: 'library', revision: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false; let active: StudioBridge | undefined;
    void createStudioBridge((artifactId, view) => {
      if (!disposed) setNavigation(current => ({ artifactId, view: view || (artifactId ? 'editor' : 'library'), revision: current.revision + 1 }));
    }).then(value => {
      active = value;
      if (!disposed) {
        setBridge(value);
        setNavigation(current => ({ artifactId: value.artifactId, view: value.view || (value.artifactId ? 'editor' : 'library'), revision: current.revision }));
      } else void value.close();
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '无法连接作品服务'); });
    return () => { disposed = true; void active?.close(); };
  }, []);
  if (error) return <main style={{ padding: 36, fontFamily: 'system-ui', color: 'var(--color-text-primary, #d9dce5)' }}><h1>Agentero 创作</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>重新连接</button></main>;
  if (!bridge) return <main style={{ padding: 36, fontFamily: 'system-ui' }}>正在连接作品库…</main>;
  return <StudioApp client={bridge.client} actor={bridge.actor} initialArtifactId={navigation.artifactId} initialView={navigation.view} navigationRevision={navigation.revision} attachContext={bridge.attachContext} onViewContext={bridge.updateContext} />;
}
const reader = window.__STUDIO_READER_BOOT__;
createRoot(document.getElementById('root')!).render(reader ? <HtmlReader {...reader} /> : <Root />);
