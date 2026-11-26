import { rewriteCopyMarkup, rewriteCopyText } from './copy-asset-markup.js';

type StoredPayload = Record<string, unknown>;
type AssetResolver = (source: string) => string;

export interface CopyPayloadScope {
  readonly sourceBoardId: string;
  readonly destinationBoardId: string;
  readonly onAsset: (assetId: string) => void;
}

const assetPath = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;

export class CopyPayloadError extends Error {
  constructor() {
    super('The source board contains an unreadable payload.');
  }
}

function record(value: unknown): StoredPayload | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as StoredPayload;
}

function replaceField(body: StoredPayload, field: string, replace: AssetResolver): void {
  const value = body[field];
  if (typeof value === 'string') {
    body[field] = replace(value);
  }
}

function rewriteDocument(body: StoredPayload, replace: AssetResolver): void {
  const rewriteText: AssetResolver = (text) => rewriteCopyText(text, replace);
  const pending: unknown[] = [body.blocks];
  while (pending.length) {
    const children = pending.pop();
    if (!Array.isArray(children)) {
      continue;
    }

    for (const value of children) {
      const block = record(value);
      if (!block) {
        continue;
      }

      if ('props' in block) {
        block.props = rewriteState(block.props, rewriteText);
      }
      if ('content' in block) {
        block.content = rewriteState(block.content, rewriteText);
      }
      pending.push(block.children);
    }
  }
}

function rewriteState(value: unknown, replace: AssetResolver): unknown {
  if (typeof value === 'string') {
    return replace(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => rewriteState(entry, replace));
  }

  const fields = record(value);
  if (!fields) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(fields).map(([field, entry]) => [field, rewriteState(entry, replace)]),
  );
}

function rewriteEmbed(body: StoredPayload, replace: AssetResolver): void {
  replaceField(body, 'html', (markup) => rewriteCopyMarkup(markup, replace));
  if ('state' in body) {
    body.state = rewriteState(body.state, (text) => rewriteCopyText(text, replace));
  }
}

function rebindTodoSource(source: StoredPayload, scope: CopyPayloadScope): boolean {
  if (typeof source.objectId !== 'string' || !source.objectId) {
    return false;
  }

  const { boardId } = source;
  const explicitSource = boardId === scope.sourceBoardId;
  if (boardId !== undefined && !explicitSource) {
    return false;
  }

  if (explicitSource) {
    source.boardId = scope.destinationBoardId;
  }

  const hadVersion = 'version' in source;
  if (hadVersion) {
    delete source.version;
  }

  return explicitSource || hadVersion;
}

function rewriteTodo(body: StoredPayload, scope: CopyPayloadScope): boolean {
  if (!Array.isArray(body.items)) {
    return false;
  }

  let changed = false;
  for (const value of body.items) {
    const source = record(record(value)?.sourceRef);
    if (source && rebindTodoSource(source, scope)) {
      changed = true;
    }
  }

  return changed;
}

function rewriteAssets(bodyKind: string, body: StoredPayload, replace: AssetResolver): void {
  switch (bodyKind) {
    case 'image':
      replaceField(body, 'src', replace);
      replaceField(body, 'href', replace);
      break;
    case 'video':
      replaceField(body, 'src', replace);
      replaceField(body, 'poster', replace);
      break;
    case 'link':
      replaceField(body, 'href', replace);
      break;
    case 'document':
      rewriteDocument(body, replace);
      break;
    case 'embed':
      rewriteEmbed(body, replace);
      break;
  }
}

export function rewriteCopyPayload(
  bodyKind: string,
  bodyJson: string,
  scope: CopyPayloadScope,
): string | undefined {
  const parsed: unknown = JSON.parse(bodyJson);
  const body = record(parsed);
  if (!body) {
    throw new CopyPayloadError();
  }

  let changed = false;
  const replace: AssetResolver = (source) => {
    const match = assetPath.exec(source);
    if (!match) {
      return source;
    }

    const [, boardId, assetId] = match;
    if (boardId !== scope.sourceBoardId || assetId === undefined) {
      return source;
    }

    scope.onAsset(assetId);
    changed = true;

    return '/studio-archive-assets/' + scope.destinationBoardId + '/' + assetId;
  };

  if (bodyKind === 'todo') {
    changed = rewriteTodo(body, scope);
  } else {
    rewriteAssets(bodyKind, body, replace);
  }

  return changed ? JSON.stringify(body) : undefined;
}
