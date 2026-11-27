import { useLayoutEffect, useRef, useState } from 'react';
import type { WhiteboardService } from '../../data/whiteboard/index.js';
import type {
  CanvasObjectIntent,
  CanvasObjectKind,
  CanvasObjectReceipt,
} from '../../ui/domain/canvas/index.js';
import { readContentEdit } from './content-edit-command.js';

export interface LocalBoardDraftEntry {
  readonly id: string;
  readonly data: string;
}

export interface LocalBoardDraftStorage {
  readonly createId: () => string;
  readonly list: (scope: string) => readonly LocalBoardDraftEntry[];
  readonly write: (scope: string, id: string, data: string) => void;
  readonly remove: (scope: string, id: string) => void;
}

export interface LocalBoardDraftConfig {
  readonly actorId: string;
  readonly storage: LocalBoardDraftStorage;
}

export interface LocalBoardDraft {
  readonly id: string;
  readonly data: string;
  readonly intent: CanvasObjectIntent;
}

interface ScopedDraft {
  readonly scope: string;
  readonly storage: LocalBoardDraftStorage;
}

export interface CapturedDraft extends ScopedDraft {
  readonly id: string;
}

interface MemoryDraft {
  readonly scope: string;
  readonly entry: LocalBoardDraftEntry;
}

interface DraftPresence {
  readonly scope?: string;
  readonly hasEntries?: boolean;
  readonly message?: string;
}

export interface BoardDraftCurrent {
  readonly canEdit: boolean;
  readonly kind?: string;
  readonly version?: bigint;
  readonly value?: unknown;
}

export interface LocalDraftAccess {
  readonly scope: string;
  readonly hasEntries: boolean;
  readonly storageError: string;
  readonly active: () => boolean;
  readonly list: () => readonly LocalBoardDraft[];
  readonly remove: (id: string) => void;
}

export interface BoardDraftAccess extends LocalDraftAccess {
  readonly restore: (draft: LocalBoardDraft) => Promise<CanvasObjectReceipt>;
}

const maxDraftCharacters = 2 * 1024 * 1024;
const maxMemoryDrafts = 16;
const draftIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const knownKinds = new Set<string>([
  'text',
  'note',
  'shape',
  'section',
  'connector',
  'document',
  'todo',
  'table',
  'html',
  'sticker',
  'image',
  'link',
]);

function draftKind(value: unknown): value is CanvasObjectKind {
  return typeof value === 'string' && knownKinds.has(value);
}

function draftVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function unpackEntry(entry: LocalBoardDraftEntry): LocalBoardDraft | undefined {
  if (!draftIdPattern.test(entry.id) || entry.data.length > maxDraftCharacters) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.data);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }

    throw error;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const raw = parsed as Record<string, unknown>;
  const { objectId, kind, expectedVersion, name, value } = raw;
  const identityValid = typeof objectId === 'string' && Boolean(objectId.trim());
  if (!identityValid || !draftKind(kind) || !draftVersion(expectedVersion)) {
    return undefined;
  }
  if (typeof name !== 'string') {
    return undefined;
  }

  const intent = { objectId, kind, expectedVersion, name, value };

  return readContentEdit(intent) ? { ...entry, intent } : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '本机草稿无法读取。';
}

function initialDraftPresence(
  scope: string | undefined,
  storage: LocalBoardDraftStorage | undefined,
): DraftPresence {
  if (scope === undefined || storage === undefined) {
    return {};
  }

  try {
    return { scope, hasEntries: storage.list(scope).some((entry) => Boolean(unpackEntry(entry))) };
  } catch (error) {
    return { scope, message: '不能读取本机保存的草稿。' + errorText(error) };
  }
}

function keyOf(scope: string, id: string): string {
  return JSON.stringify([scope, id]);
}

function localEntries(
  persisted: readonly LocalBoardDraftEntry[],
  scope: string,
  memory: ReadonlyMap<string, MemoryDraft>,
): readonly LocalBoardDraft[] {
  const entries = new Map(persisted.map((entry) => [entry.id, entry]));
  for (const draft of memory.values()) {
    if (draft.scope === scope) {
      entries.set(draft.entry.id, draft.entry);
    }
  }

  const result: LocalBoardDraft[] = [];
  for (const entry of entries.values()) {
    const draft = unpackEntry(entry);
    if (draft) {
      result.push(draft);
    }
  }

  return result;
}

