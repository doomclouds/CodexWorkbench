import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ScrollRegionHandle, ScrollRegionPosition } from '../../../base/index.js';
import type {
  DocumentActivity,
  DocumentBlock,
  DocumentContent,
  DocumentNoteSource,
} from './contracts.js';
import { blockText, flattenBlocks } from './model.js';

const emptyPosition: ScrollRegionPosition = { left: 0, top: 0 };
const nativeControl = '[contenteditable],input,textarea,select,button,a[href]';

function blockAt(root: HTMLElement, id: string) {
  const candidates = root.querySelectorAll<HTMLElement>('[data-document-read-block],[data-id]');

  return Array.from(candidates).find(
    (element) => (element.dataset.documentReadBlock ?? element.dataset.id) === id,
  );
}

function blockSearch(blocks: readonly DocumentBlock[], find: string) {
  const target = find.trim().toLocaleLowerCase();

  return target
    ? blocks.filter((block) => blockText(block).toLocaleLowerCase().includes(target))
    : [];
}

function documentSelection(root: HTMLElement, version: number): DocumentNoteSource | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return undefined;
  }

  const items = root.querySelectorAll<HTMLElement>('[data-document-read-block]');
  const blockIds = Array.from(items)
    .filter((item) => range.intersectsNode(item))
    .map((item) => item.dataset.documentReadBlock ?? '');
  const quote = selection.toString().trim();

  return blockIds.length && quote ? { blockIds, quote, version } : undefined;
}

export function useDocumentViewport(
  mode: DocumentActivity['mode'],
  value: DocumentContent,
  version: number,
) {
  const body = useRef<HTMLDivElement>(null);
  const scroll = useRef<ScrollRegionHandle>(null);
  const position = useRef({ inline: emptyPosition, expanded: emptyPosition });
  const selection = useRef<DocumentNoteSource | undefined>(undefined);
  const [find, setFind] = useState('');
  const [index, setIndex] = useState(0);
  const blocks = flattenBlocks(value.blocks);
  const matches = blockSearch(blocks, find);
  const selected = matches.at(index % Math.max(1, matches.length));
  const currentId = selected?.id;
  const expanded = mode !== 'inline';

  useLayoutEffect(() => {
    const saved = position.current[expanded ? 'expanded' : 'inline'];
    scroll.current?.scrollTo(saved);
  }, [expanded, mode]);

  useLayoutEffect(() => {
    if (currentId && body.current) {
      blockAt(body.current, currentId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [currentId, expanded, mode]);

  function handleScroll(positionNow: ScrollRegionPosition) {
    position.current[expanded ? 'expanded' : 'inline'] = positionNow;
  }

  function handleFind(valueNow: string) {
    setFind(valueNow);
    setIndex(0);
  }

  function advance(direction: number) {
    const count = matches.length;
    if (count) {
      setIndex((current) => (current + direction + count) % count);
    }
  }

  function reveal(id: string) {
    if (body.current) {
      blockAt(body.current, id)?.scrollIntoView({ block: 'nearest' });
    }
  }

  function captureSelection() {
    const element = body.current;
    selection.current = element ? documentSelection(element, version) : undefined;
  }

  function readSelection() {
    return selection.current;
  }

  function handleSelectAll(event: KeyboardEvent<HTMLDivElement>) {
    const command = event.ctrlKey || event.metaKey;
    const read = mode !== 'edit' && event.key.toLowerCase() === 'a';
    if (!command || !read || event.altKey) {
      return;
    }

    const target = event.target;
    const element = body.current?.querySelector('.studio-document-reading');
    const controlled = target instanceof Element && target.closest(nativeControl);
    if (!element || controlled) {
      return;
    }

    const { ownerDocument } = element;
    const range = ownerDocument.createRange();
    range.selectNodeContents(element);
    const current = ownerDocument.getSelection();
    current?.removeAllRanges();
    current?.addRange(range);
    event.preventDefault();
    event.stopPropagation();
    captureSelection();
  }

  return {
    body,
    scroll,
    readSelection,
    find,
    matches,
    currentId,
    matchIndex: index % Math.max(1, matches.length),
    headings: blocks.filter((block) => block.type === 'heading'),
    handleScroll,
    handleFind,
    advance,
    reveal,
    captureSelection,
    handleSelectAll,
  };
}
