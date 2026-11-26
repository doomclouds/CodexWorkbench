import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { Button } from '../../../base/index.js';
import type { SearchFieldHandle } from '../../../base/index.js';
import type { DocumentBlock } from './contracts.js';
import { DocumentOutlineSelect, DocumentReaderTools } from './DocumentToolbar.js';
import { blockText, untitledDocument } from './model.js';
import type { useDocumentViewport } from './useDocumentViewport.js';

interface DocumentReadingLayoutProps {
  readonly focused: boolean;
  readonly onBack?: () => void;
  readonly closingDisabled: boolean;
  readonly viewport: ReturnType<typeof useDocumentViewport>;
  readonly searchField: Ref<SearchFieldHandle>;
  readonly expanded: boolean;
  readonly interactive: boolean;
  readonly heading: ReactNode;
  readonly renderActions: (outline?: ReactNode) => ReactNode;
  readonly comparison: ReactNode;
  readonly children: ReactNode;
}

type DocumentFocusedReadingProps = Pick<
  DocumentReadingLayoutProps,
  | 'onBack'
  | 'closingDisabled'
  | 'viewport'
  | 'searchField'
  | 'heading'
  | 'renderActions'
  | 'children'
  | 'comparison'
>;

function headingPadding(block: DocumentBlock) {
  const { level } = block.props;
  const depth = typeof level === 'number' && Number.isInteger(level) ? level : 1;

  return 10 + Math.min(6, Math.max(1, depth)) * 8;
}

function DocumentBackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7M5 12h14" />
    </svg>
  );
}

function DocumentFocusedReading({
  onBack,
  closingDisabled,
  viewport,
  searchField,
  heading,
  renderActions,
  comparison,
  children,
}: DocumentFocusedReadingProps) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineButton = useRef<HTMLButtonElement>(null);
  const hasHeadings = viewport.headings.length > 0;
  const showOutline = hasHeadings && outlineOpen;

  function handleOutlineKey(event: KeyboardEvent<HTMLElement>) {
    const handled = event.defaultPrevented || event.nativeEvent.isComposing;
    if (!outlineOpen || event.key !== 'Escape' || handled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setOutlineOpen(false);
    outlineButton.current?.focus();
  }

  const outline = hasHeadings && (
    <button
      ref={outlineButton}
      type="button"
      className="studio-document-focused-toggle"
      aria-label="切换文档目录"
      aria-expanded={showOutline}
      title="文档目录"
      onClick={() => setOutlineOpen((current) => !current)}
      onKeyDown={handleOutlineKey}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    </button>
  );

  return (
    <>
      <header className="studio-document-focused-heading">
        {onBack && (
          <div className="studio-document-focused-back" data-canvas-presentation-exit="">
            <Button
              label="返回白板"
              icon={<DocumentBackIcon />}
              disabled={closingDisabled}
              onActivate={onBack}
            />
          </div>
        )}
        {heading}
        {renderActions(outline)}
      </header>
      <div className="studio-document-focused-find">
        <DocumentReaderTools viewport={viewport} searchField={searchField} showOutline={false} />
      </div>
      {showOutline && (
        <div className="studio-document-focused-mobile-outline">
          <DocumentOutlineSelect viewport={viewport} />
        </div>
      )}
      <div className="studio-document-body">
        {showOutline && (
          <nav
            className="studio-document-focused-outline"
            aria-label="文档目录"
            onKeyDown={handleOutlineKey}
          >
            <strong>文档目录</strong>
            {viewport.headings.map((block) => (
              <button
                key={block.id}
                type="button"
                style={{ paddingInlineStart: headingPadding(block) }}
                onClick={() => viewport.reveal(block.id)}
              >
                {blockText(block) || untitledDocument}
              </button>
            ))}
          </nav>
        )}
        {children}
      </div>
      {comparison}
    </>
  );
}

export function DocumentReadingLayout({
  focused,
  onBack,
  closingDisabled,
  viewport,
  searchField,
  expanded,
  interactive,
  heading,
  renderActions,
  comparison,
  children,
}: DocumentReadingLayoutProps) {
  if (focused) {
    return (
      <DocumentFocusedReading
        onBack={onBack}
        closingDisabled={closingDisabled}
        viewport={viewport}
        searchField={searchField}
        heading={heading}
        renderActions={renderActions}
        comparison={comparison}
      >
        {children}
      </DocumentFocusedReading>
    );
  }

  return (
    <>
      <div className="studio-document-top" data-canvas-native="">
        {heading}
        {renderActions()}
        {expanded && <DocumentReaderTools viewport={viewport} searchField={searchField} />}
      </div>
      <div className="studio-document-body" inert={!interactive && !expanded}>
        {children}
      </div>
      {comparison}
    </>
  );
}
