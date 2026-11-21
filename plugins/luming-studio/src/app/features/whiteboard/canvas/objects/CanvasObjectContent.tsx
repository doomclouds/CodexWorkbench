import type { ReactNode } from 'react';
import { ExternalLink, Link } from 'lucide-react';
import type { BoardElement, StudioClient, StyleProfile } from '../../../../../contracts/studio.js';
import { nativeTextInk } from '../../../../../shared/native-surface.js';
import { parseRichText } from '../../../../../shared/rich-text.js';
import { strokePath } from '../../../../../shared/whiteboard-geometry.js';
import { getBoardSticker } from '../../../../../shared/whiteboard-stickers.js';
import { safeHttpLink } from '../scene/canvas-model.js';
import {
  overviewSectionTitle,
  overviewStrokeWidth,
  type sectionTitleDetails,
} from '../scene/canvas-presentation.js';
import { Shape } from './CanvasShape.js';
import { CroppedImage } from './NativeMedia.js';
import RichText from './RichText.js';
import Sticker from './Sticker.js';

export type CanvasSectionTitle = ReturnType<ReturnType<typeof sectionTitleDetails>['get']>;

export interface CanvasObjectAssets {
  resolve(source: string | undefined): string | undefined;
  state(source: string): ReturnType<NonNullable<StudioClient['assetState']>>;
}

interface CanvasObjectContentProps {
  element: BoardElement;
  assets: CanvasObjectAssets;
  zoom: number;
  viewStyle: StyleProfile;
  editor?: ReactNode;
  expanded: boolean;
  showText: boolean;
  showMediaControls: boolean;
  sectionTitle?: CanvasSectionTitle;
  lineColor: string;
  dash: string | undefined;
  fill: string;
  color: unknown;
  backdrop: string;
}

export function CanvasObjectContent({
  element,
  assets,
  zoom,
  viewStyle,
  editor,
  expanded,
  showText,
  showMediaControls,
  sectionTitle,
  lineColor,
  dash,
  fill,
  color,
  backdrop,
}: CanvasObjectContentProps) {
  if (element.type === 'stroke') {
    return renderStroke();
  }
  if (element.type === 'image') {
    return renderMedia();
  }
  if (element.type === 'link') {
    return renderLink();
  }
  if (element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId)) {
    return renderSticker();
  }
  if (element.type === 'container') {
    return renderSection();
  }

  return renderBasicElement();

  function renderStroke() {
    return (
      <svg className="studio-stroke-svg" overflow="visible" aria-hidden="true">
        <path
          d={strokePath(element.points)}
          fill="none"
          stroke={lineColor}
          strokeWidth={overviewStrokeWidth(Number(element.strokeWidth ?? element.width ?? 3), zoom)}
          strokeDasharray={expanded && element.dash ? '6 5' : dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  function renderMedia() {
    const src = assets.resolve(element.src);
    const video = assets.resolve(element.video);
    const href = safeHttpLink(element.href);
    const mediaState = assets.state(element.video || element.src || '');
    const unavailable = Boolean((element.video && !video) || (!element.video && !src));
    function renderMediaBody() {
      if (video) {
        return (
          <video
            src={video}
            controls={showMediaControls}
            preload="metadata"
            playsInline
            poster={src}
            data-native-interactive={showMediaControls ? 'true' : undefined}
            style={showMediaControls ? undefined : { pointerEvents: 'none' }}
            tabIndex={showMediaControls ? undefined : -1}
          />
        );
      }
      if (src) {
        return (
          <>
            <CroppedImage element={element} src={src} />
            {href && showMediaControls && (
              <a
                className="studio-image-link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="打开图片链接"
                data-native-interactive="true"
              >
                <ExternalLink size={16} />
              </a>
            )}
          </>
        );
      }

      return null;
    }
    let message = '无法读取媒体';
    if (mediaState?.status === 'loading') {
      message = '正在加载媒体…';
    } else if (mediaState?.status === 'error') {
      message = mediaState.message || '媒体加载失败。';
    }
    return (
      <>
        {renderMediaBody()}
        {unavailable && (
          <div
            className="studio-media-missing studio-media-state"
            role={mediaState?.status === 'error' ? 'alert' : 'status'}
          >
            {message}
          </div>
        )}
      </>
    );
  }
  function renderLink() {
    return (
      <div className="studio-link-card" style={{ background: fill }}>
        <Link size={22} />
        {showText && (
          <>
            <div>
              <strong>{element.text || '链接'}</strong>
              <span style={{ color: nativeTextInk(color ?? 'muted', viewStyle, fill, backdrop) }}>
                {element.href}
              </span>
            </div>
            <a
              href={safeHttpLink(element.href)}
              target="_blank"
              rel="noreferrer"
              aria-label="打开链接"
              data-native-interactive="true"
            >
              <ExternalLink size={17} />
            </a>
          </>
        )}
      </div>
    );
  }
  function renderSticker() {
    return <Sticker id={element.data?.stickerIconId} />;
  }
  function renderSection() {
    if (editor || expanded || sectionTitle?.mode === 'full') {
      return (
        <div className="studio-section-title" data-canvas-external-title="">
          {editor ?? <RichText text={element.text} />}
        </div>
      );
    } else if (sectionTitle?.mode === 'overview') {
      const name = parseRichText(element.text ?? '')
        .map((line) => line.segments.map((segment) => segment.text).join(''))
        .join(' ')
        .trim();
      const { fontSize, height, gap } = overviewSectionTitle;
      return (
        <div
          className="studio-section-title is-overview"
          data-canvas-external-title="overview"
          title={name}
          style={{
            fontSize: fontSize / zoom,
            lineHeight: `${height / zoom}px`,
            maxWidth: `min(100%, ${sectionTitle.width}px)`,
            bottom: `calc(100% + ${gap / zoom}px)`,
          }}
        >
          {name}
        </div>
      );
    }
  }
  function renderBasicElement() {
    return (
      <>
        {element.type === 'shape' && (
          <Shape
            element={{
              ...element,
              fill,
              stroke: lineColor,
              dash: !!(element.dash && (expanded || dash)),
            }}
          />
        )}
        {element.type === 'note' && (
          <div className="studio-note-fill" style={{ background: fill }} />
        )}
        {showText || element.type === 'sticker' ? (
          <div
            className={`studio-element-text${element.type === 'sticker' ? ' studio-sticker-text' : ''}`}
            style={{
              padding: element.type === 'text' || element.type === 'sticker' ? 2 : 16,
              ...(element.kind === 'person' ? { top: '39%', paddingTop: 4 } : {}),
            }}
          >
            {editor ?? <RichText text={element.text} />}
          </div>
        ) : (
          element.type === 'text' &&
          !!element.text && (
            <span
              className="studio-text-preview"
              aria-hidden="true"
              style={{ height: Math.min(2 / zoom, element.h / 3) }}
            />
          )
        )}
      </>
    );
  }
}
