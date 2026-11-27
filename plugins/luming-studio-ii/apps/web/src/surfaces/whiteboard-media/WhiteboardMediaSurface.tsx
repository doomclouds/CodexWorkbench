import { ImagePlus } from 'lucide-react';
import { useLayoutEffect, useRef, type ChangeEvent } from 'react';

import { Button, StatusText } from '../../ui/base/index.js';
import { previewAtGeometry } from './board-media-state.js';
import type { WhiteboardMediaSurfaceProps } from './contracts.js';
import { ImageGhost, MediaPlacement } from './MediaPlacement.js';
import { useBoardMedia } from './use-board-media.js';
import './whiteboard-media.css';

const imageTypes = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const videoTypes = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov';

interface ImageEntryProps {
  readonly video?: boolean;
  readonly disabled: boolean;
  readonly onChoose?: () => void;
}

function ImageEntry({ video, disabled, onChoose }: ImageEntryProps) {
  return (
    <button
      type="button"
      className="whiteboard-media__entry"
      disabled={disabled}
      onClick={onChoose}
    >
      <ImagePlus size={17} aria-hidden="true" />
      {video ? '上传图片或视频' : '上传图片'}
    </button>
  );
}

interface MediaNoticeProps {
  readonly media: ReturnType<typeof useBoardMedia>;
}

function MediaNotice({ media }: MediaNoticeProps) {
  const { state, dismiss, recoverSave, reposition, stopWaiting } = media;
  switch (state.kind) {
    case 'reading':
      return (
        <div className="whiteboard-media__notice">
          <StatusText message="正在读取媒体。" announcement="polite" busy />
          <Button label="取消读取" onActivate={dismiss} />
        </div>
      );
    case 'saving':
      return (
        <div className="whiteboard-media__notice">
          <StatusText
            message={'mediaType' in state.image ? '正在保存视频。' : '正在保存图片。'}
            announcement="polite"
            busy
          />
          <Button label="停止等待" onActivate={stopWaiting} />
        </div>
      );
    case 'uncertain':
      return (
        <div className="whiteboard-media__notice">
          <StatusText message={state.message} tone="warning" announcement="polite" />
          <Button label="核对保存结果" onActivate={() => recoverSave('check')} />
          <Button label="重试" onActivate={() => recoverSave('retry')} />
        </div>
      );
    case 'rejected':
    case 'readFailed':
      return (
        <div className="whiteboard-media__notice">
          <StatusText message={state.message} tone="error" announcement="assertive" />
          {state.kind === 'rejected' && <Button label="重新放置" onActivate={reposition} />}
          <Button label="关闭" onActivate={dismiss} />
        </div>
      );
    case 'idle':
    case 'placing':
      return null;
  }
}

function BoardMediaSession(props: WhiteboardMediaSurfaceProps) {
  const { canEdit, paused, viewport, renderTools, onUploadReady } = props;
  const input = useRef<HTMLInputElement>(null);
  const media = useBoardMedia(props);
  const liveUpload = useRef(media.upload);
  const { state } = media;
  const placing = state.kind === 'placing';
  const canChoose = state.kind === 'idle' || state.kind === 'readFailed';
  const video = Boolean(props.prepareVideo && props.service.attachVideo);

  useLayoutEffect(() => {
    liveUpload.current = media.upload;
  }, [media.upload]);
  useLayoutEffect(() => {
    if (canEdit && !paused && onUploadReady) {
      onUploadReady((files, point) => liveUpload.current(files, point));

      return () => onUploadReady(undefined);
    }
  }, [canEdit, paused, onUploadReady]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    media.upload(files);
  }

  if (paused) {
    return null;
  }
  if (!canEdit) {
    return renderTools(() => <ImageEntry disabled video={video} />);
  }

  return (
    <>
      <div inert={placing}>
        {renderTools((onChoose) => (
          <ImageEntry
            video={video}
            disabled={!canChoose}
            onChoose={() => {
              input.current?.click();
              onChoose();
            }}
          />
        ))}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        aria-label={video ? '选择图片或视频文件' : '选择图片文件'}
        accept={video ? imageTypes + ',' + videoTypes : imageTypes}
        onChange={handleFileChange}
      />
      {placing && (
        <MediaPlacement
          image={state.image}
          zoom={viewport.zoom}
          onCancel={media.dismiss}
          onPlace={media.insert}
        />
      )}
      {(state.kind === 'saving' || state.kind === 'uncertain') && (
        <ImageGhost
          image={state.image}
          zoom={viewport.zoom}
          center={previewAtGeometry(state.command.geometry, viewport)}
        />
      )}
      <MediaNotice media={media} />
    </>
  );
}

export function WhiteboardMediaSurface(props: WhiteboardMediaSurfaceProps) {
  return <BoardMediaSession key={props.boardId} {...props} />;
}
