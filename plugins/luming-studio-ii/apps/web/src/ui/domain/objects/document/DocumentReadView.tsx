import { createElement, Fragment } from 'react';
import type { ReactNode } from 'react';
import { Checkbox } from '../../../base/index.js';
import type { DocumentBlock, DocumentContent, DocumentObjectProps } from './contracts.js';
import { DocumentImage } from './DocumentImage.js';
import { blockText, isRecord, safeDocumentLink, tableRows } from './model.js';

interface DocumentReadViewProps {
  readonly value: DocumentContent;
  readonly resolveImage?: DocumentObjectProps['resolveImage'];
  readonly selectedId?: string;
  readonly matchingIds?: ReadonlySet<string>;
}

type ChildViewOptions = Omit<DocumentReadViewProps, 'value'>;

const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const markTags = [
  ['code', 'code'],
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['strike', 's'],
] as const;
const textAlignments = new Set(['left', 'center', 'right', 'justify']);
const listTypes = new Set(['bulletListItem', 'numberedListItem']);
const inlineColors = new Set([
  'gray',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
]);

function ink(value: unknown, role: 'text' | 'background') {
  if (typeof value === 'string' && inlineColors.has(value)) {
    return 'var(--studio-document-' + role + '-' + value + ')';
  }
}

function inlineSegment(item: unknown): ReactNode {
  if (typeof item === 'string') {
    return item;
  }
  if (!isRecord(item)) {
    return null;
  }

  if (item.type === 'link') {
    const url = safeDocumentLink(item.href);
    const children = inline(item.content);

    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      children
    );
  }

  const text = typeof item.text === 'string' ? item.text : '';
  const styles = isRecord(item.styles) ? item.styles : {};
  const marked = markTags.reduce<ReactNode>(
    (child, [mark, Tag]) => (styles[mark] ? <Tag>{child}</Tag> : child),
    text,
  );
  const color = ink(styles.textColor, 'text');
  const backgroundColor = ink(styles.backgroundColor, 'background');

  return color || backgroundColor ? (
    <span style={{ color, backgroundColor }}>{marked}</span>
  ) : (
    marked
  );
}

function inline(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    return value.map((item, index) => <Fragment key={index}>{inlineSegment(item)}</Fragment>);
  }

  return inlineSegment(value);
}

function tableCell(cell: unknown) {
  return isRecord(cell) && cell.type === 'tableCell' ? cell.content : cell;
}

function ReadTable({ block }: { readonly block: DocumentBlock }) {
  const rows = tableRows(block.content);
  const headerRows = isRecord(block.content) ? Number(block.content.headerRows) || 0 : 0;

  return (
    <table>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, position) => {
              const Cell = index < headerRows ? 'th' : 'td';

              return <Cell key={position}>{inline(tableCell(cell))}</Cell>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BlockBody({
  block,
  resolveImage,
}: {
  readonly block: DocumentBlock;
  readonly resolveImage?: DocumentObjectProps['resolveImage'];
}) {
  const body = inline(block.content);
  switch (block.type) {
    case 'heading': {
      const heading = headingTags.at(Number(block.props.level || 1) - 1) ?? 'h2';

      return createElement(heading, null, body);
    }
    case 'quote':
      return <blockquote>{body}</blockquote>;
    case 'codeBlock':
      return (
        <pre>
          <code>{blockText(block)}</code>
        </pre>
      );
    case 'divider':
      return <hr />;
    case 'image':
      return <DocumentImage block={block} resolveImage={resolveImage} />;
    case 'table':
      return <ReadTable block={block} />;
    case 'checkListItem':
      return (
        <Checkbox
          label={blockText(block)}
          checked={block.props.checked === true}
          disabled
          onCheckedChange={() => undefined}
        />
      );
    case 'paragraph':
    case 'numberedListItem':
    case 'bulletListItem':
      return <p>{body}</p>;
  }
}

function blockAttributes(block: DocumentBlock, { selectedId, matchingIds }: ChildViewOptions) {
  const textAlignment = block.props.textAlignment;
  const align =
    typeof textAlignment === 'string' && textAlignments.has(textAlignment)
      ? (textAlignment as 'left' | 'center' | 'right' | 'justify')
      : undefined;

  return {
    'data-document-read-block': block.id,
    'data-document-match': matchingIds?.has(block.id) || undefined,
    'data-document-current': selectedId === block.id || undefined,
    style: { textAlign: align },
  };
}

interface ReadBlockGroup {
  readonly type: 'bulletListItem' | 'numberedListItem' | 'block';
  readonly blocks: DocumentBlock[];
}

function groupBlocks(blocks: readonly DocumentBlock[]) {
  const groups: ReadBlockGroup[] = [];
  for (const block of blocks) {
    const previous = groups.at(-1);
    const type =
      block.type === 'bulletListItem' || block.type === 'numberedListItem' ? block.type : 'block';

    if (listTypes.has(type) && previous?.type === type) {
      previous.blocks.push(block);
    } else {
      groups.push({ type, blocks: [block] });
    }
  }

  return groups;
}

function ReadList({
  group,
  options,
}: {
  readonly group: ReadBlockGroup;
  readonly options: ChildViewOptions;
}) {
  const List = group.type === 'numberedListItem' ? 'ol' : 'ul';

  return (
    <List>
      {group.blocks.map((block) => (
        <li key={block.id} {...blockAttributes(block, options)}>
          {inline(block.content)}
          <ReadBlocks blocks={block.children ?? []} options={options} />
        </li>
      ))}
    </List>
  );
}

function ReadBlocks({
  blocks,
  options,
}: {
  readonly blocks: readonly DocumentBlock[];
  readonly options: ChildViewOptions;
}) {
  return groupBlocks(blocks).map((group) => {
    const block = group.blocks[0];
    if (!block) {
      return null;
    }
    if (group.type !== 'block') {
      return <ReadList key={block.id} group={group} options={options} />;
    }

    return (
      <div key={block.id} {...blockAttributes(block, options)}>
        <BlockBody block={block} resolveImage={options.resolveImage} />
        <ReadBlocks blocks={block.children ?? []} options={options} />
      </div>
    );
  });
}

export function DocumentReadView({ value, ...options }: DocumentReadViewProps) {
  return (
    <article className="studio-document-reading">
      <ReadBlocks blocks={value.blocks} options={options} />
    </article>
  );
}
