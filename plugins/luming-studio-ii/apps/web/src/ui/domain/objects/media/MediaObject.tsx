import { useRef, useState, type Ref } from 'react';
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
import { ExternalLinkIcon, safeHttpLink } from './LinkObject.js';
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

interface ImageActionsProps {
  readonly href?: string;
  readonly showLink: boolean;
  readonly showCrop: boolean;
  readonly cropButton: Ref<ButtonHandle>;
  readonly onCrop?: () => void;
}

function ImageActions({ href, showLink, showCrop, cropButton, onCrop }: ImageActionsProps) {
  const link = safeHttpLink(href);

  return (
    <div className="luming-media-object__actions">
      {link && showLink && (
        <a
          className="luming-image-link"
          aria-label="打开图片链接"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          data-canvas-native=""
        >
          <ExternalLinkIcon size={16} />
        </a>
      )}
      {onCrop && showCrop && <Button ref={cropButton} label="裁剪图片" onActivate={onCrop} />}
    </div>
  );
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
  showCropControl = true,
  showLinkControl = true,
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
  const openCrop = canCrop ? editor.open : undefined;

  return (
    <div className="luming-media-object" data-media-loading={decodedSize ? undefined : ''}>
      <ImagePreview
        src={src}
        label={label}
        frame={frame}
        naturalSize={natural}
        crop={crop}
        onNaturalSize={setDecodedSize}
        onError={() => setFailed(true)}
        onRequestCrop={openCrop}
      />
      <ImageActions
        href={href}
        showLink={interactive && showLinkControl}
        showCrop={showCropControl}
        cropButton={cropButton}
        onCrop={openCrop}
      />
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
