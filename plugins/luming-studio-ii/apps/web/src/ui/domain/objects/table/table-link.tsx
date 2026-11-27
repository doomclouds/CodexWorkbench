import { AnchoredPopover, type AnchoredPopoverCloseReason } from '../../../base/index.js';
import { InlineTextLinkEditor } from '../text/index.js';
import { sameCell } from './table-grid.js';
import type { CellAddress } from './table-model.js';

export interface CellLinkDraft {
  readonly cell: CellAddress;
  readonly anchor: HTMLTableCellElement;
  readonly url: string;
}

interface TableLinkPopoverProps {
  readonly link?: CellLinkDraft;
  readonly onApply: (url: string) => boolean;
  readonly onClose: () => void;
  readonly onDismiss: (reason: AnchoredPopoverCloseReason) => void;
}

export function activeCellLink(
  editable: boolean,
  currentCell: CellAddress | null,
  link: CellLinkDraft | undefined,
) {
  return editable && link && sameCell(currentCell, link.cell) ? link : undefined;
}

export function TableLinkPopover({ link, onApply, onClose, onDismiss }: TableLinkPopoverProps) {
  if (!link) {
    return null;
  }

  return (
    <AnchoredPopover
      open
      anchor={link.anchor}
      portalRoot={link.anchor.closest<HTMLElement>('.whiteboard-editor')}
      label="文字链接"
      onRequestClose={onDismiss}
    >
      <div className="studio-object-table-link" data-canvas-native="" data-canvas-controls="">
        <InlineTextLinkEditor
          initialUrl={link.url}
          label="文字链接地址"
          applyLabel="应用"
          onApply={onApply}
          onClose={onClose}
        />
      </div>
    </AnchoredPopover>
  );
}
