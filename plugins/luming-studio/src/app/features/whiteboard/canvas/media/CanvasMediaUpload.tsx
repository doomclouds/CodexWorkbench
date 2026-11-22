import { Loader2 } from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';
import OperationNotice from '../../../../shared/OperationNotice.js';
import type { MediaUploadView } from './useCanvasMediaUpload.js';

const phaseLabels = {
  uploading: '正在上传',
  queued: '正在加入白板',
  failed: '尚未加入白板',
};

interface CanvasMediaInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
}

export function CanvasMediaInput({ inputRef, onFiles }: CanvasMediaInputProps) {
  function handleSelectFiles(event: ChangeEvent<HTMLInputElement>) {
    onFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  }

  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime"
      multiple
      hidden
      onChange={handleSelectFiles}
    />
  );
}

interface CanvasMediaPlaceholdersProps {
  batch: MediaUploadView | null;
  zoom: number;
  canEdit: boolean;
  preview?: boolean;
  retry: () => void;
  discard: () => void;
}

export function CanvasMediaPlaceholders({
  batch,
  zoom,
  canEdit,
  preview,
  retry,
  discard,
}: CanvasMediaPlaceholdersProps) {
  if (preview || !batch) {
    return null;
  }

  return batch.placeholders.map((placeholder, index) => {
    const element = batch.elements[index] ?? placeholder;

    return (
      <div
        key={`upload-${placeholder.id}`}
        data-upload-placeholder={placeholder.id}
        data-upload-phase={batch.phase}
        style={{
          position: 'absolute',
          left: element.x,
          top: element.y,
          width: element.w,
          height: element.h,
          border: `${1 / zoom}px dashed var(--studio-accent)`,
          background:
            batch.phase === 'uploading'
              ? 'color-mix(in srgb, var(--canvas-ui) 85%, transparent)'
              : undefined,
          pointerEvents: 'none',
          zIndex: 73,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 8 / zoom,
            top: 8 / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'left top',
            padding: '6px 8px',
            borderRadius: 5,
            background: 'var(--canvas-ui)',
            color: 'var(--canvas-ui-text)',
            font: '12px/1.5 Arial,"Microsoft YaHei",sans-serif',
            maxWidth: 280,
          }}
        >
          {batch.phase !== 'failed' && (
            <Loader2 size={13} className="studio-spin" aria-hidden="true" />
          )}
          {phaseLabels[batch.phase]} · {batch.files[index]!.name}
          {batch.phase === 'failed' && index === 0 && (
            <OperationNotice
              source="媒体上传"
              message={batch.error || '媒体尚未加入白板。'}
              fallbackStyle={{ pointerEvents: 'auto' }}
              closeLabel="关闭媒体上传通知"
              actions={
                <>
                  <button type="button" disabled={!canEdit} onClick={retry}>
                    重试加入白板
                  </button>
                  <button type="button" onClick={discard}>
                    移除上传草稿
                  </button>
                </>
              }
            />
          )}
        </div>
      </div>
    );
  });
}
