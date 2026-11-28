import { useCallback, useRef, type DragEvent } from 'react';
import type { CanvasPoint } from '../../ui/domain/canvas/index.js';
import type { BoardMediaUpload } from './board-features.js';
import { useBoardClipboard } from './use-board-clipboard.js';

const nativeDropTypes = new Set(['image', 'video']);

interface WorkspaceTransfersOptions extends Omit<
  Parameters<typeof useBoardClipboard>[0],
  'onMedia'
> {
  readonly canvasArea: HTMLDivElement | null;
  readonly canDrop: boolean;
}

export function useWorkspaceTransfers({
  canvasArea,
  canDrop,
  ...clipboardOptions
}: WorkspaceTransfersOptions) {
  const mediaUploadRef = useRef<BoardMediaUpload | undefined>(undefined);
  const handleUploadReady = useCallback((upload: BoardMediaUpload | undefined) => {
    mediaUploadRef.current = upload;
  }, []);

  function uploadMedia(files: readonly File[], point?: CanvasPoint) {
    const accepted = files.filter(({ type }) => nativeDropTypes.has(type.split('/')[0] ?? ''));
    if (!canDrop || !mediaUploadRef.current || accepted.length === 0) {
      return false;
    }

    mediaUploadRef.current(accepted, point);
    return true;
  }
  const clipboard = useBoardClipboard({ ...clipboardOptions, onMedia: uploadMedia });

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return;
    }

    const bounds = canvasArea?.getBoundingClientRect();
    const point = bounds && { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    if (uploadMedia(Array.from(event.dataTransfer.files), point)) {
      event.preventDefault();
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    const canReceiveFiles = canDrop && Boolean(mediaUploadRef.current);
    if (!event.defaultPrevented && canReceiveFiles && event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
    }
  }

  return { ...clipboard, handleUploadReady, handleDrop, handleDragOver };
}
