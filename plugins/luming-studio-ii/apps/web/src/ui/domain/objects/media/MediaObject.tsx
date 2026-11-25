import { useRef, useState } from 'react';
import { Button, StatusText } from '../../../base/index.js';
import type { ButtonHandle } from '../../../base/index.js';
import type {
  ImageObjectProps,
  MediaObjectProps,
  MediaObjectStatus,
  MediaSize,
  VideoObjectProps,
} from './contracts.js';
import { ImageCropDialog } from './ImageCropDialog.js';
import { ImagePreview } from './ImagePreview.js';
import { safeHttpLink } from './LinkObject.js';
import './media-object.css';

const mediaLoadError: MediaObjectStatus = { status: 'error' };

function MediaPlaceholder({ status }: { status: MediaObjectStatus | undefined }) {
  const failed = status?.status === 'error';
  const message = status?.status === 'loading' ? '正在加载媒体…' : '无法读取媒体';

  return (
    <div className="luming-media-placeholder">
      <StatusText
        message={failed ? status.message || '媒体加载失败。' : message}
        tone={failed ? 'error' : 'neutral'}
        announcement={failed ? 'assertive' : 'polite'}
      />
    </div>
  );
}

function useCropEditor(allowed: boolean, request: number | undefined) {
  const [editor, setEditor] = useState(() => ({
    allowed,
    request,
    open: allowed && request !== undefined,
  }));

  if (editor.allowed !== allowed || editor.request !== request) {
    const newRequest = request !== undefined && request !== editor.request;
    setEditor({ allowed, request, open: allowed && (editor.open || newRequest) });
  }

  function open() {
    setEditor((current) => ({ ...current, open: true }));
  }

  function close() {
    setEditor((current) => ({ ...current, open: false }));
  }

  return { isOpen: editor.open, open, close };
}

function ImageObject({
  src,
  label,
  width,
  height,
  crop,
  naturalSize,
  href,
  status,
  locked,
  readOnly,
  interactive = true,
  editRequest,
  onCropActivityChange,
  onSaveCrop,
}: ImageObjectProps) {
  const [decodedSize, setDecodedSize] = useState<MediaSize>();
  const [failed, setFailed] = useState(false);
  const unavailable = !src || failed || status?.status === 'error';
  const canCrop = interactive && !readOnly && !locked && onSaveCrop !== undefined && !unavailable;
  const editor = useCropEditor(canCrop, editRequest);
  const cropButton = useRef<ButtonHandle>(null);

  if (unavailable) {
    return <MediaPlaceholder status={failed ? mediaLoadError : status} />;
  }

  const frame = { width, height };
  const natural = decodedSize ?? naturalSize;
  const link = safeHttpLink(href);
  const openCrop = canCrop ? editor.open : undefined;

  return (
    <div className="luming-media-object">
      <ImagePreview
        src={src}
        label={label}
        crop={crop}
        onNaturalSize={setDecodedSize}
        onError={() => setFailed(true)}
        onRequestCrop={openCrop}
      />
      <div className="luming-media-object__actions">
        {link && interactive && (
          <a
            className="luming-media-link__target"
            aria-label="打开图片链接"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开
          </a>
        )}
        {openCrop && <Button ref={cropButton} label="裁剪图片" onActivate={openCrop} />}
      </div>
      {editor.isOpen && canCrop && (
        <ImageCropDialog
          src={src}
          label={label}
          frame={frame}
          initialCrop={crop}
          naturalSize={natural}
          onActivityChange={onCropActivityChange}
          onClose={editor.close}
          onRestoreFocus={() => cropButton.current?.focus()}
          onSave={onSaveCrop}
        />
      )}
    </div>
  );
}

function VideoObject({ src, label, poster, status, interactive = true }: VideoObjectProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed || status?.status === 'error') {
    return <MediaPlaceholder status={failed ? mediaLoadError : status} />;
  }

  return (
    <video
      className="luming-media-video"
      aria-label={label}
      src={src}
      poster={poster}
      controls={interactive}
      preload="metadata"
      playsInline
      tabIndex={interactive ? undefined : -1}
      data-interactive={interactive}
      data-canvas-native={interactive ? '' : undefined}
      onError={() => setFailed(true)}
    />
  );
}

export function MediaObject(props: MediaObjectProps) {
  return props.kind === 'image' ? (
    <ImageObject key={props.src} {...props} />
  ) : (
    <VideoObject key={props.src} {...props} />
  );
}
