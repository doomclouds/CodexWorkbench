import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';

import type { WhiteboardPoint } from '../../data/whiteboard/index.js';
import { Button, StatusText } from '../../ui/base/index.js';
import { imageBoardSize } from './board-media-state.js';
import type { PreparedBoardImage } from './contracts.js';

interface ImageGhostProps {
  readonly image: PreparedBoardImage;
  readonly zoom: number;
  readonly center?: WhiteboardPoint;
}

export function ImageGhost({ image, zoom, center }: ImageGhostProps) {
  const { width, height } = imageBoardSize(image);

  return (
    <img
      className="whiteboard-media__preview"
      src={image.previewUrl}
      alt=""
      draggable={false}
      aria-hidden="true"
      style={{
        left: center?.x ?? '50%',
        top: center?.y ?? '50%',
        width: width * zoom,
        height: height * zoom,
      }}
    />
  );
}

interface ImagePlacementProps {
  readonly image: PreparedBoardImage;
  readonly zoom: number;
  readonly onCancel: () => void;
  readonly onPlace: (point: WhiteboardPoint) => void;
}

function clickPosition(event: MouseEvent<HTMLButtonElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();

  return event.detail === 0
    ? { x: bounds.width / 2, y: bounds.height / 2 }
    : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export function MediaPlacement({ image, zoom, onCancel, onPlace }: ImagePlacementProps) {
  const target = useRef<HTMLButtonElement>(null);
  const [point, setPoint] = useState<WhiteboardPoint>();

  useLayoutEffect(() => {
    target.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="whiteboard-media__placement">
      <button
        ref={target}
        className="whiteboard-media__target"
        type="button"
        aria-label="将图片放到白板"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        }}
        onClick={(event) => onPlace(clickPosition(event))}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <ImageGhost image={image} zoom={zoom} center={point} />
      <div className="whiteboard-media__notice">
        <StatusText message="选择图片的放置位置。按 Esc 取消。" announcement="polite" />
        <Button label="取消放置" onActivate={onCancel} />
      </div>
    </div>
  );
}
