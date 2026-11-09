import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import type { BookmarkNode, ReaderMark } from '../contracts/reader.js';
import { LibraryError } from '../contracts/errors.js';
import { markPalette } from './marks.js';

const name = PDFName.of;
async function editable(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, v] of pdf.context.enumerateIndirectObjects()) if (v instanceof PDFDict && (v.has(name('ByteRange')) || v.get(name('FT')) === name('Sig'))) throw new LibraryError('PDF_PROTECTED', '带数字签名的 PDF 不能重写，请先保存无签名副本。');
  return pdf;
}

/** Rebuild outline links while retaining original destination/action dictionaries. */
export async function editBookmarks(bytes: Uint8Array, nodes: BookmarkNode[]): Promise<Uint8Array> {
  const pdf = await editable(bytes), pages = pdf.getPages();
  const originals = new Map<string, { dict: PDFDict; ref: PDFRef }>(), visited = new Set<string>();
  const originalRoot = pdf.catalog.lookupMaybe(name('Outlines'), PDFDict);
  function collect(parent: PDFDict, prefix: string, depth: number) {
    if (depth > 32) throw new LibraryError('PDF_OUTLINE_UNSUPPORTED', 'PDF 目录层级过深。');
    let pointer = parent.get(name('First')), index = 0;
    while (pointer) {
      if (!(pointer instanceof PDFRef) || visited.has(pointer.toString()) || visited.size >= 5000) throw new LibraryError('PDF_OUTLINE_UNSUPPORTED', 'PDF 目录包含循环或不支持的引用。');
      visited.add(pointer.toString());
      const dict = pdf.context.lookup(pointer, PDFDict), action = dict.lookupMaybe(name('A'), PDFDict);
      if (action && (action.get(name('S')) !== name('GoTo') || action.has(name('Next')))) throw new LibraryError('PDF_OUTLINE_UNSUPPORTED', 'PDF 目录包含外部或复合动作，无法安全重写。');
      const id = `${prefix}${index++}`; originals.set(id, { dict, ref: pointer });
      collect(dict, `${id}.`, depth + 1); pointer = dict.get(name('Next'));
    }
  }
  if (originalRoot) collect(originalRoot, '', 0);
  const root = originalRoot ?? pdf.context.obj({ Type: 'Outlines' }), rootRef = pdf.context.getObjectRef(root) ?? pdf.context.register(root);
  let count = 0; const used = new Set<string>();
  function write(items: BookmarkNode[], parent: PDFDict, parentRef: PDFRef, depth: number): number {
    if (!Array.isArray(items) || depth > 16) throw new LibraryError('INVALID_BOOKMARKS', '目录层级最多 16 层。');
    const entries = items.map(node => {
      if (++count > 2000 || !node || typeof node.title !== 'string' || !node.title.trim() || node.title.length > 1000 || !Array.isArray(node.children)) throw new LibraryError('INVALID_BOOKMARKS', '目录标题或数量无效。');
      const original = node.origin === null ? undefined : originals.get(node.origin);
      if (node.origin !== null && (!original || used.has(node.origin))) throw new LibraryError('PDF_OUTLINE_CHANGED', '原始 PDF 目录引用无效或重复。', true);
      if (node.origin !== null) used.add(node.origin);
      if (original && node.originalTitle !== undefined) {
        const title = original.dict.lookup(name('Title'));
        if (!(title instanceof PDFString || title instanceof PDFHexString) || title.decodeText() !== node.originalTitle) throw new LibraryError('PDF_OUTLINE_CHANGED', '原始 PDF 目录已变化，请重新载入。', true);
      }
      const dict = original?.dict ?? pdf.context.obj({}), ref = original?.ref ?? pdf.context.register(dict);
      dict.set(name('Title'), PDFHexString.fromText(node.title.trim())); dict.set(name('Parent'), parentRef);
      if (node.pageIndex !== undefined) {
        if (!Number.isInteger(node.pageIndex) || !pages[node.pageIndex]) throw new LibraryError('INVALID_BOOKMARKS', '目录目标页无效。');
        dict.delete(name('A')); dict.set(name('Dest'), pdf.context.obj([pages[node.pageIndex].ref, 'Fit']));
      } else if (!original) throw new LibraryError('INVALID_BOOKMARKS', '新增目录需要目标页。');
      return { node, dict, ref };
    });
    parent.delete(name('First')); parent.delete(name('Last'));
    if (entries.length) { parent.set(name('First'), entries[0].ref); parent.set(name('Last'), entries[entries.length - 1].ref); }
    let visible = 0;
    entries.forEach(({ node, dict, ref }, i) => {
      dict.delete(name('Prev')); dict.delete(name('Next'));
      if (i) dict.set(name('Prev'), entries[i - 1].ref);
      if (i + 1 < entries.length) dict.set(name('Next'), entries[i + 1].ref);
      const closed = (dict.lookupMaybe(name('Count'), PDFNumber)?.asNumber() ?? 0) < 0;
      const children = write(node.children, dict, ref, depth + 1); dict.delete(name('Count'));
      if (children) dict.set(name('Count'), PDFNumber.of(closed ? -children : children));
      visible += 1 + (closed ? 0 : children);
    });
    return visible;
  }
  root.set(name('Count'), PDFNumber.of(write(nodes, root, rootRef, 0)));
  if (nodes.length) pdf.catalog.set(name('Outlines'), rootRef); else pdf.catalog.delete(name('Outlines'));
  return pdf.save();
}

