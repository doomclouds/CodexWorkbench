import { useEffect, useState, type DragEvent, type ReactNode } from 'react';

import './FileDropZone.css';

const dropZoneClassName = 'studio-ui-file-drop-zone';

export interface FileDropZoneProps {
  label: string;
  disabled?: boolean;
  children?: ReactNode;
  onFilesDropped: (files: File[]) => void;
}

function ownsDragTarget(event: DragEvent<HTMLDivElement>) {
  const { target, currentTarget } = event;

  return target instanceof Element && target.closest(`.${dropZoneClassName}`) === currentTarget;
}

function canHandleFileDrag(event: DragEvent<HTMLDivElement>) {
  const hasFiles = event.dataTransfer?.types.includes('Files') === true;

  return hasFiles && ownsDragTarget(event) && !event.defaultPrevented;
}

export function FileDropZone({
  label,
  disabled = false,
  children,
  onFilesDropped,
}: FileDropZoneProps) {
  const [depth, setDepth] = useState(0);
  if (disabled && depth > 0) {
    setDepth(0);
  }

  const dragging = !disabled && depth > 0;

  useEffect(() => {
    if (!dragging) {
      return;
    }

    function handleDragEnd() {
      setDepth(0);
    }

    document.addEventListener('dragend', handleDragEnd, true);
    document.addEventListener('drop', handleDragEnd, true);

    return () => {
      document.removeEventListener('dragend', handleDragEnd, true);
      document.removeEventListener('drop', handleDragEnd, true);
    };
  }, [dragging]);

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (disabled || !canHandleFileDrag(event)) {
      return;
    }

    event.preventDefault();
    setDepth((current) => current + 1);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (ownsDragTarget(event)) {
      setDepth((current) => Math.max(0, current - 1));
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canHandleFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    setDepth(0);
    if (event.defaultPrevented || !ownsDragTarget(event)) {
      return;
    }

    const files = event.dataTransfer?.files;
    if (!files?.length) {
      return;
    }

    event.preventDefault();
    if (!disabled) {
      onFilesDropped(Array.from(files));
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={dropZoneClassName}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children ?? label}
    </div>
  );
}
