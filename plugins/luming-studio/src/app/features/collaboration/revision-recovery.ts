import type { StudioEvent } from '../../../contracts/studio';
import { isRecord } from '../../../shared/is-record';

function verifiedChanges(event: StudioEvent): boolean {
  const ids = event.changedIds;
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string')) {
    return false;
  }
  if (new Set(ids).size !== ids.length) {
    return false;
  }
  if (!Array.isArray(event.units)) {
    return event.units === undefined && ids.length > 0;
  }
  if (event.units.some((unit) => !isRecord(unit) || typeof unit.id !== 'string')) {
    return false;
  }

  const units = new Set(event.units.map((unit) => unit.id));

  return units.size === ids.length && ids.every((id) => units.has(id));
}

export function missedRevisions(
  events: readonly StudioEvent[],
  artifactId: string,
  applied: number,
  target: number,
): StudioEvent[] | undefined {
  const changes: StudioEvent[] = [];
  let revision = applied;
  for (const event of events) {
    if (!isRecord(event)) {
      return;
    }
    if (event.artifactId !== artifactId || event.type !== 'board') {
      continue;
    }
    if (typeof event.revision !== 'number' || event.revision <= revision) {
      continue;
    }

    const sameArtifact =
      event.artifact?.id === artifactId && event.artifact.revision === event.revision;

    if (event.revision !== revision + 1 || !sameArtifact || !verifiedChanges(event)) {
      return;
    }

    changes.push(event);
    revision = event.revision;
    if (revision === target) {
      return changes;
    }
  }
}
