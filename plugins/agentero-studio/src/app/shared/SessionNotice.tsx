import { Loader2, ShieldAlert, WifiOff } from 'lucide-react';
import { useLayoutEffect, type RefObject } from 'react';
import type { AccessReason, SessionStatus } from './useStudioSession';
import './session.css';

const reasons: Record<AccessReason, string> = {
  removed: '房主已移除你的访问权限，请联系房主',
  'sharing-closed': '房主已停止分享此白板，请联系房主。',
  'link-disabled': '此分享链接已关闭，请联系房主。',
  'link-reset': '此分享链接已重置，请向房主索取新链接。',
  'invalid-link': '此分享链接已失效，请向房主索取有效链接。',
  'local-only': '此白板已改为仅本机访问，请联系房主。',
};

function suspendStudioPortals(node: HTMLElement, hidePortals: boolean) {
  const previous = new Map<
    HTMLElement,
    { hidden: HTMLElement['hidden']; inert: boolean; ariaHidden: string | null }
  >();
  const update = () => {
    for (const child of node.children) {
      const belongsToSession = child.matches(
        '.studio-session-message, .studio-session-status, .studio-session-content',
      );

      if (!(child instanceof HTMLElement) || belongsToSession || previous.has(child)) {
        continue;
      }

      previous.set(child, {
        hidden: child.hidden,
        inert: child.inert,
        ariaHidden: child.getAttribute('aria-hidden'),
      });
      child.inert = true;
      if (hidePortals) {
        child.hidden = true;
        child.setAttribute('aria-hidden', 'true');
      }
    }
  };

  update();
  node.querySelector<HTMLElement>('.studio-session-message')?.focus({ preventScroll: true });
  const observer = new MutationObserver(update);
  observer.observe(node, { childList: true });

  return () => {
    observer.disconnect();
    for (const [child, value] of previous) {
      child.hidden = value.hidden;
      child.inert = value.inert;
      if (value.ariaHidden === null) {
        child.removeAttribute('aria-hidden');
      } else {
        child.setAttribute('aria-hidden', value.ariaHidden);
      }
    }
  };
}

export function useSessionVisibility(root: RefObject<HTMLElement | null>, status: SessionStatus) {
  useLayoutEffect(() => {
    const node = root.current;
    if (node && status !== 'valid') {
      return suspendStudioPortals(node, status === 'denied');
    }
  }, [root, status]);
}

export function SessionNotice({
  status,
  reason,
  onRetry,
}: {
  status: SessionStatus;
  reason?: AccessReason;
  onRetry: () => void;
}) {
  if (status === 'valid') {
    return null;
  }
  if (status === 'denied') {
    return (
      <main
        className="studio-session-message"
        aria-labelledby="studio-access-title"
        role="alert"
        tabIndex={-1}
      >
        <ShieldAlert size={30} />
        <h1 id="studio-access-title">无法访问此白板</h1>
        <p>{reasons[reason || 'invalid-link']}</p>
        <p className="studio-session-draft-note">本页尚未提交的草稿未发送。</p>
      </main>
    );
  }

  return (
    <div className="studio-session-status" role="status">
      {status === 'checking' ? (
        <Loader2 size={16} className="studio-spin" />
      ) : (
        <WifiOff size={16} />
      )}
      <span>
        {status === 'checking'
          ? '正在核对访问权限，编辑已暂停。'
          : '连接已中断，正在重新连接。未提交的草稿已保留。'}
      </span>
      {status === 'reconnecting' && (
        <button type="button" className="studio-link-button" onClick={onRetry}>
          重新连接
        </button>
      )}
    </div>
  );
}
