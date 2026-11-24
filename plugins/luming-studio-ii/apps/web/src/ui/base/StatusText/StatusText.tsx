import './StatusText.css';

export type StatusTextTone = 'neutral' | 'success' | 'warning' | 'error';
export type StatusTextAnnouncement = 'off' | 'polite' | 'assertive';

export interface StatusTextProps {
  message: string;
  tone?: StatusTextTone;
  busy?: boolean;
  announcement?: StatusTextAnnouncement;
}

const liveRoles = {
  off: undefined,
  polite: 'status',
  assertive: 'alert',
} as const;

export function StatusText({
  message,
  tone = 'neutral',
  busy = false,
  announcement = 'off',
}: StatusTextProps) {
  return (
    <span
      className="studio-ui-status-text"
      data-tone={tone}
      role={liveRoles[announcement]}
      aria-live={announcement === 'off' ? 'off' : undefined}
      aria-busy={busy || undefined}
    >
      {busy && <span className="studio-ui-status-text__busy" aria-hidden="true" />}
      <span>{message}</span>
    </span>
  );
}
