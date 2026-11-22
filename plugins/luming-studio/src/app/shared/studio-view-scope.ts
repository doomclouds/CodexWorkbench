export interface StudioViewScope {
  readonly viewId: string;
  readonly artifactId: string;
  readonly navigationGeneration: number;
}

export interface StudioViewRequests {
  capture(): StudioViewScope;
  isCurrent(scope: StudioViewScope): boolean;
}

export function isCurrentStudioViewScope(
  request: StudioViewScope,
  active: StudioViewScope | undefined,
): boolean {
  if (!active) {
    return false;
  }

  return (
    request.viewId === active.viewId &&
    request.artifactId === active.artifactId &&
    request.navigationGeneration === active.navigationGeneration
  );
}
