const payloadKinds = new Set([
  'text',
  'document',
  'embed',
  'todo',
  'table',
  'image',
  'video',
  'link',
  'sticker',
  'ink',
  'extension',
]);

export function isSupportedPayload(bodyKind: string): boolean {
  return payloadKinds.has(bodyKind);
}
