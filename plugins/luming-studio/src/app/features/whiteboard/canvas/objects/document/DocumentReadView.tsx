import { createElement, Fragment, useEffect, useState, type ReactNode } from 'react';
import type { StudioClient } from '../../../../../../contracts/studio.js';
import {
  documentBlockText,
  type DocumentBlock,
  type DocumentContent,
} from '../../../../../../contracts/document.js';
import { assetDisplayUrl, safeHttpLink } from '../../scene/canvas-model.js';
import { documentInlineColor } from '../../../../../../shared/document-surface.js';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function inline(value: unknown, scheme: 'light' | 'dark'): ReactNode {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }

  return value.map((item, index) => {
    if (!record(item)) {
      return null;
    }
    if (item.type === 'link') {
      return (
        <a
          key={index}
          href={typeof item.href === 'string' ? safeHttpLink(item.href) : undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          {inline(item.content, scheme)}
        </a>
      );
    }

    let text: ReactNode = typeof item.text === 'string' ? item.text : '';
    const styles = record(item.styles) ? item.styles : {};
    if (styles.code) {
      text = <code>{text}</code>;
    }
    if (styles.bold) {
      text = <strong>{text}</strong>;
    }
    if (styles.italic) {
      text = <em>{text}</em>;
    }
    if (styles.underline) {
      text = <u>{text}</u>;
    }
    if (styles.strike) {
      text = <s>{text}</s>;
    }

    const color = documentInlineColor(styles.textColor, 'text', scheme);
    const backgroundColor = documentInlineColor(styles.backgroundColor, 'background', scheme);
    if (color || backgroundColor) {
      text = <span style={{ color, backgroundColor }}>{text}</span>;
    }

    return <Fragment key={index}>{text}</Fragment>;
  });
}

function imageBlock(block: DocumentBlock, client: StudioClient): ReactNode {
  const { url, previewWidth, caption, name } = block.props;
  const source = assetDisplayUrl(String(url || ''), client);
  if (!source) {
    return <p className="studio-doc-unavailable">图片尚未加载或已不可用</p>;
  }

  const width = typeof previewWidth === 'number' && previewWidth > 0 ? previewWidth : undefined;

  return (
    <figure>
      <img src={source} alt={String(caption || name || '')} loading="lazy" style={{ width }} />
      {caption && <figcaption>{String(caption)}</figcaption>}
    </figure>
  );
}

function tableCellContent(cell: unknown): unknown {
  if (typeof cell === 'string' || Array.isArray(cell)) {
    return cell;
  }

  return record(cell) ? cell.content : [];
}

function tableBlock(value: unknown, scheme: 'light' | 'dark'): ReactNode {
  const rows = record(value) && Array.isArray(value.rows) ? value.rows : [];

  return (
    <div className="studio-doc-table-wrap">
      <table>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {(record(row) && Array.isArray(row.cells) ? row.cells : []).map((cell, column) => (
                <td key={column}>{inline(tableCellContent(cell), scheme)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocumentReadView({
  document,
  client,
  highlightedIds = [],
  find = '',
  scheme = 'light',
  annotating = false,
  interactive = false,
  renderCommentPins,
}: {
  document: DocumentContent;
  client: StudioClient;
  highlightedIds?: string[];
  find?: string;
  scheme?: 'light' | 'dark';
  annotating?: boolean;
  interactive?: boolean;
  renderCommentPins?: (blockId: string) => ReactNode;
}) {
  const [, refresh] = useState(0);
  useEffect(() => client.subscribeAssets?.(() => refresh((value) => value + 1)), [client]);
  function blockViews(blocks: DocumentBlock[]): ReactNode {
    let sequence = 0;

    return blocks.map((block) => {
      sequence = block.type === 'numberedListItem' ? Number(block.props.start) || sequence + 1 : 0;

      return blockView(block, sequence);
    });
  }

  function blockView(block: DocumentBlock, sequence: number): ReactNode {
    const content = inline(block.content, scheme);
    const text = documentBlockText(block);
    let node: ReactNode;
    switch (block.type) {
      case 'heading': {
        const level = Math.max(1, Math.min(6, Number(block.props.level) || 1));
        node = createElement(`h${level}`, null, content);
        break;
      }

      case 'bulletListItem':
        node = (
          <div className="studio-doc-list-item">
            <span aria-hidden="true">•</span>
            <div>{content}</div>
          </div>
        );
        break;
      case 'numberedListItem':
        node = (
          <div className="studio-doc-list-item">
            <span aria-hidden="true">{sequence}.</span>
            <div>{content}</div>
          </div>
        );
        break;
      case 'checkListItem':
        node = (
          <label className="studio-doc-task">
            <input type="checkbox" checked={Boolean(block.props.checked)} disabled />
            <span>{content}</span>
          </label>
        );
        break;
      case 'quote':
        node = <blockquote>{content}</blockquote>;
        break;
      case 'codeBlock':
        node = (
          <pre>
            <code>{typeof block.content === 'string' ? block.content : text}</code>
          </pre>
        );
        break;
      case 'divider':
        node = <hr />;
        break;
      case 'image':
        node = imageBlock(block, client);
        break;
      case 'table':
        node = tableBlock(block.content, scheme);
        break;
      case 'paragraph':
        node = <p>{content || <br />}</p>;
    }

    const matched = Boolean(
      find.trim() && text.toLocaleLowerCase().includes(find.trim().toLocaleLowerCase()),
    );

    return (
      <Fragment key={block.id}>
        <div
          data-document-block-id={block.id}
          data-document-annotation-target={annotating ? '' : undefined}
          tabIndex={annotating && interactive ? 0 : undefined}
          className={`studio-doc-block${highlightedIds.includes(block.id) ? ' is-anchored' : ''}${matched ? ' is-find-match' : ''}`}
          style={{
            textAlign: ['left', 'right', 'center', 'justify'].includes(
              String(block.props.textAlignment),
            )
              ? (block.props.textAlignment as 'left')
              : undefined,
          }}
        >
          {node}
          {renderCommentPins?.(block.id)}
        </div>
        {!!block.children?.length && (
          <div className="studio-doc-children">{blockViews(block.children)}</div>
        )}
      </Fragment>
    );
  }

  return <article className="studio-doc-prose">{blockViews(document.blocks)}</article>;
}
