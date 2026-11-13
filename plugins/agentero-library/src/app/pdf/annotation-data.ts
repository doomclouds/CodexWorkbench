import type { MarkList } from '../../contracts/reader';

/** Read one revision consistently; a failed refresh must not replace a complete view. */
export async function readAllAnnotations(read: (cursor?: string) => Promise<MarkList>, cancelled: () => boolean = () => false): Promise<MarkList> {
  let first: MarkList | undefined; let cursor: string | undefined;
  const cursors = new Set<string>(); const items = new Map<string, MarkList['items'][number]>();
  do {
    if (cancelled()) throw new Error('批注读取已取消。');
    const page = await read(cursor);
    if (cancelled()) throw new Error('批注读取已取消。');
    first ??= page;
    if (page.revision !== first.revision || page.vaultId !== first.vaultId || page.paperPath !== first.paperPath || page.total !== first.total) throw new Error('读取期间批注已变化，请重新刷新。');
    for (const mark of page.items) {
      if (items.has(mark.id)) throw new Error('批注分页包含重复记录，请重新刷新。');
      items.set(mark.id, mark);
    }
    cursor = page.nextCursor || undefined;
    if (cursor && (cursors.has(cursor) || !page.items.length)) throw new Error('批注分页未能继续，请重新刷新。');
    if (cursor) cursors.add(cursor);
    else if (page.truncated || page.total !== undefined && page.total !== items.size) throw new Error('批注列表尚未完整读取，请重新刷新。');
  } while (cursor);
  return { ...first!, items: [...items.values()], total: items.size, nextCursor: null, truncated: false };
}