/** Export standard PDF annotations; original PDF is never modified by this function. */
export async function annotatedPdf(bytes: Uint8Array, marks: ReaderMark[]): Promise<Uint8Array> {
  const pdf = await editable(bytes), pages = pdf.getPages();
  for (const mark of marks) {
    const page = pages[mark.page - 1]; if (!page || !mark.rects.length) continue;
    const crop = page.getCropBox();
    const rects = mark.rects.map(r => mark.space === 'norm' ? { x: r.x * crop.width, y: r.y * crop.height, w: r.w * crop.width, h: r.h * crop.height } : r);
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y)), right = Math.max(...rects.map(r => r.x + r.w)), bottom = Math.max(...rects.map(r => r.y + r.h));
    const hex = markPalette[mark.color ?? 'yellow'];
    const color = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const contents = [mark.comment, mark.result, ...(mark.messages ?? []).map(m => `${m.role}: ${m.content}`)].filter(Boolean).join('\n\n') || mark.quote;
    const subtype = mark.kind === 'highlight' ? 'Highlight' : mark.kind === 'underline' ? 'Underline' : mark.kind === 'visual' ? 'Square' : 'Text';
    const dict = pdf.context.obj({ Type: 'Annot', Subtype: subtype, Rect: [crop.x + x, crop.y + crop.height - bottom, crop.x + right, crop.y + crop.height - y], C: color, CA: mark.kind === 'highlight' ? 0.4 : 1, F: 4, NM: PDFString.of(`agentero:${mark.id}`), T: PDFHexString.fromText('Agentero'), Contents: PDFHexString.fromText(contents), P: page.ref });
    if (subtype === 'Highlight' || subtype === 'Underline') dict.set(name('QuadPoints'), pdf.context.obj(rects.flatMap(r => [crop.x + r.x, crop.y + crop.height - r.y, crop.x + r.x + r.w, crop.y + crop.height - r.y, crop.x + r.x, crop.y + crop.height - r.y - r.h, crop.x + r.x + r.w, crop.y + crop.height - r.y - r.h])));
    // Replace our own prior export annotation with the same id; retain every other annotation.
    const annots = page.node.Annots();
    if (annots) for (let i = annots.size() - 1; i >= 0; i--) {
      const old = pdf.context.lookup(annots.get(i));
      if (old instanceof PDFDict) { const nm = old.lookupMaybe(name('NM'), PDFString); if (nm?.decodeText() === `agentero:${mark.id}`) annots.remove(i); }
    }
    page.node.addAnnot(pdf.context.register(dict));
  }
  return pdf.save();
}
