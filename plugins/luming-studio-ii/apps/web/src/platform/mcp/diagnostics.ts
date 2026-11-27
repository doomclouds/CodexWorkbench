export function reportMcpWarning(message: string, error: unknown) {
  console.warn(message, error instanceof Error ? error.name : 'UnknownError');
}
