import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { AgentTaskReleaseTarget, Anchor, Presence } from '../../../contracts/studio';
import {
  useCollaboration,
  useRoomTimer,
  useStudioSharing,
  useViewportFollow,
  releaseWorkspace,
} from '../../features/collaboration';
import { useVersionHistory } from '../../features/history';
import { useStudioFeedback } from '../../features/feedback';
import type { StudioDocument } from '../../product-contract';
import { getProduct, products } from '../../products';
import type { StudioViewRequests } from '../../shared/studio-view-scope';
import type { EditorPanel } from './StudioEditorView';

type CollaborationOptions = Omit<
  Parameters<typeof useCollaboration>[0],
  'applyRemoteEvent' | 'onClock' | 'onPresence'
>;

export function getEditorProduct(board: StudioDocument | null) {
  return getProduct(board?.artifact.type || products[0]!.id)!;
}

export function locateEditorAnchor(document: StudioDocument, anchor: Anchor) {
  return getProduct(document.artifact.type)?.locateAnchor?.(document, anchor);
}

export function useEditorFeedback(
  panel: EditorPanel | null,
  options: Omit<Parameters<typeof useStudioFeedback>[0], 'panelOpen'>,
) {
  return useStudioFeedback({ ...options, panelOpen: panel === 'feedback' });
}

export function useEditorCollaboration(
  scope: StudioViewRequests,
  options: CollaborationOptions,
  onPeers: (peers: Presence[]) => void,
) {
  const timer = useRoomTimer(scope);
  const collaboration = useCollaboration({
    ...options,
    scope,
    applyRemoteEvent: (current, event) =>
      getProduct(current.artifact.type)?.applyRemoteEvent?.(current, event),
    onClock: timer.setClockOffsetMs,
    onPresence(peers, currentTimer) {
      onPeers(peers);
      timer.setRoomTimer(currentTimer);
    },
  });

  const { client } = options;
  const releaseAgentWorkspace = useCallback(
    (target: AgentTaskReleaseTarget, allowed: boolean) =>
      releaseWorkspace(client, scope, target, allowed),
    [client, scope],
  );

  return { collaboration, timer, releaseAgentWorkspace };
}

export function useEditorFollowing(
  options: Omit<Parameters<typeof useViewportFollow>[0], 'following' | 'onStop'>,
) {
  const [following, setFollowing] = useState('');
  const stopMotion = useRef<(() => void) | undefined>(undefined);
  const stopFollowing = useCallback(() => {
    stopMotion.current?.();
    setFollowing('');
  }, []);
  const follow = useViewportFollow({ ...options, following, onStop: stopFollowing });
  useLayoutEffect(() => {
    stopMotion.current = follow.stop;
  }, [follow.stop]);

  return {
    following,
    setFollowing,
    stopFollowing,
    followedPeer: follow.peer,
    followedViewport: follow.viewport,
  };
}

interface EditorPanelOptions {
  history: Omit<Parameters<typeof useVersionHistory>[0], 'open'>;
  sharing: Omit<Parameters<typeof useStudioSharing>[0], 'busy' | 'enabled'>;
  accessPending: boolean;
}

export function useEditorPanels(panel: EditorPanel | null, options: EditorPanelOptions) {
  const history = useVersionHistory({ ...options.history, open: panel === 'history' });
  const busy = options.history.operationBusy || history.previewBusy;
  const sharing = useStudioSharing({
    ...options.sharing,
    busy,
    enabled: panel === 'share' && !options.accessPending,
  });

  return { history, sharing, busy };
}
