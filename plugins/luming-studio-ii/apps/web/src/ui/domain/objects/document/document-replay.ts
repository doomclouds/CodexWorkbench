import type { DocumentBlock, DocumentContent, DocumentDraft } from './contracts.js';
import { flattenBlocks, sameDocument, sameValue } from './model.js';

function blockChanges(base: DocumentBlock, draft: DocumentBlock) {
  return {
    ...(base.type === draft.type ? {} : { type: draft.type }),
    ...(sameValue(base.props, draft.props) ? {} : { props: draft.props }),
    ...(sameValue(base.content, draft.content) ? {} : { content: draft.content }),
  };
}

function withChildren(block: DocumentBlock, children: readonly DocumentBlock[]): DocumentBlock {
  return children.length || block.children ? { ...block, children } : block;
}

export function applyEditorChange(
  before: DocumentContent,
  after: DocumentContent,
  canonical: DocumentContent,
): DocumentContent {
  const previous = new Map(flattenBlocks(before.blocks).map((block) => [block.id, block]));
  const stored = new Map(flattenBlocks(canonical.blocks).map((block) => [block.id, block]));

  function preserve(block: DocumentBlock): DocumentBlock {
    const base = previous.get(block.id);
    const original = stored.get(block.id);
    const edited = base && original ? { ...original, ...blockChanges(base, block) } : block;

    return withChildren(edited, (block.children ?? []).map(preserve));
  }

  return { ...after, blocks: after.blocks.map(preserve) };
}

interface BlockNode {
  block: DocumentBlock;
  parent: BlockNode | undefined;
  children: BlockNode[];
}

interface BlockTree {
  readonly nodes: Map<string, BlockNode>;
  readonly roots: BlockNode[];
}

function blockTree(document: DocumentContent): BlockTree {
  const nodes = new Map<string, BlockNode>();

  function add(block: DocumentBlock, parent?: BlockNode): BlockNode {
    const node: BlockNode = { block, parent, children: [] };
    nodes.set(block.id, node);
    node.children = (block.children ?? []).map((child) => add(child, node));

    return node;
  }

  return { nodes, roots: document.blocks.map((block) => add(block)) };
}

function requireNode(tree: BlockTree, id: string) {
  const node = tree.nodes.get(id);
  if (!node) {
    throw new Error('要修改的段落或其位置已不存在。草稿已保留。');
  }

  return node;
}

function detach(tree: BlockTree, node: BlockNode) {
  const siblings = node.parent?.children ?? tree.roots;
  const index = siblings.indexOf(node);
  if (index !== -1) {
    siblings.splice(index, 1);
  }
}

function place(tree: BlockTree, node: BlockNode, parentId?: string, afterId?: string) {
  const parent = parentId === undefined ? undefined : requireNode(tree, parentId);
  const after = afterId === undefined ? undefined : requireNode(tree, afterId);
  if (after && after.parent !== parent) {
    throw new Error('要放置段落的位置已变化。草稿已保留。');
  }

  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor === node) {
      throw new Error('段落层级已变化。草稿已保留。');
    }
  }

  detach(tree, node);
  const siblings = parent?.children ?? tree.roots;
  siblings.splice(after ? siblings.indexOf(after) + 1 : 0, 0, node);
  node.parent = parent;
  tree.nodes.set(node.block.id, node);
}

function addNode(tree: BlockTree, block: DocumentBlock, parentId?: string, afterId?: string) {
  if (tree.nodes.has(block.id)) {
    throw new Error('要新增的段落已存在。草稿已保留。');
  }

  place(tree, { block, parent: undefined, children: [] }, parentId, afterId);
}

function beforeNode(tree: BlockTree, node: BlockNode, retained: ReadonlySet<string>) {
  const siblings = node.parent?.children ?? tree.roots;
  const index = siblings.indexOf(node);

  return siblings.slice(0, index).findLast((sibling) => retained.has(sibling.block.id));
}

function toBlock(node: BlockNode): DocumentBlock {
  return withChildren(node.block, node.children.map(toBlock));
}

function replayBlocks(
  base: DocumentContent,
  draft: DocumentContent,
  latest: DocumentContent,
): DocumentContent {
  if (sameDocument(base, draft)) {
    return latest;
  }

  const origin = blockTree(base);
  const result = blockTree(latest);
  const retained = new Set(flattenBlocks(draft.blocks).map((block) => block.id));

  function replayBlock(block: DocumentBlock, parentId?: string, afterId?: string) {
    const previous = origin.nodes.get(block.id);
    if (!previous) {
      addNode(origin, block, parentId, afterId);
      addNode(result, block, parentId, afterId);
      return;
    }

    const changes = blockChanges(previous.block, block);
    if (Object.keys(changes).length) {
      const node = requireNode(result, block.id);
      node.block = { ...node.block, ...changes };
    }

    const previousId = beforeNode(origin, previous, retained)?.block.id;
    if (previous.parent?.block.id !== parentId || previousId !== afterId) {
      place(origin, previous, parentId, afterId);
      place(result, requireNode(result, block.id), parentId, afterId);
    }
  }

  function replayChildren(blocks: readonly DocumentBlock[], parentId?: string) {
    let afterId: string | undefined;
    for (const block of blocks) {
      replayBlock(block, parentId, afterId);
      replayChildren(block.children ?? [], block.id);
      afterId = block.id;
    }
  }

  replayChildren(draft.blocks);
  for (const [id, original] of origin.nodes) {
    const parentId = original.parent?.block.id;
    if (retained.has(id) || (parentId !== undefined && !retained.has(parentId))) {
      continue;
    }

    const node = result.nodes.get(id);
    if (node) {
      detach(result, node);
    }
  }

  return { ...latest, blocks: result.roots.map(toBlock) };
}

export function replayDocumentDraft(
  base: DocumentDraft,
  draft: DocumentDraft,
  latest: DocumentDraft,
): DocumentDraft {
  return {
    title: base.title === draft.title ? latest.title : draft.title,
    document: replayBlocks(base.document, draft.document, latest.document),
  };
}
