import { createElement, Fragment, useEffect, useState, type ReactNode } from 'react';
import type { StudioClient } from '../../contracts/studio.js';
import { documentBlockText, type DocumentBlock, type DocumentContent } from '../../contracts/document.js';
import { assetDisplayUrl, safeHttpLink } from './canvas-model.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function inline(value: unknown): ReactNode {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  return value.map((item, index) => {
    if (!record(item)) return null;
    if (item.type === 'link') return <a key={index} href={typeof item.href === 'string' ? safeHttpLink(item.href) : undefined} target="_blank" rel="noopener noreferrer">{inline(item.content)}</a>;
    let text: ReactNode = typeof item.text === 'string' ? item.text : '';
    const styles = record(item.styles) ? item.styles : {};
    if (styles.code) text = <code>{text}</code>;
    if (styles.bold) text = <strong>{text}</strong>;
    if (styles.italic) text = <em>{text}</em>;
    if (styles.underline) text = <u>{text}</u>;
    if (styles.strike) text = <s>{text}</s>;
    return <Fragment key={index}>{text}</Fragment>;
  });
}
export default function DocumentReadView({ document, client, highlightedIds = [], find = '' }: { document: DocumentContent; client: StudioClient; highlightedIds?: string[]; find?: string }) {
  const [, refresh] = useState(0);
  useEffect(() => client.subscribeAssets?.(() => refresh(value => value + 1)), [client]);
  function blockViews(blocks: DocumentBlock[]): ReactNode {
    let sequence = 0;
    return blocks.map(block => { sequence = block.type === 'numberedListItem' ? Number(block.props.start) || sequence + 1 : 0; return blockView(block, sequence); });
  }
  function blockView(block: DocumentBlock, sequence: number): ReactNode {
    const content = inline(block.content), text = documentBlockText(block);
    let node: ReactNode;
    switch (block.type) {
      case 'heading': { const level = Math.max(1, Math.min(6, Number(block.props.level) || 1)); node = createElement(`h${level}`, null, content); break; }
      case 'bulletListItem': node = <div className="studio-doc-list-item"><span aria-hidden="true">•</span><div>{content}</div></div>; break;
      case 'numberedListItem': node = <div className="studio-doc-list-item"><span aria-hidden="true">{sequence}.</span><div>{content}</div></div>; break;
      case 'checkListItem': node = <label className="studio-doc-task"><input type="checkbox" checked={Boolean(block.props.checked)} disabled /><span>{content}</span></label>; break;
      case 'quote': node = <blockquote>{content}</blockquote>; break;
      case 'codeBlock': node = <pre><code>{typeof block.content === 'string' ? block.content : text}</code></pre>; break;
      case 'divider': node = <hr />; break;
      case 'image': { const source = assetDisplayUrl(String(block.props.url || ''), client); node = source ? <figure><img src={source} alt={String(block.props.caption || block.props.name || '')} loading="lazy" style={{ width: typeof block.props.previewWidth === 'number' && block.props.previewWidth > 0 ? block.props.previewWidth : undefined }} />{block.props.caption && <figcaption>{String(block.props.caption)}</figcaption>}</figure> : <p className="studio-doc-unavailable">图片尚未加载或已不可用</p>; break; }
      case 'table': {
        const table = record(block.content) ? block.content : {}, rows = Array.isArray(table.rows) ? table.rows : [];
        node = <div className="studio-doc-table-wrap"><table><tbody>{rows.map((row, index) => <tr key={index}>{(record(row) && Array.isArray(row.cells) ? row.cells : []).map((cell, column) => <td key={column}>{inline(typeof cell === 'string' || Array.isArray(cell) ? cell : record(cell) ? cell.content : [])}</td>)}</tr>)}</tbody></table></div>;
        break;
      }
      default: node = <p>{content || <br />}</p>;
    }
    const matched = Boolean(find.trim() && text.toLocaleLowerCase().includes(find.trim().toLocaleLowerCase()));
    return <Fragment key={block.id}><div data-document-block-id={block.id} className={`studio-doc-block${highlightedIds.includes(block.id) ? ' is-anchored' : ''}${matched ? ' is-find-match' : ''}`} style={{ textAlign: ['left', 'right', 'center', 'justify'].includes(String(block.props.textAlignment)) ? block.props.textAlignment as 'left' : undefined }}>{node}</div>{!!block.children?.length && <div className="studio-doc-children">{blockViews(block.children)}</div>}</Fragment>;
  }
  return <article className="studio-doc-prose">{blockViews(document.blocks)}</article>;
}
