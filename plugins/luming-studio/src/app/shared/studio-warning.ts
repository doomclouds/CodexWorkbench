export function reportStudioWarning(message: string, error: unknown): void {
  console.warn(message, error instanceof Error ? error.name : typeof error);
}
