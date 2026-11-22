export class StudioError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StudioError';
  }
}

export function safeId(value: unknown, label = '作品 ID'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)) {
    throw new StudioError('INVALID_ARGUMENT', `${label}无效。`);
  }

  return value;
}

export function text(value: unknown, fallback = '', maximum = 20_000): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || value.length > maximum) {
    throw new StudioError('INVALID_ARGUMENT', '文字内容无效或过长。');
  }

  return value;
}

export function invalidArchive(
  message = '备份文件无效或不完整。',
  options?: ErrorOptions,
): StudioError {
  return new StudioError('INVALID_ARCHIVE', message, undefined, options);
}
