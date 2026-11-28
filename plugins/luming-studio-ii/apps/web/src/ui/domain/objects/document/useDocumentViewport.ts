import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ScrollRegionHandle, ScrollRegionPosition } from '../../../base/index.js';
import type {
  DocumentActivity,
  DocumentBlock,
  DocumentContent,
  DocumentNoteSource,
  DocumentObjectProps,
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

function headingAtScroll(paper: HTMLElement, region: HTMLElement) {
  const atBottom =
    region.scrollTop > 0 && region.scrollHeight - region.clientHeight - region.scrollTop <= 1;
  const top = region.getBoundingClientRect().top + 1;
  let current: string | undefined;
  for (const heading of paper.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
    const block = heading.closest<HTMLElement>('[data-document-read-block],[data-id]');
    const id = block?.dataset.documentReadBlock ?? block?.dataset.id;
    if (!id) {
      continue;
    }
    if (current !== undefined && !atBottom && heading.getBoundingClientRect().top > top) {
      break;
    }

    current = id;
  }

  return current;
}

function blockSearch(blocks: readonly DocumentBlock[], find: string) {
  const target = find.trim().toLocaleLowerCase();

  return target
    ? blocks.filter((block) => blockText(block).toLocaleLowerCase().includes(target))
    : [];
}

function notePosition(root: HTMLElement, first: HTMLElement, requested?: { x: number; y: number }) {
  const owner = root.closest('.studio-document-surface') ?? root;
  const bounds = owner.getBoundingClientRect();
  const block = first.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }

  const unit = (value: number) => Math.max(0, Math.min(1, value));
  const point = requested ?? { x: block.right, y: block.top + Math.min(6, block.height / 2) };

  return {
    u: unit((point.x - bounds.left) / bounds.width),
    v: unit((point.y - bounds.top) / bounds.height),
  };
}

function selectionBlocks(root: HTMLElement, range: Range) {
  const blocks = new Map<string, HTMLElement>();
  const sequence = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = sequence.nextNode(); text; text = sequence.nextNode()) {
    if (!text.textContent?.trim() || !range.intersectsNode(text)) {
      continue;
    }

    const block = text.parentElement?.closest<HTMLElement>('[data-document-read-block]');
    const id = block?.dataset.documentReadBlock;
    if (block && id) {
      blocks.set(id, block);
    }
  }

  return blocks;
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

  const selected = selectionBlocks(root, range);
  const first = selected.values().next().value;
  const point = first && notePosition(root, first);
  const blockIds = Array.from(selected.keys());
  const quote = selection.toString().trim();

  return blockIds.length && quote && point ? { blockIds, quote, version, ...point } : undefined;
}

export function useDocumentViewport(
  mode: DocumentActivity['mode'],
  value: DocumentContent,
  version: number,
  nativeBlockRequest?: DocumentObjectProps['nativeBlockRequest'],
  focused = false,
) {
  const body = useRef<HTMLDivElement>(null);
  const scroll = useRef<ScrollRegionHandle>(null);
  const position = useRef({ inline: emptyPosition, expanded: emptyPosition });
  const previousMode = useRef(mode);
  const selection = useRef<DocumentNoteSource | undefined>(undefined);
  const [selectionVersion, setSelectionVersion] = useState<number>();
  const [find, setFind] = useState('');
  const [index, setIndex] = useState(0);
  const [headingId, setHeadingId] = useState<string>();
  const headingJump = useRef<number | undefined>(undefined);
  const blocks = flattenBlocks(value.blocks);
  const headings = blocks.filter((block) => block.type === 'heading');
  const currentHeadingId =
    headings.find((heading) => heading.id === headingId)?.id ?? headings[0]?.id;
  const matches = blockSearch(blocks, find);
  const selected = matches.at(index % Math.max(1, matches.length));
  const currentId = selected?.id;
  const expanded = mode !== 'inline';
  const selectedSource = nativeBlockRequest?.id;
  const sourceSequence = nativeBlockRequest?.sequence;

  useLayoutEffect(() => {
    if (selectedSource && sourceSequence !== undefined && body.current) {
      blockAt(body.current, selectedSource)?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedSource, sourceSequence]);

  useLayoutEffect(() => {
    if (previousMode.current === mode) {
      return;
    }

    previousMode.current = mode;
    const saved = position.current[expanded ? 'expanded' : 'inline'];
    scroll.current?.scrollTo(saved);
  }, [expanded, mode]);

  useLayoutEffect(() => {
    if (currentId && body.current) {
      blockAt(body.current, currentId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [currentId, expanded, mode]);

  function handleScroll(positionNow: ScrollRegionPosition) {
    const view = expanded ? 'expanded' : 'inline';
    const movedVertically = position.current[view].top !== positionNow.top;
    const followsOutline = focused && movedVertically;
    position.current[view] = positionNow;
    const paper = body.current;
    const region = paper?.parentElement;
    if (followsOutline && paper && region) {
      const jump = headingJump.current;
      headingJump.current = undefined;
      if (jump === undefined || Math.abs(positionNow.top - jump) > 1) {
        setHeadingId(headingAtScroll(paper, region));
      }
    }
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
    const paper = body.current;
    const block = paper && blockAt(paper, id);
    if (!block) {
      return;
    }

    const region = paper.parentElement;
    if (!focused || !region) {
      block.scrollIntoView({ block: 'nearest' });
      return;
    }

    const offset = block.getBoundingClientRect().top - region.getBoundingClientRect().top;
    const top = Math.max(
      0,
      Math.min(region.scrollTop + offset, region.scrollHeight - region.clientHeight),
    );
    setHeadingId(id);
    headingJump.current = top !== region.scrollTop ? top : undefined;
    scroll.current?.scrollTo({ top });
  }

  function captureSelection() {
    const element = body.current;
    selection.current = element ? documentSelection(element, version) : undefined;
    setSelectionVersion(selection.current?.version);
  }

  function readSelection() {
    return selection.current?.version === version ? selection.current : undefined;
  }

  function noteForBlock(
    id: string,
    requested?: { x: number; y: number },
  ): DocumentNoteSource | undefined {
    const root = body.current;
    const node = root && blockAt(root, id);
    const block = blocks.find((candidate) => candidate.id === id);
    if (!root || !node || !block) {
      return undefined;
    }

    const point = notePosition(root, node, requested);

    return point && { blockIds: [id], quote: blockText(block), version, ...point };
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
    noteForBlock,
    canAnnotate: selectionVersion === version,
    find,
    matches,
    currentId,
    matchIndex: index % Math.max(1, matches.length),
    headings,
    currentHeadingId,
    handleScroll,
    handleFind,
    advance,
    reveal,
    captureSelection,
    handleSelectAll,
  };
}
