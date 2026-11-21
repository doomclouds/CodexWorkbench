import type { StudioClient } from '../../../contracts/studio.js';
import { newClientId } from '../../shared/client-id.js';
import { studioDraftStorage } from '../../transport/draft-storage.js';

type DraftKind = 'canvas' | 'source' | 'document';

interface DraftMetadata {
  ownerId: string;
  recordId: string;
  generation: number;
  updatedAt: number;
  viewId?: string;
}

export interface DraftCandidate {
  key: string;
  raw: string;
  source: 'panel' | 'other' | 'legacy';
  stored: string;
  updatedAt: number;
}

export type DraftWorkspace = ReturnType<typeof createDraftWorkspace>;
export type DraftSlot = ReturnType<DraftWorkspace['open']>;

function draftMetadata(value: unknown): value is DraftMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const identity = typeof fields.ownerId === 'string' && typeof fields.recordId === 'string';
  const time = Number.isSafeInteger(fields.generation) && Number.isFinite(fields.updatedAt);
  const view = fields.viewId === undefined || typeof fields.viewId === 'string';
  return identity && time && view;
}

function candidate(
  key: string,
  stored: string,
  restoredViewId: string | undefined,
): DraftCandidate {
  const newline = stored.indexOf('\n');
  const legacy = { key, raw: stored, source: 'legacy' as const, stored, updatedAt: 0 };
  if (newline < 0) {
    return legacy;
  }

  try {
    const metadata: unknown = JSON.parse(stored.slice(0, newline));
    if (draftMetadata(metadata) && key.endsWith(`:${metadata.ownerId}:${metadata.recordId}`)) {
      return {
        key,
        raw: stored.slice(newline + 1),
        source: restoredViewId && metadata.viewId === restoredViewId ? 'panel' : 'other',
        stored,
        updatedAt: metadata.updatedAt,
      };
    }
  } catch (failure) {
    if (!(failure instanceof SyntaxError)) {
      throw failure;
    }
  }

  return legacy;
}

function legacyKey(
  kind: DraftKind,
  service: string,
  actorId: string,
  artifactId: string,
  regionId?: string,
) {
  if (kind === 'document') {
    return `studio-document-draft:${actorId}:${artifactId}:${regionId}`;
  }

  const prefix = kind === 'canvas' ? 'studio-draft' : 'studio-source-draft';
  return `${prefix}:${service}:${actorId}:${artifactId}`;
}

function earlierEmbeddedKeys(kind: 'canvas' | 'source', actorId: string, artifactId: string) {
  const prefix = kind === 'canvas' ? 'studio-draft:' : 'studio-source-draft:';
  const suffix = `:${actorId}:${artifactId}`;
  return studioDraftStorage.keys(prefix).filter((key) => {
    if (!key.endsWith(suffix)) {
      return false;
    }

    const address = key.slice(prefix.length, -suffix.length);
    return (
      address === 'embedded' ||
      /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(address)
    );
  });
}

export function createDraftWorkspace(
  client: Pick<StudioClient, 'baseUrl' | 'embedded'>,
  actorId: string,
  artifactId: string,
  viewId?: string,
  restoredViewId?: string,
) {
  const legacyService = client.baseUrl ?? 'embedded';
  const service = client.embedded ? 'embedded' : `web:${client.baseUrl ?? ''}`;
  const ownerId = newClientId('draft-owner');
  const prefix = `studio-draft-v2:${encodeURIComponent(JSON.stringify([service, actorId, artifactId]))}:`;
  let candidateKeys: string[] | undefined;

  return {
    open(kind: DraftKind, regionId?: string) {
      const area = `${prefix}${kind}:${encodeURIComponent(regionId ?? '')}:`;
      const recordId = newClientId('draft-record');
      const key = `${area}${ownerId}:${recordId}`;
      const oldKey = legacyKey(kind, legacyService, actorId, artifactId, regionId);
      let oldKeys: string[] | undefined;
      let generation = 0;
      let active: string | undefined;
      let activeRaw: string | undefined;

      return {
        list() {
          candidateKeys ??= studioDraftStorage.keys(prefix);
          const known = candidateKeys.flatMap((candidateKey) => {
            if (!candidateKey.startsWith(area) || candidateKey === key) {
              return [];
            }

            const stored = studioDraftStorage.read(candidateKey);
            return stored === null ? [] : [candidate(candidateKey, stored, restoredViewId)];
          });

          if (!oldKeys) {
            const earlier =
              client.embedded && kind !== 'document'
                ? earlierEmbeddedKeys(kind, actorId, artifactId)
                : [];
            oldKeys = [...new Set([oldKey, ...earlier])];
          }
          const legacy = oldKeys.flatMap((old) => {
            const stored = studioDraftStorage.read(old);
            return stored === null
              ? []
              : [{ key: old, raw: stored, stored, source: 'legacy' as const, updatedAt: 0 }];
          });

          return [...known, ...legacy].sort(
            (a, b) =>
              Number(b.source === 'panel') - Number(a.source === 'panel') ||
              b.updatedAt - a.updatedAt ||
              a.key.localeCompare(b.key),
          );
        },
        matches(choice: DraftCandidate) {
          const inScope = oldKeys?.includes(choice.key) || choice.key.startsWith(area);
          return inScope && studioDraftStorage.read(choice.key) === choice.stored;
        },
        write(raw: string) {
          if (raw === activeRaw && active !== undefined) {
            return active;
          }

          generation += 1;
          const header: DraftMetadata = {
            ownerId,
            recordId,
            generation,
            updatedAt: Date.now(),
            viewId,
          };
          const record = `${JSON.stringify(header)}\n${raw}`;
          studioDraftStorage.write(key, record);
          active = record;
          activeRaw = raw;
          return record;
        },
        current() {
          return active;
        },
        clear(expected = active) {
          if (expected === undefined || studioDraftStorage.read(key) !== expected) {
            return false;
          }

          studioDraftStorage.remove(key);
          if (active === expected) {
            active = undefined;
            activeRaw = undefined;
          }

          return true;
        },
      };
    },
  };
}
