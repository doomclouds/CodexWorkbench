import type { Anchor, BoardElement, Json } from './studio.js';

export const DOCUMENT_BLOCK_TYPES = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'codeBlock', 'table', 'image', 'divider'] as const;
export type DocumentBlockType = typeof DOCUMENT_BLOCK_TYPES[number];
/** BlockNote-compatible JSON is the only editable source; rendered HTML is derived. */
export interface DocumentBlock { id: string; type: DocumentBlockType; props: Record<string, Json>; content?: Json; children?: DocumentBlock[] }
export interface DocumentContent { schemaVersion: 1; blocks: DocumentBlock[] }
export type DocumentBlockOperation =
  | { op: 'insert'; block: DocumentBlock; parentId?: string | null; afterId?: string | null }
  | { op: 'update'; id: string; changes: Partial<Pick<DocumentBlock, 'type' | 'props' | 'content'>> }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; parentId?: string | null; afterId?: string | null };
const invalid = (message: string) => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
const conflict = (message: string) => Object.assign(new Error(message), { code: 'CONFLICT' });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
export function defaultDocument(id = 'paragraph'): DocumentContent { return { schemaVersion: 1, blocks: [{ id, type: 'paragraph', props: {}, content: [], children: [] }] }; }
export function flattenDocumentBlocks(blocks: readonly DocumentBlock[]): DocumentBlock[] { return blocks.flatMap(block => [block, ...flattenDocumentBlocks(block.children ?? [])]); }
export function documentBlockText(block: DocumentBlock): string {
  const walk = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(walk).join('') : record(value) ? typeof value.text === 'string' ? value.text : Object.entries(value).filter(([key]) => !['props', 'styles', 'url', 'href', 'type'].includes(key)).map(([, child]) => walk(child)).join(' ') : '';
  if (block.type === 'image') return String(block.props.caption || block.props.name || '');
  if (block.type === 'codeBlock') return walk(block.content);
  if (block.type === 'table' && record(block.content) && Array.isArray(block.content.rows)) return block.content.rows.map(row => record(row) && Array.isArray(row.cells) ? row.cells.map(walk).join('\t') : '').join('\n');
  return walk(block.content).trim();
}
export function documentPlainText(document: DocumentContent): string { return flattenDocumentBlocks(document.blocks).map(documentBlockText).filter(Boolean).join('\n'); }
function safeUrl(value: string, image = false): boolean {
  if (!value) return true;
  if (/^\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value)) return true;
  if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return true;
  try { const url = new URL(value); return ['http:', 'https:', ...(image ? [] : ['mailto:'])].includes(url.protocol); } catch { return false; }
}
/** Validate persisted/API JSON without importing an editor or accepting executable HTML. */
export function normalizeDocument(value: unknown): DocumentContent {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.blocks)) throw invalid('文档须使用 schemaVersion:1 与 blocks JSON。');
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > 2 * 1024 * 1024) throw invalid('单个文档不能超过 2 MB。');
  const ids = new Set<string>(); let count = 0;
  function json(input: unknown, depth: number): Json {
    if (depth > 24) throw invalid('文档内容嵌套过深。');
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(item => item === undefined ? null : json(item, depth + 1));
    if (!record(input)) throw invalid('文档只允许 JSON 内容。');
    const result: Record<string, Json> = {};
    for (const [key, child] of Object.entries(input)) {
      if (['__proto__', 'constructor', 'prototype', 'html', 'innerHTML'].includes(key)) throw invalid('文档包含不允许的内容字段。');
      if (child === undefined) continue;
      if (key === 'href' && (typeof child !== 'string' || !safeUrl(child)) || key === 'url' && (typeof child !== 'string' || !safeUrl(child, true))) throw invalid('文档链接或图片地址不受支持。');
      result[key] = json(child, depth + 1);
    }
    return result;
  }
  function block(input: unknown, depth: number): DocumentBlock {
    if (depth > 12 || ++count > 2000) throw invalid('文档层级或段落数量超过当前范围。');
    if (!record(input) || !validId(input.id) || ids.has(input.id) || !(DOCUMENT_BLOCK_TYPES as readonly unknown[]).includes(input.type)) throw invalid('文档块 ID 必须唯一且类型受支持。');
    ids.add(input.id);
    if (input.props !== undefined && !record(input.props) || input.children !== undefined && !Array.isArray(input.children)) throw invalid('文档块属性或子块格式无效。');
    const props = json(input.props ?? {}, 0) as Record<string, Json>;
    if (props.textAlignment !== undefined && !['left', 'center', 'right', 'justify'].includes(String(props.textAlignment))) throw invalid('文档对齐方式无效。');
    if (input.type === 'heading' && props.level !== undefined && (typeof props.level !== 'number' || ![1, 2, 3, 4, 5, 6].includes(props.level))) throw invalid('文档标题级别无效。');
    if (input.type === 'checkListItem' && props.checked !== undefined && typeof props.checked !== 'boolean') throw invalid('任务项状态必须是布尔值。');
    const inline = (value: unknown): boolean => typeof value === 'string' || Array.isArray(value) && value.every(item => record(item) && (item.type === 'text' && typeof item.text === 'string' || item.type === 'link' && typeof item.href === 'string' && inline(item.content)));
    if (input.type === 'table') {
      if (!record(input.content) || input.content.type !== 'tableContent' || !Array.isArray(input.content.rows) || input.content.rows.some(row => !record(row) || !Array.isArray(row.cells) || row.cells.some(cell => !(record(cell) && cell.type === 'tableCell' ? inline(cell.content) : inline(cell))))) throw invalid('文档表格需要有效的 tableContent 行与单元格。');
    } else if (!['image', 'divider'].includes(String(input.type)) && input.content !== undefined && !inline(input.content)) throw invalid('文档文字内容须使用文本或链接片段。');
    return { id: input.id, type: input.type as DocumentBlockType, props, ...(input.content !== undefined ? { content: json(input.content, 0) } : {}), children: ((input.children ?? []) as unknown[]).map(child => block(child, depth + 1)) };
  }
  return { schemaVersion: 1, blocks: value.blocks.map(item => block(item, 0)) };
}
function locate(blocks: DocumentBlock[], id: string): { list: DocumentBlock[]; index: number; block: DocumentBlock; parentId: string | null } | undefined {
  for (const [index, block] of blocks.entries()) {
    if (block.id === id) return { list: blocks, index, block, parentId: null };
    const nested = locate(block.children ?? [], id);
    if (nested) return { ...nested, parentId: nested.parentId ?? block.id };
  }
}
function applyDocumentOperation(next: DocumentContent, operation: DocumentBlockOperation): void {
    if (!record(operation as unknown)) throw invalid('文档块操作无效。');
    if (operation.op === 'update') {
      const target = locate(next.blocks, operation.id);
      if (!target) throw conflict('要编辑的文档段落已不存在。');
      if (!record(operation.changes) || Object.keys(operation.changes).some(key => !['type', 'props', 'content'].includes(key))) throw invalid('块更新只允许 type、props 与 content。');
      target.list[target.index] = { ...target.block, ...structuredClone(operation.changes), id: target.block.id, children: target.block.children };
    } else if (operation.op === 'delete') {
      const target = locate(next.blocks, operation.id);
      if (!target) throw conflict('要删除的文档段落已不存在。');
      target.list.splice(target.index, 1);
    } else if (operation.op === 'insert' || operation.op === 'move') {
      if (operation.parentId !== undefined && operation.parentId !== null && !validId(operation.parentId) || operation.afterId !== undefined && operation.afterId !== null && !validId(operation.afterId)) throw invalid('段落位置需要有效的 parentId/afterId 或 null。');
      const target = operation.op === 'move' ? locate(next.blocks, operation.id) : undefined;
      if (operation.op === 'move' && !target) throw conflict('要移动的文档段落已不存在。');
      const moving = target ? target.block : normalizeDocument({ schemaVersion: 1, blocks: operation.op === 'insert' ? [operation.block] : [] }).blocks[0]!;
      if (!target && flattenDocumentBlocks([moving]).some(block => locate(next.blocks, block.id))) throw conflict('新增文档块 ID 已存在。');
      if (operation.parentId && flattenDocumentBlocks([moving]).some(block => block.id === operation.parentId)) throw invalid('不能把段落移动到自身内部。');
      const parent = operation.parentId ? locate(next.blocks, operation.parentId) : undefined;
      if (operation.parentId && !parent) throw conflict('目标父段落已不存在。');
      const list = parent ? parent.block.children ?? (parent.block.children = []) : next.blocks;
      if (target) target.list.splice(target.index, 1);
      const after = operation.afterId === undefined ? list.length - 1 : operation.afterId === null ? -1 : list.findIndex(block => block.id === operation.afterId);
      if (operation.afterId !== undefined && operation.afterId !== null && after < 0) throw conflict('插入位置的相邻段落已不存在。');
      list.splice(after + 1, 0, moving);
    } else throw invalid('不支持的文档块操作。');
}
export function applyDocumentOperations(document: DocumentContent, operations: readonly DocumentBlockOperation[]): DocumentContent {
  const next = normalizeDocument(document);
  if (!Array.isArray(operations) || !operations.length || operations.length > 6000) throw invalid('文档提交需要 1 至 6000 个块操作。');
  for (const operation of operations) applyDocumentOperation(next, operation);
  return normalizeDocument(next);
}
/** Compare editor snapshots into identity-preserving block operations, including nested moves. */
export function documentOperations(before: DocumentContent, after: DocumentContent): DocumentBlockOperation[] {
  const working = normalizeDocument(before), wanted = normalizeDocument(after), operations: DocumentBlockOperation[] = [];
  const put = (operation: DocumentBlockOperation) => { applyDocumentOperation(working, operation); operations.push(operation); };
  const order = (blocks: DocumentBlock[], parentId: string | null) => {
    let previous: string | null = null;
    for (const block of blocks) {
      let found = locate(working.blocks, block.id);
      if (!found) { put({ op: 'insert', block: { ...structuredClone(block), children: [] }, parentId, afterId: previous }); found = locate(working.blocks, block.id)!; }
      const own = { type: block.type, props: block.props, content: block.content }, current = { type: found.block.type, props: found.block.props, content: found.block.content };
      const changes = Object.fromEntries(Object.entries(own).filter(([key, value]) => JSON.stringify(current[key as keyof typeof current]) !== JSON.stringify(value)));
      if (Object.keys(changes).length) put({ op: 'update', id: block.id, changes });
      found = locate(working.blocks, block.id)!;
      if (found.parentId !== parentId || (found.list[found.index - 1]?.id ?? null) !== previous) put({ op: 'move', id: block.id, parentId, afterId: previous });
      order(block.children ?? [], block.id); previous = block.id;
    }
  };
  order(wanted.blocks, null);
  const surviving = new Set(flattenDocumentBlocks(wanted.blocks).map(block => block.id));
  for (const block of flattenDocumentBlocks(working.blocks)) if (!surviving.has(block.id) && locate(working.blocks, block.id)) put({ op: 'delete', id: block.id });
  return operations;
}
export function documentAnchorState(anchor: Anchor, element: BoardElement | undefined): 'current' | 'changed' | 'missing' {
  if (!element || element.type !== 'document' || !element.document || !anchor.blockIds?.length) return 'missing';
  const blocks = flattenDocumentBlocks(element.document.blocks), selected = anchor.blockIds.map(id => blocks.find(block => block.id === id));
  if (selected.some(block => !block)) return 'missing';
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const quoted = normalize(selected.map(block => documentBlockText(block!)).join('\n'));
  return anchor.sourceVersion !== element.version || !!anchor.quote && !quoted.includes(normalize(anchor.quote)) ? 'changed' : 'current';
}
