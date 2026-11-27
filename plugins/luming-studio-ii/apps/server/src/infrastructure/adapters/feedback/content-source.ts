import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type {
  FeedbackContentSource,
  FeedbackContentTarget,
  FeedbackContentUnit,
} from '../../../modules/feedback/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { readText, readUnsigned } from './stored-values.js';

const nonContentElements = new Set(['head', 'script', 'style', 'template', 'noscript']);
const maximumHtmlLength = 1024 * 1024;

function visibleElement(
  node: DefaultTreeAdapterMap['node'],
): node is DefaultTreeAdapterMap['element'] {
  if (!('tagName' in node) || nonContentElements.has(node.tagName)) {
    return false;
  }

  return !node.attrs.some(
    ({ name, value }) => name === 'hidden' || (name === 'aria-hidden' && value === 'true'),
  );
}

function validateHtmlNodes(html: string, ids: readonly string[]): readonly string[] {
  if (html.length > maximumHtmlLength) {
    return [];
  }

  const requested = new Set(ids);
  const matches = new Map<string, number>();
  const document = parse(html);
  const nodes: DefaultTreeAdapterMap['node'][] = [...document.childNodes];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || !visibleElement(node)) {
      continue;
    }

    const id = node.attrs.find((attribute) => attribute.name === 'data-studio-id')?.value;
    if (id && requested.has(id)) {
      matches.set(id, (matches.get(id) ?? 0) + 1);
    }
    for (const child of node.childNodes) {
      nodes.push(child);
    }
  }

  return ids.filter((id) => matches.get(id) === 1);
}

function contentData(row: SqliteRow) {
  const data: unknown = JSON.parse(readText(row.body_json, 'body_json'));

  return data;
}

function htmlOf(data: unknown) {
  if (typeof data === 'object' && data !== null && 'html' in data) {
    return typeof data.html === 'string' ? data.html : undefined;
  }
}

export function readContentSource(
  connection: SqliteConnection,
  boardId: string,
  target: FeedbackContentTarget,
): FeedbackContentSource | undefined {
  const statement = connection.prepare(`
    SELECT body_kind, payload_version, body_json
    FROM object_payloads
    WHERE board_id = ? AND object_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, target.objectId);
  if (!row) {
    return undefined;
  }

  const kind = readText(row.body_kind, 'body_kind');
  const payloadVersion = readUnsigned(row.payload_version, 'payload_version');
  const data = contentData(row);
  const { content } = target;
  const html = content.kind === 'html' && kind === 'embed' ? htmlOf(data) : undefined;
  const htmlNodeIds =
    html !== undefined && content.kind === 'html'
      ? validateHtmlNodes(html, content.nodeIds)
      : undefined;

  return { kind, payloadVersion, data, htmlNodeIds };
}

function versionFromText(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,20}$/u.test(value)) {
    throw new Error('Invalid stored HTML anchor source revision.');
  }

  return BigInt(value);
}

function unitIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new Error('Invalid stored content anchor IDs.');
  }

  return value.map((id) => readText(id, 'content anchor identifier'));
}

export function decodeFeedbackContentUnit(raw: unknown): FeedbackContentUnit {
  const value: unknown = JSON.parse(readText(raw, 'content anchor'));
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('Invalid stored content anchor.');
  }
  if (value.kind === 'document' && 'blockIds' in value) {
    return { kind: 'document', blockIds: unitIds(value.blockIds) };
  }
  if (value.kind === 'todo' && 'itemId' in value) {
    return { kind: 'todo', itemId: readText(value.itemId, 'task identifier') };
  }
  if (value.kind === 'html' && 'nodeIds' in value && 'sourceRevision' in value) {
    return {
      kind: 'html',
      nodeIds: unitIds(value.nodeIds),
      sourceRevision: versionFromText(value.sourceRevision),
    };
  }

  throw new Error('Invalid stored content anchor unit.');
}

export function encodeFeedbackContentUnit(unit: FeedbackContentUnit): string {
  return JSON.stringify(
    unit.kind === 'html' ? { ...unit, sourceRevision: unit.sourceRevision.toString() } : unit,
  );
}
