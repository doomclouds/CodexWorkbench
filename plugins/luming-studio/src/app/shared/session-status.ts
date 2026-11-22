const ACCESS_REASONS = [
  'removed',
  'sharing-closed',
  'link-disabled',
  'link-reset',
  'invalid-link',
  'local-only',
] as const;

export type AccessReason = (typeof ACCESS_REASONS)[number];
export type SessionStatus = 'valid' | 'checking' | 'reconnecting' | 'denied';

export function accessReason(value: unknown): AccessReason | undefined {
  return ACCESS_REASONS.includes(value as AccessReason) ? (value as AccessReason) : undefined;
}
