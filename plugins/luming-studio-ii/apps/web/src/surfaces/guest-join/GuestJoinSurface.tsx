import { Loader2, ShieldAlert, WifiOff } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import type { BoardSharingService } from '../../data/sharing/index.js';
import { Button, StatusText } from '../../ui/base/index.js';
import './guest-access.css';

type GuestJoinService = Pick<BoardSharingService, 'inspectBoardInvitation' | 'joinBoardInvitation'>;
type JoinResult = Awaited<ReturnType<GuestJoinService['joinBoardInvitation']>>;
type GuestSession = Extract<JoinResult, { kind: 'joined' }>['session'];
type InspectionResult = Awaited<ReturnType<GuestJoinService['inspectBoardInvitation']>>;
type InvitationDetails = Extract<InspectionResult, { kind: 'available' }>['invitation'];

export interface GuestJoinSurfaceProps {
  readonly boardId: string;
  readonly invitationToken: string;
  readonly service: GuestJoinService;
  readonly onJoined: (session: GuestSession) => void;
  readonly onCancel?: () => void;
}

interface GuestAccessLostProps {
  readonly message?: string;
  readonly onExit?: () => void;
  readonly activeSession?: boolean;
}

type InvitationView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'available'; readonly invitation: InvitationDetails }
  | { readonly kind: 'denied'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

const roleActions = { editor: '编辑', commenter: '评论', viewer: '查看' };
const nameMessages = new Map([
  ['nameTaken', '这个名字已经有人使用，请换一个名字。'],
  ['invalidCommand', '请输入有效的名字。'],
]);
const maximumGuestNameLength = 60;
const unavailableInvitation = '这个邀请链接已失效。';
const getNewInvitation = '请向所有者索取有效链接。';

function GuestCard({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <main className="guest-access">
      <section className="guest-access__card">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function GuestAccessLostSurface({
  message,
  onExit,
  activeSession = false,
}: GuestAccessLostProps) {
  if (activeSession) {
    return <GuestSessionDenied message={message} onExit={onExit} />;
  }

  return (
    <GuestCard title="无权访问">
      <p role="alert">
        {message ?? '这块白板没有分享给你。'}
        {getNewInvitation}
      </p>
      {onExit && <Button label="退出此白板" variant="primary" onActivate={onExit} />}
    </GuestCard>
  );
}

function GuestSessionDenied({ message, onExit }: Pick<GuestAccessLostProps, 'message' | 'onExit'>) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main
      ref={panel}
      className="guest-session-denied"
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
    >
      <ShieldAlert size={30} aria-hidden="true" />
      <h1 id={titleId}>无法访问此白板</h1>
      <p>{message ?? '当前访问权限已失效。'} 请联系房主。</p>
      <p className="guest-session-denied__draft">本页尚未提交的草稿未发送。</p>
      {onExit && <Button label="退出此白板" variant="ghost" onActivate={onExit} />}
    </main>
  );
}

export function GuestSessionPendingSurface({
  activeSession,
  message,
  onRetry,
}: {
  readonly activeSession: boolean;
  readonly message?: string;
  readonly onRetry: () => void;
}) {
  if (!activeSession) {
    return (
      <GuestCard title="打开白板">
        {message ? (
          <>
            <p role="alert">{message}</p>
            <Button label="重新连接" variant="primary" onActivate={onRetry} />
          </>
        ) : (
          <StatusText message="正在验证白板访问权限…" busy announcement="polite" />
        )}
      </GuestCard>
    );
  }

  return (
    <div className="guest-session-connection" role="status">
      {message ? (
        <WifiOff size={16} aria-hidden="true" />
      ) : (
        <Loader2 className="guest-session-connection__loading" size={16} aria-hidden="true" />
      )}
      <span>{message ? '连接已中断，正在重新连接。' : '正在核对访问权限，编辑已暂停。'}</span>
      {message && (
        <button type="button" className="guest-session-connection__retry" onClick={onRetry}>
          重新连接
        </button>
      )}
    </div>
  );
}

interface GuestNameFormProps {
  readonly invitation: InvitationDetails;
  readonly busy: boolean;
  readonly error?: string;
  readonly onJoin: (name: string) => void;
  readonly onCancel?: () => void;
}

function GuestNameForm({ invitation, busy, error, onJoin, onCancel }: GuestNameFormProps) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = fieldId + '-error';

  useLayoutEffect(() => {
    if (!busy) {
      input.current?.focus();
    }
  }, [busy]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed && !busy) {
      onJoin(trimmed);
    }
  }

  return (
    <GuestCard title={invitation.title}>
      <p>你被邀请{roleActions[invitation.role]}这块白板。</p>
      {error && (
        <p id={errorId} role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <label htmlFor={fieldId}>你的名字（别人会在你的评论和编辑上看到它）</label>
        <input
          ref={input}
          id={fieldId}
          name="name"
          type="text"
          autoComplete="nickname"
          maxLength={maximumGuestNameLength}
          required
          disabled={busy}
          value={name}
          aria-invalid={error !== undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Button
          label="打开白板"
          type="submit"
          variant="primary"
          disabled={!name.trim()}
          busy={busy}
        />
      </form>
      <p className="guest-access__note">这个浏览器会记住你的身份；所有者可以随时移除。</p>
      {onCancel && <Button label="取消" variant="ghost" onActivate={onCancel} />}
    </GuestCard>
  );
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : '无法连接白板服务，请重试。';
}

function GuestInvite({
  boardId,
  invitationToken,
  service,
  onJoined,
  onCancel,
}: GuestJoinSurfaceProps) {
  const [view, setView] = useState<InvitationView>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const lifecycle = useRef<AbortController>(undefined);
  const joining = useRef(false);
  const restoreSession = useEffectEvent(onJoined);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const { signal } = controller;
    service
      .inspectBoardInvitation({ boardId, invitationToken }, signal)
      .then((result) => {
        if (signal.aborted) {
          return;
        }

        if (result.kind === 'joined') {
          restoreSession(result.session);
          return;
        }

        setView(
          result.kind === 'available' ? result : { kind: 'denied', message: unavailableInvitation },
        );
      })
      .catch((failure: unknown) => {
        if (!signal.aborted) {
          setView({ kind: 'failed', message: failureMessage(failure) });
        }
      });

    return () => {
      controller.abort();
      joining.current = false;
    };
  }, [boardId, invitationToken, service, retry]);

  function settleJoin(result: JoinResult) {
    if (result.kind === 'joined') {
      onJoined(result.session);

      return;
    }
    const message = nameMessages.get(result.reason);
    if (message) {
      setError(message);
    } else {
      setView({ kind: 'denied', message: unavailableInvitation });
    }
  }

  function handleJoin(name: string) {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || joining.current) {
      return;
    }

    joining.current = true;
    setBusy(true);
    setError(undefined);
    service
      .joinBoardInvitation({ boardId, invitationToken, name }, signal)
      .then((result) => {
        if (!signal.aborted) {
          settleJoin(result);
        }
      })
      .catch((failure: unknown) => {
        if (!signal.aborted) {
          setError(failureMessage(failure));
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          joining.current = false;
          setBusy(false);
        }
      });
  }

  function cancel() {
    lifecycle.current?.abort();
    onCancel?.();
  }

  function handleRetry() {
    setView({ kind: 'loading' });
    setRetry((value) => value + 1);
  }

  if (view.kind === 'available') {
    return (
      <GuestNameForm
        invitation={view.invitation}
        busy={busy}
        error={error}
        onJoin={handleJoin}
        onCancel={onCancel ? cancel : undefined}
      />
    );
  }
  if (view.kind === 'denied') {
    return <GuestAccessLostSurface message={view.message} onExit={onCancel ? cancel : undefined} />;
  }
  if (view.kind === 'failed') {
    return (
      <GuestCard title="无法读取邀请">
        <p role="alert">{view.message}</p>
        <Button label="重试" variant="primary" onActivate={handleRetry} />
      </GuestCard>
    );
  }

  return (
    <GuestCard title="打开白板">
      <StatusText message="正在验证邀请…" busy announcement="polite" />
    </GuestCard>
  );
}

export function GuestJoinSurface(props: GuestJoinSurfaceProps) {
  return <GuestInvite key={props.boardId + ':' + props.invitationToken} {...props} />;
}
