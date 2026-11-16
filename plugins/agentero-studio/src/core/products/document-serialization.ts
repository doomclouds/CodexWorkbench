import { documentBlockText, type DocumentBlock, type DocumentContent } from '../../contracts/document.js';
const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function link(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try { const url = new URL(value); if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href; } catch {}
}
function inline(value: unknown): string {
  if (typeof value === 'string') return esc(value);
  if (Array.isArray(value)) return value.map(inline).join('');
  if (!record(value)) return '';
  if (value.type === 'link') { const href = link(value.href), content = inline(value.content); return href ? `<a href="${esc(href)}">${content}</a>` : content; }
  if (typeof value.text !== 'string') return inline(value.content);
  let text = esc(value.text).replaceAll('\n', '<br>');
  const styles = record(value.styles) ? value.styles : {};
  for (const [property, tag] of [['bold', 'strong'], ['italic', 'em'], ['underline', 'u'], ['strike', 's'], ['code', 'code']] as const) if (styles[property]) text = `<${tag}>${text}</${tag}>`;
  const paint = (color: unknown) => typeof color === 'string' && color !== 'default' && /^(?:#[\da-f]{3,8}|[a-z]+)$/i.test(color) ? color : undefined;
  const color = paint(styles.textColor), background = paint(styles.backgroundColor);
  return color || background ? `<span style="${color ? `color:${color};` : ''}${background ? `background-color:${background};` : ''}">${text}</span>` : text;
}
function table(content: unknown): string {
  const rows = record(content) && Array.isArray(content.rows) ? content.rows : [];
  const headers = record(content) && typeof content.headerRows === 'number' ? content.headerRows : 0;
  return `<table><tbody>${rows.map((row, index) => `<tr>${(record(row) && Array.isArray(row.cells) ? row.cells : []).map(cell => {
    const tag = index < headers ? 'th' : 'td', props = record(cell) && record(cell.props) ? cell.props : {};
    const span = (name: string) => Number.isInteger(props[name]) && Number(props[name]) > 1 && Number(props[name]) <= 100 ? ` ${name}="${props[name]}"` : '';
    return `<${tag}${span('colspan')}${span('rowspan')}>${inline(cell)}</${tag}>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}
function blockBody(block: DocumentBlock): string {
  const content = inline(block.content), children = blocksHtml(block.children ?? []), id = ` data-block-id="${esc(block.id)}"`;
  const align = ['left', 'center', 'right', 'justify'].includes(String(block.props.textAlignment)) ? ` style="text-align:${block.props.textAlignment}"` : '';
  if (block.type === 'heading') { const level = Math.max(1, Math.min(6, Number(block.props.level) || 1)); return `<h${level}${id}${align}>${content}</h${level}>${children}`; }
  if (block.type === 'codeBlock') return `<pre${id}><code>${esc(documentBlockText(block))}</code></pre>${children}`;
  if (block.type === 'quote') return `<blockquote${id}>${content}${children}</blockquote>`;
  if (block.type === 'divider') return `<hr${id}>${children}`;
  if (block.type === 'table') return `<div${id} class="document-table">${table(block.content)}</div>${children}`;
  if (block.type === 'image') {
    const url = typeof block.props.url === 'string' ? block.props.url : '';
    const width = typeof block.props.previewWidth === 'number' && block.props.previewWidth > 0 ? ` style="width:${Math.min(10000, block.props.previewWidth)}px"` : '';
    return `<figure${id}>${url ? `<img src="${esc(url)}" alt="${esc(block.props.caption || block.props.name || '')}"${width}>` : ''}${block.props.caption ? `<figcaption>${esc(block.props.caption)}</figcaption>` : ''}</figure>${children}`;
  }
  return `<p${id}${align}>${content || '<br>'}</p>${children}`;
}
export function blocksHtml(blocks: readonly DocumentBlock[]): string {
  let html = '';
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (!['bulletListItem', 'numberedListItem', 'checkListItem'].includes(block.type)) { html += blockBody(block); continue; }
    const tag = block.type === 'numberedListItem' ? 'ol' : 'ul', list = [block];
    while (blocks[index + 1]?.type === block.type) list.push(blocks[++index]!);
    const start = (item: DocumentBlock) => item.type === 'numberedListItem' && typeof item.props.start === 'number' && Number.isInteger(item.props.start) ? item.props.start : undefined;
    html += `<${tag}${block.type === 'checkListItem' ? ' class="document-tasks"' : start(block) !== undefined ? ` start="${start(block)}"` : ''}>${list.map((item, at) => `<li data-block-id="${esc(item.id)}"${at && start(item) !== undefined ? ` value="${start(item)}"` : ''}>${item.type === 'checkListItem' ? `<input type="checkbox" disabled${item.props.checked ? ' checked' : ''}> ` : ''}${inline(item.content)}${blocksHtml(item.children ?? [])}</li>`).join('')}</${tag}>`;
  }
  return html;
}
export const DOCUMENT_EXPORT_CSS = `.studio-document{box-sizing:border-box;line-height:1.8;color:#24303e;background:#fff;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;padding:28px;overflow-wrap:anywhere}.studio-document h1,.studio-document h2,.studio-document h3{line-height:1.4;margin:1.25em 0 .5em}.studio-document p{margin:.65em 0}.studio-document img{max-width:100%;height:auto}.studio-document figure{margin:1em 0}.studio-document figcaption{font-size:13px;color:#65717e}.studio-document pre{padding:14px;background:#f2f4f7;border-radius:6px;overflow:auto;white-space:pre-wrap}.studio-document code{font-family:Consolas,monospace}.studio-document blockquote{border-left:3px solid #abb9c8;padding-left:16px;margin:1em 0;color:#526172}.studio-document table{border-collapse:collapse;width:100%}.studio-document th,.studio-document td{border:1px solid #ccd4de;padding:6px 10px;min-width:60px}.studio-document .document-table{overflow:auto}.studio-document .document-tasks{list-style:none;padding-left:1em}.studio-document a{color:#325fc1}.studio-document hr{border:0;border-top:1px solid #ccd4de;margin:20px 0}`;
export function documentHtml(document: DocumentContent, title: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';img-src data:;object-src 'none';base-uri 'none';form-action 'none'"><title>${esc(title)}</title><style>body{margin:0;background:#f3f5f7}main{max-width:900px;margin:auto;min-height:100vh}${DOCUMENT_EXPORT_CSS}</style></head><body><main class="studio-document"><h1>${esc(title)}</h1>${blocksHtml(document.blocks)}</main></body></html>`;
}
