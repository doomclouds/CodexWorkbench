import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { STUDIO_TOOLS, type StudioClient } from '../../../contracts/studio';
import type { StudioViewRequests, StudioViewScope } from '../../shared/studio-view-scope';
import type { EditorShareState, ShareRole } from './SharePanel';

export type SharingAction =
  | 'start'
  | 'stop'
  | 'reset'
  | 'link'
  | 'role'
  | 'remove'
  | 'restore'
  | 'forget';

export interface SharingOptions {
  role?: string;
  on?: boolean;
  memberId?: string;
  access?: 'local' | 'lan';
}

interface UseStudioSharingOptions {
  client: StudioClient;
  scope: StudioViewRequests;
  authorityKey: string;
  access: EditorShareState['access'];
  enabled: boolean;
  busy: string;
  setBusy: Dispatch<SetStateAction<string>>;
  setError: (message: string) => void;
  reportFailure: (cause: unknown, retry?: () => void) => void;
  copyLink: (link: string, scope: StudioViewScope) => Promise<void>;
}

export async function loadOrStartSharing(client: StudioClient, artifactId: string) {
  const share = await client.call<EditorShareState>(STUDIO_TOOLS.share, {
    action: 'status',
    artifactId,
  });

  if (share.enabled) {
    return share;
  }

  return client.call<EditorShareState>(STUDIO_TOOLS.share, {
    action: 'start',
    artifactId,
    access: 'local',
  });
}

export function useStudioSharing({
  client,
  scope,
  authorityKey,
  access,
  enabled,
  busy,
  setBusy,
  setError,
  reportFailure,
  copyLink,
}: UseStudioSharingOptions) {
  const [share, setShare] = useState<EditorShareState | null>(null);
  const sequence = useRef(0);
  const authority = useRef(0);
  const mutation = useRef(0);
  useLayoutEffect(() => {
    sequence.current += 1;
    authority.current += 1;
  }, [authorityKey]);

  const loadShare = useCallback(async () => {
    const request = scope.capture();
    if (!request.artifactId || busy === 'share') {
      return;
    }

    const serial = ++sequence.current;
    const isCurrent = () => serial === sequence.current && scope.isCurrent(request);
    try {
      const result = await client.call<EditorShareState>(STUDIO_TOOLS.share, {
        action: 'status',
        artifactId: request.artifactId,
      });

      if (isCurrent()) {
        setShare(result);
      }
    } catch (cause) {
      if (isCurrent()) {
        reportFailure(cause, () => {
          if (scope.isCurrent(request)) {
            void loadShare().catch(reportFailure);
          }
        });
      }
    }
  }, [busy, client, reportFailure, scope]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void loadShare().catch(reportFailure);
    const refresh = () => {
      if (document.visibilityState !== 'hidden') {
        void loadShare().catch(reportFailure);
      }
    };
    const timer = window.setInterval(refresh, 4000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [access, authorityKey, enabled, loadShare, reportFailure]);

  const stopSharingWork = useCallback(() => {
    setBusy((previous) => (previous === 'share' ? '' : previous));
  }, [setBusy]);

  const clear = useCallback(() => {
    sequence.current += 1;
    mutation.current += 1;
    setShare(null);
    stopSharingWork();
  }, [stopSharingWork]);

  const updateAccess = useCallback((next: unknown) => {
    sequence.current += 1;
    if (next === 'local' || next === 'lan') {
      setShare((previous) => previous && { ...previous, access: next });
    }
  }, []);

  function beginSharing(request: StudioViewScope) {
    sequence.current += 1;
    const serial = ++mutation.current;
    const authorization = authority.current;
    const ownsBusy = () => serial === mutation.current && scope.isCurrent(request);
    setBusy('share');
    setError('');

    return {
      isCurrent: () => ownsBusy() && authorization === authority.current,
      finish() {
        if (ownsBusy()) {
          stopSharingWork();
        }
      },
    };
  }

  async function changeSharing(action: SharingAction, options: SharingOptions = {}) {
    const request = scope.capture();
    if (!request.artifactId || busy) {
      return false;
    }

    const sharing = beginSharing(request);
    try {
      const result = await client.call<EditorShareState>(STUDIO_TOOLS.share, {
        artifactId: request.artifactId,
        action,
        ...options,
      });

      if (sharing.isCurrent()) {
        setShare(result);
      }

      return true;
    } catch (cause) {
      if (sharing.isCurrent()) {
        reportFailure(cause, () => {
          if (sharing.isCurrent()) {
            void changeSharing(action, options).catch(reportFailure);
          }
        });
      }

      return false;
    } finally {
      sharing.finish();
    }
  }

  async function copyInvitation(link: string | undefined, role: ShareRole) {
    const request = scope.capture();
    if (!request.artifactId || busy) {
      return;
    }

    if (link) {
      await copyLink(link, request);
      return;
    }
    if (share?.enabled) {
      reportFailure(new Error('该角色的邀请链接不可用，请重新读取分享权限。'));
      return;
    }

    const sharing = beginSharing(request);
    try {
      const result = await client.call<EditorShareState>(STUDIO_TOOLS.share, {
        artifactId: request.artifactId,
        action: 'start',
        access: 'local',
      });

      if (!sharing.isCurrent()) {
        return;
      }

      setShare(result);
      const invitation = result.links?.[role];
      if (!invitation) {
        throw new Error('该角色的邀请链接不可用，请重新读取分享权限。');
      }

      await copyLink(invitation, request);
    } catch (cause) {
      if (sharing.isCurrent()) {
        reportFailure(cause);
      }
    } finally {
      sharing.finish();
    }
  }

  return { share, setShare, loadShare, changeSharing, copyInvitation, clear, updateAccess };
}
