import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import DocumentAnchorNotice from '../src/app/shared/comments/DocumentAnchorNotice.js';
import { DEFAULT_STYLE, type Anchor, type Board } from '../src/contracts/studio.js';

const anchor: Anchor = { coordinateSpace: 'document', elementIds: ['document-one'], blockIds: ['paragraph-one'], sourceVersion: 1, quote: '选中文字' };
const document: Board = { artifact: { id: 'artifact-one', type: 'whiteboard', title: '方案', revision: 1, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements: [{ id: 'document-one', type: 'document', text: '说明', x: 0, y: 0, w: 500, h: 400, version: 1, document: { schemaVersion: 1, blocks: [{ id: 'paragraph-one', type: 'paragraph', props: {}, content: '选中文字' }] } }] };
it('keeps a current paragraph comment free from a stale-source warning', () => { expect(renderToStaticMarkup(<DocumentAnchorNotice anchor={anchor} document={document} />)).toBe(''); });
it('shows a changed paragraph warning inside the comment independently of canvas overlays', () => { const changed = structuredClone(document); changed.elements[0].version = 2; expect(renderToStaticMarkup(<DocumentAnchorNotice anchor={anchor} document={changed} />)).toContain('来源原文已有变化'); });
it('identifies a removed paragraph without redirecting to similar text in a new block', () => { const removed = structuredClone(document); removed.elements[0].document!.blocks[0].id = 'similar-new-paragraph'; expect(renderToStaticMarkup(<DocumentAnchorNotice anchor={anchor} document={removed} />)).toContain('来源段落已删除'); });