export function useLocalBoardDrafts(
  config: LocalBoardDraftConfig | undefined,
  boardId: string,
  editable: boolean,
) {
  const key = config ? JSON.stringify([config.actorId, boardId]) : undefined;
  const storage = config?.storage;
  const [unavailable, setUnavailable] = useState<string>();
  const [presence, setPresence] = useState(() =>
    initialDraftPresence(editable ? key : undefined, storage),
  );
  const enabled = Boolean(storage && key && editable && unavailable !== key);
  const live = useRef<ScopedDraft | undefined>(undefined);
  const memory = useRef(new Map<string, MemoryDraft>());

  useLayoutEffect(() => {
    live.current = enabled && key && storage ? { scope: key, storage } : undefined;

    return () => {
      live.current = undefined;
    };
  }, [enabled, key, storage]);

  function active(scope: string, vault: LocalBoardDraftStorage) {
    return live.current?.scope === scope && live.current.storage === vault;
  }

  function note(scope: string, message: string) {
    setPresence((current) => ({ ...current, scope, message }));
  }

  function remember(intent: CanvasObjectIntent, existingId?: string): CapturedDraft | undefined {
    const source = live.current;
    if (!source) {
      return undefined;
    }
    if (existingId !== undefined) {
      return { ...source, id: existingId };
    }

    const { scope, storage } = source;
    let data: string;
    let id: string;
    try {
      data = JSON.stringify(intent);
      id = storage.createId();
      if (data.length > maxDraftCharacters) {
        note(scope, '草稿超过本机保存范围。关闭前请在编辑器中复制。');

        return undefined;
      }
    } catch (error) {
      note(scope, '本机草稿未生成。' + errorText(error));

      return undefined;
    }

    try {
      storage.write(scope, id, data);
    } catch (error) {
      if (memory.current.size < maxMemoryDrafts) {
        memory.current.set(keyOf(scope, id), { scope, entry: { id, data } });
        note(scope, '本机草稿未能保存。关闭前请复制或下载当前草稿。' + errorText(error));
      } else {
        note(scope, '本机草稿未能保存。关闭前请在编辑器中复制。' + errorText(error));
      }
    }

    return { ...source, id };
  }

  function remove({ scope, id, storage }: CapturedDraft): void {
    if (!memory.current.delete(keyOf(scope, id))) {
      storage.remove(scope, id);
    }
  }

  function confirm(draft: CapturedDraft | undefined): void {
    if (!draft) {
      return;
    }

    try {
      remove(draft);
      if (presence.hasEntries && active(draft.scope, draft.storage)) {
        read(draft.scope, draft.storage);
      }
    } catch (error) {
      if (active(draft.scope, draft.storage)) {
        note(draft.scope, '无法清理本机草稿。' + errorText(error));
      }
    }
  }

  function revoke(): void {
    const source = live.current;
    if (source) {
      live.current = undefined;
      setUnavailable(source.scope);
    }
  }

  function read(scope: string, vault: LocalBoardDraftStorage): readonly LocalBoardDraft[] {
    if (!active(scope, vault)) {
      return [];
    }

    let persisted: readonly LocalBoardDraftEntry[] = [];
    try {
      persisted = vault.list(scope);
    } catch (error) {
      note(scope, '不能读取本机保存的草稿。' + errorText(error));
    }

    const entries = localEntries(persisted, scope, memory.current);
    const hasEntries = entries.length > 0;
    setPresence((current) =>
      current.scope === scope && current.hasEntries === hasEntries
        ? current
        : { ...current, scope, hasEntries },
    );

    return entries;
  }

  function retain(draft: CapturedDraft | undefined): void {
    if (draft && active(draft.scope, draft.storage)) {
      setPresence((current) => ({ ...current, scope: draft.scope, hasEntries: true }));
    }
  }

  function draftAccess(scope: string, vault: LocalBoardDraftStorage): LocalDraftAccess {
    return {
      scope,
      hasEntries: presence.scope === scope && Boolean(presence.hasEntries),
      active: () => active(scope, vault),
      list: () => read(scope, vault),
      remove: (id) => {
        if (active(scope, vault)) {
          remove({ scope, storage: vault, id });
        }
      },
      storageError: presence.scope === scope ? (presence.message ?? '') : '',
    };
  }

  return {
    remember,
    confirm,
    retain,
    revoke,
    access: enabled && key && storage ? draftAccess(key, storage) : undefined,
  };
}

type DraftReadService = Pick<WhiteboardService, 'getScene' | 'getPayloads'>;

export async function readBoardDraftCurrent(
  service: DraftReadService,
  boardId: string,
  objectId: string,
  signal: AbortSignal,
): Promise<BoardDraftCurrent> {
  const scene = await service.getScene(boardId, signal);
  if (scene.boardId !== boardId || !scene.canEdit || signal.aborted) {
    return { canEdit: false };
  }

  const object = scene.objects.find(({ id }) => id === objectId);
  if (!object) {
    return { canEdit: true };
  }

  const result = await service.getPayloads(boardId, [objectId], signal);
  if (signal.aborted) {
    return { canEdit: false };
  }

  const loaded = result.find((entry) => entry.kind === 'loaded' && entry.payload.id === objectId);
  const payload = loaded?.kind === 'loaded' ? loaded.payload : undefined;

  return {
    canEdit: true,
    kind: object.kind,
    version: payload?.version,
    value: payload?.body.kind === 'ink' ? payload.body.points : payload?.body.value,
  };
}
